import { supabase } from './supabase';

/** Manual replies and the UI takeover share the same durable hold. This also
 * protects older clients: control is established on the server before send. */
export async function holdAutomationForManualReply(ticketId: string, brandId: string): Promise<{ ready: boolean; running: boolean }> {
  const hold = await supabase.from('support_automation_holds').upsert({ ticket_id: ticketId, brand_id: brandId });
  if (hold.error) {
    if (['PGRST205', '42P01'].includes(hold.error.code)) return { ready: false, running: false };
    throw new Error('Could not hold automation. Refresh before replying.');
  }
  const queued = await supabase.from('support_automation_jobs').update({ status: 'cancelled', reason: 'A person took over this ticket.' }).eq('ticket_id', ticketId).eq('brand_id', brandId).eq('status', 'scheduled');
  if (queued.error) throw new Error('Could not stop queued automation. Refresh before replying.');
  const running = await supabase.from('support_automation_jobs').select('id').eq('ticket_id', ticketId).eq('brand_id', brandId).eq('status', 'running');
  if (running.error) throw new Error('Could not verify active execution. Refresh before replying.');
  return { ready: true, running: Boolean(running.data?.length) };
}
