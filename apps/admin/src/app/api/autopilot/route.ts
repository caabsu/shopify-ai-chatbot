import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { getAutopilotLearningStats } from '@/lib/autopilot-learning';
import { pendingPlanNeedsAutomaticRepair } from '@/lib/autopilot-execution-policy';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const AUTOMATIC_AWAITING_CUSTOMER_PROMPT_VERSIONS = new Set([
  'response-state-park-v1',
  'response-state-auto-park-v2',
]);

/**
 * Autopilot review queue. Lists tickets carrying an AI action plan
 * (tickets.metadata.autopilot), grouped by review state:
 *   pending   → proposed or executing (needs a decision or safe resume)
 *   done      → executed / partially_executed / failed
 *   dismissed → dismissed
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const tab = req.nextUrl.searchParams.get('tab') || 'pending';
  const statuses =
    tab === 'done' ? ['executed', 'partially_executed', 'failed', 'approved']
    : tab === 'dismissed' ? ['dismissed']
    : ['proposed', 'executing'];

  let ticketQuery = supabase
    .from('tickets')
    .select('*')
    .eq('brand_id', session.brandId)
    .filter('metadata->autopilot->>status', 'in', `(${statuses.join(',')})`)
    .order('updated_at', { ascending: false });
  // A closed ticket can retain an archived/legacy proposed projection, but it
  // is not actionable work. Keep it out of Pending while preserving it in the
  // ticket audit/history for migration provenance.
  if (tab !== 'done' && tab !== 'dismissed') {
    ticketQuery = ticketQuery.in('status', ['open', 'pending']);
  }
  const { data, error } = await ticketQuery.limit(100);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const tickets = (data ?? []).filter((ticket) => (
    tab !== 'pending'
    || !AUTOMATIC_AWAITING_CUSTOMER_PROMPT_VERSIONS.has(String(
      (ticket.metadata as Record<string, any> | null)?.autopilot?.prompt_version ?? '',
    ))
  ));
  const executingPlanIds = tickets
    .map((ticket) => ((ticket.metadata as Record<string, unknown> | null)?.autopilot as { id?: string; status?: string } | undefined))
    .filter((plan): plan is { id: string; status?: string } => Boolean(plan?.id && plan.status === 'executing'))
    .map((plan) => plan.id);
  const { data: receiptRows } = executingPlanIds.length
    ? await supabase
        .from('autopilot_action_executions')
        .select('id, plan_id, action_id, action_type, status, result, error, provider_reference, context_before, expected_context_after, context_after, started_at, lease_expires_at, heartbeat_at, provider_deadline_at, failure_reconcile_after')
        .in('plan_id', executingPlanIds)
        .order('started_at', { ascending: true })
    : { data: [] };
  const receiptsByPlan = new Map<string, Record<string, unknown>[]>();
  for (const receipt of receiptRows ?? []) {
    const planId = String(receipt.plan_id);
    receiptsByPlan.set(planId, [...(receiptsByPlan.get(planId) ?? []), receipt]);
  }
  const responseTicketsWithRepairState = tickets.map((ticket) => {
    const metadata = { ...((ticket.metadata as Record<string, unknown> | null) ?? {}) };
    const plan = metadata.autopilot as Record<string, unknown> | undefined;
    if (!plan || typeof plan.id !== 'string') return ticket;
    const executionReceipts = receiptsByPlan.get(plan.id);
    return executionReceipts?.length
      ? { ...ticket, metadata: { ...metadata, autopilot: { ...plan, execution_receipts: executionReceipts } } }
      : ticket;
  });
  const responseTickets = responseTicketsWithRepairState.filter((ticket) => {
    if (tab !== 'pending') return true;
    const metadata = (ticket.metadata as Record<string, unknown> | null) ?? {};
    const plan = metadata.autopilot as {
      status?: string;
      context_version?: number;
      decided_at?: string;
      execution_receipts?: Array<{ status?: string }>;
    } | undefined;
    return !pendingPlanNeedsAutomaticRepair({
      planStatus: plan?.status,
      planContextVersion: plan?.context_version,
      ticketContextVersion: Number(ticket.context_version ?? 0),
      decidedAt: plan?.decided_at,
      receipts: plan?.execution_receipts,
    });
  });
  const automaticRepairCount = responseTicketsWithRepairState.length - responseTickets.length;

  // Counts for the tab bar
  const [pendingRes, automaticParkRes, doneRes, dismissedRes, learning] = await Promise.all([
    supabase.from('tickets').select('id', { count: 'exact', head: true }).eq('brand_id', session.brandId).in('status', ['open', 'pending']).filter('metadata->autopilot->>status', 'in', '(proposed,executing)'),
    supabase.from('tickets').select('id', { count: 'exact', head: true }).eq('brand_id', session.brandId).in('status', ['open', 'pending']).filter('metadata->autopilot->>status', 'eq', 'proposed').filter('metadata->autopilot->>prompt_version', 'in', '(response-state-park-v1,response-state-auto-park-v2)'),
    supabase.from('tickets').select('id', { count: 'exact', head: true }).eq('brand_id', session.brandId).filter('metadata->autopilot->>status', 'in', '(executed,partially_executed,failed)'),
    supabase.from('tickets').select('id', { count: 'exact', head: true }).eq('brand_id', session.brandId).filter('metadata->autopilot->>status', 'eq', 'dismissed'),
    getAutopilotLearningStats(session.brandId),
  ]);

  return NextResponse.json({
    tickets: responseTickets,
    counts: {
      pending: Math.max(0, (pendingRes.count ?? 0) - (automaticParkRes.count ?? 0) - automaticRepairCount),
      done: doneRes.count ?? 0,
      dismissed: dismissedRes.count ?? 0,
    },
    learning,
  }, {
    headers: {
      'Cache-Control': 'private, no-store, max-age=0',
    },
  });
}
