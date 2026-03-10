import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

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

  return NextResponse.json({ ticket });
}
