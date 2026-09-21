import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { maybeSendCsatRequest } from '@/lib/csat';

interface CustomerHistoryTicket {
  id: string;
  ticket_number: number;
  subject: string;
  status: string;
  created_at: string;
  [key: string]: unknown;
}

function readCanonicalTickets(value: unknown): CustomerHistoryTicket[] | null {
  if (!value || typeof value !== 'object') return null;
  const tickets = (value as Record<string, unknown>).tickets;
  if (!Array.isArray(tickets)) return null;
  if (tickets.some((ticket) => {
    if (!ticket || typeof ticket !== 'object') return true;
    const candidate = ticket as Record<string, unknown>;
    return typeof candidate.id !== 'string'
      || typeof candidate.ticket_number !== 'number'
      || typeof candidate.subject !== 'string'
      || typeof candidate.status !== 'string'
      || typeof candidate.created_at !== 'string';
  })) return null;
  return tickets as CustomerHistoryTicket[];
}

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

  // Read every independent timeline in parallel. Customer history comes from
  // the same canonical projection used by Autopilot.
  const [messagesRes, eventsRes, aiMessagesRes, customerContextRes] = await Promise.all([
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
    ticket.conversation_id
      ? supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', ticket.conversation_id)
        .order('created_at', { ascending: true })
      : Promise.resolve({ data: null, error: null }),
    supabase.rpc('get_customer_support_context', {
      p_ticket_id: id,
      p_brand_id: session.brandId,
    }),
  ]);

  // Use the same canonical, normalized identity projection that Autopilot
  // drafts from. It contains every same-customer ticket (not a case-sensitive
  // five-row sample), including linked/closed histories and response state.
  let canonicalTickets = customerContextRes.error
    ? null
    : readCanonicalTickets(customerContextRes.data);

  // During a rolling deploy, retain complete normalized ticket history if the
  // context RPC is momentarily unavailable. This still requires migration 013
  // and never falls back to raw case-sensitive email equality or a row limit.
  if (!canonicalTickets && ticket.customer_email) {
    console.warn('[ticket-detail] Canonical customer context unavailable; using normalized ticket history', {
      ticketId: id,
      error: customerContextRes.error?.message ?? 'invalid context payload',
    });
    const normalizedHistory = await supabase
      .from('tickets')
      .select('id, ticket_number, source, subject, status, priority, category, tags, order_id, conversation_id, context_version, created_at, first_response_at, resolved_at, closed_at, merged_into_ticket_id')
      .eq('brand_id', session.brandId)
      .eq('customer_email_normalized', String(ticket.customer_email).trim().toLowerCase())
      .order('created_at', { ascending: false });
    if (normalizedHistory.error) {
      console.error('[ticket-detail] Failed to load normalized customer history', {
        ticketId: id,
        error: normalizedHistory.error.message,
      });
      return NextResponse.json({ error: 'Customer ticket history is unavailable' }, { status: 500 });
    }
    canonicalTickets = (normalizedHistory.data ?? []) as CustomerHistoryTicket[];
  }

  const pastTickets = (canonicalTickets ?? [])
    .filter((candidate) => candidate.id !== id)
    .sort((left, right) => right.created_at.localeCompare(left.created_at));

  return NextResponse.json({
    ticket,
    messages: messagesRes.data ?? [],
    events: eventsRes.data ?? [],
    aiConversationMessages: aiMessagesRes.data ?? undefined,
    pastTickets,
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

  if (body.status !== undefined && !['open', 'pending', 'resolved', 'closed'].includes(body.status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
  }
  if (body.priority !== undefined && !['low', 'medium', 'high', 'urgent'].includes(body.priority)) {
    return NextResponse.json({ error: 'Invalid priority' }, { status: 400 });
  }
  if (body.tags !== undefined && (!Array.isArray(body.tags) || body.tags.some((tag: unknown) => typeof tag !== 'string'))) {
    return NextResponse.json({ error: 'tags must be an array of strings' }, { status: 400 });
  }

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

  const plan = ((currentTicket.metadata as Record<string, unknown> | null)?.autopilot ?? null) as Record<string, unknown> | null;
  const invalidatesPlan = Boolean(
    plan?.status === 'proposed'
    && (
      updates.status !== undefined
      || updates.priority !== undefined
      || updates.tags !== undefined
      || updates.category !== undefined
    )
  );
  const supersededPlanId = invalidatesPlan
    ? (typeof plan?.id === 'string' ? plan.id : String(plan?.proposed_at ?? 'legacy'))
    : null;
  if (invalidatesPlan && plan) {
    const meta = {
      ...((currentTicket.metadata as Record<string, unknown>) || {}),
      ...((updates.metadata as Record<string, unknown> | undefined) || {}),
    };
    const history = Array.isArray(meta.autopilot_history) ? meta.autopilot_history as unknown[] : [];
    meta.autopilot_history = [...history.slice(-5), {
      ...plan,
      status: 'superseded',
      superseded_reason: 'manual_ticket_change',
      superseded_at: new Date().toISOString(),
    }];
    delete meta.autopilot;
    updates.metadata = meta;
    events.push({
      ticket_id: id,
      event_type: 'autopilot_superseded',
      actor: 'agent',
      old_value: supersededPlanId,
      new_value: null,
    });
  }

  const { data: ticket, error } = await supabase
    .from('tickets')
    .update(updates)
    .eq('id', id)
    .eq('brand_id', session.brandId)
    .eq('updated_at', currentTicket.updated_at)
    .select()
    .single();

  if (error || !ticket) {
    if (error?.code === 'PGRST116') {
      return NextResponse.json({ error: 'Ticket changed in another session. Refresh and try again.' }, { status: 409 });
    }
    return NextResponse.json({ error: error?.message ?? 'Ticket update failed' }, { status: 500 });
  }

  // Insert events
  if (events.length > 0) {
    await supabase.from('ticket_events').insert(events);
  }
  if (supersededPlanId && /^[0-9a-f-]{36}$/i.test(supersededPlanId)) {
    await supabase.from('ticket_action_plans').update({ status: 'superseded', updated_at: new Date().toISOString() }).eq('id', supersededPlanId);
  }

  // CSAT loop: when a ticket is resolved, ask the customer how we did — once.
  if (updates.status === 'resolved') {
    const meta = await maybeSendCsatRequest(ticket, session);
    if (meta) ticket.metadata = meta;
  }

  return NextResponse.json({ ticket });
}
