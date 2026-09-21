import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function numericArg(name: string, fallback: number): number {
  const prefix = `--${name}=`;
  const raw = process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

const concurrency = Math.min(6, numericArg('concurrency', 3));
const maxPasses = Math.min(5, numericArg('passes', 3));
const maxTickets = numericArg('max', Number.MAX_SAFE_INTEGER);
const requestedTicket = numericArg('ticket', 0);
const requestedTickets = new Set(
  (process.argv.find((arg) => arg.startsWith('--tickets='))?.slice('--tickets='.length) ?? '')
    .split(',')
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value > 0),
);
if (requestedTicket > 0) requestedTickets.add(requestedTicket);
const forceRequestedTicket = requestedTickets.size > 0 && process.argv.includes('--force');
const forceAll = process.argv.includes('--force-all');
const requestedBrand = process.argv
  .find((arg) => arg.startsWith('--brand='))
  ?.slice('--brand='.length)
  .trim()
  .toLowerCase();

const { data: brands, error: brandsError } = await supabase
  .from('brands')
  .select('id, slug')
  .eq('enabled', true);
if (brandsError) throw new Error(`brands: ${brandsError.message}`);
const configuredBrandSlugs = new Set(
  (process.env.AUTOPILOT_BRANDS || 'warm-by-design')
    .split(',')
    .map((slug) => slug.trim().toLowerCase())
    .filter(Boolean),
);
const enabledBrands = (brands ?? []).filter((brand) => (
  configuredBrandSlugs.has(String(brand.slug).toLowerCase())
  && (!requestedBrand || String(brand.slug).toLowerCase() === requestedBrand)
));
const enabledBrandIds = enabledBrands.map((brand) => brand.id);

const [
  { proposeForTicket, refreshTicketPlan },
  { autopilotPlanRefreshReasons },
  { customerHistoryEvidenceMatches },
  { validatorFallbackNeedsRetry },
] = await Promise.all([
  import('../apps/backend/src/services/autopilot.service.js'),
  import('../apps/backend/src/services/autopilot-coverage-policy.js'),
  import('../apps/backend/src/services/autopilot-refresh-policy.js'),
  import('../apps/backend/src/services/autopilot-validation-repair-policy.js'),
]);

type RepairTicket = {
  id: string;
  ticket_number: number;
  brand_id: string;
  status: string;
  customer_email: string | null;
  context_version: number;
  classification: string | null;
  metadata: Record<string, unknown> | null;
  force_customer_history_refresh?: boolean;
  force_plan_refresh?: boolean;
};

function canonicalUuid(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function needsRepair(ticket: RepairTicket): boolean {
  const plan = ticket.metadata?.autopilot as Record<string, any> | undefined;
  if (!plan
      || plan.version !== 2
      || !canonicalUuid(plan.id)
      || !Number.isInteger(plan.revision)
      || typeof plan.context_fingerprint !== 'string'
      || !plan.context_fingerprint
      || !Number.isInteger(plan.context_version)
      || !Array.isArray(plan.actions)
      || plan.actions.length === 0) {
    return true;
  }
  if (
    plan.analysis?.review_only === true
    || plan.analysis?.approval_allowed === false
    || plan.analysis?.auto_run_allowed === false
    || plan.actions.some((action: Record<string, any>) => (
      action?.params?.review_only === true
      || action?.params?.approval_allowed === false
      || action?.params?.auto_run_allowed === false
    ))
  ) {
    return true;
  }
  if (
    (!ticket.classification || ticket.classification === 'customer_support')
    && (
      plan.planner_version !== 'autopilot-v5'
      || (
        !plan.generation
        && !String(plan.prompt_version ?? '').startsWith('response-state-')
        && !String(plan.prompt_version ?? '').startsWith('deterministic-')
      )
    )
  ) {
    return true;
  }
  if (validatorFallbackNeedsRetry(plan)) {
    return true;
  }
  if (
    plan.status === 'proposed'
    && plan.prompt_version === 'response-state-park-v1'
  ) {
    return true;
  }
  return autopilotPlanRefreshReasons({
    plan,
    ticketContextVersion: ticket.context_version ?? 0,
    hasCustomerEmail: Boolean(ticket.customer_email),
    refreshBeforeMs: Date.now(),
  }).length > 0;
}

async function loadCandidates(): Promise<RepairTicket[]> {
  const all: RepairTicket[] = [];
  const pageSize = 500;
  for (let from = 0; ; from += pageSize) {
    let query = supabase
      .from('tickets')
      .select('id, ticket_number, brand_id, status, customer_email, context_version, classification, metadata')
      .in('brand_id', enabledBrandIds)
      .in('status', ['open', 'pending'])
      .order('created_at', { ascending: true })
      .range(from, from + pageSize - 1);
    if (requestedTickets.size > 0) query = query.in('ticket_number', [...requestedTickets]);
    const { data, error } = await query;
    if (error) throw new Error(`tickets: ${error.message}`);
    all.push(...((data ?? []) as RepairTicket[]));
    if ((data ?? []).length < pageSize) break;
  }
  const candidates = all
    .filter((ticket) => (
      forceRequestedTicket
      || (
        forceAll
        && (!ticket.classification || ticket.classification === 'customer_support')
        && ticket.metadata?.autopilot?.status === 'proposed'
      )
      || needsRepair(ticket)
    ))
    .map((ticket) => ({
      ...ticket,
      force_plan_refresh: Boolean((ticket.metadata?.autopilot as Record<string, any> | undefined)?.id),
    }));
  const staticallyHealthy = all.filter((ticket) => !needsRepair(ticket));
  await runPool(staticallyHealthy, async (ticket) => {
    const plan = ticket.metadata?.autopilot as Record<string, any> | undefined;
    const evidence = plan?.evidence?.customer_history;
    if (!evidence || plan?.status !== 'proposed' || !ticket.customer_email) return;
    const { data, error } = await supabase.rpc('get_customer_support_context', {
      p_ticket_id: ticket.id,
      p_brand_id: ticket.brand_id,
    });
    if (error || !data || typeof data !== 'object') {
      throw new Error(
        `customer history for ticket #${ticket.ticket_number}: ${error?.message ?? 'empty projection'}`,
      );
    }
    const current = data as Record<string, any>;
    if (!customerHistoryEvidenceMatches(evidence, {
      projection_version: current.projection_version,
      hash: current.context_hash,
      ticket_count: current.ticket_count,
      ticket_message_count: current.ticket_message_count,
      conversation_count: current.conversation_count,
      chat_message_count: current.chat_message_count,
    })) {
      candidates.push({ ...ticket, force_customer_history_refresh: true });
    }
  });
  const deduplicated = new Map<string, RepairTicket>();
  for (const candidate of candidates) {
    const existing = deduplicated.get(candidate.id);
    deduplicated.set(candidate.id, {
      ...(existing ?? candidate),
      ...candidate,
      force_plan_refresh: Boolean(existing?.force_plan_refresh || candidate.force_plan_refresh),
      force_customer_history_refresh: Boolean(
        existing?.force_customer_history_refresh || candidate.force_customer_history_refresh,
      ),
    });
  }
  return [...deduplicated.values()]
    .sort((left, right) => left.ticket_number - right.ticket_number)
    .slice(0, maxTickets);
}

async function runPool<T>(
  values: T[],
  worker: (value: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor++;
      await worker(values[index]);
    }
  }));
}

let totalPersisted = 0;
for (let pass = 1; pass <= maxPasses; pass += 1) {
  const candidates = await loadCandidates();
  console.log(JSON.stringify({
    event: 'repair_pass_started',
    pass,
    candidates: candidates.length,
    concurrency,
  }));
  if (candidates.length === 0) break;

  let completed = 0;
  let persisted = 0;
  const failed: number[] = [];
  await runPool(candidates, async (ticket) => {
    const plan = ticket.force_customer_history_refresh || ticket.force_plan_refresh
      ? (await refreshTicketPlan(ticket.id, {
          brandId: ticket.brand_id,
          recoverTerminal: ticket.force_plan_refresh === true,
          reason: ticket.force_customer_history_refresh
            ? 'repair_customer_history_changed'
            : 'repair_nonblocking_plan',
        })).plan
      : await proposeForTicket(ticket.id, 'sweep');
    completed += 1;
    if (plan) {
      persisted += 1;
      totalPersisted += 1;
    } else {
      failed.push(ticket.ticket_number);
    }
    if (completed % 10 === 0 || completed === candidates.length) {
      console.log(JSON.stringify({
        event: 'repair_progress',
        pass,
        completed,
        candidates: candidates.length,
        persisted,
        failed: failed.length,
      }));
    }
  });
  console.log(JSON.stringify({
    event: 'repair_pass_finished',
    pass,
    candidates: candidates.length,
    persisted,
    failed_ticket_numbers: failed,
  }));
}

const remaining = forceRequestedTicket ? [] : await loadCandidates();
console.log(JSON.stringify({
  event: 'repair_finished',
  persisted: totalPersisted,
  remaining: remaining.length,
  remaining_ticket_numbers: remaining.map((ticket) => ticket.ticket_number),
}));
if (remaining.length > 0) process.exitCode = 2;
