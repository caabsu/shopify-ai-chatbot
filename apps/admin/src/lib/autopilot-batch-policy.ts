import {
  autopilotPlanRequiresRevision,
  isHighImpactAutopilotAction,
  requiresCustomerHistoryEvidence,
} from './autopilot-execution-policy';
import type { AutopilotAction, AutopilotPlan, Ticket } from './types';
import { ticketAutopilot } from './types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHOPIFY_EVIDENCE_PROJECTION = 'shopify-support-prompt-v2';
const CUSTOMER_HISTORY_PROJECTION = 'customer-support-context-v1';

/**
 * A new provider/model/prompt cohort must earn enough individually reviewed
 * outcomes before its confidence can authorize unattended batch execution.
 * Threshold batch approvals are excluded from the backend calibration sample,
 * so a batch cannot bootstrap its own trust.
 */
export const MIN_AUTOPILOT_BATCH_MODEL_REVIEWS = 25;

export const DEFAULT_AUTOPILOT_BATCH_SETTINGS: AutopilotBatchSettings = {
  minConfidencePercent: 85,
  maxConfidencePercent: 100,
  maxPlans: 25,
  concurrency: 2,
  requireCalibrated: false,
  includeHighImpact: false,
  order: 'oldest',
  failureMode: 'continue',
};

export interface AutopilotBatchSettings {
  minConfidencePercent: number;
  maxConfidencePercent: number;
  maxPlans: number;
  concurrency: number;
  requireCalibrated: boolean;
  includeHighImpact: boolean;
  order: 'oldest' | 'confidence';
  failureMode: 'continue' | 'stop';
}

export function batchResultStopsScheduling(input: {
  failureMode: AutopilotBatchSettings['failureMode'];
  status: 'succeeded' | 'stale' | 'failed' | 'in_progress';
}): boolean {
  if (input.failureMode !== 'stop') return false;
  return input.status !== 'succeeded';
}

export type AutopilotBatchExclusionReason =
  | 'not_actionable'
  | 'already_executing'
  | 'review_only'
  | 'legacy_or_malformed'
  | 'stale_context'
  | 'missing_evidence'
  | 'expired_evidence'
  | 'model_cold_start'
  | 'uncalibrated'
  | 'below_range'
  | 'above_range'
  | 'high_impact_excluded'
  | 'local_changes'
  | 'customer_collision'
  | 'batch_limit';

export interface AutopilotBatchActionVerdict {
  id: string;
  approved: true;
  reply_text?: string;
}

export interface AutopilotBatchCandidate {
  ticketId: string;
  ticketNumber: number;
  subject: string;
  customerName: string | null;
  customerEmail: string;
  planId: string;
  planRevision: number;
  contextFingerprint: string;
  contextVersion: number;
  proposedAt: string;
  planFingerprint: string;
  effectiveConfidence: number;
  effectiveConfidencePercent: number;
  rawModelConfidence: number;
  rawModelConfidencePercent: number;
  confidenceIsCalibrated: boolean;
  hasHighImpact: boolean;
  hasConsolidation: boolean;
  actionTypes: AutopilotAction['type'][];
  actionVerdicts: AutopilotBatchActionVerdict[];
}

export interface AutopilotBatchExcludedItem {
  ticketId: string;
  ticketNumber: number;
  subject: string;
  reason: AutopilotBatchExclusionReason;
  detail: string;
}

export interface AutopilotBatchPreview {
  previewId: string;
  generatedAt: string;
  expiresAt: string;
  totalQueue: number;
  effectiveConcurrency: number;
  settings: AutopilotBatchSettings;
  eligible: AutopilotBatchCandidate[];
  excluded: AutopilotBatchExcludedItem[];
  excludedCounts: Partial<Record<AutopilotBatchExclusionReason, number>>;
}

type CandidateWithKeys = AutopilotBatchCandidate & { collisionKeys: string[] };

export function reviewedCalibration(
  basis?: { sample_count: number; effective_sample_weight: number },
): boolean {
  return Boolean(
    basis
    && Number.isFinite(basis.sample_count)
    && basis.sample_count > 0
    && Number.isFinite(basis.effective_sample_weight)
    && basis.effective_sample_weight > 0,
  );
}

/**
 * This is the executable score. It deliberately never falls back to a larger
 * raw model score: overall_confidence and action.confidence contain policy
 * caps, dependency floors, and any reviewed calibration.
 */
export function effectivePlanConfidence(plan: AutopilotPlan): number | null {
  const values = [
    Number(plan.analysis?.overall_confidence),
    ...plan.actions.map((action) => Number(action.confidence)),
  ];
  if (values.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) return null;
  return Math.min(...values);
}

/**
 * Calibration is meaningful for the executable score only when every value
 * tied for that limiting score has reviewed evidence. A plan-level calibration
 * must not make a lower, uncalibrated action look calibrated.
 */
export function limitingConfidenceIsCalibrated(plan: AutopilotPlan): boolean {
  const confidence = effectivePlanConfidence(plan);
  if (confidence === null) return false;
  const epsilon = 1e-9;
  const limitingBases = [
    ...(Math.abs(Number(plan.analysis.overall_confidence) - confidence) <= epsilon
      ? [plan.analysis.confidence_basis]
      : []),
    ...plan.actions.flatMap((action) => (
      Math.abs(Number(action.confidence) - confidence) <= epsilon
        ? [action.confidence_basis]
        : []
    )),
  ];
  return limitingBases.length > 0 && limitingBases.every(reviewedCalibration);
}

export interface AutopilotBatchModelCalibration {
  ready: boolean;
  calibrationKey: string | null;
  reviewedSamples: number;
  requiredSamples: number;
  detail: string;
}

/**
 * This reports both model lineage and reviewed cohort maturity. Complete
 * lineage is always required for an auditable batch. Cohort maturity is
 * required only in strict reviewed-calibration mode; guarded mode may use the
 * policy-capped executable score while the cohort is still warming up.
 *
 * Threshold batch approvals are lower-trust audit evidence and are excluded
 * from reviewed calibration, so guarded runs cannot bootstrap their own trust.
 */
export function batchModelCalibration(
  plan: AutopilotPlan,
): AutopilotBatchModelCalibration {
  const generation = plan.generation;
  const review = plan.analysis.review_assessment;
  // An explicit direct review has its own audit trail. Do not fabricate a
  // provider generation or treat an editorial score as calibrated model data.
  if (!generation
    && plan.trigger === 'revision'
    && plan.planner_version?.startsWith('codex-inbox-review-')
    && plan.prompt_version === 'individual-evidence-reviewed-drafts-v1'
    && review?.source === 'Codex direct review'
    && typeof review.basis === 'string' && review.basis.trim()
    && Number.isFinite(Date.parse(review.assessed_at))
    && UUID_PATTERN.test(review.previous_plan_id)
    && review.previous_plan_id === plan.parent_plan_id) {
    return {
      ready: false,
      calibrationKey: `direct-review:${plan.planner_version}:${plan.prompt_version}`,
      reviewedSamples: 0,
      requiredSamples: MIN_AUTOPILOT_BATCH_MODEL_REVIEWS,
      detail: 'This plan has a documented direct Codex review. Guarded batch approval '
        + 'uses its policy-capped review score; model calibration is not claimed.',
    };
  }
  const deterministicLineage = !generation
    && typeof plan.planner_version === 'string'
    && plan.planner_version.trim()
    && typeof plan.prompt_version === 'string'
    && (
      plan.prompt_version.startsWith('response-state-')
      || plan.prompt_version.startsWith('deterministic-')
    );
  if (deterministicLineage) {
    return {
      ready: false,
      calibrationKey: `deterministic:${plan.planner_version}:${plan.prompt_version}`,
      reviewedSamples: 0,
      requiredSamples: MIN_AUTOPILOT_BATCH_MODEL_REVIEWS,
      detail:
        'This plan was produced by a deterministic policy, not a model cohort. '
        + 'It is eligible in guarded mode using its policy-capped executable score.',
    };
  }
  const calibrationKey = typeof generation?.calibration_key === 'string'
    && generation.calibration_key.trim()
    ? generation.calibration_key.trim()
    : null;
  const hasCompleteLineage = Boolean(
    calibrationKey
    && typeof generation?.provider === 'string'
    && generation.provider.trim()
    && typeof generation?.model === 'string'
    && generation.model.trim()
    && typeof plan.prompt_version === 'string'
    && plan.prompt_version.trim(),
  );
  const sampleCount = Number(plan.analysis.confidence_basis?.sample_count);
  const reviewedSamples = reviewedCalibration(plan.analysis.confidence_basis)
    && Number.isInteger(sampleCount)
    && sampleCount > 0
    ? sampleCount
    : 0;

  if (!hasCompleteLineage) {
    return {
      ready: false,
      calibrationKey: null,
      reviewedSamples: 0,
      requiredSamples: MIN_AUTOPILOT_BATCH_MODEL_REVIEWS,
      detail: 'This plan has no complete provider/model/prompt calibration lineage. Review it individually; legacy calibration cannot unlock a new model cohort.',
    };
  }
  if (reviewedSamples < MIN_AUTOPILOT_BATCH_MODEL_REVIEWS) {
    return {
      ready: false,
      calibrationKey,
      reviewedSamples,
      requiredSamples: MIN_AUTOPILOT_BATCH_MODEL_REVIEWS,
      detail: `This provider/model/prompt cohort has ${reviewedSamples} of ${MIN_AUTOPILOT_BATCH_MODEL_REVIEWS} required individually reviewed samples. Review this plan individually to warm the cohort.`,
    };
  }
  return {
    ready: true,
    calibrationKey,
    reviewedSamples,
    requiredSamples: MIN_AUTOPILOT_BATCH_MODEL_REVIEWS,
    detail: `${reviewedSamples} individually reviewed samples support this provider/model/prompt cohort.`,
  };
}

export function validateAutopilotBatchSettings(
  value: unknown,
): { ok: true; value: AutopilotBatchSettings } | { ok: false; error: string } {
  if (!value || typeof value !== 'object') return { ok: false, error: 'Batch settings are required.' };
  const settings = value as Partial<AutopilotBatchSettings>;
  const min = Number(settings.minConfidencePercent);
  const max = Number(settings.maxConfidencePercent);
  const maxPlans = Number(settings.maxPlans);
  const concurrency = Number(settings.concurrency);
  if (!Number.isInteger(min) || min < 0 || min > 100) {
    return { ok: false, error: 'Minimum confidence must be a whole percentage from 0 to 100.' };
  }
  if (!Number.isInteger(max) || max < 0 || max > 100) {
    return { ok: false, error: 'Maximum confidence must be a whole percentage from 0 to 100.' };
  }
  if (min > max) return { ok: false, error: 'Minimum confidence cannot exceed maximum confidence.' };
  if (!Number.isInteger(maxPlans) || maxPlans < 1 || maxPlans > 50) {
    return { ok: false, error: 'Batch size must be from 1 to 50 plans.' };
  }
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 3) {
    return { ok: false, error: 'Concurrency must be 1, 2, or 3.' };
  }
  if (typeof settings.requireCalibrated !== 'boolean' || typeof settings.includeHighImpact !== 'boolean') {
    return { ok: false, error: 'Batch safety toggles must be explicit booleans.' };
  }
  if (settings.order !== 'oldest' && settings.order !== 'confidence') {
    return { ok: false, error: 'Batch order must be oldest or confidence.' };
  }
  if (settings.failureMode !== 'continue' && settings.failureMode !== 'stop') {
    return { ok: false, error: 'Failure mode must be continue or stop.' };
  }
  return {
    ok: true,
    value: {
      minConfidencePercent: min,
      maxConfidencePercent: max,
      maxPlans,
      concurrency,
      requireCalibrated: settings.requireCalibrated,
      includeHighImpact: settings.includeHighImpact,
      order: settings.order,
      failureMode: settings.failureMode,
    },
  };
}

function evidenceExclusion(
  ticket: Ticket,
  plan: AutopilotPlan,
  _now: Date,
): { reason: 'missing_evidence'; detail: string } | null {
  const hasOrderMutation = plan.actions.some(isHighImpactAutopilotAction);
  const needsShopifyEvidence = Boolean(ticket.customer_email)
    && (hasOrderMutation || plan.actions.some((action) => action.type === 'send_reply'));
  if (needsShopifyEvidence) {
    const evidence = plan.evidence?.shopify_orders;
    if (!evidence || evidence.projection_version !== SHOPIFY_EVIDENCE_PROJECTION) {
      return {
        reason: 'missing_evidence',
        detail: 'The plan predates the current Shopify evidence projection.',
      };
    }
  }

  if (requiresCustomerHistoryEvidence(plan, Boolean(ticket.customer_email))) {
    const evidence = plan.evidence?.customer_history;
    if (!evidence || evidence.projection_version !== CUSTOMER_HISTORY_PROJECTION) {
      return {
        reason: 'missing_evidence',
        detail: 'The plan has no current all-thread customer-history evidence.',
      };
    }
  }
  return null;
}

function planShapeIsExecutable(ticket: Ticket, plan: AutopilotPlan): boolean {
  const revision = plan.revision ?? plan.revision_count ?? 0;
  if (plan.version !== 2
      || !plan.id
      || !UUID_PATTERN.test(plan.id)
      || !Number.isInteger(revision)
      || revision < 0
      || typeof plan.context_fingerprint !== 'string'
      || !plan.context_fingerprint.trim()
      || !Number.isInteger(plan.context_version)
      || Number(plan.context_version) < 0
      || !Array.isArray(plan.actions)
      || plan.actions.length === 0) return false;
  const actionIds = new Set<string>();
  for (const action of plan.actions) {
    if (!action || typeof action.id !== 'string' || !action.id || actionIds.has(action.id)) return false;
    if (action.type === 'send_reply' && !String(action.params?.reply_text ?? '').trim()) return false;
    actionIds.add(action.id);
  }
  return Number.isInteger(ticket.context_version);
}

function relatedTicketIds(plan: AutopilotPlan): string[] {
  return plan.actions.flatMap((action) => {
    if (action.type !== 'consolidate_related_tickets') return [];
    const direct = Array.isArray(action.params.related_ticket_ids)
      ? action.params.related_ticket_ids.filter((value): value is string => typeof value === 'string')
      : [];
    const snapshots = Array.isArray(action.params.related_tickets)
      ? action.params.related_tickets.flatMap((value) => (
          value && typeof value === 'object' && typeof (value as { ticket_id?: unknown }).ticket_id === 'string'
            ? [(value as { ticket_id: string }).ticket_id]
            : []
        ))
      : [];
    return [...direct, ...snapshots];
  });
}

function collisionKeys(ticket: Ticket, plan: AutopilotPlan): string[] {
  const keys = new Set<string>([`ticket:${ticket.id}`]);
  const email = (ticket.customer_email_normalized || ticket.customer_email || '').trim().toLowerCase();
  if (email) keys.add(`email:${email}`);
  if (ticket.shopify_customer_id) keys.add(`customer:${ticket.shopify_customer_id}`);
  if (ticket.order_id) keys.add(`order:${ticket.order_id}`);
  for (const action of plan.actions) {
    if (typeof action.params.order_id === 'string' && action.params.order_id) {
      keys.add(`order:${action.params.order_id}`);
    }
  }
  for (const relatedId of relatedTicketIds(plan)) keys.add(`ticket:${relatedId}`);
  return [...keys];
}

function exclusion(
  ticket: Ticket,
  reason: AutopilotBatchExclusionReason,
  detail: string,
): AutopilotBatchExcludedItem {
  return {
    ticketId: ticket.id,
    ticketNumber: ticket.ticket_number,
    subject: ticket.subject,
    reason,
    detail,
  };
}

function oldestFirst(left: AutopilotBatchCandidate, right: AutopilotBatchCandidate): number {
  const date = left.proposedAt.localeCompare(right.proposedAt);
  if (date !== 0) return date;
  if (left.ticketNumber !== right.ticketNumber) return left.ticketNumber - right.ticketNumber;
  return left.ticketId.localeCompare(right.ticketId);
}

export function selectAutopilotBatch(input: {
  tickets: Ticket[];
  settings: AutopilotBatchSettings;
  now?: Date;
  blockedTicketIds?: ReadonlySet<string>;
  fingerprintPlan: (plan: AutopilotPlan) => string;
}): {
  eligible: AutopilotBatchCandidate[];
  excluded: AutopilotBatchExcludedItem[];
  excludedCounts: Partial<Record<AutopilotBatchExclusionReason, number>>;
  effectiveConcurrency: number;
} {
  const now = input.now ?? new Date();
  const blocked = input.blockedTicketIds ?? new Set<string>();
  const candidates: CandidateWithKeys[] = [];
  const excluded: AutopilotBatchExcludedItem[] = [];

  for (const ticket of input.tickets) {
    const plan = ticketAutopilot(ticket);
    if (!plan || !['open', 'pending'].includes(ticket.status) || ticket.merged_into_ticket_id) {
      excluded.push(exclusion(ticket, 'not_actionable', 'The ticket is not open, pending, or independently actionable.'));
      continue;
    }
    if (plan.status === 'executing') {
      excluded.push(exclusion(ticket, 'already_executing', 'An existing durable run must be resumed with its original key.'));
      continue;
    }
    if (plan.status !== 'proposed') {
      excluded.push(exclusion(ticket, 'not_actionable', 'Only proposed plans can enter a new batch.'));
      continue;
    }
    if (
      plan.prompt_version === 'response-state-park-v1'
      || plan.prompt_version === 'response-state-auto-park-v2'
    ) {
      excluded.push(exclusion(
        ticket,
        'not_actionable',
        'The latest delivered message is already ours. This ticket is automatically parked until the customer replies.',
      ));
      continue;
    }
    if (blocked.has(ticket.id)) {
      excluded.push(exclusion(ticket, 'local_changes', 'This card has unsaved edits, action choices, or revision notes.'));
      continue;
    }
    if (autopilotPlanRequiresRevision(plan)) {
      excluded.push(exclusion(
        ticket,
        'review_only',
        'Deterministic safety validation withheld the generated actions. A human must revise this plan before it can run.',
      ));
      continue;
    }
    if (!planShapeIsExecutable(ticket, plan)) {
      excluded.push(exclusion(ticket, 'legacy_or_malformed', 'The plan has no complete v2 identity and execution fence.'));
      continue;
    }
    if (Number(ticket.context_version) !== Number(plan.context_version)) {
      excluded.push(exclusion(ticket, 'stale_context', 'Ticket context changed after this plan was drafted.'));
      continue;
    }
    const evidenceIssue = evidenceExclusion(ticket, plan, now);
    if (evidenceIssue) {
      excluded.push(exclusion(ticket, evidenceIssue.reason, evidenceIssue.detail));
      continue;
    }
    const confidence = effectivePlanConfidence(plan);
    if (confidence === null) {
      excluded.push(exclusion(ticket, 'legacy_or_malformed', 'The plan has an invalid executable confidence score.'));
      continue;
    }
    const modelCalibration = batchModelCalibration(plan);
    if (!modelCalibration.calibrationKey) {
      excluded.push(exclusion(ticket, 'legacy_or_malformed', modelCalibration.detail));
      continue;
    }
    const confidencePercent = confidence * 100;
    if (confidencePercent < input.settings.minConfidencePercent) {
      excluded.push(exclusion(
        ticket,
        'below_range',
        `${confidencePercent.toFixed(1)}% effective confidence is below the selected range.`,
      ));
      continue;
    }
    if (confidencePercent > input.settings.maxConfidencePercent) {
      excluded.push(exclusion(
        ticket,
        'above_range',
        `${confidencePercent.toFixed(1)}% effective confidence is above the selected range.`,
      ));
      continue;
    }
    if (input.settings.requireCalibrated && !modelCalibration.ready) {
      excluded.push(exclusion(ticket, 'model_cold_start', modelCalibration.detail));
      continue;
    }
    const calibrated = limitingConfidenceIsCalibrated(plan);
    if (input.settings.requireCalibrated && !calibrated) {
      excluded.push(exclusion(ticket, 'uncalibrated', 'No relevant reviewed calibration samples support this plan yet.'));
      continue;
    }
    const hasHighImpact = plan.actions.some(isHighImpactAutopilotAction);
    if (hasHighImpact && !input.settings.includeHighImpact) {
      excluded.push(exclusion(ticket, 'high_impact_excluded', 'Cancellation, refund, or address mutation requires explicit batch opt-in.'));
      continue;
    }
    const raw = Number(plan.analysis.model_confidence ?? plan.analysis.overall_confidence);
    const revision = plan.revision ?? plan.revision_count ?? 0;
    candidates.push({
      ticketId: ticket.id,
      ticketNumber: ticket.ticket_number,
      subject: ticket.subject,
      customerName: ticket.customer_name,
      customerEmail: ticket.customer_email,
      planId: plan.id!,
      planRevision: revision,
      contextFingerprint: plan.context_fingerprint!,
      contextVersion: plan.context_version!,
      proposedAt: plan.proposed_at,
      planFingerprint: input.fingerprintPlan(plan),
      effectiveConfidence: confidence,
      effectiveConfidencePercent: confidencePercent,
      rawModelConfidence: Number.isFinite(raw) ? raw : confidence,
      rawModelConfidencePercent: (Number.isFinite(raw) ? raw : confidence) * 100,
      confidenceIsCalibrated: calibrated,
      hasHighImpact,
      hasConsolidation: plan.actions.some((action) => action.type === 'consolidate_related_tickets'),
      actionTypes: plan.actions.map((action) => action.type),
      actionVerdicts: plan.actions.map((action) => ({
        id: action.id,
        approved: true as const,
        ...(action.type === 'send_reply'
          ? { reply_text: String(action.params.reply_text ?? '') }
          : {}),
      })),
      collisionKeys: collisionKeys(ticket, plan),
    });
  }

  // Shared customer/order/related-ticket context makes concurrent duplicate
  // replies unsafe. Prefer the plan that explicitly consolidates the case,
  // then the most confident plan, while keeping the final run order separate.
  candidates.sort((left, right) => (
    Number(right.hasConsolidation) - Number(left.hasConsolidation)
    || right.effectiveConfidence - left.effectiveConfidence
    || oldestFirst(left, right)
  ));
  const claimedKeys = new Set<string>();
  const collisionFree: CandidateWithKeys[] = [];
  for (const candidate of candidates) {
    if (candidate.collisionKeys.some((key) => claimedKeys.has(key))) {
      const ticket = input.tickets.find((item) => item.id === candidate.ticketId)!;
      excluded.push(exclusion(
        ticket,
        'customer_collision',
        'Another selected plan covers the same customer, order, or related ticket set.',
      ));
      continue;
    }
    collisionFree.push(candidate);
    for (const key of candidate.collisionKeys) claimedKeys.add(key);
  }

  collisionFree.sort((left, right) => (
    input.settings.order === 'confidence'
      ? right.effectiveConfidence - left.effectiveConfidence || oldestFirst(left, right)
      : oldestFirst(left, right)
  ));
  const selected = collisionFree.slice(0, input.settings.maxPlans);
  for (const overflow of collisionFree.slice(input.settings.maxPlans)) {
    const ticket = input.tickets.find((item) => item.id === overflow.ticketId)!;
    excluded.push(exclusion(ticket, 'batch_limit', 'Eligible, but beyond the selected maximum batch size.'));
  }

  const excludedCounts: Partial<Record<AutopilotBatchExclusionReason, number>> = {};
  for (const item of excluded) excludedCounts[item.reason] = (excludedCounts[item.reason] ?? 0) + 1;
  return {
    eligible: selected.map(({ collisionKeys: _keys, ...candidate }) => candidate),
    excluded,
    excludedCounts,
    effectiveConcurrency: input.settings.includeHighImpact ? 1 : input.settings.concurrency,
  };
}
