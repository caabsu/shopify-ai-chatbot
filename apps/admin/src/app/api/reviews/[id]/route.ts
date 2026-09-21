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
      .eq('brand_id', session.brandId)
      .single();
    product = data;
  }

  const response = NextResponse.json({
    review: {
      ...reviewRes.data,
      media: mediaRes.data ?? [],
      reply: replyRes.data ?? null,
      product,
    },
  });
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await req.json();

  const { data: existing, error: existingError } = await supabase
    .from('reviews')
    .select('id, status, published_at, featured')
    .eq('id', id)
    .eq('brand_id', session.brandId)
    .single();

  if (existingError || !existing) {
    return NextResponse.json({ error: 'Review not found' }, { status: 404 });
  }

  const updates: Record<string, unknown> = {};
  const statusValues = new Set(['published', 'pending', 'rejected', 'archived']);

  if (body.status !== undefined) {
    if (typeof body.status !== 'string' || !statusValues.has(body.status)) {
      return NextResponse.json({ error: 'Invalid review status' }, { status: 400 });
    }
    updates.status = body.status;
  }

  if (body.rating !== undefined) {
    if (!Number.isInteger(body.rating) || body.rating < 1 || body.rating > 5) {
      return NextResponse.json({ error: 'Rating must be an integer from 1 to 5' }, { status: 400 });
    }
    updates.rating = body.rating;
  }

  const requiredTextFields = [
    ['body', 10_000],
    ['customer_name', 160],
    ['customer_email', 320],
  ] as const;
  for (const [key, maxLength] of requiredTextFields) {
    if (body[key] === undefined) continue;
    if (typeof body[key] !== 'string' || !body[key].trim() || body[key].length > maxLength) {
      return NextResponse.json(
        { error: `${key.replace('_', ' ')} is required and must be ${maxLength} characters or fewer` },
        { status: 400 },
      );
    }
    updates[key] = body[key].trim();
  }

  if (
    body.customer_email !== undefined
    && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.customer_email.trim())
  ) {
    return NextResponse.json({ error: 'Enter a valid customer email' }, { status: 400 });
  }

  const optionalTextFields = [
    ['title', 240],
    ['customer_nickname', 160],
    ['variant_title', 240],
  ] as const;
  for (const [key, maxLength] of optionalTextFields) {
    if (body[key] === undefined) continue;
    if (body[key] !== null && (typeof body[key] !== 'string' || body[key].length > maxLength)) {
      return NextResponse.json(
        { error: `${key.replace('_', ' ')} must be ${maxLength} characters or fewer` },
        { status: 400 },
      );
    }
    updates[key] = typeof body[key] === 'string' && body[key].trim()
      ? body[key].trim()
      : null;
  }

  for (const key of ['featured', 'verified_purchase', 'incentivized'] as const) {
    if (body[key] === undefined) continue;
    if (typeof body[key] !== 'boolean') {
      return NextResponse.json({ error: `${key.replace('_', ' ')} must be true or false` }, { status: 400 });
    }
    updates[key] = body[key];
  }

  if (body.submitted_at !== undefined) {
    const submittedAt = new Date(body.submitted_at);
    if (typeof body.submitted_at !== 'string' || Number.isNaN(submittedAt.getTime())) {
      return NextResponse.json({ error: 'Submitted date is invalid' }, { status: 400 });
    }
    updates.submitted_at = submittedAt.toISOString();
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No editable review fields were provided' }, { status: 400 });
  }

  const effectiveStatus = (updates.status as string | undefined) ?? existing.status;
  const effectiveFeatured = (updates.featured as boolean | undefined) ?? existing.featured;
  if (effectiveFeatured && effectiveStatus !== 'published') {
    if (updates.featured === true) {
      return NextResponse.json(
        { error: 'A homepage review must also be published' },
        { status: 400 },
      );
    }
    updates.featured = false;
  }

  if (updates.status === 'published' && existing.status !== 'published') {
    updates.published_at = new Date().toISOString();
  } else if (updates.status !== undefined && updates.status !== 'published') {
    updates.published_at = null;
  }
  updates.updated_at = new Date().toISOString();

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

  const response = NextResponse.json({ review: data });
  response.headers.set('Cache-Control', 'no-store');
  return response;
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
