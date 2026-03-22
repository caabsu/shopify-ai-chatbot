import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const search = searchParams.get('search');
  const page = parseInt(searchParams.get('page') || '1');
  const perPage = parseInt(searchParams.get('per_page') || '500');

  let query = supabase
    .from('products')
    .select('*', { count: 'exact' })
    .eq('brand_id', session.brandId);

  if (search) {
    query = query.or(`title.ilike.%${search}%,handle.ilike.%${search}%`);
  }

  query = query.order('title', { ascending: true });

  const from = (page - 1) * perPage;
  const to = from + perPage - 1;
  query = query.range(from, to);

  const { data: products, error, count } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Compute review stats for each product
  const productIds = (products ?? []).map((p) => p.id);
  let reviewStats: Record<string, { count: number; avg: number }> = {};

  if (productIds.length > 0) {
    const { data: reviews } = await supabase
      .from('reviews')
      .select('product_id, rating')
      .in('product_id', productIds)
      .eq('status', 'published');

    if (reviews) {
      const grouped: Record<string, number[]> = {};
      for (const r of reviews) {
        if (!r.product_id) continue;
        if (!grouped[r.product_id]) grouped[r.product_id] = [];
        grouped[r.product_id].push(r.rating);
      }
      for (const [pid, ratings] of Object.entries(grouped)) {
        const sum = ratings.reduce((a, b) => a + b, 0);
        reviewStats[pid] = {
          count: ratings.length,
          avg: Math.round((sum / ratings.length) * 10) / 10,
        };
      }
    }
  }

  const items = (products ?? []).map((p) => ({
    ...p,
    review_count: reviewStats[p.id]?.count ?? 0,
    average_rating: reviewStats[p.id]?.avg ?? 0,
  }));

  return NextResponse.json({
    items,
    total: count ?? 0,
    page,
    perPage,
    totalPages: Math.ceil((count ?? 0) / perPage),
  });
}
