import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { ids, action } = body;

  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: 'ids array is required' }, { status: 400 });
  }

  const validActions = ['publish', 'reject', 'archive', 'delete'];
  if (!action || !validActions.includes(action)) {
    return NextResponse.json({ error: `action must be one of: ${validActions.join(', ')}` }, { status: 400 });
  }

  if (ids.length > 500) {
    return NextResponse.json({ error: 'Maximum 500 reviews per bulk operation' }, { status: 400 });
  }

  if (action === 'delete') {
    // Cascade handles media and replies
    for (let i = 0; i < ids.length; i += 200) {
      const batch = ids.slice(i, i + 200);
      const { error } = await supabase
        .from('reviews')
        .delete()
        .in('id', batch)
        .eq('brand_id', session.brandId);

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }

    return NextResponse.json({ updated: ids.length, action });
  }

  // Map action to status
  const statusMap: Record<string, string> = {
    publish: 'published',
    reject: 'rejected',
    archive: 'archived',
  };

  const updates: Record<string, unknown> = {
    status: statusMap[action],
    updated_at: new Date().toISOString(),
  };

  if (action === 'publish') {
    updates.published_at = new Date().toISOString();
  }

  let totalUpdated = 0;
  for (let i = 0; i < ids.length; i += 200) {
    const batch = ids.slice(i, i + 200);
    const { data, error } = await supabase
      .from('reviews')
      .update(updates)
      .in('id', batch)
      .eq('brand_id', session.brandId)
      .select('id');

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    totalUpdated += (data ?? []).length;
  }

  return NextResponse.json({ updated: totalUpdated, action });
}
