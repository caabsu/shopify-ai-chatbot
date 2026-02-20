import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const params = request.nextUrl.searchParams;
  const page = parseInt(params.get('page') || '1');
  const limit = 20;
  const offset = (page - 1) * limit;
  const status = params.get('status') || '';
  const search = params.get('search') || '';

  let query = supabase
    .from('conversations')
    .select('*', { count: 'exact' })
    .eq('brand_id', session.brandId)
    .gte('message_count', 2)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (status) query = query.eq('status', status);
  if (search) {
    query = query.or(`customer_email.ilike.%${search}%,customer_name.ilike.%${search}%`);
  }

  const { data, count, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    conversations: data,
    total: count ?? 0,
    page,
    totalPages: Math.ceil((count ?? 0) / limit),
  });
}
