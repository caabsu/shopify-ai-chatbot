import type { AutopilotModelTier } from './autopilot-model-routing.js';
import { AUTOPILOT_REVIEW_FALLBACK_REASON } from './autopilot-review-fallback.js';

export const VALIDATION_REPAIR_VERSION = 'pro-validator-repair-v2';

type ReviewFallbackPlan = {
  status?: string;
  analysis?: {
    review_only?: boolean;
    validation_repair_version?: string;
  };
  actions?: Array<{
    params?: Record<string, unknown>;
  }>;
};

/** Flash may escalate to Pro; every Pro route gets exactly one bounded repair. */
export function plannerAttemptTiers(initialTier: AutopilotModelTier): AutopilotModelTier[] {
  return initialTier === 'flash'
    ? ['flash', 'pro', 'pro']
    : ['pro', 'pro'];
}

/** Retry only failures another Pro request can plausibly repair. */
export function shouldRetryProPlannerError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = 'code' in error && typeof error.code === 'string' ? error.code : '';
  if (code === 'timeout' || code === 'invalid_response'
      || code === 'missing_tool_call' || code === 'invalid_tool_arguments') {
    return true;
  }
  if (code !== 'http_error') return false;
  const status = 'status' in error && typeof error.status === 'number'
    ? error.status
    : undefined;
  return status === undefined
    || status === 408
    || status === 409
    || status === 425
    || status === 429
    || status >= 500;
}

/** Retry old validator fallbacks once after the repair-loop version changes. */
export function validatorFallbackNeedsRetry(plan: ReviewFallbackPlan): boolean {
  return plan.status === 'proposed'
    && plan.analysis?.review_only === true
    && plan.analysis.validation_repair_version !== VALIDATION_REPAIR_VERSION
    && (plan.actions ?? []).some((action) => (
      action.params?.reason_code === AUTOPILOT_REVIEW_FALLBACK_REASON
    ));
}
