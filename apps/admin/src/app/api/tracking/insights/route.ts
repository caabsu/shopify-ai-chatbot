import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

function maskEmail(email: string | null): string {
  if (!email) return '';
  const atIdx = email.indexOf('@');
  if (atIdx < 1) return '***';
  return email[0] + '***@' + email.slice(atIdx + 1);
}

function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const brandId = session.brandId;

  try {
    // ── Total lookups (all time) ──────────────────────────────────────────
    const { count: totalLookups } = await supabase
      .from('tracking_lookups')
      .select('*', { count: 'exact', head: true })
      .eq('brand_id', brandId);

    // ── This week ──────────────────────────────────────────────────────────
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const { count: lookupsThisWeek } = await supabase
      .from('tracking_lookups')
      .select('*', { count: 'exact', head: true })
      .eq('brand_id', brandId)
      .gte('created_at', weekAgo.toISOString());

    // ── Today ─────────────────────────────────────────────────────────────
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const { count: lookupsToday } = await supabase
      .from('tracking_lookups')
      .select('*', { count: 'exact', head: true })
      .eq('brand_id', brandId)
      .gte('created_at', todayStart.toISOString());

    // ── All rows for aggregation ───────────────────────────────────────────
    const { data: allRows } = await supabase
      .from('tracking_lookups')
      .select('status, carrier, created_at')
      .eq('brand_id', brandId)
      .gte('created_at', (() => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString(); })());

    const rows = allRows ?? [];

    // byStatus
    const byStatus: Record<string, number> = {};
    for (const r of rows) {
      if (r.status) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    }

    // byCarrier
    const byCarrier: Record<string, number> = {};
    for (const r of rows) {
      if (r.carrier) byCarrier[r.carrier] = (byCarrier[r.carrier] ?? 0) + 1;
    }

    // byDay — last 30 days
    const dayCounts: Record<string, number> = {};
    for (const r of rows) {
      const day = r.created_at ? r.created_at.slice(0, 10) : null;
      if (day) dayCounts[day] = (dayCounts[day] ?? 0) + 1;
    }
    // Build the full 30-day array with zeros for missing days
    const byDay: Array<{ date: string; count: number }> = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = toDateString(d);
      byDay.push({ date: dateStr, count: dayCounts[dateStr] ?? 0 });
    }

    // ── Recent lookups ────────────────────────────────────────────────────
    const { data: recentRows } = await supabase
      .from('tracking_lookups')
      .select('order_number, email, status, carrier, created_at')
      .eq('brand_id', brandId)
      .order('created_at', { ascending: false })
      .limit(20);

    const recentLookups = (recentRows ?? []).map((r) => ({
      order_number: r.order_number ?? null,
      email: maskEmail(r.email),
      status: r.status,
      carrier: r.carrier ?? null,
      created_at: r.created_at,
    }));

    return NextResponse.json({
      totalLookups: totalLookups ?? 0,
      lookupsThisWeek: lookupsThisWeek ?? 0,
      lookupsToday: lookupsToday ?? 0,
      byStatus,
      byCarrier,
      byDay,
      recentLookups,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[tracking/insights] error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
