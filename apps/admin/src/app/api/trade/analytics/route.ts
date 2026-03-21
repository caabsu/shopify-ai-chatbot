import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { cookies } from 'next/headers';

export async function GET(_req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const cookieStore = await cookies();
  const token = cookieStore.get('admin_token')?.value;

  const BACKEND_URL =
    process.env.BACKEND_URL || 'https://shopify-ai-chatbot-production-9ab4.up.railway.app';

  const res = await fetch(`${BACKEND_URL}/api/trade/analytics`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  const data = await res.json().catch(() => ({}));

  // Normalize field names for the frontend
  return NextResponse.json({
    total_members: data.total_members ?? data.activeMembers ?? 0,
    pending_applications: data.pending_applications ?? data.pendingApplications ?? 0,
    total_trade_revenue: data.total_trade_revenue ?? data.totalRevenue ?? 0,
    avg_order_value: data.avg_order_value ?? 0,
    top_members: data.top_members ?? data.topMembers ?? [],
  });
}
