import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const brandId = session.brandId;

  // Fetch all return requests with labels
  const { data: labeled, error } = await supabase
    .from('return_requests')
    .select('id, order_number, customer_email, customer_name, return_carrier, return_tracking_number, return_shipping_cost, return_label_url, created_at, updated_at')
    .eq('brand_id', brandId)
    .not('return_label_url', 'is', null)
    .order('updated_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (labeled ?? []) as Array<{
    id: string;
    order_number: string;
    customer_email: string;
    customer_name: string | null;
    return_carrier: string | null;
    return_tracking_number: string | null;
    return_shipping_cost: number | null;
    return_label_url: string | null;
    created_at: string;
    updated_at: string;
  }>;

  // Calculate stats
  const totalLabels = rows.length;
  const totalShippingCost = rows.reduce((sum, r) => sum + (r.return_shipping_cost ?? 0), 0);
  const avgCostPerReturn = totalLabels > 0 ? totalShippingCost / totalLabels : 0;

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const labelsThisMonth = rows.filter((r) => r.created_at >= startOfMonth).length;

  // Most used carrier
  const carrierCounts: Record<string, number> = {};
  for (const r of rows) {
    const carrier = r.return_carrier || 'Unknown';
    carrierCounts[carrier] = (carrierCounts[carrier] || 0) + 1;
  }
  const mostUsedCarrier = Object.entries(carrierCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A';

  // Cost by carrier
  const costByCarrier: Record<string, { count: number; cost: number }> = {};
  for (const r of rows) {
    const carrier = r.return_carrier || 'Unknown';
    if (!costByCarrier[carrier]) costByCarrier[carrier] = { count: 0, cost: 0 };
    costByCarrier[carrier].count++;
    costByCarrier[carrier].cost += r.return_shipping_cost ?? 0;
  }

  // Cost over time (last 30 days)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const dailyCosts: Record<string, number> = {};
  for (let i = 0; i < 30; i++) {
    const d = new Date(thirtyDaysAgo.getTime() + i * 24 * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 10);
    dailyCosts[key] = 0;
  }
  for (const r of rows) {
    const dateKey = r.created_at.slice(0, 10);
    if (dailyCosts[dateKey] !== undefined) {
      dailyCosts[dateKey] += r.return_shipping_cost ?? 0;
    }
  }

  // Recent labels (last 20)
  const recentLabels = rows.slice(0, 20).map((r) => ({
    id: r.id,
    orderNumber: r.order_number,
    customer: r.customer_name || r.customer_email,
    carrier: r.return_carrier || 'Unknown',
    trackingNumber: r.return_tracking_number,
    cost: r.return_shipping_cost ?? 0,
    date: r.created_at,
    labelUrl: r.return_label_url,
  }));

  return NextResponse.json({
    totalLabels,
    totalShippingCost,
    avgCostPerReturn,
    labelsThisMonth,
    mostUsedCarrier,
    costByCarrier,
    dailyCosts,
    recentLabels,
  });
}
