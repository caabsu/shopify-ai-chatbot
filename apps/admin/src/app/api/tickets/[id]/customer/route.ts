import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { getCustomerByEmail, getCustomerOrders } from '@/lib/shopify';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  const { data: ticket } = await supabase
    .from('tickets')
    .select('id, customer_email')
    .eq('id', id)
    .eq('brand_id', session.brandId)
    .single();

  if (!ticket) {
    return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
  }

  if (!ticket.customer_email) {
    return NextResponse.json({ profile: null, orders: [] });
  }

  try {
    const [profile, orders] = await Promise.all([
      getCustomerByEmail(ticket.customer_email).catch(() => null),
      getCustomerOrders(ticket.customer_email, 5).catch(() => []),
    ]);

    return NextResponse.json({ profile, orders });
  } catch {
    return NextResponse.json({ profile: null, orders: [] });
  }
}
