import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

// POST /api/tickets/close-all — Close all tickets matching filter
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { status, source, priority, search } = body;

  // Build query to find matching open/pending tickets
  let query = supabase
    .from('tickets')
    .select('id')
    .eq('brand_id', session.brandId)
    .in('status', ['open', 'pending']);

  if (status && status !== 'open' && status !== 'pending') {
    // If they're viewing resolved/closed, close those too
    query = supabase
      .from('tickets')
      .select('id')
      .eq('brand_id', session.brandId)
      .eq('status', status);
  }
  if (source) query = query.eq('source', source);
  if (priority) query = query.eq('priority', priority);
  if (search) query = query.or(`subject.ilike.%${search}%,customer_email.ilike.%${search}%`);

  const { data: tickets } = await query;
  if (!tickets || tickets.length === 0) {
    return NextResponse.json({ closed: 0 });
  }

  const ids = tickets.map((t) => t.id);
  const now = new Date().toISOString();
  let totalClosed = 0;

  for (let i = 0; i < ids.length; i += 200) {
    const batch = ids.slice(i, i + 200);
    const { data: closed } = await supabase
      .from('tickets')
      .update({ status: 'closed', closed_at: now, updated_at: now })
      .in('id', batch)
      .eq('brand_id', session.brandId)
      .select('id');

    totalClosed += closed?.length ?? 0;
  }

  return NextResponse.json({ closed: totalClosed });
}
