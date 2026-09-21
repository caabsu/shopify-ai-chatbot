import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function allRows(table, select, configure = (query) => query) {
  const rows = [];
  const pageSize = 500;
  for (let from = 0; ; from += pageSize) {
    const query = configure(
      supabase.from(table).select(select).range(from, from + pageSize - 1),
    );
    const { data, error } = await query;
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data ?? []));
    if ((data ?? []).length < pageSize) return rows;
  }
}

function validUuid(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function customerHistoryMatches(evidence, current) {
  return Boolean(
    evidence
    && current
    && current.projection_version === evidence.projection_version
    && current.context_hash === evidence.hash
    && Number(current.ticket_count ?? -1) === Number(evidence.ticket_count ?? -2)
    && Number(current.ticket_message_count ?? -1) === Number(evidence.ticket_message_count ?? -2)
    && Number(current.conversation_count ?? -1) === Number(evidence.conversation_count ?? -2)
    && Number(current.chat_message_count ?? -1) === Number(evidence.chat_message_count ?? -2)
  );
}

async function runPool(values, concurrency, worker) {
  let cursor = 0;
  await Promise.all(Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      while (cursor < values.length) {
        const index = cursor++;
        await worker(values[index]);
      }
    },
  ));
}

function assess(ticket, ledgers, now) {
  const plan = ticket.metadata?.autopilot;
  const reasons = [];
  if (!plan || typeof plan !== 'object') {
    reasons.push('missing_projection');
    return { reasons, plan: null };
  }

  if (plan.version !== 2
      || !validUuid(plan.id)
      || !Number.isInteger(plan.revision)
      || typeof plan.context_fingerprint !== 'string'
      || !plan.context_fingerprint
      || !Number.isInteger(plan.context_version)
      || !Array.isArray(plan.actions)
      || plan.actions.length === 0) {
    reasons.push('malformed_projection');
  }
  // An execution intentionally advances ticket context when it stores the
  // sent reply, priority, tags, or resolution. Context equality is an active
  // plan fence, not a validity requirement for an immutable decided receipt.
  if (['proposed', 'approved', 'executing'].includes(plan.status)
      && Number(plan.context_version) !== Number(ticket.context_version)) {
    reasons.push('stale_context');
  }
  if (!['proposed', 'approved', 'executing', 'executed', 'partially_executed', 'failed', 'dismissed'].includes(plan.status)) {
    reasons.push('invalid_projection_status');
  }

  const actionTypes = Array.isArray(plan.actions)
    ? plan.actions.map((action) => action?.type).filter(Boolean)
    : [];
  const needsLiveEvidence = Boolean(ticket.customer_email)
    && actionTypes.some((type) => [
      'send_reply',
      'cancel_order',
      'refund_order',
      'update_shipping_address',
      'consolidate_related_tickets',
    ].includes(type));
  if (needsLiveEvidence) {
    const shopify = plan.evidence?.shopify_orders;
    const customerHistory = plan.evidence?.customer_history;
    if (!shopify) reasons.push('missing_shopify_evidence');
    if (!customerHistory) reasons.push('missing_customer_history_evidence');
  }

  const matchingLedger = ledgers.find((ledger) => ledger.id === plan.id);
  if (!matchingLedger) {
    reasons.push('missing_ledger');
  } else {
    if (Number(matchingLedger.revision) !== Number(plan.revision)) reasons.push('revision_mismatch');
    if (Number(matchingLedger.context_version) !== Number(plan.context_version)) reasons.push('ledger_context_mismatch');
  }
  const liveLedgers = ledgers.filter((ledger) => ['proposed', 'approved', 'executing'].includes(ledger.status));
  if (liveLedgers.length > 1) reasons.push('duplicate_live_ledgers');

  return { reasons, plan };
}

const [brands, tickets, plans] = await Promise.all([
  allRows('brands', 'id, slug, name, enabled, shopify_shop, settings'),
  allRows(
    'tickets',
    'id, brand_id, ticket_number, status, classification, customer_email, context_version, metadata, created_at, updated_at',
    (query) => query
      .in('status', ['open', 'pending'])
      .order('created_at', { ascending: true })
      .order('id', { ascending: true }),
  ),
  allRows(
    'ticket_action_plans',
    'id, ticket_id, brand_id, revision, status, context_version, proposed_at, updated_at',
    (query) => query
      .order('ticket_id', { ascending: true })
      .order('revision', { ascending: false })
      .order('id', { ascending: true }),
  ),
]);

const brandById = new Map(brands.map((brand) => [brand.id, brand.slug || brand.name || brand.id]));
const plansByTicket = new Map();
for (const plan of plans) {
  const bucket = plansByTicket.get(plan.ticket_id) ?? [];
  bucket.push(plan);
  plansByTicket.set(plan.ticket_id, bucket);
}

const now = Date.now();
const liveCustomerHistoryReasons = new Map();
const customerHistoryTickets = tickets.filter((ticket) => {
  const plan = ticket.metadata?.autopilot;
  return plan?.status === 'proposed'
    && Boolean(ticket.customer_email)
    && Boolean(plan?.evidence?.customer_history);
});
await runPool(customerHistoryTickets, 8, async (ticket) => {
  const plan = ticket.metadata.autopilot;
  const { data, error } = await supabase.rpc('get_customer_support_context', {
    p_ticket_id: ticket.id,
    p_brand_id: ticket.brand_id,
  });
  if (error || !data || typeof data !== 'object') {
    liveCustomerHistoryReasons.set(ticket.id, 'customer_history_unavailable');
    return;
  }
  if (!customerHistoryMatches(plan.evidence.customer_history, data)) {
    liveCustomerHistoryReasons.set(ticket.id, 'stale_customer_history');
  }
});

const reasonCounts = new Map();
const brandCounts = new Map();
const ticketStatusCounts = new Map();
const projectionStatusCounts = new Map();
const actionTypeCounts = new Map();
const generationModelCounts = new Map();
const reviewOnlyReasonCounts = new Map();
const reviewOnlyByBrand = new Map();
const unhealthy = [];
let healthy = 0;
let reviewOnly = 0;
let runReady = 0;
for (const ticket of tickets) {
  ticketStatusCounts.set(ticket.status, (ticketStatusCounts.get(ticket.status) ?? 0) + 1);
  const brand = brandById.get(ticket.brand_id) ?? ticket.brand_id;
  const brandEntry = brandCounts.get(brand) ?? { total: 0, healthy: 0, unhealthy: 0 };
  brandEntry.total += 1;
  const assessment = assess(ticket, plansByTicket.get(ticket.id) ?? [], now);
  const liveCustomerHistoryReason = liveCustomerHistoryReasons.get(ticket.id);
  if (liveCustomerHistoryReason) assessment.reasons.push(liveCustomerHistoryReason);
  const projectionStatus = assessment.plan?.status ?? 'missing';
  let requiresRevision = false;
  projectionStatusCounts.set(
    projectionStatus,
    (projectionStatusCounts.get(projectionStatus) ?? 0) + 1,
  );
  if (assessment.plan) {
    const actions = Array.isArray(assessment.plan.actions) ? assessment.plan.actions : [];
    for (const action of actions) {
      const type = typeof action?.type === 'string' ? action.type : 'invalid';
      actionTypeCounts.set(type, (actionTypeCounts.get(type) ?? 0) + 1);
    }
    const model = assessment.plan.generation?.model ?? 'deterministic/no-model';
    generationModelCounts.set(model, (generationModelCounts.get(model) ?? 0) + 1);
    requiresRevision = assessment.plan.analysis?.review_only === true
      || assessment.plan.analysis?.approval_allowed === false
      || assessment.plan.analysis?.auto_run_allowed === false
      || actions.some((action) => (
        action?.params?.review_only === true
        || action?.params?.approval_allowed === false
        || action?.params?.auto_run_allowed === false
      ));
    if (requiresRevision) {
      reviewOnly += 1;
      reviewOnlyByBrand.set(brand, (reviewOnlyByBrand.get(brand) ?? 0) + 1);
      const reason = actions.find((action) => action?.params?.reason_code)?.params?.reason_code
        ?? 'unspecified';
      reviewOnlyReasonCounts.set(reason, (reviewOnlyReasonCounts.get(reason) ?? 0) + 1);
    }
  }
  if (assessment.reasons.length === 0) {
    healthy += 1;
    brandEntry.healthy += 1;
    if (assessment.plan?.status === 'proposed' && !requiresRevision) {
      runReady += 1;
    }
  } else {
    brandEntry.unhealthy += 1;
    for (const reason of new Set(assessment.reasons)) {
      reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
    }
    unhealthy.push({
      ticket_number: ticket.ticket_number,
      brand,
      status: ticket.status,
      context_version: ticket.context_version,
      plan_id: assessment.plan?.id ?? null,
      revision: assessment.plan?.revision ?? null,
      plan_status: assessment.plan?.status ?? null,
      proposed_at: assessment.plan?.proposed_at ?? null,
      attempts: Number(ticket.metadata?.autopilot_attempts ?? 0),
      reasons: assessment.reasons,
    });
  }
  brandCounts.set(brand, brandEntry);
}

console.log(JSON.stringify({
  audited_at: new Date(now).toISOString(),
  open_or_pending: tickets.length,
  healthy,
  unhealthy: unhealthy.length,
  by_brand: Object.fromEntries([...brandCounts.entries()].sort(([a], [b]) => a.localeCompare(b))),
  ticket_statuses: Object.fromEntries([...ticketStatusCounts.entries()].sort(([a], [b]) => a.localeCompare(b))),
  projection_statuses: Object.fromEntries([...projectionStatusCounts.entries()].sort(([a], [b]) => a.localeCompare(b))),
  run_ready: runReady,
  review_only: reviewOnly,
  review_only_by_brand: Object.fromEntries([...reviewOnlyByBrand.entries()].sort(([a], [b]) => a.localeCompare(b))),
  review_only_reasons: Object.fromEntries([...reviewOnlyReasonCounts.entries()].sort(([a], [b]) => a.localeCompare(b))),
  action_types: Object.fromEntries([...actionTypeCounts.entries()].sort(([a], [b]) => a.localeCompare(b))),
  generation_models: Object.fromEntries([...generationModelCounts.entries()].sort(([a], [b]) => a.localeCompare(b))),
  brand_runtime_readiness: Object.fromEntries(brands.map((brand) => {
    const settings = brand.settings ?? {};
    return [brand.slug, {
      enabled: brand.enabled === true,
      shop_configured: Boolean(
        brand.shopify_shop
        && (
          (settings.shopify_client_id && settings.shopify_client_secret)
          || (process.env.SHOPIFY_CLIENT_ID && process.env.SHOPIFY_CLIENT_SECRET)
        )
      ),
      email_configured: Boolean(
        (settings.email_provider && (settings.email_api_key || settings.gmail_refresh_token))
        || process.env.RESEND_API_KEY
        || process.env.GMAIL_REFRESH_TOKEN
      ),
    }];
  })),
  reason_counts: Object.fromEntries([...reasonCounts.entries()].sort(([a], [b]) => a.localeCompare(b))),
  ...(process.argv.includes('--summary') ? {} : { unhealthy_tickets: unhealthy }),
}, null, 2));
