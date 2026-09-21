import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import type { SupportAutomationJob } from '@/lib/support-automation-types';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const view = req.nextUrl.searchParams.get('view') || 'inbox';
  const page = Math.floor(Math.max(1, Math.min(10000, Number(req.nextUrl.searchParams.get('page')) || 1)));
  const search = (req.nextUrl.searchParams.get('search') || '').replace(/[,()%\\]/g, ' ').trim().slice(0, 120);
  const pageSize = 30;
  const [settings, jobCounts, inboxCount, pendingCount] = await Promise.all([
    supabase.from('support_automation_settings').select('*').eq('brand_id', session.brandId).maybeSingle(),
    Promise.all(['scheduled', 'completed', 'needs_review'].map(status => supabase.from('support_automation_jobs').select('id', { count: 'exact', head: true }).eq('brand_id', session.brandId).in('status', status === 'scheduled' ? ['scheduled', 'running'] : [status]))),
    supabase.from('tickets').select('id', { count: 'exact', head: true }).eq('brand_id', session.brandId).in('status', ['open', 'pending']).is('merged_into_ticket_id', null),
    supabase.from('tickets').select('id', { count: 'exact', head: true }).eq('brand_id', session.brandId).in('status', ['open', 'pending']).filter('metadata->autopilot->>status', 'eq', 'proposed'),
  ]);
  if (inboxCount.error || pendingCount.error) return NextResponse.json({ error: 'Support inbox is unavailable. Please retry.' }, { status: 503 });
  const ready = !settings.error && Boolean(settings.data) && jobCounts.every(r => !r.error);
  const reviewCount = ready ? await supabase.from('support_inbox_queue').select('id', { count: 'exact', head: true }).eq('brand_id', session.brandId).eq('needs_review', true) : pendingCount;
  if (reviewCount.error) return NextResponse.json({ error: 'Could not load the review queue.' }, { status: 503 });
  let items: Array<{ ticket: unknown; job: SupportAutomationJob | null }> = [];
  let total = 0;
  if (view === 'scheduled' || view === 'completed') {
    let query = supabase.from('support_automation_jobs').select('*, ticket:tickets!inner(*)', { count: 'exact' }).eq('brand_id', session.brandId).in('status', view === 'scheduled' ? ['scheduled', 'running'] : ['completed']).order(view === 'scheduled' ? 'scheduled_for' : 'completed_at', { ascending: view === 'scheduled' });
    if (search) query = query.ilike('ticket.subject', `%${search}%`);
    if (ready) {
      const result = await query.range((page - 1) * pageSize, page * pageSize - 1);
      if (result.error) return NextResponse.json({ error: 'Automation history is unavailable.' }, { status: 503 });
      items = (result.data || []).map(row => { const { ticket, ...job } = row; return { ticket, job: job as SupportAutomationJob }; });
      total = result.count || 0;
    }
  } else if (ready) {
    let query = supabase.from('support_inbox_queue').select('ticket,job', { count: 'exact' }).eq('brand_id', session.brandId).order('updated_at', { ascending: false });
    if (view === 'review') query = query.eq('needs_review', true);
    if (search) query = query.or(`subject.ilike.%${search}%,customer_email.ilike.%${search}%,customer_name.ilike.%${search}%`);
    const result = await query.range((page - 1) * pageSize, page * pageSize - 1);
    if (result.error) return NextResponse.json({ error: 'Could not load the support queue.' }, { status: 503 });
    items = (result.data || []).map(row => ({ ticket: row.ticket, job: row.job as SupportAutomationJob | null }));
    total = result.count || 0;
  } else {
    let query = supabase.from('tickets').select('*', { count: 'exact' }).eq('brand_id', session.brandId).is('merged_into_ticket_id', null).in('status', ['open', 'pending']).order('updated_at', { ascending: false });
    if (search) query = query.or(`subject.ilike.%${search}%,customer_email.ilike.%${search}%,customer_name.ilike.%${search}%`);
    if (view === 'review') query = query.or('metadata->autopilot->>status.eq.proposed,metadata->autopilot->>status.eq.failed,metadata->autopilot->>status.eq.partially_executed');
    const result = await query.range((page - 1) * pageSize, page * pageSize - 1);
    if (result.error) return NextResponse.json({ error: 'Could not load tickets.' }, { status: 503 });
    const tickets = result.data || [];
    const jobs = ready && tickets.length ? await supabase.from('support_automation_jobs').select('*').eq('brand_id', session.brandId).in('ticket_id', tickets.map(t => t.id)).order('created_at', { ascending: false }) : { data: [] };
    items = tickets.map(ticket => ({ ticket, job: ((jobs.data || []).find(j => j.ticket_id === ticket.id) as SupportAutomationJob) || null }));
    total = result.count || 0;
  }
  return NextResponse.json({ items, total, page, page_size: pageSize, settings: settings.data, automation_ready: ready, worker_configured: Boolean(process.env.SUPPORT_AUTOMATION_SECRET), counts: { inbox: inboxCount.count || 0, scheduled: jobCounts[0].count || 0, completed: jobCounts[1].count || 0, review: reviewCount.count || 0 } }, { headers: { 'Cache-Control': 'private, no-store' } });
}
