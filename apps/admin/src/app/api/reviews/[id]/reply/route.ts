import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: reviewId } = await params;
  const body = await req.json();

  if (!body.author_name || !body.body) {
    return NextResponse.json({ error: 'author_name and body are required' }, { status: 400 });
  }

  // Verify review belongs to this brand
  const { data: review } = await supabase
    .from('reviews')
    .select('id')
    .eq('id', reviewId)
    .eq('brand_id', session.brandId)
    .single();

  if (!review) {
    return NextResponse.json({ error: 'Review not found' }, { status: 404 });
  }

  // Upsert reply (one reply per review, review_id is UNIQUE)
  const { data, error } = await supabase
    .from('review_replies')
    .upsert(
      {
        review_id: reviewId,
        author_name: body.author_name,
        body: body.body,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'review_id' }
    )
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ reply: data });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: reviewId } = await params;

  // Verify review belongs to this brand
  const { data: review } = await supabase
    .from('reviews')
    .select('id')
    .eq('id', reviewId)
    .eq('brand_id', session.brandId)
    .single();

  if (!review) {
    return NextResponse.json({ error: 'Review not found' }, { status: 404 });
  }

  const { error } = await supabase
    .from('review_replies')
    .delete()
    .eq('review_id', reviewId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
