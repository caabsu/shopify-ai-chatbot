import assert from 'node:assert/strict';
import test from 'node:test';
import {
  batchResultStopsScheduling,
  DEFAULT_AUTOPILOT_BATCH_SETTINGS,
  MIN_AUTOPILOT_BATCH_MODEL_REVIEWS,
  batchModelCalibration,
  effectivePlanConfidence,
  limitingConfidenceIsCalibrated,
  selectAutopilotBatch,
  validateAutopilotBatchSettings,
  type AutopilotBatchSettings,
} from './autopilot-batch-policy';
import { autopilotPlanFingerprint } from './autopilot-plan-fingerprint';
import type { AutopilotAction, AutopilotActionType, AutopilotPlan, Ticket } from './types';

const NOW = new Date('2026-07-17T20:00:00.000Z');
const FUTURE = '2026-07-17T21:00:00.000Z';

function uuid(value: number): string {
  return `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
}

function action(
  type: AutopilotActionType = 'send_reply',
  confidence = 0.9,
  index = 1,
): AutopilotAction {
  return {
    id: uuid(1000 + index),
    type,
    title: type,
    detail: type,
    params: type === 'send_reply'
      ? { reply_text: 'A grounded reply.' }
      : type === 'consolidate_related_tickets'
        ? { related_ticket_ids: [] }
        : type === 'cancel_order' || type === 'refund_order' || type === 'update_shipping_address'
          ? { order_id: `gid://shopify/Order/${index}` }
          : {},
    model_confidence: confidence,
    confidence,
    status: 'proposed',
  };
}

function plan(input: {
  id?: number;
  confidence?: number;
  modelConfidence?: number;
  calibrated?: boolean;
  actions?: AutopilotAction[];
  status?: AutopilotPlan['status'];
  version?: 1 | 2;
  contextVersion?: number;
  proposedAt?: string;
  cohortSamples?: number;
  generationLineage?: boolean;
} = {}): AutopilotPlan {
  const actions = input.actions ?? [action('send_reply', input.confidence ?? 0.9)];
  if (input.calibrated && input.actions === undefined) {
    for (const candidate of actions) {
      candidate.confidence_basis = {
        method: 'bayesian_local_v1',
        sample_count: 3,
        effective_sample_weight: 2.4,
        delta: 0,
      };
    }
  }
  return {
    version: input.version ?? 2,
    id: uuid(input.id ?? 1),
    revision: 0,
    planner_version: 'autopilot-v2',
    prompt_version: 'test',
    ...(input.generationLineage === false
      ? {}
      : {
          generation: {
            provider: 'vercel-ai-gateway',
            model: 'deepseek/deepseek-v4.1-flash',
            tier: 'flash' as const,
            thinking: 'disabled',
            calibration_key: 'vercel-ai-gateway:deepseek/deepseek-v4.1-flash:test',
          },
        }),
    context_fingerprint: `context-${input.id ?? 1}`,
    context_version: input.contextVersion ?? 3,
    status: input.status ?? 'proposed',
    trigger: 'sweep',
    proposed_at: input.proposedAt ?? '2026-07-17T19:00:00.000Z',
    analysis: {
      summary: 'summary',
      reasoning: 'reasoning',
      model_confidence: input.modelConfidence ?? input.confidence ?? 0.9,
      overall_confidence: input.confidence ?? 0.9,
      confidence_basis: {
        method: 'bayesian_local_v1',
        sample_count: input.cohortSamples ?? MIN_AUTOPILOT_BATCH_MODEL_REVIEWS,
        effective_sample_weight: (input.cohortSamples ?? MIN_AUTOPILOT_BATCH_MODEL_REVIEWS) * 0.8,
        delta: 0,
      },
    },
    evidence: {
      shopify_orders: {
        hash: 'shopify',
        fetched_at: NOW.toISOString(),
        valid_until: FUTURE,
        order_count: 1,
        projection_version: 'shopify-support-prompt-v2',
        customer_present: true,
      },
      customer_history: {
        hash: 'history',
        fetched_at: NOW.toISOString(),
        valid_until: FUTURE,
        ticket_count: 1,
        ticket_message_count: 1,
        conversation_count: 0,
        chat_message_count: 0,
        projection_version: 'customer-support-context-v1',
      },
    },
    actions,
  };
}

function ticket(index: number, autopilot = plan({ id: index })): Ticket {
  return {
    id: uuid(100 + index),
    brand_id: uuid(900),
    ticket_number: 3000 + index,
    source: 'email',
    status: 'open',
    priority: 'medium',
    category: 'support',
    subject: `Ticket ${index}`,
    customer_email: `customer${index}@example.com`,
    customer_name: `Customer ${index}`,
    customer_phone: null,
    shopify_customer_id: `gid://shopify/Customer/${index}`,
    assigned_to: null,
    tags: [],
    conversation_id: null,
    order_id: `gid://shopify/Order/${index}`,
    metadata: { autopilot },
    first_response_at: null,
    resolved_at: null,
    closed_at: null,
    sla_deadline: null,
    classification: 'customer_support',
    classification_confidence: 1,
    sla_breached: false,
    created_at: '2026-07-17T18:00:00.000Z',
    updated_at: '2026-07-17T19:00:00.000Z',
    context_version: autopilot.context_version,
  };
}

function settings(patch: Partial<AutopilotBatchSettings> = {}): AutopilotBatchSettings {
  return { ...DEFAULT_AUTOPILOT_BATCH_SETTINGS, ...patch };
}

function directlyReviewedPlan(): AutopilotPlan {
  const reviewed = plan({ generationLineage: false });
  reviewed.trigger = 'revision';
  reviewed.parent_plan_id = uuid(42);
  reviewed.planner_version = 'codex-inbox-review-2026-09-05';
  reviewed.prompt_version = 'individual-evidence-reviewed-drafts-v1';
  reviewed.analysis.review_assessment = {
    source: 'Codex direct review',
    assessed_at: NOW.toISOString(),
    basis: 'Read the customer history and verified the live order and proposed reply.',
    previous_plan_id: uuid(42),
  };
  return reviewed;
}

test('documented direct reviews can enter guarded batches without model calibration', () => {
  const reviewed = directlyReviewedPlan();
  const result = select([ticket(1, reviewed)]);
  assert.equal(result.eligible.length, 1);
  assert.equal(batchModelCalibration(reviewed).ready, false);
  assert.equal(batchModelCalibration(reviewed).reviewedSamples, 0);
  assert.equal(select([ticket(1, reviewed)], { requireCalibrated: true }).excluded[0].reason, 'model_cold_start');
});

test('incomplete or unrelated direct-review records do not unlock a batch', () => {
  for (const change of [
    (p: AutopilotPlan) => { p.analysis.review_assessment!.basis = ''; },
    (p: AutopilotPlan) => { p.analysis.review_assessment!.assessed_at = 'invalid'; },
    (p: AutopilotPlan) => { p.analysis.review_assessment!.previous_plan_id = uuid(43); },
    (p: AutopilotPlan) => { p.analysis.review_assessment!.source = 'unknown'; },
    (p: AutopilotPlan) => { p.prompt_version = 'unknown'; },
  ]) {
    const reviewed = directlyReviewedPlan();
    change(reviewed);
    assert.equal(select([ticket(1, reviewed)]).excluded[0].reason, 'legacy_or_malformed');
  }
});

test('direct review preserves validation holds, policy caps, evidence and mutation opt-in', () => {
  const held = directlyReviewedPlan();
  held.analysis.auto_run_allowed = false;
  assert.equal(select([ticket(1, held)]).excluded[0].reason, 'review_only');
  const capped = directlyReviewedPlan();
  capped.actions[0].confidence = 0.65;
  assert.equal(select([ticket(1, capped)], { minConfidencePercent: 71 }).excluded[0].reason, 'below_range');
  const missing = directlyReviewedPlan();
  delete missing.evidence;
  assert.equal(select([ticket(1, missing)]).excluded[0].reason, 'missing_evidence');
  const mutation = directlyReviewedPlan();
  mutation.actions.push(action('cancel_order', 0.9, 2));
  assert.equal(select([ticket(1, mutation)]).excluded[0].reason, 'high_impact_excluded');
});

function select(tickets: Ticket[], overrides: Partial<AutopilotBatchSettings> = {}) {
  return selectAutopilotBatch({
    tickets,
    // Guarded mode isolates each named safety condition while strict-mode
    // tests opt into reviewed cohort and limiting-score calibration.
    settings: settings({ requireCalibrated: false, ...overrides }),
    now: NOW,
    fingerprintPlan: (value) => `fingerprint:${value.id}`,
  });
}

test('batch defaults to guarded policy-capped confidence while excluding order changes', () => {
  assert.equal(DEFAULT_AUTOPILOT_BATCH_SETTINGS.requireCalibrated, false);
  assert.equal(DEFAULT_AUTOPILOT_BATCH_SETTINGS.includeHighImpact, false);
});

test('batch settings reject malformed or unsafe ranges instead of silently clamping', () => {
  for (const invalid of [
    { ...settings(), minConfidencePercent: Number.NaN },
    { ...settings(), maxConfidencePercent: Number.POSITIVE_INFINITY },
    { ...settings(), minConfidencePercent: -1 },
    { ...settings(), maxConfidencePercent: 101 },
    { ...settings(), minConfidencePercent: 91, maxConfidencePercent: 90 },
    { ...settings(), maxPlans: 0 },
    { ...settings(), maxPlans: 51 },
    { ...settings(), concurrency: 4 },
  ]) {
    assert.equal(validateAutopilotBatchSettings(invalid).ok, false);
  }
  assert.deepEqual(validateAutopilotBatchSettings(settings()), { ok: true, value: settings() });
});

test('review-only validator fallbacks can never enter a batch at any confidence range', () => {
  const fallback = plan({
    id: 9,
    confidence: 0,
    calibrated: true,
    cohortSamples: 0,
    actions: [{
      ...action('escalate_human', 0),
      params: {
        review_only: true,
        auto_run_allowed: false,
        approval_allowed: false,
      },
    }],
  });
  fallback.analysis.review_only = true;
  fallback.analysis.auto_run_allowed = false;

  const result = select([ticket(9, fallback)], {
    minConfidencePercent: 0,
    maxConfidencePercent: 100,
    requireCalibrated: false,
    includeHighImpact: true,
  });

  assert.equal(result.eligible.length, 0);
  assert.equal(result.excluded[0]?.reason, 'review_only');
  assert.match(result.excluded[0]?.detail ?? '', /must revise/i);
});

test('missing provider/model/prompt lineage can never enter a guarded batch', () => {
  const legacyCalibrated = plan({
    id: 10,
    confidence: 0.99,
    calibrated: true,
    cohortSamples: 100,
    generationLineage: false,
  });
  const legacyReadiness = batchModelCalibration(legacyCalibrated);
  assert.equal(legacyReadiness.ready, false);
  assert.equal(legacyReadiness.calibrationKey, null);

  const result = select([ticket(10, legacyCalibrated)], {
    requireCalibrated: false,
    minConfidencePercent: 0,
  });
  assert.equal(result.eligible.length, 0);
  assert.equal(result.excluded[0]?.reason, 'legacy_or_malformed');
  assert.match(result.excluded[0]?.detail ?? '', /legacy calibration cannot unlock/i);
});

test('strict mode requires 25 reviewed cohort samples while guarded mode can warm up safely', () => {
  const almostReady = plan({
    id: 11,
    confidence: 0.99,
    calibrated: true,
    cohortSamples: MIN_AUTOPILOT_BATCH_MODEL_REVIEWS - 1,
  });
  const readiness = batchModelCalibration(almostReady);
  assert.deepEqual(
    {
      ready: readiness.ready,
      reviewedSamples: readiness.reviewedSamples,
      requiredSamples: readiness.requiredSamples,
    },
    {
      ready: false,
      reviewedSamples: 24,
      requiredSamples: 25,
    },
  );
  const excluded = select([ticket(11, almostReady)], {
    requireCalibrated: true,
    minConfidencePercent: 0,
  });
  assert.equal(excluded.excluded[0]?.reason, 'model_cold_start');
  assert.match(excluded.excluded[0]?.detail ?? '', /24 of 25/);

  const guarded = select([ticket(11, almostReady)], {
    requireCalibrated: false,
    minConfidencePercent: 0,
  });
  assert.deepEqual(guarded.eligible.map((candidate) => candidate.ticketId), [ticket(11, almostReady).id]);

  const warmed = plan({
    id: 12,
    confidence: 0.9,
    calibrated: true,
    cohortSamples: MIN_AUTOPILOT_BATCH_MODEL_REVIEWS,
  });
  const eligible = select([ticket(12, warmed)]);
  assert.equal(batchModelCalibration(warmed).ready, true);
  assert.deepEqual(eligible.eligible.map((candidate) => candidate.ticketId), [ticket(12, warmed).id]);

  const zeroWeight = structuredClone(warmed);
  zeroWeight.analysis.confidence_basis!.effective_sample_weight = 0;
  assert.equal(batchModelCalibration(zeroWeight).ready, false);
});

test('guarded mode authorizes only policy-capped effective confidence, never a higher raw score', () => {
  const guarded = plan({
    id: 13,
    confidence: 0.92,
    modelConfidence: 0.99,
    cohortSamples: 0,
    actions: [action('send_reply', 0.85)],
  });
  const preview = select([ticket(13, guarded)], {
    requireCalibrated: false,
    minConfidencePercent: 85,
    maxConfidencePercent: 85,
  });

  assert.equal(preview.eligible.length, 1);
  assert.equal(preview.eligible[0]?.rawModelConfidencePercent, 99);
  assert.equal(preview.eligible[0]?.effectiveConfidencePercent, 85);
  assert.equal(preview.eligible[0]?.confidenceIsCalibrated, false);
  assert.equal(preview.excludedCounts.model_cold_start, undefined);
});

test('deterministic awaiting-customer parks never enter a batch', () => {
  const parked = plan({
    id: 130,
    confidence: 0.99,
    generationLineage: false,
    actions: [action('add_tags', 0.99)],
  });
  parked.planner_version = 'autopilot-v5';
  parked.prompt_version = 'response-state-park-v1';
  const guarded = select([ticket(130, parked)], {
    minConfidencePercent: 99,
    maxConfidencePercent: 100,
  });

  assert.equal(batchModelCalibration(parked).calibrationKey, 'deterministic:autopilot-v5:response-state-park-v1');
  assert.equal(guarded.eligible.length, 0);
  assert.equal(guarded.excluded[0]?.reason, 'not_actionable');
  assert.match(guarded.excluded[0]?.detail ?? '', /automatically parked/i);

  const strict = select([ticket(130, parked)], {
    requireCalibrated: true,
    minConfidencePercent: 99,
  });
  assert.equal(strict.eligible.length, 0);
  assert.equal(strict.excluded[0]?.reason, 'not_actionable');
});

test('effective confidence honors policy/action caps and never falls back to raw model confidence', () => {
  const guarded = plan({
    confidence: 0.92,
    modelConfidence: 0.99,
    actions: [action('cancel_order', 0.65)],
  });
  assert.equal(effectivePlanConfidence(guarded), 0.65);
  const preview = select([ticket(1, guarded)], {
    minConfidencePercent: 85,
    includeHighImpact: true,
  });
  assert.equal(preview.eligible.length, 0);
  assert.equal(preview.excluded[0]?.reason, 'below_range');
});

test('confidence range is inclusive and calibration can be required independently', () => {
  const low = ticket(1, plan({ id: 1, confidence: 0.85 }));
  const high = ticket(2, plan({ id: 2, confidence: 1 }));
  const below = ticket(3, plan({ id: 3, confidence: 0.849 }));
  const above = ticket(4, plan({ id: 4, confidence: 0.951 }));
  const bounded = select([below, low, high, above], {
    minConfidencePercent: 85,
    maxConfidencePercent: 95,
  });
  assert.deepEqual(bounded.eligible.map((item) => item.ticketId), [low.id]);
  assert.equal(bounded.excludedCounts.below_range, 1);
  assert.equal(bounded.excludedCounts.above_range, 2);

  const calibrated = ticket(5, plan({ id: 5, confidence: 0.9, calibrated: true }));
  const required = select([low, calibrated], { requireCalibrated: true });
  assert.deepEqual(required.eligible.map((item) => item.ticketId), [calibrated.id]);
  assert.equal(required.excludedCounts.uncalibrated, 1);
});

test('calibration follows the confidence component that actually limits execution', () => {
  const uncalibratedAction = action('send_reply', 0.86);
  const actionLimited = plan({
    confidence: 0.94,
    calibrated: true,
    actions: [uncalibratedAction],
  });
  assert.equal(effectivePlanConfidence(actionLimited), 0.86);
  assert.equal(limitingConfidenceIsCalibrated(actionLimited), false);
  assert.equal(
    select([ticket(20, actionLimited)], { requireCalibrated: true }).excluded[0]?.reason,
    'uncalibrated',
  );

  uncalibratedAction.confidence_basis = {
    method: 'bayesian_local_v1',
    sample_count: 4,
    effective_sample_weight: 3.1,
    delta: -0.02,
  };
  assert.equal(limitingConfidenceIsCalibrated(actionLimited), true);
  const eligible = select([ticket(20, actionLimited)], { requireCalibrated: true });
  assert.equal(eligible.eligible[0]?.confidenceIsCalibrated, true);
});

test('range exclusions retain enough precision to explain a rounded boundary', () => {
  const boundary = ticket(21, plan({ id: 21, confidence: 0.849 }));
  const preview = select([boundary], { minConfidencePercent: 85 });
  assert.equal(preview.excluded[0]?.reason, 'below_range');
  assert.match(preview.excluded[0]?.detail ?? '', /^84\.9%/);
});

test('confidence range remains the visible reason when a strict cohort is also cold', () => {
  const coldAndBelow = ticket(22, plan({
    id: 22,
    confidence: 0.55,
    cohortSamples: 0,
  }));
  const preview = select([coldAndBelow], {
    requireCalibrated: true,
    minConfidencePercent: 85,
  });
  assert.equal(preview.excluded[0]?.reason, 'below_range');
  assert.equal(preview.excludedCounts.model_cold_start, undefined);
});

test('all Shopify mutations require explicit high-impact opt-in and force sequential execution', () => {
  for (const [index, type] of ([
    'cancel_order',
    'refund_order',
    'update_shipping_address',
  ] as AutopilotActionType[]).entries()) {
    const mutation = ticket(index + 1, plan({
      id: index + 1,
      cohortSamples: 0,
      actions: [action(type, 0.9, index + 1)],
    }));
    assert.equal(select([mutation]).excluded[0]?.reason, 'high_impact_excluded', type);
    const included = select([mutation], { includeHighImpact: true, concurrency: 3 });
    assert.equal(included.eligible.length, 1, type);
    assert.equal(included.effectiveConcurrency, 1, type);
  }
  const ordinaryGuarded = ticket(8, plan({ id: 8, cohortSamples: 0 }));
  const ordinaryPreview = select([ordinaryGuarded], { concurrency: 3 });
  assert.equal(ordinaryPreview.eligible.length, 1);
  assert.equal(ordinaryPreview.effectiveConcurrency, 3);
});

test('legacy, executing, and context-mismatched plans stay out while expired snapshots revalidate live', () => {
  const legacy = ticket(1, plan({ id: 1, version: 1 }));
  const executing = ticket(2, plan({ id: 2, status: 'executing' }));
  const stale = ticket(3, plan({ id: 3, contextVersion: 4 }));
  stale.context_version = 5;
  const expiredPlan = plan({ id: 4 });
  expiredPlan.evidence!.shopify_orders!.valid_until = '2026-07-17T19:59:59.000Z';
  const expired = ticket(4, expiredPlan);
  const result = select([legacy, executing, stale, expired]);
  assert.deepEqual(result.eligible.map((item) => item.ticketId), [expired.id]);
  assert.deepEqual(
    new Set(result.excluded.map((item) => item.reason)),
    new Set(['legacy_or_malformed', 'already_executing', 'stale_context']),
  );
});

test('same-customer collisions prefer the consolidating plan and freeze every exact action verdict', () => {
  const ordinary = ticket(1, plan({
    id: 1,
    confidence: 0.95,
    proposedAt: '2026-07-17T18:00:00.000Z',
  }));
  const consolidationAction = action('consolidate_related_tickets', 0.9, 3);
  consolidationAction.params.related_ticket_ids = [ordinary.id];
  const consolidating = ticket(2, plan({
    id: 2,
    confidence: 0.9,
    actions: [action('send_reply', 0.9, 2), consolidationAction],
    proposedAt: '2026-07-17T19:00:00.000Z',
  }));
  consolidating.customer_email = ordinary.customer_email;
  consolidating.customer_email_normalized = ordinary.customer_email;
  consolidating.shopify_customer_id = ordinary.shopify_customer_id;

  const result = select([ordinary, consolidating]);
  assert.deepEqual(result.eligible.map((item) => item.ticketId), [consolidating.id]);
  assert.equal(result.excluded[0]?.reason, 'customer_collision');
  assert.deepEqual(result.eligible[0]?.actionVerdicts, [
    { id: uuid(1002), approved: true, reply_text: 'A grounded reply.' },
    { id: uuid(1003), approved: true },
  ]);
  assert.equal(result.eligible[0]?.planFingerprint, `fingerprint:${ticketAutopilotId(consolidating)}`);
});

test('selection is deterministic, applies limits after filtering, and preserves supplied ordering', () => {
  const items = [
    ticket(1, plan({ id: 1, confidence: 0.9, proposedAt: '2026-07-17T18:03:00.000Z' })),
    ticket(2, plan({ id: 2, confidence: 0.91, proposedAt: '2026-07-17T18:01:00.000Z' })),
    ticket(3, plan({ id: 3, confidence: 0.92, proposedAt: '2026-07-17T18:02:00.000Z' })),
  ];
  const first = select(items, { maxPlans: 2 });
  const shuffled = select([items[2], items[0], items[1]], { maxPlans: 2 });
  assert.deepEqual(
    first.eligible.map((item) => item.ticketId),
    [items[1].id, items[2].id],
  );
  assert.deepEqual(
    shuffled.eligible.map((item) => item.ticketId),
    first.eligible.map((item) => item.ticketId),
  );
  assert.equal(first.excludedCounts.batch_limit, 1);
});

test('plan fingerprints are stable for the same snapshot and change with action content', () => {
  const original = plan({ id: 42 });
  const clone = structuredClone(original);
  const changed = structuredClone(original);
  changed.actions[0].params.reply_text = 'Different reply.';

  assert.equal(autopilotPlanFingerprint(original), autopilotPlanFingerprint(clone));
  assert.notEqual(autopilotPlanFingerprint(original), autopilotPlanFingerprint(changed));
  assert.match(autopilotPlanFingerprint(original), /^[0-9a-f]{64}$/);
});

test('continue mode isolates a failed high-impact ticket and finishes the frozen batch', () => {
  assert.equal(batchResultStopsScheduling({
    failureMode: 'continue',
    status: 'failed',
  }), false);
  assert.equal(batchResultStopsScheduling({
    failureMode: 'continue',
    status: 'in_progress',
  }), false);
});

test('explicit stop mode still stops after a non-successful result', () => {
  assert.equal(batchResultStopsScheduling({
    failureMode: 'stop',
    status: 'failed',
  }), true);
  assert.equal(batchResultStopsScheduling({
    failureMode: 'stop',
    status: 'succeeded',
  }), false);
});

function ticketAutopilotId(value: Ticket): string {
  return (value.metadata!.autopilot as AutopilotPlan).id!;
}
