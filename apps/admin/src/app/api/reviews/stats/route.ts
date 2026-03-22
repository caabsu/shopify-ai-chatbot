import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const brandId = session.brandId;

  // Run status counts in parallel
  const [allRes, publishedRes, pendingRes, rejectedRes, archivedRes] = await Promise.all([
    supabase.from('reviews').select('id', { count: 'exact', head: true }).eq('brand_id', brandId),
    supabase.from('reviews').select('id', { count: 'exact', head: true }).eq('brand_id', brandId).eq('status', 'published'),
    supabase.from('reviews').select('id', { count: 'exact', head: true }).eq('brand_id', brandId).eq('status', 'pending'),
    supabase.from('reviews').select('id', { count: 'exact', head: true }).eq('brand_id', brandId).eq('status', 'rejected'),
    supabase.from('reviews').select('id', { count: 'exact', head: true }).eq('brand_id', brandId).eq('status', 'archived'),
  ]);

  // For with_photos and with_replies, fetch review IDs first then count distinct
  const { data: reviewIds } = await supabase
    .from('reviews')
    .select('id')
    .eq('brand_id', brandId);

  let withPhotos = 0;
  let withReplies = 0;

  if (reviewIds && reviewIds.length > 0) {
    const ids = reviewIds.map((r) => r.id);

    // Batch in groups of 200 for .in() limits
    const mediaReviewIds = new Set<string>();
    const replyReviewIds = new Set<string>();

    for (let i = 0; i < ids.length; i += 200) {
      const batch = ids.slice(i, i + 200);

      const [mediaRes, repliesRes] = await Promise.all([
        supabase
          .from('review_media')
          .select('review_id')
          .in('review_id', batch),
        supabase
          .from('review_replies')
          .select('review_id')
          .in('review_id', batch),
      ]);

      if (mediaRes.data) {
        for (const m of mediaRes.data) mediaReviewIds.add(m.review_id);
      }
      if (repliesRes.data) {
        for (const r of repliesRes.data) replyReviewIds.add(r.review_id);
      }
    }

    withPhotos = mediaReviewIds.size;
    withReplies = replyReviewIds.size;
  }

  return NextResponse.json({
    all: allRes.count ?? 0,
    published: publishedRes.count ?? 0,
    pending: pendingRes.count ?? 0,
    rejected: rejectedRes.count ?? 0,
    archived: archivedRes.count ?? 0,
    with_photos: withPhotos,
    with_replies: withReplies,
  });
}
