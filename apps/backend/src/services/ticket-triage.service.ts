import { assessTicketIntake } from './ticket-intelligence.service.js';
import { supabase } from '../config/supabase.js';
import { calculateSlaDeadline } from './sla.service.js';
import type { RequiredToolDefinition } from './deepseek-tool-call.service.js';
import {
  callSupportRequiredTool,
  type SupportModelGeneration,
} from './support-model-tool.service.js';
import { recordSupportGenerationRun } from './ai-generation-ledger.service.js';

const TRIAGE_PROMPT_VERSION = 'ticket-triage-2026-07-deepseek-v1';

export interface TriageResult {
  intent: string;
  sentiment: 'angry' | 'frustrated' | 'neutral' | 'positive';
  language: string;
  summary: string;
  suggested_priority: 'low' | 'medium' | 'high' | 'urgent';
  suggested_tags: string[];
  triaged_at: string;
  generation?: SupportModelGeneration & { prompt_version?: string };
}

const INTENTS = [
  'order_status', 'shipping_delay', 'return_refund', 'damaged_item', 'product_question',
  'cancel_order', 'address_change', 'discount_inquiry', 'wholesale_trade', 'feedback',
  'other',
] as const;

const TRIAGE_TOOL: RequiredToolDefinition = {
  name: 'triage_support_ticket',
  description: 'Return structured intake triage for one customer-support ticket.',
  inputSchema: {
    type: 'object',
    required: ['intent', 'sentiment', 'language', 'summary', 'suggested_priority', 'suggested_tags'],
    properties: {
      intent: { type: 'string', enum: [...INTENTS] },
      sentiment: { type: 'string', enum: ['angry', 'frustrated', 'neutral', 'positive'] },
      language: { type: 'string' },
      summary: { type: 'string' },
      suggested_priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
      suggested_tags: { type: 'array', maxItems: 3, items: { type: 'string' } },
    },
  },
};

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

    const { data: recentMessages } = await supabase
      .from('ticket_messages')
      .select('content')
      .eq('ticket_id', ticketId)
      .eq('sender_type', 'customer')
      .order('created_at', { ascending: false })
      .limit(3);

    const body = [...(recentMessages ?? [])].reverse().map((m) => m.content).join('\n\n').slice(-4000);
    if (!body.trim()) return null;

    const intake = await assessTicketIntake(ticketId, ticket.brand_id as string);
    const useJev = intake?.evaluation.mode === 'active' && intake.evaluation.status === 'completed';
    const response = useJev ? {
      value: { intent: intake.intent, sentiment: intake.sentiment, suggested_priority: intake.priority,
        summary: intake.intent.replace(/_/g, ' '), language: 'und', suggested_tags: [intake.intent.replace(/_/g, '-')] } as Partial<TriageResult>,
      generation: { access_provider: 'typesafe', provider: 'typesafe', model: intake.evaluation.model,
        requested_model: intake.evaluation.model, tier: 'flash', thinking: 'disabled', latency_ms: 0,
        usage: {}, response_id: intake.evaluation.run_id } as SupportModelGeneration,
    } : await callSupportRequiredTool<Partial<TriageResult>>({
      tier: 'flash',
      max_tokens: 400,
      temperature: 0,
      system: `Triage an incoming Shopify customer-support ticket.
Use one supported intent. The summary is one sentence (110 characters or fewer).
Urgent means an angry customer with money at risk or a genuinely time-critical issue.
Tags are up to three short kebab-case values. Language is an ISO 639-1 code.`,
      user: `Subject: ${ticket.subject}\n\n${body}`,
      tool: TRIAGE_TOOL,
      parse(value) {
        if (!value || typeof value !== 'object') throw new Error('Triage tool input must be an object');
        return value as Partial<TriageResult>;
      },
    });
    const parsed = response.value;
    if (!useJev) await recordSupportGenerationRun({
      purpose: 'ticket_triage',
      generation: response.generation,
      brandId: ticket.brand_id as string,
      ticketId,
      promptVersion: TRIAGE_PROMPT_VERSION,
      routerVersion: 'ticket-triage-router-v1',
      routerDecision: { tier: 'flash', reason: 'bounded_intent_sentiment_tagging' },
    });

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
      generation: {
        ...response.generation,
        prompt_version: TRIAGE_PROMPT_VERSION,
      },
    };

    let appliedPriority: string | null = null;
    let priorPriority: string | null = null;
    let committed = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data: current } = await supabase
        .from('tickets')
        .select('metadata, priority, updated_at, brand_id')
        .eq('id', ticketId)
        .single();
      if (!current) return null;
      const updates: Record<string, unknown> = {
        metadata: { ...((current.metadata as Record<string, unknown>) || {}), ai_triage: triage },
        updated_at: new Date().toISOString(),
      };
      const escalate = current.priority === 'medium'
        && (triage.suggested_priority === 'urgent' || triage.suggested_priority === 'high');
      if (escalate) {
        updates.priority = triage.suggested_priority;
        try {
          const sla = await calculateSlaDeadline(triage.suggested_priority, current.brand_id as string);
          if (sla) updates.sla_deadline = sla;
        } catch { /* keep existing SLA */ }
      }
      const { data: updated } = await supabase
        .from('tickets')
        .update(updates)
        .eq('id', ticketId)
        .eq('updated_at', current.updated_at)
        .select('id')
        .maybeSingle();
      if (updated) {
        priorPriority = current.priority;
        appliedPriority = escalate ? triage.suggested_priority : null;
        committed = true;
        break;
      }
    }
    if (!committed) {
      console.warn(`[triage] Ticket #${ticket.ticket_number} changed repeatedly; discarded stale triage result`);
      return null;
    }

    await supabase.from('ticket_events').insert({
      ticket_id: ticketId,
      event_type: 'ai_triaged',
      actor: 'ai',
      old_value: appliedPriority ? priorPriority : null,
      new_value: appliedPriority ?? triage.intent,
      metadata: {
        intent: triage.intent,
        sentiment: triage.sentiment,
        suggested_priority: triage.suggested_priority,
        model_provider: triage.generation?.provider,
        model_id: triage.generation?.model,
        model_tier: triage.generation?.tier,
        prompt_version: TRIAGE_PROMPT_VERSION,
      },
    });

    console.log(`[triage] Ticket #${ticket.ticket_number}: ${triage.intent} / ${triage.sentiment}${appliedPriority ? ` → priority ${appliedPriority}` : ''}`);
    return triage;
  } catch (err) {
    console.error('[triage] failed:', err instanceof Error ? err.message : err);
    return null;
  }
}
