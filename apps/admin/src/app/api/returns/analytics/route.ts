import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const brandId = session.brandId;

  // Fetch all return requests for this brand
  const { data: requests, error: reqError } = await supabase
    .from('return_requests')
    .select('id, status, resolution_type, refund_amount, approved_no_return, created_at, updated_at, decided_at, order_number, customer_email, customer_name')
    .eq('brand_id', brandId)
    .order('created_at', { ascending: false });

  if (reqError) {
    return NextResponse.json({ error: reqError.message }, { status: 500 });
  }

  const rows = (requests ?? []) as Array<{
    id: string;
    status: string;
    resolution_type: string | null;
    refund_amount: number | null;
    approved_no_return: boolean;
    created_at: string;
    updated_at: string;
    decided_at: string | null;
    order_number: string;
    customer_email: string;
    customer_name: string | null;
  }>;

  // Fetch all return items for reason breakdown
  const requestIds = rows.map((r) => r.id);
  let itemReasons: Array<{ return_request_id: string; reason: string }> = [];
  if (requestIds.length > 0) {
    const { data: items } = await supabase
      .from('return_items')
      .select('return_request_id, reason')
      .in('return_request_id', requestIds);
    itemReasons = (items ?? []) as Array<{ return_request_id: string; reason: string }>;
  }

  // Stats
  const totalReturns = rows.length;

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const returnsThisMonth = rows.filter((r) => r.created_at >= startOfMonth).length;

  const approvedCount = rows.filter((r) => ['approved', 'refunded', 'shipped', 'received'].includes(r.status)).length;
  const decidedCount = rows.filter((r) => ['approved', 'denied', 'refunded', 'shipped', 'received', 'closed'].includes(r.status)).length;
  const approvalRate = decidedCount > 0 ? (approvedCount / decidedCount) * 100 : 0;

  const refundedRows = rows.filter((r) => r.refund_amount != null && r.refund_amount > 0);
  const avgRefundAmount = refundedRows.length > 0
    ? refundedRows.reduce((sum, r) => sum + (r.refund_amount ?? 0), 0) / refundedRows.length
    : 0;

  // Average processing time (days from creation to decided_at)
  const processedRows = rows.filter((r) => r.decided_at);
  const avgProcessingTime = processedRows.length > 0
    ? processedRows.reduce((sum, r) => {
        const created = new Date(r.created_at).getTime();
        const decided = new Date(r.decided_at!).getTime();
        return sum + (decided - created) / (1000 * 60 * 60 * 24);
      }, 0) / processedRows.length
    : 0;

  const refundOnlyCount = rows.filter((r) => r.approved_no_return).length;

  // By status
  const byStatus: Record<string, number> = {};
  for (const r of rows) {
    byStatus[r.status] = (byStatus[r.status] || 0) + 1;
  }

  // By reason
  const byReason: Record<string, number> = {};
  for (const item of itemReasons) {
    byReason[item.reason] = (byReason[item.reason] || 0) + 1;
  }

  // By resolution type
  const byResolution: Record<string, number> = {};
  for (const r of rows) {
    const res = r.resolution_type || 'pending';
    byResolution[res] = (byResolution[res] || 0) + 1;
  }

  // Over time (last 30 days)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const dailyReturns: Record<string, number> = {};
  for (let i = 0; i < 30; i++) {
    const d = new Date(thirtyDaysAgo.getTime() + i * 24 * 60 * 60 * 1000);
    dailyReturns[d.toISOString().slice(0, 10)] = 0;
  }
  for (const r of rows) {
    const dateKey = r.created_at.slice(0, 10);
    if (dailyReturns[dateKey] !== undefined) {
      dailyReturns[dateKey]++;
    }
  }

  // Recent returns (last 20)
  const recentReturns = rows.slice(0, 20).map((r) => {
    const primaryReason = itemReasons.find((i) => i.return_request_id === r.id)?.reason || 'unknown';
    const daysOpen = Math.floor((Date.now() - new Date(r.created_at).getTime()) / (1000 * 60 * 60 * 24));
    return {
      id: r.id,
      orderNumber: r.order_number,
      customer: r.customer_name || r.customer_email,
      status: r.status,
      reason: primaryReason,
      amount: r.refund_amount,
      daysOpen,
      createdAt: r.created_at,
    };
  });

  return NextResponse.json({
    totalReturns,
    returnsThisMonth,
    approvalRate,
    avgRefundAmount,
    avgProcessingTime,
    refundOnlyCount,
    byStatus,
    byReason,
    byResolution,
    dailyReturns,
    recentReturns,
  });
}
