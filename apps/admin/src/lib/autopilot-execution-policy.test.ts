import assert from 'node:assert/strict';
import test from 'node:test';
import {
  autopilotPlanRequiresRevision,
  classifyExistingAutopilotDecision,
  isHighImpactAutopilotAction,
  matchOrderCustomerIdentity,
  mergeShippingAddressForExecution,
  plannedOrderIdentityBindingMatches,
  pendingPlanNeedsAutomaticRepair,
  requiresImmediateActionEvidenceRevalidation,
  requiresFreshPlanFingerprintCheck,
  requiresCustomerHistoryEvidence,
  shippingAddressMatchesExpected,
} from './autopilot-execution-policy';
import type { AutopilotAction, AutopilotPlan } from './types';

function action(type: AutopilotAction['type']): AutopilotAction {
  return {
    id: `action-${type}`,
    type,
    title: type,
    detail: type,
    params: {},
    confidence: 1,
    status: 'approved',
  };
}

function plan(...types: AutopilotAction['type'][]): Pick<AutopilotPlan, 'actions'> {
  return { actions: types.map(action) };
}

test('all irreversible Shopify mutations use the immediate live-evidence fence', () => {
  for (const type of ['cancel_order', 'refund_order', 'update_shipping_address'] as const) {
    assert.equal(isHighImpactAutopilotAction(action(type)), true, type);
    assert.equal(requiresImmediateActionEvidenceRevalidation(action(type)), true, type);
    assert.equal(requiresCustomerHistoryEvidence(plan(type), false), true, type);
  }
});

test('send_reply also revalidates evidence immediately before execution', () => {
  assert.equal(requiresImmediateActionEvidenceRevalidation(action('send_reply')), true);
});

test('an exact order can bind to a customer through email, phone, or last name', () => {
  assert.equal(matchOrderCustomerIdentity({
    ticketEmail: 'support-address@example.com',
    orderEmail: 'support-address@example.com',
  }), 'email');
  assert.equal(matchOrderCustomerIdentity({
    ticketPhone: '(704) 620-2529',
    orderPhone: '+1 704 620 2529',
  }), 'phone');
  assert.equal(matchOrderCustomerIdentity({
    ticketName: 'Joshua Lipack',
    shippingName: 'Josh Lipack',
  }), 'last_name');
  assert.equal(matchOrderCustomerIdentity({
    ticketName: 'Joshua Lipack',
    shippingName: 'Josh Smith',
    ticketEmail: 'one@example.com',
    orderEmail: 'two@example.com',
  }), null);
});

test('a frozen deterministic identity binding survives a weaker ticket header', () => {
  assert.equal(plannedOrderIdentityBindingMatches({
    order_identity_binding: {
      version: 'deterministic-order-identity-v1',
      order_id: 'gid://shopify/Order/1149',
      evidence: ['customer_last_name'],
      confidence: 0.95,
    },
  }, 'gid://shopify/Order/1149'), true);
  assert.equal(plannedOrderIdentityBindingMatches({
    order_identity_binding: {
      version: 'deterministic-order-identity-v1',
      order_id: 'gid://shopify/Order/other',
      evidence: ['customer_last_name'],
      confidence: 0.95,
    },
  }, 'gid://shopify/Order/1149'), false);
  assert.equal(plannedOrderIdentityBindingMatches({
    order_identity_binding: {
      version: 'deterministic-order-identity-v1',
      order_id: 'gid://shopify/Order/1149',
      evidence: ['model_guess'],
      confidence: 0.99,
    },
  }, 'gid://shopify/Order/1149'), false);
});

test('ordinary local actions do not become high-impact mutations', () => {
  for (const type of ['resolve', 'set_priority', 'add_tags', 'escalate_human'] as const) {
    assert.equal(isHighImpactAutopilotAction(action(type)), false, type);
    assert.equal(requiresImmediateActionEvidenceRevalidation(action(type)), false, type);
  }
});

test('reply history evidence still depends on customer identity', () => {
  assert.equal(requiresCustomerHistoryEvidence(plan('send_reply'), true), true);
  assert.equal(requiresCustomerHistoryEvidence(plan('send_reply'), false), false);
  assert.equal(requiresCustomerHistoryEvidence(plan('consolidate_related_tickets'), false), true);
});

test('validator fallback plans require revision even if one marker is lost', () => {
  const reviewAction = action('escalate_human');
  reviewAction.params = {
    review_only: true,
    auto_run_allowed: false,
    approval_allowed: false,
  };
  const analysis = {
    summary: 'Manual revision required.',
    reasoning: 'Validator rejected the generated plan.',
    overall_confidence: 0,
  };

  assert.equal(autopilotPlanRequiresRevision({
    analysis: { ...analysis, review_only: true, auto_run_allowed: false },
    actions: [action('escalate_human')],
  }), true);
  assert.equal(autopilotPlanRequiresRevision({
    analysis,
    actions: [reviewAction],
  }), true);
  assert.equal(autopilotPlanRequiresRevision({
    analysis,
    actions: [action('send_reply')],
  }), false);
});

test('only the exact batch attempt can resume or replay an executing plan', () => {
  const base = {
    planId: 'plan-1',
    executionAttemptId: 'attempt-1',
    requestedPlanId: 'plan-1',
    decision: 'approve' as const,
    decisionMode: 'batch_threshold' as const,
  };

  assert.equal(classifyExistingAutopilotDecision({
    ...base,
    planStatus: 'executing',
    requestIdempotencyKey: 'attempt-1',
  }), 'resume_exact');
  assert.equal(classifyExistingAutopilotDecision({
    ...base,
    planStatus: 'executing',
    requestIdempotencyKey: 'attempt-2',
  }), 'in_progress_other_attempt');
  assert.equal(classifyExistingAutopilotDecision({
    ...base,
    planStatus: 'executed',
    requestIdempotencyKey: 'attempt-1',
  }), 'replay_exact');
  assert.equal(classifyExistingAutopilotDecision({
    ...base,
    planStatus: 'executed',
    requestIdempotencyKey: 'attempt-2',
  }), 'batch_decided_elsewhere');
});

test('an exact in-flight retry uses durable attempt fences instead of the proposed fingerprint', () => {
  assert.equal(requiresFreshPlanFingerprintCheck(false), true);
  assert.equal(requiresFreshPlanFingerprintCheck(true), false);
});

test('stale proposals and terminal interrupted runs are hidden for automatic repair', () => {
  assert.equal(pendingPlanNeedsAutomaticRepair({
    planStatus: 'proposed',
    planContextVersion: 4,
    ticketContextVersion: 5,
  }), true);
  assert.equal(pendingPlanNeedsAutomaticRepair({
    planStatus: 'executing',
    decidedAt: '2026-07-18T03:00:00.000Z',
    receipts: [{ status: 'executed' }, { status: 'failed' }],
    nowMs: Date.parse('2026-07-18T04:00:00.000Z'),
  }), true);
  assert.equal(pendingPlanNeedsAutomaticRepair({
    planStatus: 'executing',
    decidedAt: '2026-07-18T03:00:00.000Z',
    receipts: [{ status: 'uncertain' }],
    nowMs: Date.parse('2026-07-18T04:00:00.000Z'),
  }), false);
});

const liveAddress = {
  name: 'Gavin Lafferty',
  firstName: 'Gavin',
  lastName: 'Lafferty',
  company: 'Warm Home LLC',
  address1: '10356 Adriana Ave',
  address2: 'Unit 9',
  city: 'Riverside',
  province: 'California',
  provinceCode: 'CA',
  zip: '92505',
  country: 'United States',
  countryCodeV2: 'US',
  phone: '+1 555 0100',
};

test('address execution preserves live identity and country while replacing the location', () => {
  const result = mergeShippingAddressForExecution({
    address1: '1750 Glendale Blvd',
    address2: 'Apt 418',
    city: 'Los Angeles',
    province: 'CA',
    zip: '90026',
  }, liveAddress);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.address, {
    name: 'Gavin Lafferty',
    firstName: 'Gavin',
    lastName: 'Lafferty',
    company: 'Warm Home LLC',
    address1: '1750 Glendale Blvd',
    address2: 'Apt 418',
    city: 'Los Angeles',
    province: 'CA',
    provinceCode: null,
    zip: '90026',
    country: 'United States',
    countryCode: 'US',
    phone: '+1 555 0100',
  });
});

test('address execution deliberately clears an old unit when the new address omits it', () => {
  const result = mergeShippingAddressForExecution({
    address1: '1750 Glendale Blvd',
    city: 'Los Angeles',
    province: 'CA',
    zip: '90026',
  }, liveAddress);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.address.address2, null);
});

test('address execution fails closed without a live address or preserved country', () => {
  assert.deepEqual(
    mergeShippingAddressForExecution({
      address1: '1750 Glendale Blvd',
      city: 'Los Angeles',
      province: 'CA',
      zip: '90026',
    }, null),
    { ok: false, error: 'The order has no live shipping address to preserve.' },
  );
  assert.deepEqual(
    mergeShippingAddressForExecution({
      address1: '1750 Glendale Blvd',
      city: 'Los Angeles',
      province: 'CA',
      zip: '90026',
    }, { ...liveAddress, country: '', countryCodeV2: null }),
    { ok: false, error: 'The live order has no country to preserve.' },
  );
});

test('an explicitly planned country replaces the old country instead of retaining its code', () => {
  const result = mergeShippingAddressForExecution({
    address1: '10 King Street',
    city: 'Toronto',
    province: 'ON',
    zip: 'M5H 1A1',
    country: 'Canada',
  }, liveAddress);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.address.country, 'Canada');
  assert.equal(result.address.countryCode, null);
});

test('address postcondition accepts Shopify display names/codes and rejects a partial mismatch', () => {
  const result = mergeShippingAddressForExecution({
    address1: '1750 Glendale Blvd',
    address2: 'Apt 418',
    city: 'Los Angeles',
    province: 'CA',
    zip: '90026',
  }, liveAddress);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  const actual = {
    ...liveAddress,
    address1: '1750 Glendale Blvd',
    address2: 'Apt 418',
    city: 'Los Angeles',
    province: 'California',
    provinceCode: 'CA',
    zip: '90026',
  };
  assert.equal(shippingAddressMatchesExpected(actual, result.address), true);
  assert.equal(shippingAddressMatchesExpected(
    { ...actual, address2: 'Unit 9' },
    result.address,
  ), false);
});
