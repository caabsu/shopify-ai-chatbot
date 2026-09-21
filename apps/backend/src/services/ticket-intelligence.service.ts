import { supabase } from '../config/supabase.js';
import { jevEnabledForBrand, scopedJev } from './jev-store.js';
import { ticketAiStore, contentHash, type IntakeAssessment, type IntakeState } from './support-ai.js';

export function ticketIntelligence(ticketId: string, brandId: string) {
  const store = ticketAiStore(supabase, ticketId, brandId);
  return { store, ai: scopedJev(supabase, brandId, ticketId) };
}

const pending = new Map<string, Promise<IntakeAssessment | null>>();

export async function assessTicketIntake(ticketId: string, brandId: string): Promise<IntakeAssessment | null> {
  if (!jevEnabledForBrand(brandId)) return null;
  try {
    const { data: ticket, error } = await supabase.from('tickets').select('subject, source').eq('id', ticketId).eq('brand_id', brandId).single();
    if (error || !ticket) return null;
    const { data: messages, error: messageError } = await supabase.from('ticket_messages').select('id, content, sender_type, is_internal_note, attachments, metadata')
      .eq('ticket_id', ticketId).order('created_at', { ascending: true }).order('id');
    if (messageError || !messages?.length) return null;
    const visible = messages.filter(m => !m.is_internal_note && m.sender_type !== 'system' && m.sender_type !== 'ai_draft');
    const outward = visible.filter(m => m.metadata?.email_status !== 'failed');
    const state: IntakeState = {
      subject: ticket.subject, source: ticket.source,
      latest_message_id: visible.at(-1)?.id,
      latest_message: outward.at(-1)?.content,
      thread: outward.map(m => `[${m.sender_type}] ${m.content}`).join('\n\n'),
      has_prior_agent_reply: outward.some(m => m.sender_type === 'agent'), latest_sender: outward.at(-1)?.sender_type ?? '',
      has_attachments: outward.some(m => (Array.isArray(m.attachments) && m.attachments.length > 0) || m.metadata?.has_attachments === true),
    };
    // Coalesce only the same snapshot. A new reply must not inherit an older
    // in-flight acknowledgement judgment.
    const key = `${brandId}:${ticketId}:${contentHash(state)}`;
    const existing = pending.get(key);
    if (existing) return await existing;
    const task = ticketIntelligence(ticketId, brandId).ai.intake(state).finally(() => { pending.delete(key); });
    pending.set(key, task);
    return await task;
  } catch (error) {
    console.error('[ticket-intelligence] Intake unavailable:', error instanceof Error ? error.message : 'unknown error');
    return null;
  }
}
