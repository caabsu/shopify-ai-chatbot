import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { sendTicketReplyEmail } from '@/lib/email';
import { maybeSendCsatRequest } from '@/lib/csat';
import { cancelFulfillment, cancelOrder, refundOrder, updateOrderShippingAddress, getOrderDetails, getCustomerByEmail, getCustomerOrders, type ShippingAddressInput } from '@/lib/shopify';
import {
  SHOPIFY_SUPPORT_EVIDENCE_PROJECTION,
  orderDetailToEvidenceSummary,
  shopifyOrderEvidenceHashes,
  shopifySupportEvidenceHash,
} from '@/lib/autopilot-evidence';
import {
  buildAutopilotReviewEvent,
  ensurePlanIdentity,
  isReviewerGuidedAutopilotRevision,
  type AutopilotReviewEventRecord,
} from '@/lib/autopilot-learning';
import { validateFinalReplyOutcomes } from '@/lib/autopilot-reply-policy';
import { retentionDeliveryAllowed, retentionRefundAmount, shopifyMoneyAmount } from '../../../backend/src/services/support-retention-policy';
import {
  cancellationRefundWasSubmitted,
  pollProviderPostcondition,
} from '@/lib/autopilot-provider-reconciliation';
import {
  autopilotPlanRequiresRevision,
  classifyExistingAutopilotDecision,
  isHighImpactAutopilotAction,
  matchOrderCustomerIdentity,
  mergeShippingAddressForExecution,
  plannedOrderIdentityBindingMatches,
  requiresImmediateActionEvidenceRevalidation,
  requiresFreshPlanFingerprintCheck,
  requiresCustomerHistoryEvidence,
  shippingAddressMatchesExpected,
} from '@/lib/autopilot-execution-policy';
import {
  deriveAutopilotExecutionScopeKeys,
  ExecutionScopeDerivationError,
} from '@/lib/autopilot-execution-scope';
import { autopilotPlanFingerprint } from '@/lib/autopilot-plan-fingerprint';
import type {
  AutopilotAction,
  AutopilotPlan,
  AutopilotRelatedTicketSnapshot,
  Ticket,
} from '@/lib/types';



const ACTION_LEASE_SECONDS = 120;
const ACTION_HEARTBEAT_INTERVAL_MS = 30_000;
const ACTION_PROVIDER_TIMEOUT_MS = 75_000;
const ACTION_HEARTBEAT_RETRY_BASE_MS = 5_000;
const CANCELLATION_POSTCONDITION_MAX_WAIT_MS = 15_000;
const CANCELLATION_POSTCONDITION_POLL_INTERVAL_MS = 1_500;

function conflictResponse(code: string, error: string, status = 409) {
  return NextResponse.json({ code, error }, { status });
}

class DefinitiveActionExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DefinitiveActionExecutionError';
  }
}

class ExecutionScopeConflictError extends DefinitiveActionExecutionError {
  readonly conflictCode: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ExecutionScopeConflictError';
    this.conflictCode = code;
  }
}

class ProviderOutcomePendingError extends Error {
  readonly providerReference?: string;

  constructor(message: string, providerReference?: string) {
    super(message);
    this.name = 'ProviderOutcomePendingError';
    this.providerReference = providerReference;
  }
}

class ExecutionLeaseLostError extends ProviderOutcomePendingError {
  constructor(message: string) {
    super(message);
    this.name = 'ExecutionLeaseLostError';
  }
}

function providerReferenceFromError(error: unknown): string | undefined {
  // ShopifyCancellationPollingError intentionally exposes this structural
  // field so the receipt keeps its job ID even when polling aborts or fails.
  if (!error || typeof error !== 'object' || !('providerReference' in error)) return undefined;
  const reference = (error as { providerReference?: unknown }).providerReference;
  return typeof reference === 'string' && reference.trim() ? reference : undefined;
}

function historicalOutcomeEvidenceFor(action: AutopilotAction): Array<{
  type: string;
  order_name?: string | null;
  amount?: number | null;
}> {
  const value = action.params.verified_historical_outcome_evidence;
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const record = item as Record<string, unknown>;
    if (typeof record.type !== 'string') return [];
    return [{
      type: record.type,
      order_name: typeof record.order_name === 'string' ? record.order_name : null,
      amount: typeof record.amount === 'number' && Number.isFinite(record.amount)
        ? record.amount
        : null,
    }];
  });
}

function verifiedPendingRefundAmountsFor(action: AutopilotAction): number[] {
  const value = action.params.verified_pending_refund_amounts;
  if (!Array.isArray(value)) return [];
  return value
    .map(Number)
    .filter((amount) => Number.isFinite(amount) && amount > 0);
}

/**
 * Decide on an Autopilot plan: dismiss it, or approve (a subset of) its actions
 * and execute them right here using the admin's proven Shopify/email libraries.
 * Per-action results land back on the plan so the review card shows exactly
 * what ran and what failed.
 *
 * Body: { decision: 'approve' | 'dismiss',
 *         actions?: [{ id, approved: boolean, reply_text?: string }] }
 */
export async function executeAutopilotRequest(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
  session: NonNullable<Awaited<ReturnType<typeof getSession>>>,
  beforeAutomaticAction?: () => Promise<void>,
) {

  const { id } = await params;
  const body = await req.json();
  const decision = body.decision as 'approve' | 'dismiss';
  if (decision !== 'approve' && decision !== 'dismiss') {
    return NextResponse.json({ error: 'decision must be approve or dismiss' }, { status: 400 });
  }
  const decisionMode = body.decision_mode === undefined
    ? 'individual_review'
    : body.decision_mode;
  if (decisionMode !== 'individual_review' && decisionMode !== 'batch_threshold') {
    return NextResponse.json({ error: 'decision_mode must be individual_review or batch_threshold' }, { status: 400 });
  }
  if (decisionMode === 'batch_threshold' && (decision !== 'approve' || session.role !== 'admin')) {
    return NextResponse.json({ error: 'Batch threshold approval requires an administrator.' }, { status: 403 });
  }

  const { data: ticket, error: ticketError } = await supabase
    .from('tickets')
    .select('*')
    .eq('id', id)
    .eq('brand_id', session.brandId)
    .single();
  if (ticketError || !ticket) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });

  const metadata = (ticket.metadata as Record<string, unknown>) || {};
  const plan = metadata.autopilot as AutopilotPlan | undefined;
  if (!plan) {
    return conflictResponse('NO_PENDING_PLAN', 'No pending Autopilot plan is attached to this ticket.');
  }
  const requestIdempotencyKey = typeof body.idempotency_key === 'string' ? body.idempotency_key : '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestIdempotencyKey)) {
    return NextResponse.json({ error: 'A valid idempotency_key is required' }, { status: 400 });
  }
  const requestedPlanId = typeof body.plan_id === 'string' ? body.plan_id : null;
  const existingDecision = classifyExistingAutopilotDecision({
    planStatus: plan.status,
    planId: plan.id,
    executionAttemptId: plan.execution_attempt_id,
    requestedPlanId,
    requestIdempotencyKey,
    decision,
    decisionMode,
  });
  const resumingExecution = existingDecision === 'resume_exact';
  if (existingDecision === 'in_progress_other_attempt') {
    return NextResponse.json({
      code: 'PLAN_ALREADY_EXECUTING',
      error: 'Another durable operation is already executing this plan. This batch attempt did not replace it.',
      plan,
      in_progress: true,
    }, { status: 202 });
  }
  if (existingDecision === 'batch_decided_elsewhere') {
    return conflictResponse(
      'PLAN_ALREADY_DECIDED',
      'This plan was decided by another operation. The frozen batch decision was not substituted or counted as executed.',
    );
  }
  if (existingDecision === 'replay_exact' || existingDecision === 'replay_compatible') {
    return NextResponse.json({ plan, replayed: true, learning_captured: true }, { status: 200 });
  }
  if (existingDecision === 'reject') {
    return conflictResponse('NO_PENDING_PLAN', 'No pending Autopilot plan is attached to this ticket.');
  }
  const executionWorkerToken = randomUUID();
  if (plan.version !== 2 || !plan.id || plan.context_version === undefined) {
    return conflictResponse(
      'LEGACY_PLAN',
      'This is a legacy plan with no safe execution token. Autopilot must regenerate it before it can run.',
    );
  }

  const planId = ensurePlanIdentity(plan);
  const expectedPlanId = requestedPlanId;
  const expectedRevision = Number(body.plan_revision);
  if (!expectedPlanId) {
    return NextResponse.json({ error: 'plan_id is required; refresh this plan and try again' }, { status: 400 });
  }
  if (expectedPlanId && expectedPlanId !== planId) {
    return conflictResponse('PLAN_REPLACED', 'This plan was replaced. Refresh before approving.');
  }
  if (Number.isFinite(expectedRevision) && expectedRevision !== (plan.revision ?? plan.revision_count ?? 0)) {
    return conflictResponse('PLAN_REVISION_CHANGED', 'This plan revision is stale. Refresh before approving.');
  }
  if (body.context_fingerprint && body.context_fingerprint !== plan.context_fingerprint) {
    return conflictResponse('CONTEXT_CHANGED', 'Ticket context changed. Refresh before approving.');
  }
  const expectedContextVersion = Number(body.context_version);
  if (!Number.isInteger(expectedContextVersion)) {
    return NextResponse.json({ error: 'context_version is required; refresh this plan and try again' }, { status: 400 });
  }
  if (Number.isInteger(expectedContextVersion)
      && (expectedContextVersion !== Number(plan.context_version ?? 0)
        || (!resumingExecution && expectedContextVersion !== Number(ticket.context_version ?? 0)))) {
    return conflictResponse(
      'CONTEXT_CHANGED',
      'Ticket context changed after this plan was drafted. Refresh before deciding.',
    );
  }
  if (decision === 'approve' && autopilotPlanRequiresRevision(plan)) {
    return conflictResponse(
      'PLAN_REQUIRES_REVISION',
      'Deterministic safety validation withheld this plan. Add reviewer instructions and use Revise before running any action.',
    );
  }
  const expectedPlanFingerprint = typeof body.plan_fingerprint === 'string'
    ? body.plan_fingerprint
    : null;
  if (decisionMode === 'batch_threshold' && !/^[0-9a-f]{64}$/i.test(expectedPlanFingerprint ?? '')) {
    return NextResponse.json({ error: 'A valid plan_fingerprint is required for batch approval.' }, { status: 400 });
  }
  if (expectedPlanFingerprint
      && requiresFreshPlanFingerprintCheck(resumingExecution)
      && expectedPlanFingerprint !== autopilotPlanFingerprint(plan)) {
    return conflictResponse(
      'PLAN_CONTENT_CHANGED',
      'The plan content changed after the batch preview. The newer plan was not substituted or run.',
    );
  }

  if (decision === 'approve' && !resumingExecution) {
    const evidenceCheck = await verifyShopifyPlanEvidence(
      plan,
      ticket as TicketRow,
      session.brandSlug,
      { allowExpired: true },
    );
    if (!evidenceCheck.ok) {
      return conflictResponse(
        evidenceCheck.retryable ? 'EVIDENCE_UNAVAILABLE' : 'EVIDENCE_STALE',
        evidenceCheck.error,
        evidenceCheck.retryable ? 503 : 409,
      );
    }
    const customerHistoryCheck = await verifyCustomerHistoryPlanEvidence(
      plan,
      ticket as TicketRow,
      session.brandId,
      { allowExpired: true },
    );
    if (!customerHistoryCheck.ok) {
      return conflictResponse(
        customerHistoryCheck.retryable ? 'EVIDENCE_UNAVAILABLE' : 'EVIDENCE_STALE',
        customerHistoryCheck.error,
        customerHistoryCheck.retryable ? 503 : 409,
      );
    }
  }

  let originalPlan = structuredClone(plan);
  if (plan.parent_plan_id && isReviewerGuidedAutopilotRevision(plan) && !resumingExecution) {
    const { data: parentLedger, error: parentLedgerError } = await supabase
      .from('ticket_action_plans')
      .select('id, revision, analysis, actions, planner_version, prompt_version, context_fingerprint, context_version, trigger, proposed_at')
      .eq('id', plan.parent_plan_id)
      .eq('ticket_id', id)
      .eq('brand_id', session.brandId)
      .maybeSingle();
    if (parentLedgerError || !parentLedger || !Array.isArray(parentLedger.actions)) {
      return NextResponse.json({
        code: 'PARENT_PLAN_MISSING',
        error: 'The parent plan needed to learn this revision delta is unavailable. Regenerate the revision before approval.',
      }, { status: 409 });
    }
    const parentAnalysis = parentLedger.analysis as (
      AutopilotPlan['analysis'] & { generation?: AutopilotPlan['generation'] }
    );
    originalPlan = {
      ...originalPlan,
      id: parentLedger.id,
      revision: parentLedger.revision,
      planner_version: parentLedger.planner_version ?? originalPlan.planner_version,
      prompt_version: parentLedger.prompt_version ?? originalPlan.prompt_version,
      context_fingerprint: parentLedger.context_fingerprint ?? undefined,
      context_version: Number(parentLedger.context_version ?? 0),
      trigger: parentLedger.trigger as AutopilotPlan['trigger'],
      proposed_at: parentLedger.proposed_at,
      generation: parentAnalysis.generation ?? originalPlan.generation,
      analysis: parentAnalysis,
      actions: parentLedger.actions as AutopilotAction[],
    };
  }
  const ticketForLearning = ticket as unknown as Ticket;

  const now = new Date().toISOString();
  const deciderName = session.name || 'admin';

  if (decision === 'dismiss') {
    plan.status = 'dismissed';
    plan.decided_at = now;
    plan.decided_by = deciderName;
    const reviewInput = {
      ticket: ticketForLearning,
      originalPlan,
      finalPlan: plan,
      decision,
      decisionMode,
      actor: { id: session.userId, name: session.name, role: session.role },
    } as const;
    const reviewEvent = buildAutopilotReviewEvent(reviewInput);
    reviewEvent.idempotency_key = requestIdempotencyKey;
    const claimed = await claimPlan({
      ticket,
      plan,
      brandId: session.brandId,
      decision,
      reviewEvent,
      actorId: session.userId,
      actorName: session.name,
      idempotencyKey: requestIdempotencyKey,
    });
    if (!claimed.claimed) return conflictResponse('PLAN_CHANGED', 'Plan changed before it could be dismissed.');
    return NextResponse.json({ plan, learning_captured: claimed.learningCaptured });
  }

  // ── approve & execute ──────────────────────────────────────────────────────
  type Override = { id: string; approved: boolean; reply_text?: string };
  if (!Array.isArray(body.actions)) {
    return NextResponse.json({ error: 'An explicit verdict is required for every action' }, { status: 400 });
  }
  const overrides = new Map<string, Override>();
  for (const override of body.actions as Override[]) {
    if (!override || typeof override.id !== 'string' || typeof override.approved !== 'boolean' || overrides.has(override.id)) {
      return NextResponse.json({ error: 'Each action must have one explicit approved verdict' }, { status: 400 });
    }
    overrides.set(override.id, override);
  }
  if (overrides.size !== plan.actions.length || plan.actions.some((action) => !overrides.has(action.id))) {
    return conflictResponse(
      'PLAN_ACTIONS_CHANGED',
      'The submitted actions do not match this plan. Refresh and try again.',
    );
  }
  if (!plan.actions.some((action) => overrides.get(action.id)?.approved)) {
    return NextResponse.json({ error: 'At least one action must be approved' }, { status: 400 });
  }
  for (const action of plan.actions.filter((candidate) => overrides.get(candidate.id)?.approved)) {
    const unapprovedDependencies = dependenciesFor(action, plan)
      .filter((dependencyId) => !overrides.get(dependencyId)?.approved);
    if (unapprovedDependencies.length) {
      const dependencyNames = unapprovedDependencies
        .map((dependencyId) => plan.actions.find((candidate) => candidate.id === dependencyId)?.title ?? dependencyId);
      return NextResponse.json({
        error: `"${action.title}" depends on unchecked action(s): ${dependencyNames.join(', ')}. Select them or uncheck the dependent action.`,
      }, { status: 400 });
    }
  }
  for (const action of plan.actions) {
    const override = overrides.get(action.id)!;
    if (action.type === 'send_reply' && override.approved && override.reply_text !== undefined && !override.reply_text.trim()) {
      return NextResponse.json({ error: 'The approved reply cannot be empty. Uncheck it or add reply text.' }, { status: 400 });
    }
    if (action.type === 'send_reply' && override.approved) {
      const finalReplyText = typeof override.reply_text === 'string'
        ? override.reply_text.trim()
        : String(action.params.reply_text ?? '').trim();
      const historicalOutcomes = Array.isArray(action.params.verified_historical_outcomes)
        ? action.params.verified_historical_outcomes.filter((value): value is string => typeof value === 'string')
        : [];
      const outcomeCheck = validateFinalReplyOutcomes({
        replyText: finalReplyText,
        actions: plan.actions,
        actionIsAvailable: (candidate) => overrides.get(candidate.id)?.approved === true,
        historicalOutcomes,
        historicalOutcomeEvidence: historicalOutcomeEvidenceFor(action),
        verifiedPendingRefundAmounts: verifiedPendingRefundAmountsFor(action),
      });
      if (!outcomeCheck.ok) {
        return NextResponse.json({ error: outcomeCheck.error }, { status: 400 });
      }
    }
  }

  let executionScopeKeys: string[];
  try {
    executionScopeKeys = deriveAutopilotExecutionScopeKeys({
      ticket,
      plan: {
        actions: plan.actions.map((action) => ({
          ...action,
          status: overrides.get(action.id)?.approved ? 'approved' : 'skipped',
        })),
      },
    });
  } catch (error) {
    const message = error instanceof ExecutionScopeDerivationError
      ? error.message
      : 'The execution scope could not be derived safely.';
    return conflictResponse(
      'INVALID_EXECUTION_SCOPE',
      `${message} Regenerate this plan before running it.`,
    );
  }

  let reviewLearningCaptured = true;
  if (resumingExecution) {
    // The idempotency key identifies the original human decision. A retry may
    // resume that exact decision, but it cannot silently change the approved
    // set or edited reply while the run is in flight.
    for (const action of plan.actions) {
      const override = overrides.get(action.id)!;
      const originallyApproved = action.status !== 'skipped';
      if (override.approved !== originallyApproved) {
        return NextResponse.json({ error: 'The retry does not match the executing plan decision.' }, { status: 409 });
      }
      if (action.type === 'send_reply' && override.approved && override.reply_text !== undefined
          && override.reply_text.trim() !== String(action.params.reply_text ?? '').trim()) {
        return NextResponse.json({ error: 'The retry reply text does not match the executing plan.' }, { status: 409 });
      }
    }
  } else {
    // Materialize the human decision before execution. This immutable review
    // episode is committed immediately, so the next draft can learn even while
    // this run is still carrying out side effects.
    for (const action of plan.actions) {
      const override = overrides.get(action.id)!;
      action.status = override.approved ? 'approved' : 'skipped';
      if (!override.approved) action.result = 'Skipped by reviewer';
      if (action.type === 'send_reply' && typeof override.reply_text === 'string'
          && override.reply_text.trim() !== String(action.params.reply_text ?? '').trim()) {
        action.params.original_reply_text = action.params.reply_text;
        action.params.reply_text = override.reply_text.trim();
        action.params.edited_by_reviewer = true;
      }
    }

    plan.status = 'executing';
    plan.execution_attempt_id = requestIdempotencyKey;
    plan.decided_at = now;
    plan.decided_by = deciderName;
    const reviewInput = {
      ticket: ticketForLearning,
      originalPlan,
      finalPlan: plan,
      decision,
      decisionMode,
      actor: { id: session.userId, name: session.name, role: session.role },
    } as const;
    const reviewEvent = buildAutopilotReviewEvent(reviewInput);
    reviewEvent.idempotency_key = requestIdempotencyKey;
    const claimed = await claimPlan({
      ticket,
      plan,
      brandId: session.brandId,
      decision,
      reviewEvent,
      actorId: session.userId,
      actorName: session.name,
      idempotencyKey: requestIdempotencyKey,
    });
    if (!claimed.claimed) return conflictResponse('PLAN_CHANGED', 'Plan changed before it could be approved.');
    reviewLearningCaptured = claimed.learningCaptured;
  }

  const { data: priorReceiptRows, error: priorReceiptError } = await supabase
    .from('autopilot_action_executions')
    .select('id, action_id, action_type, operation_key, status, context_before, expected_context_after, context_after, result, error, provider_reference, lease_expires_at, heartbeat_at, provider_deadline_at, failure_reconcile_after, started_at')
    .eq('plan_id', planId)
    .eq('execution_attempt_id', requestIdempotencyKey);
  if (priorReceiptError) {
    return NextResponse.json({
      error: 'Durable Autopilot execution receipts are unavailable. Apply migration 012 before running plans.',
      details: priorReceiptError.message,
    }, { status: 503 });
  }
  const receipts = new Map<string, ActionExecutionReceipt>(
    ((priorReceiptRows ?? []) as ActionExecutionReceipt[]).map((receipt) => [receipt.action_id, receipt]),
  );
  const shopifyMutationOrderIds = new Set(plan.actions.flatMap((candidate) => {
    const receipt = receipts.get(candidate.id);
    return isHighImpactAutopilotAction(candidate)
      && (receipt?.status === 'executed' || receipt?.status === 'uncertain')
      && typeof candidate.params.order_id === 'string'
      ? [candidate.params.order_id]
      : [];
  }));
  let executed = 0;
  let failed = 0;
  let executionInterrupted = false;
  let executionContextVersion = Number(plan.context_version ?? expectedContextVersion);
  for (const action of plan.actions) {
    const receipt = receipts.get(action.id);
    if (!receipt) continue;
    executionContextVersion = Math.max(executionContextVersion, Number(receipt.context_after ?? receipt.context_before));
    if (receipt.status === 'executed') {
      action.status = 'executed';
      action.result = receipt.result ?? 'Executed';
      executed++;
      if (receipt.context_after === null) {
        executionInterrupted = true;
        plan.execution_interrupted = true;
        plan.execution_interruption_reason = 'The reconciled action could not be bound to the current ticket context; remaining actions will not run.';
      }
    } else if (receipt.status === 'failed') {
      action.status = 'failed';
      action.result = receipt.error ?? receipt.result ?? 'Execution failed';
      failed++;
      if (receipt.context_after === null) {
        executionInterrupted = true;
        plan.execution_interrupted = true;
        plan.execution_interruption_reason = 'The reconciled failure could not be bound to the current ticket context; remaining actions will not run.';
      }
    } else if (receipt.status === 'uncertain') {
      action.status = 'failed';
      action.result = receipt.error ?? receipt.result ?? 'Provider outcome requires reconciliation';
      failed++;
      executionInterrupted = true;
      plan.execution_interrupted = true;
      plan.execution_interruption_reason = action.result;
    }
  }

  for (const action of actionsInExecutionOrder(plan)) {
    if (executionInterrupted) break;
    if (action.status === 'skipped' || action.status === 'executed' || action.status === 'failed') continue;
    const blocked = dependenciesFor(action, plan).filter((dependencyId) => {
      const dependency = plan.actions.find((candidate) => candidate.id === dependencyId);
      return !dependency || dependency.status !== 'executed';
    });
    if (blocked.length > 0) {
      action.status = 'skipped';
      action.result = `Blocked because prerequisite action(s) did not execute: ${blocked.join(', ')}`;
      continue;
    }

    const operationKey = `autopilot:${planId}:${requestIdempotencyKey}:${action.id}`;
    const contextBump = expectedContextBump(action, ticket);
    let reservation: ActionExecutionReservation | null = null;
    let scopesAcquired = false;
    try {
      reservation = await reserveActionExecution({
        ticketId: id,
        brandId: session.brandId,
        planId,
        executionAttemptId: requestIdempotencyKey,
        action,
        operationKey,
        contextBefore: executionContextVersion,
        expectedContextAfter: executionContextVersion + contextBump,
        workerToken: executionWorkerToken,
      });
      if (!reservation.canExecute) {
        if (reservation.inProgress) {
          const retryAfterSeconds = secondsUntil(reservation.receipt.lease_expires_at);
          return NextResponse.json({
            plan,
            in_progress: true,
            execution_attempt_id: requestIdempotencyKey,
            action_in_progress: {
              receipt_id: reservation.receipt.id,
              action_id: reservation.receipt.action_id,
              action_type: reservation.receipt.action_type,
              lease_expires_at: reservation.receipt.lease_expires_at,
            },
          }, {
            status: 202,
            headers: { 'Retry-After': String(retryAfterSeconds) },
          });
        }
        if (reservation.receipt.status === 'executed') {
          await releaseExecutionScopesAfterTerminal({
            receiptId: reservation.receipt.id,
            brandId: session.brandId,
            workerToken: executionWorkerToken,
          });
          action.status = 'executed';
          action.result = reservation.receipt.result ?? 'Executed';
          if (isHighImpactAutopilotAction(action) && typeof action.params.order_id === 'string') {
            shopifyMutationOrderIds.add(action.params.order_id);
          }
          executed++;
          executionContextVersion = Math.max(
            executionContextVersion,
            Number(reservation.receipt.context_after ?? reservation.receipt.context_before),
          );
          continue;
        }
        if (reservation.receipt.status === 'failed') {
          await releaseExecutionScopesAfterTerminal({
            receiptId: reservation.receipt.id,
            brandId: session.brandId,
            workerToken: executionWorkerToken,
          });
          action.status = 'failed';
          action.result = reservation.receipt.error ?? reservation.receipt.result ?? 'Execution failed';
          failed++;
          continue;
        }
        const uncertainty = reservation.receipt.error
          ?? 'The worker lease expired before its provider outcome was recorded; reconcile it before retrying.';
        action.status = 'failed';
        action.result = uncertainty;
        failed++;
        executionInterrupted = true;
        plan.execution_interrupted = true;
        plan.execution_interruption_reason = uncertainty;
        break;
      }

      await acquireExecutionScopes({
        receiptId: reservation.receipt.id,
        brandId: session.brandId,
        workerToken: executionWorkerToken,
        scopeKeys: executionScopeKeys,
      });
      scopesAcquired = true;

      const executionResult = await withActionLeaseHeartbeat(
        {
          receiptId: reservation.receipt.id,
          brandId: session.brandId,
          workerToken: executionWorkerToken,
          scopeKeys: executionScopeKeys,
        },
        async () => {
          const revalidateActionEvidence = async () => {
            if (!requiresImmediateActionEvidenceRevalidation(action)) return;
            // Orders already mutated by a completed/uncertain action in this
            // exact attempt are ignored by the snapshot comparison; every
            // mutation still performs its own live Shopify preflight.
            const customerHistoryCheck = await verifyCustomerHistoryPlanEvidence(
              plan,
              ticket as TicketRow,
              session.brandId,
              { allowExpired: true },
            );
            if (!customerHistoryCheck.ok) {
              throw new DefinitiveActionExecutionError(
                `Action stopped because its customer-history authorization is stale: ${customerHistoryCheck.error}`,
              );
            }
            const shopifyEvidenceCheck = await verifyShopifyPlanEvidence(
              plan,
              ticket as TicketRow,
              session.brandSlug,
              { allowExpired: true, ignoreOrderIds: shopifyMutationOrderIds },
            );
            if (!shopifyEvidenceCheck.ok) {
              throw new DefinitiveActionExecutionError(
                `Action stopped because its Shopify evidence is stale: ${shopifyEvidenceCheck.error}`,
              );
            }
          };
          if (beforeAutomaticAction) await beforeAutomaticAction();
          return executeAction(
            action,
            ticket,
            session,
            executionContextVersion,
            planId,
            plan,
            reservation!.receipt.id,
            executionWorkerToken,
            revalidateActionEvidence,
            <T>(operation: (signal: AbortSignal) => Promise<T>) => withProviderDeadline(
              {
                receiptId: reservation!.receipt.id,
                brandId: session.brandId,
                workerToken: executionWorkerToken,
                scopeKeys: executionScopeKeys,
              },
              async (signal) => { if (beforeAutomaticAction) await beforeAutomaticAction(); return operation(signal); },
            ),
          );
        },
      );
      const result = executionResult.summary;
      executionContextVersion += contextBump;
      await completeActionExecution({
        ticketId: id,
        brandId: session.brandId,
        planId,
        executionAttemptId: requestIdempotencyKey,
        actionId: action.id,
        operationKey,
        status: 'executed',
        contextAfter: executionContextVersion,
        result,
        error: null,
        providerReference: executionResult.providerReference,
        workerToken: executionWorkerToken,
      });
      await releaseExecutionScopesAfterTerminal({
        receiptId: reservation.receipt.id,
        brandId: session.brandId,
        workerToken: executionWorkerToken,
      });
      scopesAcquired = false;
      action.result = result;
      action.status = 'executed';
      if (isHighImpactAutopilotAction(action) && typeof action.params.order_id === 'string') {
        shopifyMutationOrderIds.add(action.params.order_id);
      }
      executed++;

      try {
        await assertExecutionContext(id, session.brandId, planId, executionContextVersion);
      } catch (contextError) {
        // The side effect and its receipt are already committed. Keep the
        // action successful, but stop before using stale context for the next
        // action.
        executionInterrupted = true;
        plan.execution_interrupted = true;
        plan.execution_interruption_reason = contextError instanceof Error
          ? contextError.message
          : 'Ticket context changed after an action completed';
        break;
      }
    } catch (err) {
      action.status = 'failed';
      action.result = err instanceof Error ? err.message : 'Execution failed';
      const definitiveFailure = err instanceof DefinitiveActionExecutionError;
      const scopeConflict = err instanceof ExecutionScopeConflictError;
      const providerReference = providerReferenceFromError(err);
      failed++;
      const observedContext = await currentExecutionContextVersion(id, session.brandId, planId);
      if (observedContext !== null) executionContextVersion = Math.max(executionContextVersion, observedContext);
      // A database-atomic action (notably related-ticket consolidation) may
      // have committed both its local effects and receipt before the client
      // lost the RPC response. Re-read the receipt before classifying that as
      // a failure; replaying the side effect is neither necessary nor safe.
      if (reservation?.receipt.id) {
        const { data: committedReceipt } = await supabase
          .from('autopilot_action_executions')
          .select('id, action_id, action_type, operation_key, status, context_before, expected_context_after, context_after, result, error, provider_reference, lease_expires_at, heartbeat_at, provider_deadline_at, failure_reconcile_after, started_at')
          .eq('id', reservation.receipt.id)
          .eq('brand_id', session.brandId)
          .maybeSingle();
        if (committedReceipt?.status === 'executed' && committedReceipt.context_after !== null) {
          await releaseExecutionScopesAfterTerminal({
            receiptId: reservation.receipt.id,
            brandId: session.brandId,
            workerToken: executionWorkerToken,
          });
          scopesAcquired = false;
          action.status = 'executed';
          action.result = committedReceipt.result ?? 'Executed';
          if (isHighImpactAutopilotAction(action) && typeof action.params.order_id === 'string') {
            shopifyMutationOrderIds.add(action.params.order_id);
          }
          failed--;
          executed++;
          executionContextVersion = Math.max(executionContextVersion, Number(committedReceipt.context_after));
          try {
            await assertExecutionContext(id, session.brandId, planId, executionContextVersion);
          } catch (contextError) {
            executionInterrupted = true;
            plan.execution_interrupted = true;
            plan.execution_interruption_reason = contextError instanceof Error
              ? contextError.message
              : 'Ticket context changed after an action completed';
          }
          if (executionInterrupted) break;
          continue;
        }
      }
      if (!reservation) {
        const { data: recoveredReceipt } = await supabase
          .from('autopilot_action_executions')
          .select('id, action_id, action_type, operation_key, status, context_before, expected_context_after, context_after, result, error, provider_reference, lease_expires_at, heartbeat_at, provider_deadline_at, failure_reconcile_after, started_at')
          .eq('brand_id', session.brandId)
          .eq('operation_key', operationKey)
          .maybeSingle();
        if (recoveredReceipt) {
          reservation = {
            canExecute: false,
            inProgress: recoveredReceipt.status === 'reserved'
              && Boolean(recoveredReceipt.lease_expires_at)
              && Date.parse(recoveredReceipt.lease_expires_at) > Date.now(),
            receipt: recoveredReceipt as ActionExecutionReceipt,
          };
        }
      }
      if (!reservation) {
        const contextStopped = /context changed|projection changed/i.test(action.result);
        if (contextStopped) {
          action.status = 'skipped';
          failed--;
          executionInterrupted = true;
          plan.execution_interrupted = true;
          plan.execution_interruption_reason = action.result;
          break;
        }
        return NextResponse.json({
          error: 'The action could not be reserved durably. No side effect was attempted; retry with the same operation key.',
          details: action.result,
          plan,
        }, { status: 503 });
      }
      if (reservation.inProgress) {
        return NextResponse.json({
          plan,
          in_progress: true,
          execution_attempt_id: requestIdempotencyKey,
          action_in_progress: {
            receipt_id: reservation.receipt.id,
            action_id: reservation.receipt.action_id,
            action_type: reservation.receipt.action_type,
            lease_expires_at: reservation.receipt.lease_expires_at,
          },
        }, {
          status: 202,
          headers: { 'Retry-After': String(secondsUntil(reservation.receipt.lease_expires_at)) },
        });
      }
      if (reservation) {
        const completionStatus = definitiveFailure
          ? 'failed'
          : reservation.receipt.status === 'reserved' ? 'uncertain' : 'failed';
        try {
          await completeActionExecution({
            ticketId: id,
            brandId: session.brandId,
            planId,
            executionAttemptId: requestIdempotencyKey,
            actionId: action.id,
            operationKey,
            status: completionStatus,
            contextAfter: executionContextVersion,
            result: null,
            error: action.result,
            providerReference,
            workerToken: executionWorkerToken,
          });
          if (completionStatus !== 'uncertain' && scopesAcquired) {
            await releaseExecutionScopesAfterTerminal({
              receiptId: reservation.receipt.id,
              brandId: session.brandId,
              workerToken: executionWorkerToken,
            });
            scopesAcquired = false;
          }
        } catch (receiptError) {
          console.error('[autopilot] failed to persist action failure receipt:', receiptError);
          return NextResponse.json({
            error: 'Action outcome could not be recorded safely. The run is paused for reconciliation.',
            plan,
          }, { status: 503 });
        }
        if (completionStatus === 'uncertain') {
          executionInterrupted = true;
          plan.execution_interrupted = true;
          plan.execution_interruption_reason = action.result;
          break;
        }
        if (scopeConflict) {
          executionInterrupted = true;
          plan.execution_interrupted = true;
          plan.execution_interruption_reason = action.result;
          break;
        }
      }
      console.error(`[autopilot] action ${action.type} failed on ticket ${ticket.ticket_number}:`, action.result);
    }
  }

  if (executionInterrupted) {
    for (const remaining of plan.actions) {
      if (remaining.status === 'approved') {
        remaining.status = 'skipped';
        remaining.result = `Skipped because execution was paused: ${plan.execution_interruption_reason ?? 'a prior action needs attention'}`;
      }
    }
  }

  const { data: unresolvedReceiptRows, error: unresolvedReceiptError } = await supabase
    .from('autopilot_action_executions')
    .select('id, action_id, action_type, operation_key, status, result, error, provider_reference, lease_expires_at, heartbeat_at, provider_deadline_at, failure_reconcile_after')
    .eq('plan_id', planId)
    .eq('execution_attempt_id', requestIdempotencyKey)
    .in('status', ['reserved', 'uncertain']);
  if (unresolvedReceiptError) {
    return NextResponse.json({
      error: 'The run paused, but its reconciliation state could not be loaded safely.',
      details: unresolvedReceiptError.message,
      plan,
      execution_attempt_id: requestIdempotencyKey,
    }, { status: 503 });
  }
  if ((unresolvedReceiptRows ?? []).length > 0) {
    // An ambiguous provider receipt is deliberately non-terminal. Do not ask
    // the terminal finalizer to accept it, and do not describe later actions
    // as finished. The exact operation key remains attached to the executing
    // plan so reconciliation can resume without repeating a side effect.
    plan.status = 'executing';
    return NextResponse.json({
      code: 'RECONCILIATION_REQUIRED',
      reconciliation_required: true,
      error: plan.execution_interruption_reason
        ?? 'A provider action is awaiting verification before the run can continue.',
      plan,
      execution_attempt_id: requestIdempotencyKey,
      uncertain_actions: unresolvedReceiptRows,
    }, {
      status: 202,
      headers: { 'Retry-After': '15' },
    });
  }

  plan.status = executionInterrupted && executed > 0
    ? 'partially_executed'
    : failed === 0 && executed > 0
    ? 'executed'
    : executed > 0
      ? 'partially_executed'
      : 'failed';
  plan.executed_at = new Date().toISOString();

  // Commit the terminal projection, ledger, audit event, and execution episode
  // together. A context bump supersedes this result instead of overwriting it.
  const finalized = await supabase.rpc('finalize_autopilot_plan_execution', {
    p_ticket_id: id,
    p_brand_id: session.brandId,
    p_plan_id: planId,
    p_expected_context_version: executionContextVersion,
    p_final_plan: plan,
    p_actor_id: session.userId ?? null,
  });
  if (finalized.error) {
    console.error('[autopilot] atomic execution finalization failed:', finalized.error.message);
    return NextResponse.json({
      error: 'Actions finished, but the durable plan finalizer did not commit. Retry with the same operation key.',
      details: finalized.error.message,
      plan,
      execution_attempt_id: requestIdempotencyKey,
    }, { status: 503 });
  }
  const finalization = (finalized.data ?? {}) as Record<string, unknown>;
  const stillCurrent = !finalized.error
    && finalization.finalized !== false
    && finalization.superseded !== true;
  return NextResponse.json({
    plan,
    learning_captured: reviewLearningCaptured,
    execution_learning_captured: finalization.learning_captured === true,
    superseded_during_execution: !stillCurrent,
  });
}

// ── action executors ─────────────────────────────────────────────────────────

interface PlanClaimResult {
  claimed: boolean;
  learningCaptured: boolean;
}

interface ActionExecutionReceipt {
  id: string;
  action_id: string;
  action_type: string;
  operation_key: string;
  status: 'reserved' | 'executed' | 'failed' | 'uncertain';
  context_before: number;
  expected_context_after: number;
  context_after: number | null;
  result: string | null;
  error: string | null;
  provider_reference?: string | null;
  lease_expires_at: string | null;
  heartbeat_at?: string | null;
  provider_deadline_at?: string | null;
  failure_reconcile_after?: string | null;
  started_at?: string;
}

interface ActionExecutionReservation {
  canExecute: boolean;
  inProgress: boolean;
  receipt: ActionExecutionReceipt;
}

async function reserveActionExecution(input: {
  ticketId: string;
  brandId: string;
  planId: string;
  executionAttemptId: string;
  action: AutopilotAction;
  operationKey: string;
  contextBefore: number;
  expectedContextAfter: number;
  workerToken: string;
}): Promise<ActionExecutionReservation> {
  const { data, error } = await supabase.rpc('reserve_autopilot_action_execution', {
    p_ticket_id: input.ticketId,
    p_brand_id: input.brandId,
    p_plan_id: input.planId,
    p_execution_attempt_id: input.executionAttemptId,
    p_action_id: input.action.id,
    p_action_type: input.action.type,
    p_operation_key: input.operationKey,
    p_context_before: input.contextBefore,
    p_expected_context_after: input.expectedContextAfter,
    p_worker_token: input.workerToken,
    p_lease_seconds: ACTION_LEASE_SECONDS,
  });
  if (error) throw new Error(`Could not reserve action safely: ${error.message}`);
  const payload = (data ?? {}) as Record<string, unknown>;
  const receipt = payload.receipt as ActionExecutionReceipt | undefined;
  if (!receipt?.id || !receipt.action_id) throw new Error('Action reservation returned an invalid receipt');
  return {
    canExecute: payload.can_execute === true,
    inProgress: payload.in_progress === true,
    receipt,
  };
}

async function acquireExecutionScopes(input: {
  receiptId: string;
  brandId: string;
  workerToken: string;
  scopeKeys: string[];
}): Promise<void> {
  const { data, error } = await supabase.rpc('acquire_autopilot_execution_scopes', {
    p_receipt_id: input.receiptId,
    p_brand_id: input.brandId,
    p_worker_token: input.workerToken,
    p_scope_keys: input.scopeKeys,
    p_lease_seconds: ACTION_LEASE_SECONDS,
  });
  if (error) {
    if (error.code === '40001') {
      throw new ExecutionLeaseLostError(
        `The action receipt or its execution scopes are fenced to another worker: ${error.message}`,
      );
    }
    throw new DefinitiveActionExecutionError(missingDatabaseFunction(error)
      ? `Database execution-scope locking is unavailable. Apply migration 016 before running plans: ${error.message}`
      : `Execution scopes could not be acquired before any side effect began: ${error.message}`);
  }
  const payload = (data ?? {}) as Record<string, unknown>;
  if (payload.acquired === true) return;
  const code = typeof payload.code === 'string' ? payload.code : 'SCOPE_LOCK_FAILED';
  if (code === 'RECEIPT_LEASE_EXPIRED' || code === 'RECEIPT_TERMINAL') {
    throw new ExecutionLeaseLostError(
      'The action receipt stopped being executable before its execution scopes were acquired.',
    );
  }
  const conflict = code === 'SCOPE_UNCERTAIN' || code === 'SCOPE_EXPIRED_UNRECONCILED'
    ? 'An overlapping customer, order, or ticket action has an unreconciled provider outcome.'
    : 'Another Autopilot run currently owns an overlapping customer, order, or ticket scope.';
  throw new ExecutionScopeConflictError(
    code,
    `${conflict} This action was stopped before any side effect began.`,
  );
}

async function heartbeatExecutionScopes(input: {
  receiptId: string;
  brandId: string;
  workerToken: string;
  scopeKeys: string[];
}): Promise<void> {
  const { data, error } = await supabase.rpc('heartbeat_autopilot_execution_scopes', {
    p_receipt_id: input.receiptId,
    p_brand_id: input.brandId,
    p_worker_token: input.workerToken,
    p_scope_keys: input.scopeKeys,
    p_lease_seconds: ACTION_LEASE_SECONDS,
  });
  if (error) throw new Error(`Could not renew execution-scope leases: ${error.message}`);
  const payload = (data ?? {}) as Record<string, unknown>;
  if (payload.renewed === true || payload.terminal === true) return;
  const code = typeof payload.code === 'string' ? payload.code : 'SCOPE_LEASE_LOST';
  throw new ExecutionLeaseLostError(
    `Execution-scope lease was lost (${code}); the action outcome requires reconciliation.`,
  );
}

async function releaseExecutionScopes(input: {
  receiptId: string;
  brandId: string;
  workerToken: string;
}): Promise<void> {
  const { data, error } = await supabase.rpc('release_autopilot_execution_scopes', {
    p_receipt_id: input.receiptId,
    p_brand_id: input.brandId,
    p_worker_token: input.workerToken,
  });
  if (error) throw new Error(`Could not release execution-scope leases: ${error.message}`);
  const payload = (data ?? {}) as Record<string, unknown>;
  if (payload.released !== true) {
    throw new Error(
      `Execution scopes remain fenced (${String(payload.code ?? 'receipt is not definitive')}).`,
    );
  }
}

async function releaseExecutionScopesAfterTerminal(input: {
  receiptId: string;
  brandId: string;
  workerToken: string;
}): Promise<void> {
  try {
    await releaseExecutionScopes(input);
  } catch (error) {
    // The receipt is already immutable and terminal. A stale lock cannot
    // permit duplication: acquisition may replace terminal-owner locks, and
    // otherwise this lease expires closed. Log cleanup failure without
    // rewriting a successful provider outcome as failed.
    console.warn(
      '[autopilot] terminal execution-scope cleanup warning:',
      error instanceof Error ? error.message : error,
    );
  }
}

async function heartbeatActionExecution(input: {
  receiptId: string;
  brandId: string;
  workerToken: string;
}): Promise<void> {
  const { data, error } = await supabase.rpc('heartbeat_autopilot_action_execution', {
    p_receipt_id: input.receiptId,
    p_brand_id: input.brandId,
    p_worker_token: input.workerToken,
    p_lease_seconds: ACTION_LEASE_SECONDS,
  });
  if (error) throw new Error(`Could not renew action lease: ${error.message}`);
  const payload = (data ?? {}) as Record<string, unknown>;
  if (payload.terminal === true) return;
  if (payload.renewed !== true) {
    throw new ExecutionLeaseLostError(payload.lease_expired === true
      ? 'Action worker lease expired; provider reconciliation is required.'
      : 'Action worker lease is no longer active.');
  }
}

async function heartbeatExecutionLeases(input: {
  receiptId: string;
  brandId: string;
  workerToken: string;
  scopeKeys: string[];
}): Promise<void> {
  await heartbeatActionExecution(input);
  await heartbeatExecutionScopes(input);
}

async function withActionLeaseHeartbeat<T>(
  input: { receiptId: string; brandId: string; workerToken: string; scopeKeys: string[] },
  execute: () => Promise<T>,
): Promise<T> {
  let stopped = false;
  let heartbeatInFlight: Promise<void> | null = null;
  let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  let consecutiveFailures = 0;
  let fatalHeartbeatError: ExecutionLeaseLostError | null = null;
  const schedule = (delayMs: number) => {
    if (stopped) return;
    if (heartbeatTimer) clearTimeout(heartbeatTimer);
    heartbeatTimer = setTimeout(pulse, delayMs);
  };
  const pulse = async () => {
    if (stopped || heartbeatInFlight) return;
    heartbeatInFlight = heartbeatExecutionLeases(input)
      .then(() => {
        consecutiveFailures = 0;
      })
      .catch((error: unknown) => {
        if (error instanceof ExecutionLeaseLostError) {
          fatalHeartbeatError = error;
          stopped = true;
          return;
        }
        consecutiveFailures += 1;
        const failure = error instanceof Error ? error : new Error('Action lease heartbeat failed');
        console.warn('[autopilot] action lease heartbeat warning; retrying:', failure.message);
      })
      .finally(() => {
        heartbeatInFlight = null;
        const retryDelay = consecutiveFailures > 0
          ? Math.min(
              ACTION_HEARTBEAT_INTERVAL_MS,
              ACTION_HEARTBEAT_RETRY_BASE_MS * 2 ** Math.min(consecutiveFailures - 1, 3),
            )
          : ACTION_HEARTBEAT_INTERVAL_MS;
        schedule(retryDelay);
      });
    await heartbeatInFlight;
  };
  schedule(ACTION_HEARTBEAT_INTERVAL_MS);
  try {
    const result = await execute();
    if (heartbeatInFlight) await heartbeatInFlight;
    if (fatalHeartbeatError) throw fatalHeartbeatError;
    return result;
  } finally {
    stopped = true;
    if (heartbeatTimer) clearTimeout(heartbeatTimer);
  }
}

async function beginActionProviderOperation(input: {
  receiptId: string;
  brandId: string;
  workerToken: string;
}): Promise<void> {
  const { data, error } = await supabase.rpc('begin_autopilot_action_provider_operation', {
    p_receipt_id: input.receiptId,
    p_brand_id: input.brandId,
    p_worker_token: input.workerToken,
    p_provider_timeout_seconds: Math.floor(ACTION_PROVIDER_TIMEOUT_MS / 1_000),
    p_lease_seconds: ACTION_LEASE_SECONDS,
  });
  if (error) throw new Error(`Could not fence provider operation: ${error.message}`);
  const payload = (data ?? {}) as Record<string, unknown>;
  if (payload.started !== true) {
    throw new Error(payload.lease_expired === true
      ? 'Action lease expired before the provider call; reconciliation is required.'
      : 'Action receipt is no longer available for a provider call.');
  }
}

async function withProviderDeadline<T>(
  input: {
    receiptId: string;
    brandId: string;
    workerToken: string;
    scopeKeys: string[];
  },
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  // Re-prove both the action lease and every cross-plan scope immediately
  // before opening a provider-side operation.
  await heartbeatExecutionLeases(input);
  await beginActionProviderOperation(input);
  const controller = new AbortController();
  const deadline = setTimeout(() => {
    controller.abort(new Error(`Provider operation exceeded ${ACTION_PROVIDER_TIMEOUT_MS / 1_000} seconds`));
  }, ACTION_PROVIDER_TIMEOUT_MS);
  try {
    const result = await operation(controller.signal);
    // Some provider SDKs normalize an aborted fetch into a fulfilled
    // `{ error }` result. The fence must still treat that outcome as
    // ambiguous instead of allowing the action receipt to commit success.
    if (controller.signal.aborted) {
      throw new Error(`Provider operation exceeded its ${ACTION_PROVIDER_TIMEOUT_MS / 1_000}-second deadline; outcome requires reconciliation.`);
    }
    return result;
  } catch (error) {
    if (controller.signal.aborted) {
      throw new ProviderOutcomePendingError(
        `Provider operation exceeded its ${ACTION_PROVIDER_TIMEOUT_MS / 1_000}-second deadline; outcome requires reconciliation.`,
        providerReferenceFromError(error),
      );
    }
    throw error;
  } finally {
    clearTimeout(deadline);
  }
}

function secondsUntil(isoTimestamp: string | null): number {
  const remaining = isoTimestamp ? Date.parse(isoTimestamp) - Date.now() : 1_000;
  return Math.max(1, Math.min(ACTION_LEASE_SECONDS, Math.ceil(remaining / 1_000)));
}

async function completeActionExecution(input: {
  ticketId: string;
  brandId: string;
  planId: string;
  executionAttemptId: string;
  actionId: string;
  operationKey: string;
  status: 'executed' | 'failed' | 'uncertain';
  contextAfter: number;
  result: string | null;
  error: string | null;
  providerReference?: string | null;
  workerToken: string;
}): Promise<void> {
  const { error } = await supabase.rpc('complete_autopilot_action_execution', {
    p_ticket_id: input.ticketId,
    p_brand_id: input.brandId,
    p_plan_id: input.planId,
    p_execution_attempt_id: input.executionAttemptId,
    p_action_id: input.actionId,
    p_operation_key: input.operationKey,
    p_status: input.status,
    p_context_after: input.contextAfter,
    p_result: input.result,
    p_error: input.error,
    p_provider_reference: input.providerReference ?? null,
    p_worker_token: input.workerToken,
  });
  if (error) throw new Error(`Could not persist action outcome: ${error.message}`);
}

async function currentExecutionContextVersion(
  ticketId: string,
  brandId: string,
  planId: string,
): Promise<number | null> {
  const { data, error } = await supabase
    .from('tickets')
    .select('context_version, metadata')
    .eq('id', ticketId)
    .eq('brand_id', brandId)
    .single();
  const currentPlan = ((data?.metadata as Record<string, unknown> | null)?.autopilot ?? null) as AutopilotPlan | null;
  return !error && data && currentPlan?.id === planId && currentPlan.status === 'executing'
    ? Number(data.context_version ?? 0)
    : null;
}

function missingDatabaseFunction(error: { code?: string; message?: string } | null): boolean {
  return Boolean(error && (
    error.code === 'PGRST202'
    || error.message?.includes('Could not find the function')
    || error.message?.includes('does not exist')
  ));
}

async function claimPlan(input: {
  ticket: { id: string; updated_at: string };
  plan: AutopilotPlan;
  brandId: string;
  decision: 'approve' | 'dismiss';
  reviewEvent: AutopilotReviewEventRecord;
  actorId?: string | null;
  actorName?: string | null;
  idempotencyKey: string;
}): Promise<PlanClaimResult> {
  const { data: result, error: rpcError } = await supabase.rpc('claim_autopilot_plan_decision', {
    p_ticket_id: input.ticket.id,
    p_brand_id: input.brandId,
    p_plan_id: input.plan.id,
    p_plan_revision: input.plan.revision ?? input.plan.revision_count ?? 0,
    p_expected_context_version: input.plan.context_version ?? 0,
    p_expected_context_fingerprint: input.plan.context_fingerprint ?? null,
    p_decision: input.decision,
    p_decided_plan: input.plan,
    p_learning_event: input.reviewEvent,
    p_actor_id: input.actorId ?? null,
    p_actor_name: input.actorName ?? 'admin',
    p_idempotency_key: input.idempotencyKey,
  });
  if (!rpcError) {
    const payload = (result ?? {}) as Record<string, unknown>;
    return {
      claimed: payload.claimed !== false && payload.success !== false,
      learningCaptured: payload.learning_captured !== false,
    };
  }
  console.error(
    missingDatabaseFunction(rpcError)
      ? '[autopilot] migration 012 is required for atomic plan decisions:'
      : '[autopilot] atomic plan decision failed:',
    rpcError.message,
  );
  return { claimed: false, learningCaptured: false };
}

function dependenciesFor(action: AutopilotAction, plan: AutopilotPlan): string[] {
  if (action.depends_on?.length) return action.depends_on;
  const mutations = plan.actions
    .filter((candidate) => ['cancel_order', 'refund_order', 'update_shipping_address'].includes(candidate.type))
    .map((candidate) => candidate.id);
  if (action.type === 'send_reply') return mutations;
  if (action.type === 'consolidate_related_tickets') {
    const reply = plan.actions.find((candidate) => candidate.type === 'send_reply');
    return [...mutations, ...(reply ? [reply.id] : [])];
  }
  if (action.type === 'resolve') {
    const reply = plan.actions.find((candidate) => candidate.type === 'send_reply');
    const consolidation = plan.actions.find((candidate) => candidate.type === 'consolidate_related_tickets');
    return [...mutations, ...(reply ? [reply.id] : []), ...(consolidation ? [consolidation.id] : [])];
  }
  return [];
}

function actionsInExecutionOrder(plan: AutopilotPlan): AutopilotAction[] {
  const rank: Partial<Record<AutopilotAction['type'], number>> = {
    cancel_order: 0,
    refund_order: 0,
    update_shipping_address: 0,
    send_reply: 1,
    set_priority: 2,
    add_tags: 2,
    close_not_support: 1,
    consolidate_related_tickets: 3,
    resolve: 4,
  };
  return [...plan.actions].sort((left, right) => (rank[left.type] ?? 1) - (rank[right.type] ?? 1));
}

async function verifyShopifyPlanEvidence(
  plan: AutopilotPlan,
  ticket: TicketRow,
  brandSlug?: string,
  options: { allowExpired?: boolean; ignoreOrderIds?: ReadonlySet<string> } = {},
): Promise<{ ok: true } | { ok: false; error: string; retryable: boolean }> {
  const orderMutations = plan.actions.some((action) => (
    action.type === 'cancel_order' || action.type === 'refund_order' || action.type === 'update_shipping_address'
  ));
  const requiresOrderEvidence = orderMutations || plan.actions.some((action) => action.type === 'send_reply');
  const evidence = plan.evidence?.shopify_orders;
  if (!ticket.customer_email) {
    return orderMutations
      ? { ok: false, error: 'This plan contains an order action but the ticket has no verified customer email.', retryable: false }
      : { ok: true };
  }
  if (!evidence) {
    return requiresOrderEvidence
      ? { ok: false, error: 'This reply/order plan predates live-evidence fencing. Regenerate it before approval.', retryable: false }
      : { ok: true };
  }
  if (evidence.projection_version !== SHOPIFY_SUPPORT_EVIDENCE_PROJECTION) {
    return {
      ok: false,
      error: 'This plan predates complete Shopify evidence fencing. Regenerate it before approval.',
      retryable: false,
    };
  }
  const validUntil = new Date(evidence.valid_until).getTime();
  if (!Number.isFinite(validUntil) || (validUntil <= Date.now() && !options.allowExpired)) {
    return {
      ok: false,
      error: 'This plan has expired. Regenerate it so Shopify, knowledge, and learning context are current.',
      retryable: false,
    };
  }
  try {
    const recordedOrderIds = evidence.order_hashes
      ? Object.keys(evidence.order_hashes).sort()
      : [];
    const [currentCustomer, exactOrderDetails, emailOrders] = await Promise.all([
      evidence.customer_present === true
        ? getCustomerByEmail(evidence.customer_lookup_email || ticket.customer_email, brandSlug)
        : Promise.resolve(null),
      recordedOrderIds.length > 0
        ? Promise.all(recordedOrderIds.map((orderId) => getOrderDetails(
            orderId,
            evidence.order_brand_slugs?.[orderId] ?? brandSlug,
          )))
        : Promise.resolve([]),
      recordedOrderIds.length === 0
        ? getCustomerOrders(ticket.customer_email, 5, brandSlug)
        : Promise.resolve([]),
    ]);
    const currentOrders = recordedOrderIds.length > 0
      ? exactOrderDetails.map(orderDetailToEvidenceSummary)
      : emailOrders;
    const ignoredOrderIds = options.ignoreOrderIds ?? new Set<string>();
    if (ignoredOrderIds.size > 0) {
      if (!evidence.order_hashes) {
        return {
          ok: false,
          error: 'This resumed plan predates per-order Shopify fencing. Regenerate it before sending.',
          retryable: false,
        };
      }
      const currentOrderHashes = shopifyOrderEvidenceHashes(currentOrders);
      const expectedUnmutated = Object.entries(evidence.order_hashes)
        .filter(([orderId]) => !ignoredOrderIds.has(orderId))
        .sort(([left], [right]) => left.localeCompare(right));
      const currentUnmutated = Object.entries(currentOrderHashes)
        .filter(([orderId]) => !ignoredOrderIds.has(orderId))
        .sort(([left], [right]) => left.localeCompare(right));
      if (JSON.stringify(currentUnmutated) !== JSON.stringify(expectedUnmutated)) {
        console.warn('[autopilot-evidence] unmutated exact Shopify order changed', {
          ticket_id: ticket.id,
          plan_id: plan.id ?? null,
          expected_order_ids: expectedUnmutated.map(([orderId]) => orderId),
          current_order_ids: currentUnmutated.map(([orderId]) => orderId),
        });
        return {
          ok: false,
          error: 'An unmutated Shopify order changed after this run started. Regenerate the reply before sending.',
          retryable: false,
        };
      }
      return { ok: true };
    }
    const currentHash = shopifySupportEvidenceHash(currentCustomer, currentOrders);
    if (currentHash !== evidence.hash || currentOrders.length !== evidence.order_count
        || (currentCustomer !== null) !== (evidence.customer_present === true)) {
      console.warn('[autopilot-evidence] exact Shopify evidence changed', {
        ticket_id: ticket.id,
        plan_id: plan.id ?? null,
        planned_hash: evidence.hash,
        current_hash: currentHash,
        planned_order_ids: Object.keys(evidence.order_hashes ?? {}).sort(),
        current_order_ids: currentOrders.map((order) => order.id).sort(),
        planned_customer_present: evidence.customer_present === true,
        current_customer_present: currentCustomer !== null,
      });
      return {
        ok: false,
        error: 'Shopify customer or order state changed after this plan was drafted. Regenerate the plan before approval.',
        retryable: false,
      };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: `Live Shopify evidence could not be revalidated: ${error instanceof Error ? error.message : 'unknown error'}`,
      retryable: true,
    };
  }
}

type CustomerSupportContextTicket = {
  id: string;
  ticket_number: number;
  subject: string;
  status: string;
  context_version: number;
};

type CustomerSupportContextPayload = {
  projection_version?: string;
  context_hash?: string;
  ticket_count?: number;
  ticket_message_count?: number;
  conversation_count?: number;
  chat_message_count?: number;
  tickets?: CustomerSupportContextTicket[];
};

function relatedTicketSnapshots(action: AutopilotAction): AutopilotRelatedTicketSnapshot[] | null {
  const snapshots = action.params.related_tickets;
  if (!Array.isArray(snapshots) || snapshots.length < 1 || snapshots.length > 25) return null;
  const seen = new Set<string>();
  const parsed: AutopilotRelatedTicketSnapshot[] = [];
  for (const value of snapshots) {
    if (!value || typeof value !== 'object') return null;
    const snapshot = value as Partial<AutopilotRelatedTicketSnapshot>;
    if (typeof snapshot.ticket_id !== 'string'
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(snapshot.ticket_id)
        || seen.has(snapshot.ticket_id)
        || !Number.isInteger(snapshot.ticket_number)
        || typeof snapshot.subject !== 'string'
        || !['open', 'pending'].includes(String(snapshot.status))
        || !Number.isInteger(snapshot.context_version)
        || !['unanswered', 'awaiting_us', 'awaiting_customer', 'no_customer_message'].includes(String(snapshot.response_state))
        || typeof snapshot.relation_reason !== 'string'
        || typeof snapshot.relation_confidence !== 'number'
        || !Number.isFinite(snapshot.relation_confidence)
        || snapshot.relation_confidence < 0
        || snapshot.relation_confidence > 1) {
      return null;
    }
    seen.add(snapshot.ticket_id);
    parsed.push(snapshot as AutopilotRelatedTicketSnapshot);
  }
  return parsed;
}

async function verifyCustomerHistoryPlanEvidence(
  plan: AutopilotPlan,
  ticket: TicketRow,
  brandId: string,
  options: { allowExpired?: boolean } = {},
): Promise<{ ok: true } | { ok: false; error: string; retryable: boolean }> {
  const consolidationActions = plan.actions.filter((action) => action.type === 'consolidate_related_tickets');
  if (consolidationActions.length > 1) {
    return { ok: false, error: 'This plan contains duplicate consolidation actions. Regenerate it before approval.', retryable: false };
  }
  if (consolidationActions.length > 0 && !plan.actions.some((action) => action.type === 'send_reply')) {
    return { ok: false, error: 'Related-ticket consolidation requires one primary reply. Regenerate the plan.', retryable: false };
  }
  const evidence = plan.evidence?.customer_history;
  const requiresCustomerHistory = requiresCustomerHistoryEvidence(
    plan,
    Boolean(ticket.customer_email),
  );
  if (!evidence) {
    return requiresCustomerHistory
      ? { ok: false, error: 'This reply/order/related-ticket plan has no customer-history evidence. Regenerate it before approval.', retryable: false }
      : { ok: true };
  }
  if (evidence.projection_version !== 'customer-support-context-v1') {
    return { ok: false, error: 'This plan uses an outdated customer-history projection. Regenerate it before approval.', retryable: false };
  }
  const validUntil = Date.parse(evidence.valid_until);
  if (!Number.isFinite(validUntil) || (validUntil <= Date.now() && !options.allowExpired)) {
    console.warn('[autopilot-evidence] customer history expired', {
      ticket_id: ticket.id,
      plan_id: plan.id ?? null,
      revision: plan.revision ?? plan.revision_count ?? 0,
      valid_until: evidence.valid_until,
    });
    return { ok: false, error: 'Customer history changed or expired. Regenerate the plan before approval.', retryable: false };
  }

  const { data, error } = await supabase.rpc('get_customer_support_context', {
    p_ticket_id: ticket.id,
    p_brand_id: brandId,
  });
  if (error || !data || typeof data !== 'object') {
    console.error('[autopilot-evidence] customer history unavailable', {
      ticket_id: ticket.id,
      plan_id: plan.id ?? null,
      revision: plan.revision ?? plan.revision_count ?? 0,
      error: error?.message ?? 'empty projection',
    });
    return {
      ok: false,
      error: `Customer history could not be revalidated${error?.message ? `: ${error.message}` : ''}. Apply migration 013 before approval.`,
      retryable: true,
    };
  }
  const current = data as CustomerSupportContextPayload;
  if (current.projection_version !== evidence.projection_version
      || current.context_hash !== evidence.hash
      || Number(current.ticket_count ?? -1) !== evidence.ticket_count
      || Number(current.ticket_message_count ?? -1) !== evidence.ticket_message_count
      || Number(current.conversation_count ?? -1) !== evidence.conversation_count
      || Number(current.chat_message_count ?? -1) !== evidence.chat_message_count) {
    console.warn('[autopilot-evidence] customer history changed', {
      ticket_id: ticket.id,
      plan_id: plan.id ?? null,
      revision: plan.revision ?? plan.revision_count ?? 0,
      planned: {
        hash: evidence.hash,
        ticket_count: evidence.ticket_count,
        ticket_message_count: evidence.ticket_message_count,
        conversation_count: evidence.conversation_count,
        chat_message_count: evidence.chat_message_count,
      },
      current: {
        hash: current.context_hash ?? null,
        ticket_count: Number(current.ticket_count ?? -1),
        ticket_message_count: Number(current.ticket_message_count ?? -1),
        conversation_count: Number(current.conversation_count ?? -1),
        chat_message_count: Number(current.chat_message_count ?? -1),
      },
    });
    return { ok: false, error: 'Another customer thread or message changed after this plan was drafted. Regenerate it before approval.', retryable: false };
  }

  const currentTickets = new Map((current.tickets ?? []).map((item) => [item.id, item]));
  for (const action of consolidationActions) {
    const snapshots = relatedTicketSnapshots(action);
    if (!snapshots || snapshots.some((snapshot) => snapshot.ticket_id === ticket.id)) {
      return { ok: false, error: 'The related-ticket action has invalid trusted snapshots. Regenerate it before approval.', retryable: false };
    }
    for (const snapshot of snapshots) {
      const live = currentTickets.get(snapshot.ticket_id);
      if (!live
          || Number(live.ticket_number) !== snapshot.ticket_number
          || live.subject !== snapshot.subject
          || live.status !== snapshot.status
          || Number(live.context_version) !== snapshot.context_version) {
        return { ok: false, error: `Related ticket #${snapshot.ticket_number} changed after drafting. Regenerate the plan.`, retryable: false };
      }
    }
  }
  return { ok: true };
}

function assertOrderBelongsToTicket(
  order: Awaited<ReturnType<typeof getOrderDetails>>,
  ticket: TicketRow,
  action: AutopilotAction,
): void {
  const identityMatch = matchOrderCustomerIdentity({
    ticketEmail: ticket.customer_email,
    ticketPhone: ticket.customer_phone,
    ticketName: ticket.customer_name,
    orderEmail: order.email,
    orderPhone: order.phone,
    shippingPhone: order.shippingAddress?.phone,
    shippingName: order.shippingAddress?.name,
    shippingFirstName: order.shippingAddress?.firstName,
    shippingLastName: order.shippingAddress?.lastName,
  });
  if (!identityMatch && !plannedOrderIdentityBindingMatches(action.params, order.id)) {
    throw new DefinitiveActionExecutionError(`Order ${order.name} could not be verified as belonging to this ticket's customer`);
  }
}

function expectedOutstandingCancellationRefund(
  totalPrice: string,
  totalRefundedBefore: string,
  transactions: Array<{ kind: string; status: string; amount: string }>,
): number | null {
  const alreadyRefunded = Number.parseFloat(totalRefundedBefore || '0');
  if (!Number.isFinite(alreadyRefunded)) return null;
  const captured = transactions
    .filter((transaction) => (
      (transaction.kind === 'SALE' || transaction.kind === 'CAPTURE')
      && transaction.status === 'SUCCESS'
    ))
    .reduce((sum, transaction) => sum + Number.parseFloat(transaction.amount || '0'), 0);
  if (Number.isFinite(captured) && captured > 0) return Math.max(0, captured - alreadyRefunded);
  const total = Number.parseFloat(totalPrice);
  return Number.isFinite(total) ? Math.max(0, total - alreadyRefunded) : null;
}

async function assertExecutionContext(
  ticketId: string,
  brandId: string,
  planId: string,
  expectedContextVersion: number,
): Promise<void> {
  const { data, error } = await supabase
    .from('tickets')
    .select('context_version, metadata')
    .eq('id', ticketId)
    .eq('brand_id', brandId)
    .single();
  const currentPlan = ((data?.metadata as Record<string, unknown> | null)?.autopilot ?? null) as AutopilotPlan | null;
  if (error || !data || Number(data.context_version ?? 0) !== expectedContextVersion
      || currentPlan?.id !== planId || currentPlan.status !== 'executing') {
    // This fence is checked before every external mutation. If it fails, the
    // provider call has not started, so the durable receipt can safely record
    // a definitive failure instead of an ambiguous provider outcome.
    throw new DefinitiveActionExecutionError(
      'Ticket context changed while this plan was executing; remaining actions were stopped',
    );
  }
}

function expectedContextBump(action: AutopilotAction, ticket: TicketRow): number {
  switch (action.type) {
    case 'send_reply':
      return 1; // non-internal ticket message insert
    case 'consolidate_related_tickets':
      return 1; // one context-relevant internal consolidation note
    case 'close_not_support':
      return ticket.status === 'closed' ? 0 : 1;
    case 'resolve':
      return ticket.status === 'resolved' ? 0 : 1;
    case 'set_priority':
      return String(ticket.priority ?? '') === String(action.params.priority ?? '') ? 0 : 1;
    case 'add_tags': {
      const incoming = Array.isArray(action.params.tags) ? action.params.tags.filter((tag): tag is string => typeof tag === 'string') : [];
      const merged = [...new Set([...(ticket.tags ?? []), ...incoming])];
      const tagsChanged = JSON.stringify(merged) !== JSON.stringify(ticket.tags ?? []);
      const statusChanged = incoming.includes('awaiting-customer') && ticket.status === 'open';
      return tagsChanged || statusChanged ? 1 : 0;
    }
    case 'escalate_human':
      return (ticket.tags ?? []).includes('needs-human') ? 0 : 1;
    default:
      return 0;
  }
}

type SessionInfo = NonNullable<Awaited<ReturnType<typeof getSession>>>;
type TicketRow = Record<string, unknown> & {
  id: string; ticket_number: number; subject: string; status: string; source: string;
  priority: string;
  customer_email: string | null; customer_name: string | null; customer_phone: string | null; first_response_at: string | null;
  tags: string[] | null; metadata: Record<string, unknown> | null;
};

async function updateTicketWithContext(
  ticket: TicketRow,
  brandId: string,
  expectedContextVersion: number,
  updates: Record<string, unknown>,
): Promise<void> {
  const { data, error } = await supabase
    .from('tickets')
    .update(updates)
    .eq('id', ticket.id)
    .eq('brand_id', brandId)
    .eq('context_version', expectedContextVersion)
    .select('id')
    .maybeSingle();
  if (error || !data) {
    throw new Error(error?.message || 'Ticket changed before this action could be committed');
  }
}

async function executeAction(
  action: AutopilotAction,
  ticket: TicketRow,
  session: SessionInfo,
  expectedContextVersion: number,
  planId: string,
  plan: AutopilotPlan,
  executionReceiptId: string,
  executionWorkerToken: string,
  revalidateActionEvidence: () => Promise<void>,
  runProvider: <T>(operation: (signal: AbortSignal) => Promise<T>) => Promise<T>,
): Promise<{ summary: string; providerReference?: string }> {
  const now = new Date().toISOString();
  const runReadOnlyPreflight = async <T>(
    operation: (signal: AbortSignal) => Promise<T>,
    label: string,
  ): Promise<T> => {
    try {
      return await runProvider(operation);
    } catch (error) {
      throw new DefinitiveActionExecutionError(
        `${label} failed before any mutation was attempted: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  };

  switch (action.type) {
    case 'close_not_support': {
      const oldStatus = ticket.status;
      await updateTicketWithContext(ticket, session.brandId, expectedContextVersion, {
        status: 'closed', closed_at: now, updated_at: now,
      });
      await supabase.from('ticket_events').insert({
        ticket_id: ticket.id, event_type: 'status_changed', actor: 'ai',
        old_value: oldStatus, new_value: 'closed',
        metadata: {
          via: 'autopilot', plan_id: planId, action_id: action.id,
          action_execution_id: executionReceiptId,
        },
      });
      ticket.status = 'closed';
      return { summary: 'Ticket closed (no reply sent)' };
    }

    case 'send_reply': {
      const replyText = String(action.params.reply_text ?? '').trim();
      if (!replyText) throw new Error('Empty reply text');
      if (!ticket.customer_email) throw new Error('Ticket has no customer email');
      const historicalOutcomes = Array.isArray(action.params.verified_historical_outcomes)
        ? action.params.verified_historical_outcomes.filter((value): value is string => typeof value === 'string')
        : [];
      const outcomeCheck = validateFinalReplyOutcomes({
        replyText,
        actions: plan.actions,
        actionIsAvailable: (candidate) => candidate.status === 'executed',
        historicalOutcomes,
        historicalOutcomeEvidence: historicalOutcomeEvidenceFor(action),
        verifiedPendingRefundAmounts: verifiedPendingRefundAmountsFor(action),
      });
      if (!outcomeCheck.ok) throw new DefinitiveActionExecutionError(outcomeCheck.error);
      const customerEmail = ticket.customer_email;
      // Re-check same-customer history and every unmutated Shopify order
      // immediately before the outbound message is reserved. Reserving the
      // message advances the plan's own history projection, so this is the
      // final valid fence before the idempotent provider send.
      await revalidateActionEvidence();

      const messageInput = {
        id: executionReceiptId,
        ticket_id: ticket.id,
        sender_type: 'agent',
        sender_name: session.name || 'Autopilot',
        sender_email: session.email ?? null,
        content: replyText,
        is_internal_note: false,
        ai_generated: true,
        attachments: [],
        metadata: {
          via: 'autopilot', plan_id: planId, action_id: action.id,
          action_execution_id: executionReceiptId,
          email_status: 'reserved',
          ...(action.params.support_retention_offer ? { support_retention_offer: action.params.support_retention_offer } : {}),
        },
      };
      const prepared = await supabase.rpc('prepare_autopilot_reply', {
        p_ticket_id: ticket.id,
        p_brand_id: session.brandId,
        p_plan_id: planId,
        p_expected_context_version: expectedContextVersion,
        p_message: messageInput,
      });
      let message: Record<string, unknown> | null = null;
      if (!prepared.error) {
        const payload = (prepared.data ?? {}) as Record<string, unknown>;
        message = (payload.message && typeof payload.message === 'object'
          ? payload.message
          : messageInput) as Record<string, unknown>;
      } else {
        throw new Error(`Failed to reserve reply atomically: ${prepared.error.message}`);
      }
      if (!message) throw new Error('Failed to reserve reply');
      const reservedMessageMetadata = (message.metadata ?? {}) as Record<string, unknown>;

      const { data: customerMsgs } = await supabase
        .from('ticket_messages')
        .select('content, email_message_id, metadata')
        .eq('ticket_id', ticket.id)
        .eq('sender_type', 'customer')
        .order('created_at', { ascending: false })
        .limit(1);
      const latest = customerMsgs?.[0];

      await assertExecutionContext(ticket.id, session.brandId, planId, expectedContextVersion + 1);
      const result = await runProvider((signal) => sendTicketReplyEmail({
        to: customerEmail,
        customerName: ticket.customer_name || undefined,
        ticketNumber: ticket.ticket_number,
        subject: ticket.subject,
        replyContent: replyText,
        brandName: session.brandName,
        brandSlug: session.brandSlug,
        inReplyToMessageId:
          latest?.email_message_id ||
          ((latest?.metadata as Record<string, unknown>)?.email_message_id as string) ||
          undefined,
        originalMessage: latest?.content?.slice(0, 1000) || undefined,
        idempotencyKey: `ticket-message-${String(message.id)}`,
        signal,
      }));

      if (result.error) {
        const { error: failedMarkerError } = await supabase.from('ticket_messages')
          .update({ metadata: { ...reservedMessageMetadata, email_status: 'failed', email_error: result.error } })
          .eq('id', String(message.id))
          .eq('ticket_id', ticket.id);
        throw new DefinitiveActionExecutionError(
          `Email send failed: ${result.error}${failedMarkerError ? `; failed delivery marker could not be saved: ${failedMarkerError.message}` : ''}`,
        );
      }
      const { data: sentMessage, error: sentMarkerError } = await supabase.from('ticket_messages')
        .update({ email_message_id: result.messageId, metadata: { ...reservedMessageMetadata, email_status: 'sent' } })
        .eq('id', String(message.id))
        .eq('ticket_id', ticket.id)
        .select('id')
        .maybeSingle();
      if (sentMarkerError || !sentMessage) {
        throw new ProviderOutcomePendingError(
          `Email provider accepted the reply, but local delivery confirmation could not be saved: ${sentMarkerError?.message || 'message row changed'}`,
          result.messageId,
        );
      }
      if (!ticket.first_response_at) {
        const firstResponseAt = new Date().toISOString();
        const { data: firstResponseTicket } = await supabase
          .from('tickets')
          .update({ first_response_at: firstResponseAt, updated_at: firstResponseAt })
          .eq('id', ticket.id)
          .eq('brand_id', session.brandId)
          .is('first_response_at', null)
          .select('id')
          .maybeSingle();
        if (firstResponseTicket) ticket.first_response_at = firstResponseAt;
      }
      return { summary: `Reply emailed to ${customerEmail}`, providerReference: result.messageId };
    }

    case 'resolve': {
      const oldStatus = ticket.status;
      await updateTicketWithContext(ticket, session.brandId, expectedContextVersion, {
        status: 'resolved', resolved_at: now, updated_at: now,
      });
      await supabase.from('ticket_events').insert({
        ticket_id: ticket.id, event_type: 'status_changed', actor: 'ai',
        old_value: oldStatus, new_value: 'resolved',
        metadata: {
          via: 'autopilot', plan_id: planId, action_id: action.id,
          action_execution_id: executionReceiptId,
        },
      });
      ticket.status = 'resolved';
      const { data: fresh } = await supabase.from('tickets').select('*').eq('id', ticket.id).single();
      if (fresh) {
        // CSAT has its own durable, idempotent request/outbox lineage. Keep
        // that optional delivery separate from the ticket-resolution receipt
        // so a survey-provider outage cannot make an already committed
        // resolution look ambiguous (or vice versa).
        await maybeSendCsatRequest(fresh, session, { signal: AbortSignal.timeout(30_000) });
      }
      return { summary: 'Ticket resolved' };
    }

    case 'set_priority': {
      const priority = String(action.params.priority);
      const oldPriority = String(ticket.priority ?? '');
      await updateTicketWithContext(
        ticket,
        session.brandId,
        expectedContextVersion,
        { priority, updated_at: now },
      );
      await supabase.from('ticket_events').insert({
        ticket_id: ticket.id, event_type: 'priority_changed', actor: 'ai',
        old_value: oldPriority, new_value: priority,
        metadata: {
          via: 'autopilot', plan_id: planId, action_id: action.id,
          action_execution_id: executionReceiptId,
        },
      });
      ticket.priority = priority;
      return { summary: `Priority set to ${priority}` };
    }

    case 'add_tags': {
      const newTags = (action.params.tags as string[]).filter((t) => typeof t === 'string');
      const merged = [...new Set([...(ticket.tags ?? []), ...newTags])];
      const updates: Record<string, unknown> = { tags: merged, updated_at: now };
      // 'awaiting-customer' means exactly what status=pending means: parked
      // until the customer replies. Move it out of the Open queue; an inbound
      // reply flips it back to open automatically.
      const parking = newTags.includes('awaiting-customer') && ticket.status === 'open';
      if (parking) updates.status = 'pending';
      await updateTicketWithContext(ticket, session.brandId, expectedContextVersion, updates);
      ticket.tags = merged;
      if (parking) ticket.status = 'pending';
      await supabase.from('ticket_events').insert({
        ticket_id: ticket.id,
        event_type: 'tags_added',
        actor: 'ai',
        new_value: newTags.join(', '),
        metadata: {
          via: 'autopilot', plan_id: planId, action_id: action.id,
          action_execution_id: executionReceiptId, tags: newTags,
        },
      });
      if (parking) {
        await supabase.from('ticket_events').insert({
          ticket_id: ticket.id, event_type: 'status_changed', actor: 'ai',
          old_value: 'open', new_value: 'pending',
          metadata: {
            via: 'autopilot', reason: 'awaiting-customer', plan_id: planId,
            action_id: action.id, action_execution_id: executionReceiptId,
          },
        });
        return { summary: 'Parked as pending — awaiting customer reply' };
      }
      return { summary: `Tags added: ${newTags.join(', ')}` };
    }

    case 'cancel_order': {
      const orderId = String(action.params.order_id);
      // Re-validate against live Shopify state — the plan may be hours old.
      let detail = await runReadOnlyPreflight(
        (signal) => getOrderDetails(orderId, session.brandSlug, signal),
        'Live cancellation preflight',
      );
      assertOrderBelongsToTicket(detail, ticket, action);
      if (detail.cancelledAt) throw new DefinitiveActionExecutionError(`Order ${detail.name} is already cancelled`);
      const refundExpected = action.params.refund_expected === true;
      const refundedBefore = Number.parseFloat(detail.totalRefunded || '0');
      const expectedRefundAmount = expectedOutstandingCancellationRefund(
        detail.totalPrice,
        detail.totalRefunded,
        detail.transactions,
      );
      const refundTransactionIdsBefore = new Set(
        detail.transactions
          .filter((transaction) => transaction.kind.toUpperCase() === 'REFUND')
          .map((transaction) => transaction.id),
      );
      await revalidateActionEvidence();
      await assertExecutionContext(ticket.id, session.brandId, planId, expectedContextVersion);

      // Shopify refuses orderCancel while an outstanding fulfillment remains.
      // Ghost fulfillments created by the former partner commonly have no
      // tracking. Cancel those fulfillments first, verify the live order again,
      // and only then perform the irreversible whole-order cancellation. This
      // remains idempotent: a retry reloads status and skips already-cancelled
      // fulfillment IDs.
      const cancellableGhostFulfillments = detail.fulfillments.filter((fulfillment) => (
        fulfillment.trackingInfo.length === 0
        && !['CANCELLED', 'FAILURE', 'ERROR'].includes(String(fulfillment.status).toUpperCase())
      ));
      let clearedFulfillmentCount = 0;
      for (const fulfillment of cancellableGhostFulfillments) {
        const fulfillmentResult = await runProvider((signal) => cancelFulfillment(
          fulfillment.id,
          session.brandSlug,
          signal,
        ));
        if (!fulfillmentResult.success) {
          throw new DefinitiveActionExecutionError(
            `Could not cancel outstanding fulfillment before cancelling ${detail.name}: ${fulfillmentResult.message}`,
          );
        }
        clearedFulfillmentCount += 1;
      }
      if (cancellableGhostFulfillments.length > 0) {
        detail = await runReadOnlyPreflight(
          (signal) => getOrderDetails(orderId, session.brandSlug, signal),
          'Post-fulfillment cancellation preflight',
        );
        assertOrderBelongsToTicket(detail, ticket, action);
        if (detail.cancelledAt) {
          throw new ProviderOutcomePendingError(
            `Shopify shows ${detail.name} cancelled after clearing its outstanding fulfillment; reconciliation is required before any retry.`,
          );
        }
      }
      const hasLiveTracking = detail.fulfillments.some((fulfillment) => fulfillment.trackingInfo.length > 0);
      const restock = String(detail.fulfillmentStatus).toUpperCase() === 'UNFULFILLED' && !hasLiveTracking;
      const res = await runProvider((signal) => cancelOrder(
        orderId,
        String(action.params.reason || 'CUSTOMER'),
        true,
        restock,
        session.brandSlug,
        signal,
      ));
      if (!res.success) throw new DefinitiveActionExecutionError(res.message);

      let confirmed: Awaited<ReturnType<typeof getOrderDetails>>;
      try {
        const confirmation = await runProvider((signal) => pollProviderPostcondition({
          load: (pollSignal) => getOrderDetails(orderId, session.brandSlug, pollSignal),
          isSatisfied: (candidate) => {
            if (!candidate.cancelledAt) return false;
            if (!refundExpected) return true;
            return cancellationRefundWasSubmitted({
              financialStatus: String(candidate.financialStatus || '').toUpperCase(),
              refundedBefore,
              refundedAfter: Number.parseFloat(candidate.totalRefunded || '0'),
              expectedOutstanding: expectedRefundAmount,
              transactions: candidate.transactions,
              refundTransactionIdsBefore,
            });
          },
          signal,
          timeoutMs: CANCELLATION_POSTCONDITION_MAX_WAIT_MS,
          intervalMs: CANCELLATION_POSTCONDITION_POLL_INTERVAL_MS,
        }));
        confirmed = confirmation.value;
      } catch {
        throw new ProviderOutcomePendingError(
          `Shopify accepted cancellation for ${detail.name}, but live confirmation could not be loaded; reconciliation is required.`,
          res.jobId,
        );
      }
      try {
        assertOrderBelongsToTicket(confirmed, ticket, action);
      } catch {
        throw new ProviderOutcomePendingError(
          `Shopify accepted cancellation for ${detail.name}, but the confirmation identity could not be safely bound back to this ticket; reconciliation is required.`,
          res.jobId,
        );
      }
      if (!confirmed.cancelledAt) {
        throw new ProviderOutcomePendingError(
          !res.completed
            ? `Shopify accepted cancellation for ${detail.name}, but the job is still processing; reconciliation is required.`
            : `Shopify's cancellation job completed for ${detail.name}, but cancelledAt is not visible yet; reconciliation is required.`,
          res.jobId,
        );
      }
      const refundedAfter = Number.parseFloat(confirmed.totalRefunded || '0');
      const refundState = String(confirmed.financialStatus || '').toUpperCase();
      const refundVerified = !refundExpected
        || cancellationRefundWasSubmitted({
          financialStatus: refundState,
          refundedBefore,
          refundedAfter,
          expectedOutstanding: expectedRefundAmount,
          transactions: confirmed.transactions,
          refundTransactionIdsBefore,
        });
      if (!refundVerified) {
        throw new ProviderOutcomePendingError(
          `Shopify cancelled ${detail.name}, but no full-value refund submission is visible in live financial state yet; reconciliation is required.`,
          res.jobId,
        );
      }
      action.params.refund_verified = refundExpected;
      action.params.refund_submitted = refundExpected;
      const { error: cancellationEventError } = await supabase.from('ticket_events').insert({
        ticket_id: ticket.id, event_type: 'order_cancelled', actor: 'ai', actor_id: session.userId ?? null,
        new_value: confirmed.name,
        metadata: {
          via: 'autopilot', order_id: orderId, plan_id: planId,
          action_id: action.id, action_execution_id: executionReceiptId,
          provider_job_id: res.jobId ?? null,
          restocked: restock,
          tracking_present_before_cancel: hasLiveTracking,
          outstanding_fulfillments_cancelled: clearedFulfillmentCount,
          refund_expected: refundExpected,
          refund_verified: refundVerified,
          refund_submission_status: refundExpected ? 'submitted' : 'not_required',
          refunded_before: Number.isFinite(refundedBefore) ? refundedBefore : null,
          refunded_after: Number.isFinite(refundedAfter) ? refundedAfter : null,
          expected_refund_amount: expectedRefundAmount,
          cancelled_at: confirmed.cancelledAt,
        },
      });
      if (cancellationEventError) {
        throw new ProviderOutcomePendingError(
          `Shopify cancelled ${detail.name}, but the local cancellation audit event could not be saved: ${cancellationEventError.message}. Reconciliation is required.`,
          res.jobId,
        );
      }
      return {
        summary: `Order ${confirmed.name} cancelled (${clearedFulfillmentCount > 0 ? `${clearedFulfillmentCount} outstanding fulfillment${clearedFulfillmentCount === 1 ? '' : 's'} cancelled first; ` : ''}${refundExpected ? 'refund submitted to the original payment method' : 'no captured payment to refund'}; ${restock ? 'restock requested' : 'no automatic restock'})`,
        providerReference: res.jobId,
      };
    }

    case 'refund_order': {
      const orderId = String(action.params.order_id);
      const amount = Number(action.params.amount);
      const detail = await runReadOnlyPreflight(
        (signal) => getOrderDetails(orderId, session.brandSlug, signal),
        'Live refund preflight',
      );
      assertOrderBelongsToTicket(detail, ticket, action);
      const refundable = parseFloat(detail.totalPrice) - parseFloat(detail.totalRefunded || '0');
      if (action.params.retention_refund) {
        if (!retentionDeliveryAllowed(session.brandSlug, detail.shippingAddress)) throw new DefinitiveActionExecutionError('The keep-order offer requires a supported shipping address. Warm by Design does not ship to Hawaii.');
        const remainingRetention = retentionRefundAmount(shopifyMoneyAmount(detail.totalPrice), shopifyMoneyAmount(detail.totalRefunded || '0'));
        if (remainingRetention === null || Math.abs(amount - remainingRetention) >= 0.005) throw new DefinitiveActionExecutionError('The proposed retention refund no longer matches the remaining 30% total concession. Review prior refunds.');
      }
      if (!Number.isFinite(amount) || amount <= 0) throw new DefinitiveActionExecutionError('Invalid refund amount');
      if (amount > refundable + 0.01) throw new DefinitiveActionExecutionError(`Refund $${amount} exceeds refundable $${refundable.toFixed(2)} on ${detail.name}`);
      await revalidateActionEvidence();
      await assertExecutionContext(ticket.id, session.brandId, planId, expectedContextVersion);
      const res = await runProvider((signal) => refundOrder(
        orderId,
        amount,
        `Autopilot operation ${executionReceiptId}: customer requested refund`,
        true,
        session.brandSlug,
        signal,
        executionReceiptId,
      ));
      if (!res.success) throw new DefinitiveActionExecutionError(res.message);
      const { error: refundEventError } = await supabase.from('ticket_events').insert({
        ticket_id: ticket.id, event_type: 'order_refunded', actor: 'ai', actor_id: session.userId ?? null,
        new_value: `${detail.name}: $${amount.toFixed(2)}`,
        metadata: {
          via: 'autopilot', order_id: orderId, plan_id: planId,
          action_id: action.id, action_execution_id: executionReceiptId,
        },
      });
      if (refundEventError) {
        throw new ProviderOutcomePendingError(
          `Shopify created refund ${res.refundId ?? ''} for ${detail.name}, but the local audit event could not be saved: ${refundEventError.message}. Reconciliation is required.`,
          res.refundId,
        );
      }
      return {
        summary: `Refunded $${amount.toFixed(2)} on ${detail.name}`,
        providerReference: res.refundId,
      };
    }

    case 'update_shipping_address': {
      const orderId = String(action.params.order_id);
      const detail = await runReadOnlyPreflight(
        (signal) => getOrderDetails(orderId, session.brandSlug, signal),
        'Live address-update preflight',
      );
      assertOrderBelongsToTicket(detail, ticket, action);
      if (detail.cancelledAt) throw new DefinitiveActionExecutionError(`Order ${detail.name} is cancelled`);
      if (detail.fulfillmentStatus !== 'UNFULFILLED') throw new DefinitiveActionExecutionError(`Order ${detail.name} is ${detail.fulfillmentStatus} — address can no longer change`);
      const mergedAddress = mergeShippingAddressForExecution(
        action.params.address,
        detail.shippingAddress,
      );
      if (!mergedAddress.ok) throw new DefinitiveActionExecutionError(mergedAddress.error);
      const address: ShippingAddressInput = mergedAddress.address;
      await revalidateActionEvidence();
      await assertExecutionContext(ticket.id, session.brandId, planId, expectedContextVersion);
      const res = await runProvider((signal) => updateOrderShippingAddress(
        orderId,
        address,
        session.brandSlug,
        signal,
      ));
      if (!res.success) throw new DefinitiveActionExecutionError(res.message);
      if (!res.address || !shippingAddressMatchesExpected(res.address, mergedAddress.address)) {
        throw new ProviderOutcomePendingError(
          `Shopify accepted the shipping-address update on ${detail.name}, but the returned address did not verify every changed and preserved field. Reconciliation is required before any reply can run.`,
          orderId,
        );
      }
      const { error: addressEventError } = await supabase.from('ticket_events').insert({
        ticket_id: ticket.id, event_type: 'order_address_updated', actor: 'ai', actor_id: session.userId ?? null,
        new_value: detail.name,
        metadata: {
          via: 'autopilot', order_id: orderId, plan_id: planId,
          action_id: action.id, action_execution_id: executionReceiptId,
        },
      });
      if (addressEventError) {
        throw new ProviderOutcomePendingError(
          `Shopify updated the shipping address on ${detail.name}, but the local audit event could not be saved: ${addressEventError.message}. Reconciliation is required.`,
          orderId,
        );
      }
      return { summary: `Shipping address updated on ${detail.name}` };
    }

    case 'consolidate_related_tickets': {
      const snapshots = relatedTicketSnapshots(action);
      if (!snapshots) throw new Error('Related-ticket snapshots are invalid');
      const { data, error } = await supabase.rpc('execute_autopilot_ticket_consolidation', {
        p_receipt_id: executionReceiptId,
        p_brand_id: session.brandId,
        p_worker_token: executionWorkerToken,
        p_actor_id: session.userId ?? null,
      });
      if (error) throw new Error(`Related-ticket consolidation failed: ${error.message}`);
      const payload = (data ?? {}) as Record<string, unknown>;
      if (payload.executed !== true || typeof payload.summary !== 'string') {
        throw new Error('Related-ticket consolidation returned an invalid result');
      }
      return {
        summary: payload.summary,
        providerReference: `ticket-group:${ticket.id}`,
      };
    }

    case 'escalate_human': {
      // Informational card — approving it just tags the ticket for follow-up.
      const merged = [...new Set([...(ticket.tags ?? []), 'needs-human'])];
      await updateTicketWithContext(
        ticket,
        session.brandId,
        expectedContextVersion,
        { tags: merged, updated_at: now },
      );
      ticket.tags = merged;
      await supabase.from('ticket_events').insert({
        ticket_id: ticket.id,
        event_type: 'tags_added',
        actor: 'ai',
        new_value: 'needs-human',
        metadata: {
          via: 'autopilot', plan_id: planId, action_id: action.id,
          action_execution_id: executionReceiptId, tags: ['needs-human'],
        },
      });
      return { summary: 'Tagged needs-human for manual follow-up' };
    }

    default:
      throw new Error(`Unknown action type: ${action.type}`);
  }
}
