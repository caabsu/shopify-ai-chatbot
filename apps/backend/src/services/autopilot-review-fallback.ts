import { randomUUID } from 'node:crypto';

export const AUTOPILOT_REVIEW_FALLBACK_REASON = 'validator_rejected_plan';
export const AUTOPILOT_CONTEXT_FALLBACK_REASON = 'required_context_unavailable';
export const AUTOPILOT_MODEL_FALLBACK_REASON = 'planner_unavailable';
export type AutopilotReviewFallbackReason =
  | typeof AUTOPILOT_REVIEW_FALLBACK_REASON
  | typeof AUTOPILOT_CONTEXT_FALLBACK_REASON
  | typeof AUTOPILOT_MODEL_FALLBACK_REASON;

export interface AutopilotReviewFallbackAction {
  id: string;
  type: 'escalate_human';
  title: string;
  detail: string;
  params: {
    review_only: true;
    auto_run_allowed: false;
    approval_allowed: false;
    policy_confidence_cap: 0;
    reason_code: AutopilotReviewFallbackReason;
    validation_error: string;
    dropped_notes: string[];
  };
  confidence: 0;
  status: 'proposed';
}

export interface AutopilotReviewFallback {
  raw: {
    summary: string;
    reasoning: string;
    overall_confidence: 0;
    actions: [];
  };
  actions: [AutopilotReviewFallbackAction];
  droppedNotes: string[];
  reviewReason: string;
}

function safeInternalText(value: string | undefined, fallback: string, maxLength: number): string {
  const normalized = String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (normalized || fallback).slice(0, maxLength);
}

/**
 * Preserve queue coverage after the strongest model attempt fails deterministic
 * validation. This deliberately carries no customer-facing reply and no
 * Shopify mutation. A reviewer must revise it into a fresh, validated plan.
 */
export function buildAutopilotReviewFallback(input: {
  rejection: string;
  validationError?: string;
  droppedNotes: string[];
  createId?: () => string;
  reasonCode?: AutopilotReviewFallbackReason;
}): AutopilotReviewFallback {
  const validationError = safeInternalText(
    input.validationError,
    input.rejection || 'deterministic safety validation failed',
    500,
  );
  const droppedNotes = input.droppedNotes
    .map((note) => safeInternalText(note, '', 500))
    .filter(Boolean)
    .slice(0, 8);
  const reviewReason = `The generated plan was withheld by deterministic safety validation: ${validationError}`;
  const action: AutopilotReviewFallbackAction = {
    id: (input.createId ?? randomUUID)(),
    type: 'escalate_human',
    title: 'Manual revision required',
    detail:
      'No customer reply or Shopify operation is included. Review the ticket, add corrective instructions, and use Revise to generate a fresh plan.',
    params: {
      review_only: true,
      auto_run_allowed: false,
      approval_allowed: false,
      policy_confidence_cap: 0,
      reason_code: input.reasonCode ?? AUTOPILOT_REVIEW_FALLBACK_REASON,
      validation_error: validationError,
      dropped_notes: droppedNotes,
    },
    confidence: 0,
    status: 'proposed',
  };

  return {
    raw: {
      summary: 'Manual revision is required before this ticket can run.',
      reasoning: `${reviewReason}. No completion claim or executable operation was retained.`,
      overall_confidence: 0,
      actions: [],
    },
    actions: [action],
    droppedNotes: [
      ...droppedNotes,
      'Created a review-only fallback; automatic and direct execution are blocked until revision.',
    ],
    reviewReason,
  };
}
