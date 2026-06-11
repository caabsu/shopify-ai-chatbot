import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config/env.js';
import { supabase } from '../config/supabase.js';
import { calculateSlaDeadline } from './sla.service.js';

const anthropic = new Anthropic({ apiKey: config.anthropic.apiKey });

// Haiku: triage runs on every inbound ticket, so it must be fast and cheap.
const TRIAGE_MODEL = 'claude-haiku-4-5-20251001';

export interface TriageResult {
  intent: string;
  sentiment: 'angry' | 'frustrated' | 'neutral' | 'positive';
  language: string;
  summary: string;
  suggested_priority: 'low' | 'medium' | 'high' | 'urgent';
  suggested_tags: string[];
  triaged_at: string;
}

const INTENTS = [
  'order_status', 'shipping_delay', 'return_refund', 'damaged_item', 'product_question',
  'cancel_order', 'address_change', 'discount_inquiry', 'wholesale_trade', 'feedback',
  'other',
] as const;

/**
 * AI auto-triage for new tickets: intent, sentiment, language, one-line summary,
 * suggested priority and tags. Stored at tickets.metadata.ai_triage so the inbox
 * and the detail view can show it without schema changes (see docs/migrations/010).
 *
 * If the model suggests urgent/high and the ticket still has the default
 * "medium" priority, the priority is applied and the SLA recalculated — angry
 * damaged-order emails shouldn't wait in the medium queue.
 */
export async function triageTicket(ticketId: string): Promise<TriageResult | null> {
  try {
    const { data: ticket } = await supabase
      .from('tickets')
      .select('id, ticket_number, brand_id, subject, priority, status, metadata, tags')
      .eq('id', ticketId)
      .single();
    if (!ticket) return null;

    const { data: firstMessages } = await supabase
      .from('ticket_messages')
      .select('content')
      .eq('ticket_id', ticketId)
      .eq('sender_type', 'customer')
      .order('created_at', { ascending: true })
      .limit(2);

    const body = (firstMessages ?? []).map((m) => m.content).join('\n\n').slice(0, 4000);
    if (!body.trim()) return null;

    const response = await anthropic.messages.create({
      model: TRIAGE_MODEL,
      max_tokens: 300,
      temperature: 0,
      system: `You triage incoming customer-support tickets for a Shopify store. Respond with ONLY a JSON object, no other text:
{
  "intent": one of ${JSON.stringify(INTENTS)},
  "sentiment": "angry" | "frustrated" | "neutral" | "positive",
  "language": ISO 639-1 code of the customer's language (e.g. "en", "de"),
  "summary": one sentence (max 110 chars) describing what the customer needs,
  "suggested_priority": "low" | "medium" | "high" | "urgent"  // urgent = angry customer, money at risk, time-critical; low = generic question
  "suggested_tags": up to 3 short kebab-case tags (e.g. "shipping-delay", "order-7598")
}`,
      messages: [{ role: 'user', content: `Subject: ${ticket.subject}\n\n${body}` }],
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]) as Partial<TriageResult>;

    const triage: TriageResult = {
      intent: typeof parsed.intent === 'string' ? parsed.intent : 'other',
      sentiment: (['angry', 'frustrated', 'neutral', 'positive'] as const).includes(parsed.sentiment as never)
        ? (parsed.sentiment as TriageResult['sentiment'])
        : 'neutral',
      language: typeof parsed.language === 'string' ? parsed.language.slice(0, 5).toLowerCase() : 'en',
      summary: typeof parsed.summary === 'string' ? parsed.summary.slice(0, 160) : '',
      suggested_priority: (['low', 'medium', 'high', 'urgent'] as const).includes(parsed.suggested_priority as never)
        ? (parsed.suggested_priority as TriageResult['suggested_priority'])
        : 'medium',
      suggested_tags: Array.isArray(parsed.suggested_tags)
        ? parsed.suggested_tags.filter((t): t is string => typeof t === 'string').slice(0, 3)
        : [],
      triaged_at: new Date().toISOString(),
    };

    const updates: Record<string, unknown> = {
      metadata: { ...((ticket.metadata as Record<string, unknown>) || {}), ai_triage: triage },
      updated_at: new Date().toISOString(),
    };

    // Escalate default-priority tickets the model flags as hot. Never downgrade,
    // and never touch a priority an agent (or the trade-member rule) already set.
    const escalate =
      ticket.priority === 'medium' &&
      (triage.suggested_priority === 'urgent' || triage.suggested_priority === 'high');
    if (escalate) {
      updates.priority = triage.suggested_priority;
      try {
        const sla = await calculateSlaDeadline(triage.suggested_priority, ticket.brand_id as string);
        if (sla) updates.sla_deadline = sla;
      } catch { /* keep existing SLA */ }
    }

    await supabase.from('tickets').update(updates).eq('id', ticketId);

    await supabase.from('ticket_events').insert({
      ticket_id: ticketId,
      event_type: 'ai_triaged',
      actor: 'ai',
      old_value: escalate ? ticket.priority : null,
      new_value: escalate ? triage.suggested_priority : triage.intent,
      metadata: { intent: triage.intent, sentiment: triage.sentiment, suggested_priority: triage.suggested_priority },
    });

    console.log(`[triage] Ticket #${ticket.ticket_number}: ${triage.intent} / ${triage.sentiment}${escalate ? ` → priority ${triage.suggested_priority}` : ''}`);
    return triage;
  } catch (err) {
    console.error('[triage] failed:', err instanceof Error ? err.message : err);
    return null;
  }
}
