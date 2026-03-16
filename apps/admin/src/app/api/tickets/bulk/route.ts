import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

// POST /api/tickets/bulk — Bulk update tickets (close, change status, etc.)
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { ids, status, priority, category } = body;

  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: 'ids array is required' }, { status: 400 });
  }

  if (ids.length > 2000) {
    return NextResponse.json({ error: 'Maximum 2000 tickets per bulk operation' }, { status: 400 });
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (status) {
    updates.status = status;
    if (status === 'resolved') updates.resolved_at = new Date().toISOString();
    if (status === 'closed') updates.closed_at = new Date().toISOString();
  }
  if (priority) updates.priority = priority;
  if (category) updates.category = category;

  if (Object.keys(updates).length <= 1) {
    return NextResponse.json({ error: 'At least one update field is required' }, { status: 400 });
  }

  // Batch in groups of 200 for Supabase .in() limits
  const allUpdated: { id: string }[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const batch = ids.slice(i, i + 200);
    const { data, error } = await supabase
      .from('tickets')
      .update(updates)
      .in('id', batch)
      .eq('brand_id', session.brandId)
      .select('id');

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    allUpdated.push(...(data ?? []));
  }

  // Log events for status changes
  if (status) {
    for (const row of allUpdated) {
      await supabase.from('ticket_events').insert({
        ticket_id: row.id,
        event_type: 'status_changed',
        actor: 'agent',
        actor_id: session.userId,
        new_value: status,
      });
    }
  }

  return NextResponse.json({ updated: allUpdated.length });
}
