import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  // Verify ticket belongs to brand
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
    const res = await fetch(`${BACKEND_URL}/api/tickets/${id}/customer`, {
      headers: {
        'Authorization': `Bearer ${req.cookies.get('admin_token')?.value || ''}`,
      },
    });

    if (res.ok) {
      const data = await res.json();
      return NextResponse.json(data);
    }
  } catch {
    // Backend proxy failed
  }

  // Fallback: return minimal data from ticket
  return NextResponse.json({ profile: null, orders: [] });
}
