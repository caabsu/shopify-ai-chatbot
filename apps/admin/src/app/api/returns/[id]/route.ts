import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  const { data: returnRequest, error } = await supabase
    .from('return_requests')
    .select('*')
    .eq('id', id)
    .eq('brand_id', session.brandId)
    .single();

  if (error || !returnRequest) {
    return NextResponse.json({ error: 'Return not found' }, { status: 404 });
  }

  // Get items
  const { data: items } = await supabase
    .from('return_items')
    .select('*')
    .eq('return_request_id', id)
    .order('created_at', { ascending: true });

  return NextResponse.json({
    returnRequest: {
      ...returnRequest,
      items: items ?? [],
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

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (body.status !== undefined) updates.status = body.status;
  if (body.resolution_type !== undefined) updates.resolution_type = body.resolution_type;
  if (body.refund_amount !== undefined) updates.refund_amount = body.refund_amount;
  if (body.admin_notes !== undefined) updates.admin_notes = body.admin_notes;
  if (body.decided_by !== undefined) updates.decided_by = body.decided_by;
  if (body.decided_at !== undefined) updates.decided_at = body.decided_at;

  const { data: returnRequest, error } = await supabase
    .from('return_requests')
    .update(updates)
    .eq('id', id)
    .eq('brand_id', session.brandId)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // If updating item statuses
  if (body.item_updates && Array.isArray(body.item_updates)) {
    for (const itemUpdate of body.item_updates) {
      const itemUpdates: Record<string, unknown> = {};
      if (itemUpdate.item_status !== undefined) itemUpdates.item_status = itemUpdate.item_status;
      if (itemUpdate.denial_reason !== undefined) itemUpdates.denial_reason = itemUpdate.denial_reason;

      if (Object.keys(itemUpdates).length > 0) {
        await supabase
          .from('return_items')
          .update(itemUpdates)
          .eq('id', itemUpdate.id)
          .eq('return_request_id', id);
      }
    }
  }

  // Re-fetch with items
  const { data: items } = await supabase
    .from('return_items')
    .select('*')
    .eq('return_request_id', id)
    .order('created_at', { ascending: true });

  return NextResponse.json({
    returnRequest: {
      ...returnRequest,
      items: items ?? [],
    },
  });
}
