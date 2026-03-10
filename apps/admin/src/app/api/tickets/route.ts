import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const status = searchParams.get('status');
  const priority = searchParams.get('priority');
  const source = searchParams.get('source');
  const search = searchParams.get('search');
  const assignedTo = searchParams.get('assigned_to');
  const page = parseInt(searchParams.get('page') || '1');
  const perPage = parseInt(searchParams.get('per_page') || '20');
  const orderBy = searchParams.get('order_by') || 'sla_urgency';

  let query = supabase
    .from('tickets')
    .select('*', { count: 'exact' })
    .eq('brand_id', session.brandId);

  if (status) query = query.eq('status', status);
  if (priority) query = query.eq('priority', priority);
  if (source) query = query.eq('source', source);
  if (assignedTo) query = query.eq('assigned_to', assignedTo);
  if (search) {
    query = query.or(`subject.ilike.%${search}%,customer_email.ilike.%${search}%`);
  }

  // Ordering
  switch (orderBy) {
    case 'newest':
      query = query.order('created_at', { ascending: false });
      break;
    case 'oldest':
      query = query.order('created_at', { ascending: true });
      break;
    case 'priority':
      // Order by priority weight: urgent > high > medium > low
      query = query.order('priority', { ascending: true }).order('created_at', { ascending: false });
      break;
    case 'sla_urgency':
    default:
      // SLA breached first, then by sla_deadline ascending (most urgent first), then by created_at
      query = query
        .order('sla_breached', { ascending: false })
        .order('sla_deadline', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: false });
      break;
  }

  // Pagination
  const from = (page - 1) * perPage;
  const to = from + perPage - 1;
  query = query.range(from, to);

  const { data: tickets, error, count } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    tickets: tickets ?? [],
    total: count ?? 0,
    page,
    perPage,
    totalPages: Math.ceil((count ?? 0) / perPage),
  });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();

  // Get next ticket number
  const { data: lastTicket } = await supabase
    .from('tickets')
    .select('ticket_number')
    .eq('brand_id', session.brandId)
    .order('ticket_number', { ascending: false })
    .limit(1)
    .single();

  const nextNumber = (lastTicket?.ticket_number ?? 1000) + 1;

  const { data: ticket, error } = await supabase
    .from('tickets')
    .insert({
      brand_id: session.brandId,
      ticket_number: nextNumber,
      source: body.source || 'form',
      status: 'open',
      priority: body.priority || 'medium',
      category: body.category || null,
      subject: body.subject,
      customer_email: body.customer_email,
      customer_name: body.customer_name || null,
      customer_phone: body.customer_phone || null,
      tags: body.tags || [],
      conversation_id: body.conversation_id || null,
      order_id: body.order_id || null,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Create initial system event
  await supabase.from('ticket_events').insert({
    ticket_id: ticket.id,
    event_type: 'created',
    actor: 'system',
    new_value: 'open',
  });

  return NextResponse.json({ ticket }, { status: 201 });
}
