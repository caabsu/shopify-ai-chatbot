import { supabase } from '../config/supabase.js';

// ── Overview Stats ───────────────────────────────────────────────────────────

export async function getOverviewStats(brandId: string, days: number = 30) {
  const since = new Date(Date.now() - days * 86400000).toISOString();

  const [
    { count: totalSessions },
    { count: completedSessions },
    { count: abandonedSessions },
    { count: conversions },
    { count: photoUploads },
    { count: emailCaptures },
  ] = await Promise.all([
    supabase.from('quiz_sessions').select('*', { count: 'exact', head: true }).eq('brand_id', brandId).gte('created_at', since),
    supabase.from('quiz_sessions').select('*', { count: 'exact', head: true }).eq('brand_id', brandId).eq('status', 'completed').gte('created_at', since),
    supabase.from('quiz_sessions').select('*', { count: 'exact', head: true }).eq('brand_id', brandId).eq('status', 'abandoned').gte('created_at', since),
    supabase.from('quiz_sessions').select('*', { count: 'exact', head: true }).eq('brand_id', brandId).eq('converted', true).gte('created_at', since),
    supabase.from('quiz_sessions').select('*', { count: 'exact', head: true }).eq('brand_id', brandId).eq('photo_uploaded', true).gte('created_at', since),
    supabase.from('quiz_sessions').select('*', { count: 'exact', head: true }).eq('brand_id', brandId).not('email', 'is', null).gte('created_at', since),
  ]);

  const total = totalSessions ?? 0;
  const completed = completedSessions ?? 0;

  return {
    totalSessions: total,
    completedSessions: completed,
    abandonedSessions: abandonedSessions ?? 0,
    completionRate: total > 0 ? Math.round((completed / total) * 100) : 0,
    conversionRate: total > 0 ? Math.round(((conversions ?? 0) / total) * 100) : 0,
    conversions: conversions ?? 0,
    photoUploads: photoUploads ?? 0,
    emailCaptures: emailCaptures ?? 0,
    period: days,
  };
}

// ── Concept Comparison (A/B) ────────────────────────────────────────────────

export async function getConceptComparison(brandId: string, days: number = 30) {
  const since = new Date(Date.now() - days * 86400000).toISOString();

  const concepts = ['reveal', 'style-profile'] as const;
  const results = await Promise.all(concepts.map(async (concept) => {
    const [
      { count: total },
      { count: completed },
      { count: converted },
    ] = await Promise.all([
      supabase.from('quiz_sessions').select('*', { count: 'exact', head: true }).eq('brand_id', brandId).eq('concept', concept).gte('created_at', since),
      supabase.from('quiz_sessions').select('*', { count: 'exact', head: true }).eq('brand_id', brandId).eq('concept', concept).eq('status', 'completed').gte('created_at', since),
      supabase.from('quiz_sessions').select('*', { count: 'exact', head: true }).eq('brand_id', brandId).eq('concept', concept).eq('converted', true).gte('created_at', since),
    ]);

    const t = total ?? 0;
    const c = completed ?? 0;
    return {
      concept,
      totalSessions: t,
      completedSessions: c,
      completionRate: t > 0 ? Math.round((c / t) * 100) : 0,
      conversions: converted ?? 0,
      conversionRate: t > 0 ? Math.round(((converted ?? 0) / t) * 100) : 0,
    };
  }));

  return results;
}

// ── Step Funnel (drop-off per step) ─────────────────────────────────────────

export async function getStepFunnel(brandId: string, concept?: string, days: number = 30) {
  const since = new Date(Date.now() - days * 86400000).toISOString();

  let query = supabase
    .from('quiz_events')
    .select('step, event_type')
    .eq('brand_id', brandId)
    .eq('event_type', 'step_enter')
    .not('step', 'is', null)
    .gte('created_at', since);

  if (concept) {
    // Join with sessions to filter by concept — use session_id
    const { data: sessionIds } = await supabase
      .from('quiz_sessions')
      .select('session_id')
      .eq('brand_id', brandId)
      .eq('concept', concept)
      .gte('created_at', since);

    const ids = (sessionIds ?? []).map((s: { session_id: string }) => s.session_id);
    if (ids.length === 0) return [];
    query = query.in('session_id', ids);
  }

  const { data: events, error } = await query;
  if (error) {
    console.error('[quiz-analytics] getStepFunnel error:', error.message);
    return [];
  }

  // Count unique sessions per step
  const stepCounts: Record<string, number> = {};
  for (const event of (events ?? [])) {
    if (event.step) {
      stepCounts[event.step] = (stepCounts[event.step] ?? 0) + 1;
    }
  }

  return Object.entries(stepCounts)
    .map(([step, count]) => ({ step, count }))
    .sort((a, b) => b.count - a.count);
}

// ── Profile Distribution ────────────────────────────────────────────────────

export async function getProfileDistribution(brandId: string, days: number = 30) {
  const since = new Date(Date.now() - days * 86400000).toISOString();

  const { data: rows, error } = await supabase
    .from('quiz_sessions')
    .select('profile_key, profile_name')
    .eq('brand_id', brandId)
    .not('profile_key', 'is', null)
    .gte('created_at', since);

  if (error) {
    console.error('[quiz-analytics] getProfileDistribution error:', error.message);
    return [];
  }

  const counts: Record<string, { name: string; count: number }> = {};
  for (const row of (rows ?? [])) {
    const key = row.profile_key as string;
    if (!counts[key]) counts[key] = { name: (row.profile_name as string) ?? key, count: 0 };
    counts[key].count++;
  }

  return Object.entries(counts)
    .map(([key, { name, count }]) => ({ key, name, count }))
    .sort((a, b) => b.count - a.count);
}

// ── Daily Sessions Time Series ──────────────────────────────────────────────

export async function getDailySessionCounts(brandId: string, days: number = 30) {
  const since = new Date(Date.now() - days * 86400000).toISOString();

  const { data: rows, error } = await supabase
    .from('quiz_sessions')
    .select('created_at, status, concept, converted')
    .eq('brand_id', brandId)
    .gte('created_at', since)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[quiz-analytics] getDailySessionCounts error:', error.message);
    return [];
  }

  const daily: Record<string, { date: string; total: number; completed: number; converted: number; reveal: number; styleProfile: number }> = {};
  for (const row of (rows ?? [])) {
    const date = (row.created_at as string).slice(0, 10);
    if (!daily[date]) daily[date] = { date, total: 0, completed: 0, converted: 0, reveal: 0, styleProfile: 0 };
    daily[date].total++;
    if (row.status === 'completed') daily[date].completed++;
    if (row.converted) daily[date].converted++;
    if (row.concept === 'reveal') daily[date].reveal++;
    if (row.concept === 'style-profile') daily[date].styleProfile++;
  }

  return Object.values(daily);
}

// ── Average Step Duration ───────────────────────────────────────────────────

export async function getAverageStepDurations(brandId: string, days: number = 30) {
  const since = new Date(Date.now() - days * 86400000).toISOString();

  const { data: events, error } = await supabase
    .from('quiz_events')
    .select('step, duration_ms')
    .eq('brand_id', brandId)
    .eq('event_type', 'step_complete')
    .not('step', 'is', null)
    .not('duration_ms', 'is', null)
    .gte('created_at', since);

  if (error) {
    console.error('[quiz-analytics] getAverageStepDurations error:', error.message);
    return [];
  }

  const sums: Record<string, { total: number; count: number }> = {};
  for (const event of (events ?? [])) {
    const step = event.step as string;
    if (!sums[step]) sums[step] = { total: 0, count: 0 };
    sums[step].total += event.duration_ms as number;
    sums[step].count++;
  }

  return Object.entries(sums)
    .map(([step, { total, count }]) => ({
      step,
      avgDurationMs: Math.round(total / count),
      avgDurationSec: Math.round(total / count / 1000),
      sampleSize: count,
    }));
}

// ── Device & UTM Breakdown ──────────────────────────────────────────────────

export async function getDeviceBreakdown(brandId: string, days: number = 30) {
  const since = new Date(Date.now() - days * 86400000).toISOString();

  const { data: rows, error } = await supabase
    .from('quiz_sessions')
    .select('device_type')
    .eq('brand_id', brandId)
    .not('device_type', 'is', null)
    .gte('created_at', since);

  if (error) return [];

  const counts: Record<string, number> = {};
  for (const row of (rows ?? [])) {
    const dt = (row.device_type as string) || 'unknown';
    counts[dt] = (counts[dt] ?? 0) + 1;
  }

  return Object.entries(counts).map(([device, count]) => ({ device, count })).sort((a, b) => b.count - a.count);
}

export async function getUtmBreakdown(brandId: string, days: number = 30) {
  const since = new Date(Date.now() - days * 86400000).toISOString();

  const { data: rows, error } = await supabase
    .from('quiz_sessions')
    .select('utm_source, utm_medium, utm_campaign, converted')
    .eq('brand_id', brandId)
    .not('utm_source', 'is', null)
    .gte('created_at', since);

  if (error) return [];

  const sources: Record<string, { count: number; conversions: number }> = {};
  for (const row of (rows ?? [])) {
    const src = (row.utm_source as string) || 'direct';
    if (!sources[src]) sources[src] = { count: 0, conversions: 0 };
    sources[src].count++;
    if (row.converted) sources[src].conversions++;
  }

  return Object.entries(sources)
    .map(([source, { count, conversions }]) => ({ source, count, conversions, conversionRate: count > 0 ? Math.round((conversions / count) * 100) : 0 }))
    .sort((a, b) => b.count - a.count);
}
