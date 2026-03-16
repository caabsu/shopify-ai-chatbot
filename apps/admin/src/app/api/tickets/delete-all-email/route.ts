import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

// POST /api/tickets/delete-all-email — PERMANENTLY delete all email-sourced tickets
// This is a one-time cleanup endpoint for the email sync mess
export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    // Find all email-sourced tickets for this brand
    let allIds: string[] = [];
    let offset = 0;
    const pageSize = 500;

    while (true) {
      const { data } = await supabase
        .from('tickets')
        .select('id')
        .eq('brand_id', session.brandId)
        .eq('source', 'email')
        .range(offset, offset + pageSize - 1);

      if (!data || data.length === 0) break;
      allIds = allIds.concat(data.map((t) => t.id));
      if (data.length < pageSize) break;
      offset += pageSize;
    }

    if (allIds.length === 0) {
      return NextResponse.json({ deleted: 0 });
    }

    let totalDeleted = 0;

    // Delete in batches — cascade will handle ticket_messages and ticket_events
    for (let i = 0; i < allIds.length; i += 200) {
      const batch = allIds.slice(i, i + 200);

      // Delete ticket_messages first (in case no cascade)
      await supabase
        .from('ticket_messages')
        .delete()
        .in('ticket_id', batch);

      // Delete ticket_events
      await supabase
        .from('ticket_events')
        .delete()
        .in('ticket_id', batch);

      // Delete tickets
      const { data: deleted } = await supabase
        .from('tickets')
        .delete()
        .in('id', batch)
        .eq('brand_id', session.brandId)
        .select('id');

      totalDeleted += deleted?.length ?? 0;
    }

    console.log(`[delete-all-email] Permanently deleted ${totalDeleted} email tickets for brand ${session.brandId}`);
    return NextResponse.json({ deleted: totalDeleted });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[delete-all-email] Error:', message);
    return NextResponse.json({ error: 'Failed to delete tickets' }, { status: 500 });
  }
}
