import { supabase } from '../config/supabase.js';

/**
 * Wake tickets whose snooze has expired: clear metadata.snoozed_until, reopen
 * pending ones, and log an event. Runs from the 5-minute maintenance interval
 * in index.ts; the inbox also filters snoozes by time, so this is the audit
 * trail + status normalization rather than the gate.
 */
export async function wakeExpiredSnoozes(): Promise<number> {
  const nowIso = new Date().toISOString();

  const { data: due, error } = await supabase
    .from('tickets')
    .select('id, ticket_number, status, metadata')
    .in('status', ['open', 'pending'])
    .not('metadata->>snoozed_until', 'is', null)
    .lte('metadata->>snoozed_until', nowIso);

  if (error) {
    console.error('[maintenance] wakeExpiredSnoozes fetch error:', error.message);
    return 0;
  }
  if (!due || due.length === 0) return 0;

  for (const ticket of due) {
    const metadata = { ...((ticket.metadata as Record<string, unknown>) || {}) };
    const wasSnoozedUntil = metadata.snoozed_until;
    delete metadata.snoozed_until;

    await supabase
      .from('tickets')
      .update({
        metadata,
        status: 'open', // snoozed tickets park as pending; waking returns them to the queue
        updated_at: nowIso,
      })
      .eq('id', ticket.id);

    await supabase.from('ticket_events').insert({
      ticket_id: ticket.id,
      event_type: 'snooze_woke',
      actor: 'system',
      old_value: typeof wasSnoozedUntil === 'string' ? wasSnoozedUntil : null,
      new_value: 'open',
    });
  }

  console.log(`[maintenance] Woke ${due.length} snoozed ticket(s)`);
  return due.length;
}
