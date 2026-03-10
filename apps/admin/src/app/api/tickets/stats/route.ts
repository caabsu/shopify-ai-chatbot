import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const brandId = session.brandId;

  // Run queries in parallel
  const [
    openRes,
    pendingRes,
    resolvedRes,
    closedRes,
    urgentRes,
    highRes,
    mediumRes,
    lowRes,
    unassignedRes,
    breachingRes,
    emailRes,
    formRes,
    aiRes,
    eventsRes,
  ] = await Promise.all([
    supabase.from('tickets').select('id', { count: 'exact', head: true }).eq('brand_id', brandId).eq('status', 'open'),
    supabase.from('tickets').select('id', { count: 'exact', head: true }).eq('brand_id', brandId).eq('status', 'pending'),
    supabase.from('tickets').select('id', { count: 'exact', head: true }).eq('brand_id', brandId).eq('status', 'resolved'),
    supabase.from('tickets').select('id', { count: 'exact', head: true }).eq('brand_id', brandId).eq('status', 'closed'),
    supabase.from('tickets').select('id', { count: 'exact', head: true }).eq('brand_id', brandId).eq('priority', 'urgent').in('status', ['open', 'pending']),
    supabase.from('tickets').select('id', { count: 'exact', head: true }).eq('brand_id', brandId).eq('priority', 'high').in('status', ['open', 'pending']),
    supabase.from('tickets').select('id', { count: 'exact', head: true }).eq('brand_id', brandId).eq('priority', 'medium').in('status', ['open', 'pending']),
    supabase.from('tickets').select('id', { count: 'exact', head: true }).eq('brand_id', brandId).eq('priority', 'low').in('status', ['open', 'pending']),
    supabase.from('tickets').select('id', { count: 'exact', head: true }).eq('brand_id', brandId).is('assigned_to', null).in('status', ['open', 'pending']),
    supabase.from('tickets').select('id', { count: 'exact', head: true }).eq('brand_id', brandId).eq('sla_breached', true).in('status', ['open', 'pending']),
    supabase.from('tickets').select('id', { count: 'exact', head: true }).eq('brand_id', brandId).eq('source', 'email'),
    supabase.from('tickets').select('id', { count: 'exact', head: true }).eq('brand_id', brandId).eq('source', 'form'),
    supabase.from('tickets').select('id', { count: 'exact', head: true }).eq('brand_id', brandId).eq('source', 'ai_escalation'),
    supabase
      .from('ticket_events')
      .select('*, tickets!inner(brand_id)')
      .eq('tickets.brand_id', brandId)
      .order('created_at', { ascending: false })
      .limit(10),
  ]);

  // Calculate avg first response time from tickets that have first_response_at
  const { data: respondedTickets } = await supabase
    .from('tickets')
    .select('created_at, first_response_at')
    .eq('brand_id', brandId)
    .not('first_response_at', 'is', null)
    .limit(100);

  let avgFirstResponseMinutes = 0;
  if (respondedTickets && respondedTickets.length > 0) {
    const totalMinutes = respondedTickets.reduce((sum, t) => {
      const diff = new Date(t.first_response_at).getTime() - new Date(t.created_at).getTime();
      return sum + diff / 60000;
    }, 0);
    avgFirstResponseMinutes = Math.round(totalMinutes / respondedTickets.length);
  }

  const openCount = openRes.count ?? 0;
  const totalActive = openCount + (pendingRes.count ?? 0);
  const totalAll = totalActive + (resolvedRes.count ?? 0) + (closedRes.count ?? 0);
  const breachingCount = breachingRes.count ?? 0;
  const slaCompliancePercent = totalAll > 0 ? Math.round(((totalAll - breachingCount) / totalAll) * 100) : 100;

  return NextResponse.json({
    openCount,
    pendingCount: pendingRes.count ?? 0,
    resolvedCount: resolvedRes.count ?? 0,
    closedCount: closedRes.count ?? 0,
    urgentCount: urgentRes.count ?? 0,
    highCount: highRes.count ?? 0,
    mediumCount: mediumRes.count ?? 0,
    lowCount: lowRes.count ?? 0,
    urgentHighCount: (urgentRes.count ?? 0) + (highRes.count ?? 0),
    unassignedCount: unassignedRes.count ?? 0,
    breachingCount,
    avgFirstResponseMinutes,
    slaCompliancePercent,
    ticketsBySource: {
      email: emailRes.count ?? 0,
      form: formRes.count ?? 0,
      ai_escalation: aiRes.count ?? 0,
    },
    recentEvents: eventsRes.data ?? [],
  });
}
