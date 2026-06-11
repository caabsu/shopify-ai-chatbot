import { supabase } from './supabase';
import { sendCsatRequestEmail } from './email';
import type { JWTPayload } from './auth';

interface CsatTicket {
  id: string;
  ticket_number: number;
  subject: string;
  source: string;
  customer_email: string | null;
  customer_name: string | null;
  metadata: Record<string, unknown> | null;
}

/**
 * Send the one-click CSAT rating email for a freshly resolved ticket — once
 * per ticket, skippable per brand via brands.settings.csat_enabled = false.
 * Called from every resolve path (status PATCH and "Send & Resolve").
 * Returns the updated metadata when an email went out, null otherwise.
 */
export async function maybeSendCsatRequest(
  ticket: CsatTicket,
  session: JWTPayload
): Promise<Record<string, unknown> | null> {
  if (!ticket.customer_email) return null;
  if (ticket.metadata?.csat_sent_at) return null;
  if (ticket.source === 'ai_escalation') return null; // resolved inside chat — no email survey

  try {
    const { data: brand } = await supabase
      .from('brands')
      .select('settings')
      .eq('id', session.brandId)
      .single();
    if ((brand?.settings as Record<string, unknown> | null)?.csat_enabled === false) return null;

    const result = await sendCsatRequestEmail({
      to: ticket.customer_email,
      customerName: ticket.customer_name || undefined,
      ticketNumber: ticket.ticket_number,
      ticketId: ticket.id,
      subject: ticket.subject,
      brandName: session.brandName,
      brandSlug: session.brandSlug,
    });
    if (result.error) {
      console.error('[csat] send failed:', result.error);
      return null;
    }

    const metadata = { ...(ticket.metadata || {}), csat_sent_at: new Date().toISOString() };
    await supabase.from('tickets').update({ metadata }).eq('id', ticket.id);
    return metadata;
  } catch (err) {
    console.error('[csat] error:', err);
    return null;
  }
}
