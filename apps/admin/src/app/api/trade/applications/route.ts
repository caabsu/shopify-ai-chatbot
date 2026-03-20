import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const status = searchParams.get('status');
  const search = searchParams.get('search');
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '20');

  let query = supabase
    .from('trade_applications')
    .select('*', { count: 'exact' })
    .eq('brand_id', session.brandId);

  if (status && status !== 'all') query = query.eq('status', status);
  if (search) {
    query = query.or(
      `full_name.ilike.%${search}%,email.ilike.%${search}%,company_name.ilike.%${search}%`
    );
  }

  query = query.order('created_at', { ascending: false });

  const from = (page - 1) * limit;
  const to = from + limit - 1;
  query = query.range(from, to);

  const { data: applications, error, count } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Get counts per status
  const [pendingRes, approvedRes, rejectedRes, archivedRes] = await Promise.all([
    supabase
      .from('trade_applications')
      .select('id', { count: 'exact', head: true })
      .eq('brand_id', session.brandId)
      .eq('status', 'pending'),
    supabase
      .from('trade_applications')
      .select('id', { count: 'exact', head: true })
      .eq('brand_id', session.brandId)
      .eq('status', 'approved'),
    supabase
      .from('trade_applications')
      .select('id', { count: 'exact', head: true })
      .eq('brand_id', session.brandId)
      .eq('status', 'rejected'),
    supabase
      .from('trade_applications')
      .select('id', { count: 'exact', head: true })
      .eq('brand_id', session.brandId)
      .eq('status', 'archived'),
  ]);

  return NextResponse.json({
    applications: applications ?? [],
    total: count ?? 0,
    page,
    limit,
    totalPages: Math.ceil((count ?? 0) / limit),
    counts: {
      all: (pendingRes.count ?? 0) + (approvedRes.count ?? 0) + (rejectedRes.count ?? 0),
      pending: pendingRes.count ?? 0,
      approved: approvedRes.count ?? 0,
      rejected: rejectedRes.count ?? 0,
      archived: archivedRes.count ?? 0,
    },
  });
}
