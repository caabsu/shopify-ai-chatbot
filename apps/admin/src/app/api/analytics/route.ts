import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const brandId = session.brandId;

  // Totals
  const [convResult, activeResult, escalatedResult, msgResult] = await Promise.all([
    supabase.from('conversations').select('*', { count: 'exact', head: true }).eq('brand_id', brandId),
    supabase.from('conversations').select('*', { count: 'exact', head: true }).eq('brand_id', brandId).eq('status', 'active'),
    supabase.from('conversations').select('*', { count: 'exact', head: true }).eq('brand_id', brandId).eq('status', 'escalated'),
    supabase.from('messages').select('tokens_input, tokens_output, latency_ms').eq('brand_id', brandId).eq('role', 'assistant').not('tokens_input', 'is', null),
  ]);

  const totalConversations = convResult.count ?? 0;
  const activeConversations = activeResult.count ?? 0;
  const escalatedConversations = escalatedResult.count ?? 0;

  const messages = msgResult.data ?? [];
  const totalTokens = messages.reduce((sum, m) => sum + (m.tokens_input || 0) + (m.tokens_output || 0), 0);
  const avgLatency = messages.length > 0
    ? Math.round(messages.reduce((sum, m) => sum + (m.latency_ms || 0), 0) / messages.length)
    : 0;

  // Satisfaction
  const { data: satRows } = await supabase
    .from('conversations')
    .select('satisfaction_score')
    .eq('brand_id', brandId)
    .not('satisfaction_score', 'is', null);
  const avgSatisfaction = satRows && satRows.length > 0
    ? (satRows.reduce((sum, r) => sum + (r.satisfaction_score ?? 0), 0) / satRows.length).toFixed(1)
    : null;

  // Conversations per day (last 30 days)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data: dailyConvs } = await supabase
    .from('conversations')
    .select('created_at')
    .eq('brand_id', brandId)
    .gte('created_at', thirtyDaysAgo);

  const dailyMap = new Map<string, number>();
  for (const c of dailyConvs ?? []) {
    const day = c.created_at.slice(0, 10);
    dailyMap.set(day, (dailyMap.get(day) ?? 0) + 1);
  }
  const conversationsPerDay = Array.from(dailyMap.entries())
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Tool usage
  const { data: toolRows } = await supabase
    .from('messages')
    .select('tools_used')
    .eq('brand_id', brandId)
    .not('tools_used', 'is', null);

  const toolCounts = new Map<string, number>();
  for (const row of toolRows ?? []) {
    const tools = row.tools_used as string[] | null;
    if (tools) {
      for (const t of tools) {
        toolCounts.set(t, (toolCounts.get(t) ?? 0) + 1);
      }
    }
  }
  const toolUsage = Array.from(toolCounts.entries())
    .map(([tool, count]) => ({ tool, count }))
    .sort((a, b) => b.count - a.count);

  return NextResponse.json({
    totalConversations,
    activeConversations,
    escalatedConversations,
    totalTokens,
    avgLatency,
    avgSatisfaction,
    conversationsPerDay,
    toolUsage,
  });
}
