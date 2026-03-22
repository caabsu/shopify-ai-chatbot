import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  const [reviewRes, mediaRes, replyRes] = await Promise.all([
    supabase
      .from('reviews')
      .select('*')
      .eq('id', id)
      .eq('brand_id', session.brandId)
      .single(),
    supabase
      .from('review_media')
      .select('*')
      .eq('review_id', id)
      .order('sort_order', { ascending: true }),
    supabase
      .from('review_replies')
      .select('*')
      .eq('review_id', id)
      .single(),
  ]);

  if (reviewRes.error || !reviewRes.data) {
    return NextResponse.json({ error: 'Review not found' }, { status: 404 });
  }

  // Fetch product info if available
  let product = null;
  if (reviewRes.data.product_id) {
    const { data } = await supabase
      .from('products')
      .select('id, title, handle, featured_image_url')
      .eq('id', reviewRes.data.product_id)
      .single();
    product = data;
  }

  return NextResponse.json({
    review: {
      ...reviewRes.data,
      media: mediaRes.data ?? [],
      reply: replyRes.data ?? null,
      product,
    },
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await req.json();

  const allowedKeys = [
    'status', 'featured', 'title', 'body', 'rating',
    'verified_purchase', 'incentivized',
  ];

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const key of allowedKeys) {
    if (body[key] !== undefined) updates[key] = body[key];
  }

  // Set published_at when publishing
  if (body.status === 'published') {
    updates.published_at = new Date().toISOString();
  }

  const { data, error } = await supabase
    .from('reviews')
    .update(updates)
    .eq('id', id)
    .eq('brand_id', session.brandId)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ review: data });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  // Cascade handles media and replies automatically
  const { error } = await supabase
    .from('reviews')
    .delete()
    .eq('id', id)
    .eq('brand_id', session.brandId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
