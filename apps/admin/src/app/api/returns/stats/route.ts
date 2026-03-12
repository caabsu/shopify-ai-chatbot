import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const brandId = session.brandId;

  const [
    allRes,
    pendingRes,
    approvedRes,
    partiallyApprovedRes,
    deniedRes,
    shippedRes,
    receivedRes,
    refundedRes,
    closedRes,
    cancelledRes,
  ] = await Promise.all([
    supabase.from('return_requests').select('id', { count: 'exact', head: true }).eq('brand_id', brandId),
    supabase.from('return_requests').select('id', { count: 'exact', head: true }).eq('brand_id', brandId).eq('status', 'pending_review'),
    supabase.from('return_requests').select('id', { count: 'exact', head: true }).eq('brand_id', brandId).eq('status', 'approved'),
    supabase.from('return_requests').select('id', { count: 'exact', head: true }).eq('brand_id', brandId).eq('status', 'partially_approved'),
    supabase.from('return_requests').select('id', { count: 'exact', head: true }).eq('brand_id', brandId).eq('status', 'denied'),
    supabase.from('return_requests').select('id', { count: 'exact', head: true }).eq('brand_id', brandId).eq('status', 'shipped'),
    supabase.from('return_requests').select('id', { count: 'exact', head: true }).eq('brand_id', brandId).eq('status', 'received'),
    supabase.from('return_requests').select('id', { count: 'exact', head: true }).eq('brand_id', brandId).eq('status', 'refunded'),
    supabase.from('return_requests').select('id', { count: 'exact', head: true }).eq('brand_id', brandId).eq('status', 'closed'),
    supabase.from('return_requests').select('id', { count: 'exact', head: true }).eq('brand_id', brandId).eq('status', 'cancelled'),
  ]);

  return NextResponse.json({
    all: allRes.count ?? 0,
    pending_review: pendingRes.count ?? 0,
    approved: approvedRes.count ?? 0,
    partially_approved: partiallyApprovedRes.count ?? 0,
    denied: deniedRes.count ?? 0,
    shipped: shippedRes.count ?? 0,
    received: receivedRes.count ?? 0,
    refunded: refundedRes.count ?? 0,
    closed: closedRes.count ?? 0,
    cancelled: cancelledRes.count ?? 0,
  });
}
