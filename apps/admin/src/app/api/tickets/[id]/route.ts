import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { sendCsatRequestEmail } from '@/lib/email';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  // Get ticket
  const { data: ticket, error: ticketError } = await supabase
    .from('tickets')
    .select('*')
    .eq('id', id)
    .eq('brand_id', session.brandId)
    .single();

  if (ticketError || !ticket) {
    return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
  }

  // Get messages, events, and optionally AI conversation messages in parallel
  const [messagesRes, eventsRes] = await Promise.all([
    supabase
      .from('ticket_messages')
      .select('*')
      .eq('ticket_id', id)
      .order('created_at', { ascending: true }),
    supabase
      .from('ticket_events')
      .select('*')
      .eq('ticket_id', id)
      .order('created_at', { ascending: true }),
  ]);

  let aiMessagesRes: { data: unknown[] | null } = { data: null };
  let pastTicketsRes: { data: unknown[] | null } = { data: null };

  // If this is an AI escalation, also get the original conversation messages
  if (ticket.conversation_id) {
    aiMessagesRes = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', ticket.conversation_id)
      .order('created_at', { ascending: true });
  }

  // Get past tickets from the same customer
  if (ticket.customer_email) {
    pastTicketsRes = await supabase
      .from('tickets')
      .select('*')
      .eq('brand_id', session.brandId)
      .eq('customer_email', ticket.customer_email)
      .neq('id', id)
      .order('created_at', { ascending: false })
      .limit(5);
  }

  return NextResponse.json({
    ticket,
    messages: messagesRes.data ?? [],
    events: eventsRes.data ?? [],
    aiConversationMessages: aiMessagesRes.data ?? undefined,
    pastTickets: pastTicketsRes.data ?? [],
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await req.json();

  // Get current ticket for event logging
  const { data: currentTicket } = await supabase
    .from('tickets')
    .select('*')
    .eq('id', id)
    .eq('brand_id', session.brandId)
    .single();

  if (!currentTicket) {
    return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const events: Array<{ ticket_id: string; event_type: string; actor: string; old_value: string | null; new_value: string | null }> = [];

  if (body.status && body.status !== currentTicket.status) {
    updates.status = body.status;
    events.push({
      ticket_id: id,
      event_type: 'status_changed',
      actor: 'agent',
      old_value: currentTicket.status,
      new_value: body.status,
    });
    if (body.status === 'resolved') updates.resolved_at = new Date().toISOString();
    if (body.status === 'closed') updates.closed_at = new Date().toISOString();
  }

  if (body.priority && body.priority !== currentTicket.priority) {
    updates.priority = body.priority;
    events.push({
      ticket_id: id,
      event_type: 'priority_changed',
      actor: 'agent',
      old_value: currentTicket.priority,
      new_value: body.priority,
    });
  }

  if (body.assigned_to !== undefined) {
    updates.assigned_to = body.assigned_to;
    events.push({
      ticket_id: id,
      event_type: 'assigned',
      actor: 'agent',
      old_value: currentTicket.assigned_to,
      new_value: body.assigned_to,
    });
  }

  if (body.tags !== undefined) {
    updates.tags = body.tags;
  }

  if (body.category !== undefined) {
    updates.category = body.category;
  }

  // Snooze: stored in metadata until the column exists (see docs/migrations/010).
  // Pass snoozed_until as ISO string to snooze, null to wake.
  if (body.snoozed_until !== undefined) {
    const currentMeta = (currentTicket.metadata as Record<string, unknown>) || {};
    updates.metadata = { ...currentMeta, snoozed_until: body.snoozed_until };
    events.push({
      ticket_id: id,
      event_type: body.snoozed_until ? 'snoozed' : 'unsnoozed',
      actor: 'agent',
      old_value: (currentMeta.snoozed_until as string) || null,
      new_value: body.snoozed_until,
    });
    // Snoozing implies the ticket is parked waiting — keep it pending so it
    // leaves the active queue; waking reopens it.
    if (body.snoozed_until && !body.status && currentTicket.status === 'open') {
      updates.status = 'pending';
    }
  }

  const { data: ticket, error } = await supabase
    .from('tickets')
    .update(updates)
    .eq('id', id)
    .eq('brand_id', session.brandId)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Insert events
  if (events.length > 0) {
    await supabase.from('ticket_events').insert(events);
  }

  // CSAT loop: when a ticket is resolved, ask the customer how we did — once.
  // Opt out per brand via brands.settings.csat_enabled = false.
  if (
    updates.status === 'resolved' &&
    ticket.customer_email &&
    !(ticket.metadata as Record<string, unknown> | null)?.csat_sent_at &&
    ticket.source !== 'ai_escalation' // escalations resolve inside chat — no email survey
  ) {
    try {
      const { data: brand } = await supabase
        .from('brands')
        .select('settings')
        .eq('id', session.brandId)
        .single();
      const csatEnabled = (brand?.settings as Record<string, unknown> | null)?.csat_enabled !== false;

      if (csatEnabled) {
        const result = await sendCsatRequestEmail({
          to: ticket.customer_email,
          customerName: ticket.customer_name || undefined,
          ticketNumber: ticket.ticket_number,
          ticketId: ticket.id,
          subject: ticket.subject,
          brandName: session.brandName,
          brandSlug: session.brandSlug,
        });
        if (!result.error) {
          const meta = { ...((ticket.metadata as Record<string, unknown>) || {}), csat_sent_at: new Date().toISOString() };
          await supabase.from('tickets').update({ metadata: meta }).eq('id', id);
          ticket.metadata = meta;
        } else {
          console.error('[csat] send failed:', result.error);
        }
      }
    } catch (err) {
      console.error('[csat] error:', err);
    }
  }

  return NextResponse.json({ ticket });
}
