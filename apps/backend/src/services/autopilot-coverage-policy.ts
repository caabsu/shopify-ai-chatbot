import { SHOPIFY_SUPPORT_EVIDENCE_PROJECTION } from './autopilot-evidence.js';
import { CUSTOMER_HISTORY_PROJECTION } from './customer-support-context.service.js';

type CoverageAction = {
  type?: string;
};

type CoverageEvidence = {
  projection_version?: string;
  valid_until?: string;
};

export type CoveragePlan = {
  status?: string;
  prompt_version?: string;
  context_version?: number;
  actions?: CoverageAction[];
  analysis?: {
    planner_retry_after?: string;
  };
  evidence?: {
    shopify_orders?: CoverageEvidence;
    customer_history?: CoverageEvidence;
  };
};

export type AutopilotRefreshReason =
  | 'stale_context'
  | 'missing_shopify_evidence'
  | 'outdated_shopify_evidence'
  | 'missing_customer_history_evidence'
  | 'outdated_customer_history_evidence'
  | 'provider_fallback_retry';

export type CoverageExecutionReceipt = {
  status?: string;
};

const TERMINAL_RECEIPT_STATUSES = new Set(['executed', 'failed']);

/**
 * An executing projection is recoverable once its worker grace period passed
 * and every durable provider receipt is terminal. This catches crashes after
 * an action/finalizer without ever replaying a reserved or uncertain effect.
 */
export function autopilotTerminalRunNeedsRecovery(input: {
  planStatus?: string;
  decidedAt?: string;
  receipts: CoverageExecutionReceipt[];
  nowMs?: number;
  graceMs?: number;
}): boolean {
  if (input.planStatus !== 'executing') return false;
  const decidedAt = Date.parse(input.decidedAt ?? '');
  const nowMs = input.nowMs ?? Date.now();
  const graceMs = input.graceMs ?? 5 * 60_000;
  if (!Number.isFinite(decidedAt) || decidedAt + graceMs > nowMs) return false;
  return input.receipts.every((receipt) => TERMINAL_RECEIPT_STATUSES.has(String(receipt.status)));
}

/**
 * Proposed cards remain stable while a reviewer is looking at them. Approval
 * and execution re-fetch and hash live evidence, so a TTL crossing by itself
 * must not replace a visible card or create an "expired plan" review loop.
 * Provider fallbacks get a separate bounded retry schedule.
 */
export function autopilotPlanRefreshReasons(input: {
  plan: CoveragePlan;
  ticketContextVersion: number;
  hasCustomerEmail: boolean;
  refreshBeforeMs: number;
  nowMs?: number;
}): AutopilotRefreshReason[] {
  const { plan } = input;
  if (plan.status !== 'proposed') return [];

  const reasons: AutopilotRefreshReason[] = [];
  if (Number(plan.context_version ?? -1) !== Number(input.ticketContextVersion)) {
    reasons.push('stale_context');
  }

  const actionTypes = new Set((plan.actions ?? []).map((action) => action.type));
  const hasOrderMutation = [
    'cancel_order',
    'refund_order',
    'update_shipping_address',
  ].some((type) => actionTypes.has(type));
  const hasReply = actionTypes.has('send_reply');
  const hasConsolidation = actionTypes.has('consolidate_related_tickets');
  const needsShopifyEvidence = input.hasCustomerEmail && (hasOrderMutation || hasReply);
  const needsCustomerHistory = hasOrderMutation
    || hasConsolidation
    || (input.hasCustomerEmail && hasReply);

  if (needsShopifyEvidence) {
    const evidence = plan.evidence?.shopify_orders;
    if (!evidence) {
      reasons.push('missing_shopify_evidence');
    } else if (evidence.projection_version !== SHOPIFY_SUPPORT_EVIDENCE_PROJECTION) {
      reasons.push('outdated_shopify_evidence');
    }
  }

  if (needsCustomerHistory) {
    const evidence = plan.evidence?.customer_history;
    if (!evidence) {
      reasons.push('missing_customer_history_evidence');
    } else if (evidence.projection_version !== CUSTOMER_HISTORY_PROJECTION) {
      reasons.push('outdated_customer_history_evidence');
    }
  }

  if (String(plan.prompt_version ?? '').startsWith('deterministic-')) {
    const retryAt = Date.parse(plan.analysis?.planner_retry_after ?? '');
    if (!Number.isFinite(retryAt) || retryAt <= (input.nowMs ?? Date.now())) {
      reasons.push('provider_fallback_retry');
    }
  }

  return reasons;
}
