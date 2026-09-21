import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const ticket = await supabase.from('tickets').select('id').eq('id', id).eq('brand_id', session.brandId).single();
  if (ticket.error) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
  const hold = await supabase.from('support_automation_holds').upsert({ ticket_id: id, brand_id: session.brandId });
  if (hold.error) return NextResponse.json({ error: 'Could not pause automation for this ticket.' }, { status: 503 });
  const stopped = await supabase.from('support_automation_jobs').update({ status: 'cancelled', reason: 'A person took over this ticket.' }).eq('ticket_id', id).eq('brand_id', session.brandId).eq('status', 'scheduled');
  if (stopped.error) return NextResponse.json({ error: 'Ticket is held, but its queue record could not be updated.' }, { status: 503 });
  const running = await supabase.from('support_automation_jobs').select('id').eq('ticket_id', id).eq('brand_id', session.brandId).eq('status', 'running');
  if (running.error) return NextResponse.json({ error: 'Ticket is held. Refresh to verify any active execution.' }, { status: 503 });
  if (running.data?.length) return NextResponse.json({ error: 'Automation is stopping. An action already submitted may finish; refresh the action timeline before replying.' }, { status: 409 });
  return NextResponse.json({ held: true });
}
