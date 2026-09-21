import type { AutopilotAction, AutopilotPlan } from './types';

export interface LiveShippingAddress {
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  province?: string | null;
  provinceCode?: string | null;
  zip?: string | null;
  country?: string | null;
  countryCodeV2?: string | null;
  phone?: string | null;
}

export interface ExecutableShippingAddress {
  name?: string;
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
  address1: string;
  address2: string | null;
  city: string;
  province: string;
  provinceCode?: string | null;
  zip: string;
  country: string;
  countryCode?: string | null;
  phone?: string | null;
}

export interface OrderCustomerIdentity {
  ticketEmail?: string | null;
  ticketPhone?: string | null;
  ticketName?: string | null;
  orderEmail?: string | null;
  orderPhone?: string | null;
  shippingPhone?: string | null;
  shippingName?: string | null;
  shippingFirstName?: string | null;
  shippingLastName?: string | null;
}

export type OrderCustomerIdentityMatch =
  | 'email'
  | 'phone'
  | 'last_name';

const TRUSTED_PLANNED_IDENTITY_EVIDENCE = new Set([
  'customer_email',
  'customer_phone',
  'customer_name',
  'customer_last_name',
]);

/**
 * Accept the deterministic order/customer binding captured by the planner.
 *
 * The caller must first verify the plan fingerprint and the exact live Shopify
 * order evidence hash. This function deliberately contains no PII: it proves
 * only that the deterministic planner bound this exact order through an
 * accepted identity channel before the human approved the frozen plan.
 */
export function plannedOrderIdentityBindingMatches(
  params: Record<string, unknown>,
  liveOrderId: string,
): boolean {
  const value = params.order_identity_binding;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const binding = value as Record<string, unknown>;
  if (binding.version !== 'deterministic-order-identity-v1') return false;
  if (binding.order_id !== liveOrderId) return false;
  const confidence = Number(binding.confidence);
  if (!Number.isFinite(confidence) || confidence < 0.9 || confidence > 1) return false;
  if (!Array.isArray(binding.evidence) || binding.evidence.length < 1) return false;
  return binding.evidence.every((item) => (
    typeof item === 'string' && TRUSTED_PLANNED_IDENTITY_EVIDENCE.has(item)
  ));
}

export type ShippingAddressMergeResult =
  | { ok: true; address: ExecutableShippingAddress }
  | { ok: false; error: string };

function cleanField(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizedEmail(value: unknown): string {
  return cleanField(value).toLowerCase();
}

function normalizedPhone(value: unknown): string {
  return cleanField(value).replace(/\D/g, '');
}

function normalizedNamePart(value: unknown): string {
  return cleanField(value)
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function lastName(value: unknown): string {
  const parts = cleanField(value).split(/\s+/).filter(Boolean);
  return normalizedNamePart(parts.at(-1));
}

/**
 * Bind a live Shopify order back to the support customer using independent
 * provider evidence. Checkout email is preferred, but customers commonly
 * write from another address; an exact phone or last-name match is sufficient
 * when the plan already targets an exact live order ID.
 */
export function matchOrderCustomerIdentity(
  input: OrderCustomerIdentity,
): OrderCustomerIdentityMatch | null {
  const ticketEmail = normalizedEmail(input.ticketEmail);
  const orderEmail = normalizedEmail(input.orderEmail);
  if (ticketEmail && orderEmail && ticketEmail === orderEmail) return 'email';

  const ticketPhone = normalizedPhone(input.ticketPhone);
  const orderPhones = [
    normalizedPhone(input.orderPhone),
    normalizedPhone(input.shippingPhone),
  ].filter((value) => value.length >= 7);
  if (ticketPhone.length >= 7 && orderPhones.some((value) => (
    value === ticketPhone
    || value.endsWith(ticketPhone)
    || ticketPhone.endsWith(value)
  ))) return 'phone';

  const ticketLastName = lastName(input.ticketName);
  const shippingLastName = normalizedNamePart(input.shippingLastName)
    || lastName(input.shippingName)
    || lastName([input.shippingFirstName, input.shippingLastName].filter(Boolean).join(' '));
  if (ticketLastName.length >= 3 && shippingLastName === ticketLastName) return 'last_name';
  return null;
}

/**
 * Complete a customer-authorized location change from the current live order.
 *
 * The planner controls only the new location. Recipient identity, company, and
 * phone are copied from Shopify's immediate preflight so a draft cannot invent
 * or silently replace them. Country is also preserved unless the customer
 * explicitly supplied a new one. An omitted address2 becomes null on purpose,
 * clearing any apartment/unit that belonged to the old destination.
 */
export function mergeShippingAddressForExecution(
  plannedValue: unknown,
  current: LiveShippingAddress | null,
): ShippingAddressMergeResult {
  if (!current) {
    return { ok: false, error: 'The order has no live shipping address to preserve.' };
  }
  if (!plannedValue || typeof plannedValue !== 'object' || Array.isArray(plannedValue)) {
    return { ok: false, error: 'The proposed shipping address is invalid.' };
  }
  const planned = plannedValue as Record<string, unknown>;
  const address1 = cleanField(planned.address1);
  const city = cleanField(planned.city);
  const province = cleanField(planned.province);
  const zip = cleanField(planned.zip);
  for (const [field, value] of Object.entries({ address1, city, province, zip })) {
    if (!value) return { ok: false, error: `The proposed shipping address is missing ${field}.` };
  }

  const plannedCountry = cleanField(planned.country);
  const currentCountry = cleanField(current.country);
  const country = plannedCountry || currentCountry;
  if (!country) {
    return { ok: false, error: 'The live order has no country to preserve.' };
  }
  const address2 = cleanField(planned.address2) || null;

  return {
    ok: true,
    address: {
      name: cleanField(current.name) || undefined,
      firstName: cleanField(current.firstName) || null,
      lastName: cleanField(current.lastName) || null,
      company: cleanField(current.company) || null,
      address1,
      address2,
      city,
      province,
      provinceCode: null,
      zip,
      country,
      countryCode: plannedCountry ? null : cleanField(current.countryCodeV2) || null,
      phone: cleanField(current.phone) || null,
    },
  };
}

function comparable(value: unknown): string {
  return cleanField(value)
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

/**
 * Verify Shopify's mutation payload before any dependent reply may run.
 * Province/country display names may differ from their codes, so either exact
 * display text or the corresponding code can satisfy those fields.
 */
export function shippingAddressMatchesExpected(
  actual: LiveShippingAddress | null | undefined,
  expected: ExecutableShippingAddress,
): boolean {
  if (!actual) return false;
  const exactFields: Array<
    'firstName' | 'lastName' | 'company' | 'address1' | 'address2' | 'city' | 'zip' | 'phone'
  > = [
    'firstName',
    'lastName',
    'company',
    'address1',
    'address2',
    'city',
    'zip',
    'phone',
  ];
  if (exactFields.some((field) => comparable(actual[field]) !== comparable(expected[field]))) {
    return false;
  }
  const province = comparable(expected.province);
  if (province !== comparable(actual.province) && province !== comparable(actual.provinceCode)) {
    return false;
  }
  if (expected.countryCode) {
    return comparable(expected.countryCode) === comparable(actual.countryCodeV2);
  }
  return comparable(expected.country) === comparable(actual.country);
}

const HIGH_IMPACT_ACTION_TYPES = new Set<AutopilotAction['type']>([
  'cancel_order',
  'refund_order',
  'update_shipping_address',
]);

export function isHighImpactAutopilotAction(
  action: Pick<AutopilotAction, 'type'>,
): boolean {
  return HIGH_IMPACT_ACTION_TYPES.has(action.type);
}

export function requiresImmediateActionEvidenceRevalidation(
  action: Pick<AutopilotAction, 'type'>,
): boolean {
  return action.type === 'send_reply' || isHighImpactAutopilotAction(action);
}

export function requiresCustomerHistoryEvidence(
  plan: Pick<AutopilotPlan, 'actions'>,
  hasCustomerEmail: boolean,
): boolean {
  return plan.actions.some(isHighImpactAutopilotAction)
    || plan.actions.some((action) => action.type === 'consolidate_related_tickets')
    || (hasCustomerEmail && plan.actions.some((action) => action.type === 'send_reply'));
}

/**
 * A validator fallback exists only to keep the ticket in the review queue.
 * Check both the plan-level marker and the deterministic action marker so a
 * malformed projection cannot accidentally regain execution eligibility.
 */
export function autopilotPlanRequiresRevision(
  plan: Pick<AutopilotPlan, 'analysis' | 'actions'>,
): boolean {
  return plan.analysis.review_only === true
    || plan.analysis.auto_run_allowed === false
    || plan.actions.some((action) => (
      action.params?.review_only === true
      || action.params?.auto_run_allowed === false
      || action.params?.approval_allowed === false
    ));
}

export type ExistingAutopilotDecisionDisposition =
  | 'proceed'
  | 'resume_exact'
  | 'replay_exact'
  | 'replay_compatible'
  | 'in_progress_other_attempt'
  | 'batch_decided_elsewhere'
  | 'reject';

/**
 * Resolve a request against an already-materialized plan projection.
 *
 * Batch approval is deliberately stricter than an individual stale-card
 * replay: only the exact execution attempt represented by its idempotency key
 * may resume or count as a successful replay. A different worker's decision
 * must never be reported as if this exact frozen batch candidate ran.
 */
export function classifyExistingAutopilotDecision(input: {
  planStatus: AutopilotPlan['status'];
  planId?: string;
  executionAttemptId?: string;
  requestedPlanId: string | null;
  requestIdempotencyKey: string;
  decision: 'approve' | 'dismiss';
  decisionMode: 'individual_review' | 'batch_threshold';
}): ExistingAutopilotDecisionDisposition {
  if (input.planStatus === 'proposed') return 'proceed';

  const samePlan = Boolean(input.planId && input.requestedPlanId === input.planId);
  if (!samePlan) return 'reject';

  if (input.decision === 'approve' && input.planStatus === 'executing') {
    return input.executionAttemptId === input.requestIdempotencyKey
      ? 'resume_exact'
      : 'in_progress_other_attempt';
  }

  if (input.decision === 'approve'
      && ['executed', 'partially_executed', 'failed'].includes(input.planStatus)) {
    if (input.decisionMode === 'batch_threshold') {
      return input.executionAttemptId === input.requestIdempotencyKey
        ? 'replay_exact'
        : 'batch_decided_elsewhere';
    }
    return 'replay_compatible';
  }

  if (input.decision === 'dismiss' && input.planStatus === 'dismissed') {
    return 'replay_compatible';
  }

  return 'reject';
}

/**
 * The preview fingerprint protects the proposed-to-executing claim. Once that
 * exact idempotency key owns the run, the projection necessarily changes
 * status/action fields; durable receipts and verdict matching become the
 * authoritative replay fence.
 */
export function requiresFreshPlanFingerprintCheck(resumingExactAttempt: boolean): boolean {
  return !resumingExactAttempt;
}

/**
 * Cards that cannot be acted on but can be repaired automatically should not
 * be presented as human review work. The backend sweep replaces them from the
 * latest context and only terminal receipts are eligible for run recovery.
 */
export function pendingPlanNeedsAutomaticRepair(input: {
  planStatus?: string;
  planContextVersion?: number;
  ticketContextVersion?: number;
  decidedAt?: string;
  receipts?: Array<{ status?: string }>;
  nowMs?: number;
  executionGraceMs?: number;
}): boolean {
  if (input.planStatus === 'proposed') {
    return Number(input.planContextVersion ?? -1) !== Number(input.ticketContextVersion ?? -2);
  }
  if (input.planStatus !== 'executing') return false;
  const decidedAt = Date.parse(input.decidedAt ?? '');
  const nowMs = input.nowMs ?? Date.now();
  if (!Number.isFinite(decidedAt)
      || decidedAt + (input.executionGraceMs ?? 5 * 60_000) > nowMs) return false;
  return (input.receipts ?? []).every((receipt) => (
    receipt.status === 'executed' || receipt.status === 'failed'
  ));
}
