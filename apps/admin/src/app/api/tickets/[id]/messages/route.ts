import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { sendTicketReplyEmail } from '@/lib/email';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await req.json();

  // Verify ticket belongs to brand — fetch full ticket for email context
  const { data: ticket } = await supabase
    .from('tickets')
    .select('id, status, first_response_at, customer_email, customer_name, subject, ticket_number')
    .eq('id', id)
    .eq('brand_id', session.brandId)
    .single();

  if (!ticket) {
    return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
  }

  const { data: message, error } = await supabase
    .from('ticket_messages')
    .insert({
      ticket_id: id,
      sender_type: body.sender_type || 'agent',
      sender_name: session.name,
      sender_email: session.email,
      content: body.content,
      content_html: body.content_html || null,
      is_internal_note: body.is_internal_note || false,
      ai_generated: body.ai_generated || false,
      attachments: body.attachments || [],
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Update ticket: first_response_at, status change
  const ticketUpdates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (!ticket.first_response_at && body.sender_type !== 'system' && !body.is_internal_note) {
    ticketUpdates.first_response_at = new Date().toISOString();
  }
  if (body.set_status) {
    ticketUpdates.status = body.set_status;
    if (body.set_status === 'resolved') ticketUpdates.resolved_at = new Date().toISOString();
    if (body.set_status === 'closed') ticketUpdates.closed_at = new Date().toISOString();
  }

  const { data: updatedTicket } = await supabase
    .from('tickets')
    .update(ticketUpdates)
    .eq('id', id)
    .select()
    .single();

  // Log event
  await supabase.from('ticket_events').insert({
    ticket_id: id,
    event_type: body.is_internal_note ? 'internal_note_added' : 'message_added',
    actor: 'agent',
    actor_id: session.userId,
    new_value: body.sender_type || 'agent',
  });

  // Send email to customer for agent replies (not internal notes)
  // Must await — Vercel terminates serverless functions after response is sent
  const isAgentReply = (body.sender_type || 'agent') === 'agent' && !body.is_internal_note;
  if (isAgentReply && ticket.customer_email) {
    try {
      const result = await sendTicketReplyEmail({
        to: ticket.customer_email,
        customerName: ticket.customer_name || undefined,
        ticketNumber: ticket.ticket_number,
        subject: ticket.subject,
        replyContent: body.content,
        agentName: session.name || undefined,
        brandName: session.brandName || undefined,
        brandSlug: session.brandSlug || undefined,
      });
      if (result.messageId) {
        await supabase
          .from('ticket_messages')
          .update({ email_message_id: result.messageId })
          .eq('id', message.id);
      }
      if (result.error) {
        console.error('[ticket-reply] Email error:', result.error);
      }
    } catch (err) {
      console.error('[ticket-reply] Email send failed:', err);
    }
  }

  return NextResponse.json({ message, ticket: updatedTicket }, { status: 201 });
}
