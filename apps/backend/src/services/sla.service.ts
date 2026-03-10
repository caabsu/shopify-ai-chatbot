import { supabase } from '../config/supabase.js';

// ── Calculate SLA Deadline ─────────────────────────────────────────────────
export async function calculateSlaDeadline(priority: string): Promise<string | null> {
  const { data: rule, error } = await supabase
    .from('sla_rules')
    .select()
    .eq('priority', priority)
    .single();

  if (error || !rule) {
    console.warn(`[sla.service] No SLA rule found for priority "${priority}"`);
    return null;
  }

  const deadlineMs = Date.now() + rule.first_response_minutes * 60 * 1000;
  return new Date(deadlineMs).toISOString();
}

// ── Check SLA Breaches ─────────────────────────────────────────────────────
export async function checkSlaBreaches(): Promise<number> {
  const now = new Date().toISOString();

  // Find tickets with breached SLAs
  const { data: breached, error: fetchError } = await supabase
    .from('tickets')
    .select('id, ticket_number')
    .in('status', ['open', 'pending'])
    .lt('sla_deadline', now)
    .eq('sla_breached', false);

  if (fetchError) {
    console.error('[sla.service] checkSlaBreaches fetch error:', fetchError.message);
    throw new Error('Failed to check SLA breaches');
  }

  if (!breached || breached.length === 0) {
    return 0;
  }

  const ids = breached.map((t: { id: string }) => t.id);

  // Update sla_breached flag
  const { error: updateError } = await supabase
    .from('tickets')
    .update({ sla_breached: true, updated_at: new Date().toISOString() })
    .in('id', ids);

  if (updateError) {
    console.error('[sla.service] checkSlaBreaches update error:', updateError.message);
    throw new Error('Failed to update SLA breaches');
  }

  // Log events for each breached ticket
  for (const ticket of breached) {
    const { error: eventError } = await supabase
      .from('ticket_events')
      .insert({
        ticket_id: ticket.id,
        event_type: 'sla_breached',
        actor: 'system',
        actor_id: null,
        old_value: null,
        new_value: 'SLA deadline exceeded',
        metadata: null,
      });

    if (eventError) {
      console.error(`[sla.service] Failed to log SLA breach event for ticket ${ticket.id}:`, eventError.message);
    }
  }

  console.log(`[sla.service] Marked ${breached.length} tickets as SLA breached`);
  return breached.length;
}
