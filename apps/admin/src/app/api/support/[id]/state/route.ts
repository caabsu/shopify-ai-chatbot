import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const ticket = await supabase.from('tickets').select('id,metadata').eq('id', id).eq('brand_id', session.brandId).single();
  if (ticket.error) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
  const [hold, jobs] = await Promise.all([
    supabase.from('support_automation_holds').select('ticket_id').eq('ticket_id', id).eq('brand_id', session.brandId).maybeSingle(),
    supabase.from('support_automation_jobs').select('id,status,scheduled_for,reason,plan_id').eq('ticket_id', id).eq('brand_id', session.brandId).order('created_at', { ascending: false }).limit(1),
  ]);
  const missingSchema = [hold.error, jobs.error].some(error => error && ['PGRST205', '42P01'].includes(error.code));
  if ((hold.error || jobs.error) && !missingSchema) return NextResponse.json({ error: 'Automation state is unavailable. Refresh before sending.' }, { status: 503 });
  return NextResponse.json({ ready: !missingSchema, held: Boolean(hold.data), job: jobs.data?.[0] || null }, { headers: { 'Cache-Control': 'private, no-store' } });
}
