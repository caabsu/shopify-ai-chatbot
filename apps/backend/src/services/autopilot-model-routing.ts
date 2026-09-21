export type AutopilotModelTier = 'flash' | 'pro';

export interface AutopilotModelRoute {
  tier: AutopilotModelTier;
  thinking: 'disabled' | 'high';
  reasons: string[];
  router_version: 'autopilot-router-v1';
}

export interface AutopilotModelRoutingInput {
  trigger: 'new_ticket' | 'customer_reply' | 'sweep' | 'revision' | 'stale_check';
  subject: string;
  currentThreadText: string;
  triageIntent?: string | null;
  authorizedCancellationCount: number;
  authorizedRefundCount: number;
  authorizedAddressChangeCount: number;
  relatedTickets: Array<{
    response_state: 'unanswered' | 'awaiting_us' | 'awaiting_customer' | 'no_customer_message';
  }>;
  knownOrderNames: string[];
  previousActionTypes?: string[];
  /** Server-derived first-choice offer; no order mutation is authorized yet. */
  retentionOfferOnly?: boolean;
  /** A saved reviewer has scoped this revision to an informational response. */
  reviewedReadOnlyRevision?: boolean;
}

const HEAVY_TRIAGE_INTENTS = new Set([
  'cancel_order',
  'return_refund',
  'address_change',
  'damaged_item',
  'order_modification',
]);

const HIGH_IMPACT_ACTIONS = new Set([
  'cancel_order',
  'refund_order',
  'update_shipping_address',
]);

function normalizedOrderTokens(orderName: string): string[] {
  const compact = orderName.toLowerCase().replace(/\s+/g, '');
  const withoutHash = compact.replace(/^#/, '');
  return [...new Set([compact, withoutHash].filter((value) => value.length > 1))];
}

export function countReferencedKnownOrders(text: string, orderNames: string[]): number {
  const normalized = text.toLowerCase();
  return orderNames.filter((name) => normalizedOrderTokens(name).some((token) => (
    new RegExp(`(?:#|\\border(?:\\s+(?:number\\s*)?)?#?\\s*)${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
      .test(normalized)
  ))).length;
}

function hasMutationConflict(text: string): boolean {
  const lower = text.toLowerCase();
  const asksToCancel = /\b(?:please|want|need|like|can|could|would|able)\b[^.!?\n]{0,80}\bcancel\b/i.test(lower);
  const revokesCancellation = /\b(?:do not|don't|dont|no longer)\b[^.!?\n]{0,50}\bcancel\b|\b(?:never\s*mind|nevermind|changed my mind|keep (?:my |the )?order|hold off)\b/i
    .test(lower);
  const asksForRefund = /\b(?:please|want|need|like|issue|process|send|get|receive)\b[^.!?\n]{0,80}\brefund\b/i.test(lower);
  const revokesRefund = /\b(?:do not|don't|dont|no longer)\b[^.!?\n]{0,50}\brefund\b|\b(?:never\s*mind|nevermind|changed my mind)\b/i
    .test(lower);
  return (asksToCancel && revokesCancellation) || (asksForRefund && revokesRefund);
}

/**
 * Cost routing is deliberately deterministic and conservative. Flash handles
 * ordinary drafting/linking/read-only work. Pro is reserved for money/order
 * mutations, conflicting state, multi-case ambiguity, and policy uncertainty.
 */
export function selectAutopilotModel(input: AutopilotModelRoutingInput): AutopilotModelRoute {
  if (input.trigger === 'revision' && input.reviewedReadOnlyRevision
      && input.authorizedCancellationCount === 0 && input.authorizedRefundCount === 0
      && input.authorizedAddressChangeCount === 0) {
    return { tier: 'flash', thinking: 'disabled', reasons: ['reviewed_read_only_revision'], router_version: 'autopilot-router-v1' };
  }
  const reasons: string[] = [];
  const combinedText = `${input.subject}\n${input.currentThreadText}`;

  if (HEAVY_TRIAGE_INTENTS.has(input.triageIntent ?? '')) {
    reasons.push(`high_risk_intent:${input.triageIntent}`);
  }
  if (input.authorizedCancellationCount > 0) reasons.push('authorized_cancellation');
  if (input.authorizedRefundCount > 0) reasons.push('authorized_refund');
  if (input.authorizedAddressChangeCount > 0) reasons.push('authorized_address_change');
  if (/\b(?:cancel(?:lation)?|refund|return|exchange|change (?:the )?(?:shipping )?address|update (?:the )?(?:shipping )?address|modify (?:the )?order|damaged|defective|wrong item)\b/i.test(combinedText)) {
    reasons.push('mutation_or_return_language');
  }

  const referencedOrderCount = countReferencedKnownOrders(combinedText, input.knownOrderNames);
  if (referencedOrderCount > 1) reasons.push('multiple_referenced_orders');

  if (hasMutationConflict(combinedText)) reasons.push('conflicting_customer_instruction');

  // Linking one clearly related thread is routine. Multiple candidates or
  // divergent response states require reasoning about which histories to join.
  if (input.relatedTickets.length > 1) reasons.push('multiple_related_tickets');
  if (new Set(input.relatedTickets.map((ticket) => ticket.response_state)).size > 1) {
    reasons.push('conflicting_related_thread_state');
  }

  if ((input.previousActionTypes ?? []).some((type) => HIGH_IMPACT_ACTIONS.has(type))) {
    reasons.push('previous_high_impact_plan');
  }

  if (/\b(?:chargeback|payment dispute|fraud|legal|attorney|lawsuit|warranty|policy exception|outside (?:the )?(?:return|refund) window)\b/i.test(combinedText)) {
    reasons.push('uncertain_or_sensitive_policy');
  }

  if (input.retentionOfferOnly && reasons.every(reason => [
    'mutation_or_return_language', 'high_risk_intent:cancel_order', 'high_risk_intent:return_refund',
  ].includes(reason))) {
    return { tier: 'flash', thinking: 'disabled', reasons: ['retention_choice_offer'], router_version: 'autopilot-router-v1' };
  }
  const tier: AutopilotModelTier = reasons.length > 0 ? 'pro' : 'flash';
  return {
    tier,
    thinking: tier === 'pro' ? 'high' : 'disabled',
    reasons: reasons.length > 0
      ? reasons
      : [input.trigger === 'revision' ? 'routine_human_revision' : 'routine_support'],
    router_version: 'autopilot-router-v1',
  };
}
