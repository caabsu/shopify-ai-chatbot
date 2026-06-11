import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

/**
 * Merge another ticket INTO this one. The source ticket's messages move to the
 * target thread, the source is closed and stamped metadata.merged_into_ticket_id,
 * and both tickets get audit events. Used for duplicate tickets from the same
 * customer (separate emails about the same issue).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: targetId } = await params;
  const { source_id: sourceId } = await req.json();

  if (!sourceId || typeof sourceId !== 'string') {
    return NextResponse.json({ error: 'source_id is required' }, { status: 400 });
  }
  if (sourceId === targetId) {
    return NextResponse.json({ error: 'Cannot merge a ticket into itself' }, { status: 400 });
  }

  const [{ data: target }, { data: source }] = await Promise.all([
    supabase.from('tickets').select('id, ticket_number, status, metadata').eq('id', targetId).eq('brand_id', session.brandId).single(),
    supabase.from('tickets').select('id, ticket_number, status, metadata, customer_email').eq('id', sourceId).eq('brand_id', session.brandId).single(),
  ]);

  if (!target || !source) {
    return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
  }
  if ((source.metadata as Record<string, unknown> | null)?.merged_into_ticket_id) {
    return NextResponse.json({ error: 'Ticket is already merged' }, { status: 409 });
  }

  const now = new Date().toISOString();

  // Move messages from source to target
  const { error: moveError } = await supabase
    .from('ticket_messages')
    .update({ ticket_id: targetId })
    .eq('ticket_id', sourceId);

  if (moveError) {
    return NextResponse.json({ error: `Failed to move messages: ${moveError.message}` }, { status: 500 });
  }

  // Close the source, pointing at the target
  await supabase
    .from('tickets')
    .update({
      status: 'closed',
      closed_at: now,
      updated_at: now,
      metadata: { ...((source.metadata as Record<string, unknown>) || {}), merged_into_ticket_id: targetId },
    })
    .eq('id', sourceId);

  // System note on the target so the thread explains itself
  await supabase.from('ticket_messages').insert({
    ticket_id: targetId,
    sender_type: 'system',
    sender_name: 'supportOS',
    content: `Merged ticket #${source.ticket_number} into this ticket (by ${session.name || 'admin'}). Its messages now appear in this thread.`,
    is_internal_note: true,
  });

  await supabase.from('ticket_events').insert([
    {
      ticket_id: targetId,
      event_type: 'merged_in',
      actor: 'agent',
      actor_id: session.userId ?? null,
      new_value: `#${source.ticket_number}`,
      metadata: { source_ticket_id: sourceId },
    },
    {
      ticket_id: sourceId,
      event_type: 'merged_away',
      actor: 'agent',
      actor_id: session.userId ?? null,
      new_value: `#${target.ticket_number}`,
      metadata: { target_ticket_id: targetId },
    },
  ]);

  await supabase.from('tickets').update({ updated_at: now }).eq('id', targetId);

  return NextResponse.json({ success: true, merged: source.ticket_number, into: target.ticket_number });
}
