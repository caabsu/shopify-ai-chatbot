import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

export async function GET(_req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [activeMembersRes, pendingApplicationsRes, revenueRes, topMembersRes] =
    await Promise.all([
      // Count active members
      supabase
        .from('trade_members')
        .select('id', { count: 'exact', head: true })
        .eq('brand_id', session.brandId)
        .eq('status', 'active'),

      // Count pending applications
      supabase
        .from('trade_applications')
        .select('id', { count: 'exact', head: true })
        .eq('brand_id', session.brandId)
        .eq('status', 'pending'),

      // Sum total_spent from active members
      supabase
        .from('trade_members')
        .select('total_spent')
        .eq('brand_id', session.brandId)
        .eq('status', 'active'),

      // Top 5 members by total_spent
      supabase
        .from('trade_members')
        .select('id, full_name, email, company_name, total_spent, status')
        .eq('brand_id', session.brandId)
        .eq('status', 'active')
        .order('total_spent', { ascending: false })
        .limit(5),
    ]);

  const totalRevenue = (revenueRes.data ?? []).reduce(
    (sum, row) => sum + (row.total_spent ?? 0),
    0
  );

  return NextResponse.json({
    activeMembers: activeMembersRes.count ?? 0,
    pendingApplications: pendingApplicationsRes.count ?? 0,
    totalRevenue,
    topMembers: topMembersRes.data ?? [],
  });
}
