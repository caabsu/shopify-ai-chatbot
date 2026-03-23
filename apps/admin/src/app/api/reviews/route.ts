import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const status = searchParams.get('status');
  const rating = searchParams.get('rating');
  const productId = searchParams.get('product_id');
  const search = searchParams.get('search');
  const source = searchParams.get('source');
  const dateFrom = searchParams.get('date_from');
  const dateTo = searchParams.get('date_to');
  const sort = searchParams.get('sort') || 'newest';
  const page = parseInt(searchParams.get('page') || '1');
  const perPage = parseInt(searchParams.get('per_page') || '20');

  let query = supabase
    .from('reviews')
    .select('*', { count: 'exact' })
    .eq('brand_id', session.brandId);

  if (status) query = query.eq('status', status);
  if (rating) query = query.eq('rating', parseInt(rating));
  if (productId) query = query.eq('product_id', productId);
  if (source) query = query.eq('source', source);
  if (dateFrom) query = query.gte('created_at', dateFrom);
  if (dateTo) query = query.lte('created_at', dateTo);
  if (search) {
    query = query.or(`title.ilike.%${search}%,body.ilike.%${search}%,customer_name.ilike.%${search}%,customer_email.ilike.%${search}%`);
  }

  // Filter by media presence — requires a subquery
  const hasMedia = searchParams.get('has_media');
  if (hasMedia === '1') {
    // Get review IDs that have media
    const { data: mediaReviewIds } = await supabase
      .from('review_media')
      .select('review_id');
    if (mediaReviewIds) {
      const ids = [...new Set(mediaReviewIds.map((m) => m.review_id))];
      if (ids.length > 0) {
        query = query.in('id', ids);
      } else {
        // No reviews with media — return empty
        return NextResponse.json({ items: [], total: 0, page, perPage, totalPages: 0 });
      }
    }
  } else if (hasMedia === '0') {
    // Get review IDs that have media, then exclude them
    const { data: mediaReviewIds } = await supabase
      .from('review_media')
      .select('review_id');
    if (mediaReviewIds) {
      const ids = [...new Set(mediaReviewIds.map((m) => m.review_id))];
      if (ids.length > 0) {
        query = query.not('id', 'in', `(${ids.join(',')})`);
      }
    }
  }

  switch (sort) {
    case 'oldest':
      query = query.order('created_at', { ascending: true });
      break;
    case 'highest':
      query = query.order('rating', { ascending: false }).order('created_at', { ascending: false });
      break;
    case 'lowest':
      query = query.order('rating', { ascending: true }).order('created_at', { ascending: false });
      break;
    case 'newest':
    default:
      query = query.order('created_at', { ascending: false });
      break;
  }

  const from = (page - 1) * perPage;
  const to = from + perPage - 1;
  query = query.range(from, to);

  const { data: reviews, error, count } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Fetch product titles for the reviews
  const productIds = [...new Set((reviews ?? []).map((r) => r.product_id).filter(Boolean))];
  let productMap: Record<string, string> = {};

  if (productIds.length > 0) {
    const { data: products } = await supabase
      .from('products')
      .select('id, title')
      .in('id', productIds);

    if (products) {
      productMap = products.reduce((acc: Record<string, string>, p) => {
        acc[p.id] = p.title;
        return acc;
      }, {});
    }
  }

  // Fetch media counts for the reviews
  const reviewIds = (reviews ?? []).map((r) => r.id);
  let mediaCountMap: Record<string, number> = {};

  if (reviewIds.length > 0) {
    for (let i = 0; i < reviewIds.length; i += 200) {
      const batch = reviewIds.slice(i, i + 200);
      const { data: mediaCounts } = await supabase
        .from('review_media')
        .select('review_id')
        .in('review_id', batch);

      if (mediaCounts) {
        for (const m of mediaCounts) {
          mediaCountMap[m.review_id] = (mediaCountMap[m.review_id] || 0) + 1;
        }
      }
    }
  }

  const items = (reviews ?? []).map((r) => ({
    ...r,
    product_title: r.product_id ? productMap[r.product_id] || null : null,
    media_count: mediaCountMap[r.id] || 0,
  }));

  return NextResponse.json({
    items,
    total: count ?? 0,
    page,
    perPage,
    totalPages: Math.ceil((count ?? 0) / perPage),
  });
}
