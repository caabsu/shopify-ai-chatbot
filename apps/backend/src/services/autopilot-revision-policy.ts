import {
  claimedCompletedMutationOutcomes,
  claimedCurrencyAmounts,
  referencedOrderNamesFromText,
  type AutopilotMutationOutcome,
} from './autopilot-action-policy.js';

export interface OperatorVerifiedHistoricalOutcome {
  type: AutopilotMutationOutcome;
  order_id: 'operator_revision';
  order_name: string | null;
  amount?: number;
  source: 'operator_revision';
}

export interface OperatorRevisionDirectives {
  /** Reviewer explicitly directs the system to cancel the active order. */
  forceCancellation: boolean;
  /** Reviewer explicitly says cancellation is not authorized. */
  forbidCancellation: boolean;
  /** Cancellation replaces a standalone refund so fulfillment is stopped. */
  replaceRefundWithCancellation: boolean;
  /** The ticket must remain open after the revised response/actions. */
  keepTicketOpen: boolean;
  /** Do not send another customer-facing reply for this revision. */
  suppressReply: boolean;
}

export interface OperatorVerifiedPendingRefund {
  /** Exact amount the reviewer says remains owed, when supplied. */
  amount: number | null;
  /** The original provider refund was attempted but did not complete. */
  originalRefundFailed: boolean;
  /** The reviewer directed an alternate PayPal payout-information workflow. */
  collectPayPalDetails: boolean;
  /** The order cancellation itself is a reviewer-verified historical fact. */
  cancellationCompleted: boolean;
  source: 'operator_revision';
}

function explicitOperatorCompletionFacts(instruction: string): AutopilotMutationOutcome[] {
  const factualInstruction = instruction.replace(/\b(?:do\s+not|don't|never|avoid|without)\b[^.!?\n]{0,100}\b(?:claim(?:ing)?|say(?:ing)?|promise|promis(?:e|ing)|phrases)\b[^.!?\n]*/gi, '');
  const text = factualInstruction.toLowerCase();
  const outcomes = new Set(claimedCompletedMutationOutcomes(factualInstruction));
  const negatedRefund = /\b(?:not|never|wasn't|was\s+not|hasn't|has\s+not)\b[^\n]{0,40}\brefund/i.test(text);
  if (!negatedRefund && /\brefund(?:ed)?\s+successfully\b/i.test(text)) outcomes.add('refund_order');
  if (/\bcancel(?:l)?(?:ed|ation)?\s+successfully\b/i.test(text)) outcomes.add('cancel_order');
  if (
    /\b(?:we|i)\s+(?:have|'ve|already)\s+cancel(?:l)?e?d\s+(?:the\s+)?order\b/i.test(text)
    || /\b(?:the\s+)?order\s+(?:was|has\s+been)\s+cancel(?:l)?e?d\b/i.test(text)
  ) {
    outcomes.add('cancel_order');
  }
  if (/\b(?:shipping\s+)?address\s+(?:was\s+|has\s+been\s+)?updated\s+successfully\b/i.test(text)) {
    outcomes.add('update_shipping_address');
  }
  return [...outcomes];
}

/**
 * Reviewer commands are operational instructions, not customer-language
 * classification. "Cancel the order instead of refunding it" must therefore
 * survive even when the instruction does not repeat an order number.
 */
export function operatorRequestsCancellation(instruction: string): boolean {
  const text = instruction.toLowerCase();
  const negated = /\b(?:do\s+not|don't|dont|never|not\s+to)\b[^.!?\n]{0,40}\bcancel\b/i.test(text);
  const historicalOnly = /\b(?:already|was|has\s+been|successfully)\b[^.!?\n]{0,30}\bcancel(?:l)?ed\b/i.test(text);
  if (negated || historicalOnly) return false;
  return (
    /\bcancel\s+(?:(?:my|the|this|that)\s+)?order\b/i.test(text)
    || /\bcancel\s+(?:it|this|that)\b/i.test(text)
    || /\bchange\s+(?:the\s+)?action\s+(?:to|into)\s+cancel/i.test(text)
  );
}

/**
 * Compile free-form reviewer feedback into a small set of deterministic
 * constraints. The model still writes the plan, but it cannot silently ignore
 * these operational instructions when revising it.
 */
export function compileOperatorRevisionDirectives(
  instruction: string,
): OperatorRevisionDirectives {
  const text = instruction.toLowerCase();
  const forbidCancellation = (
    /\b(?:do\s+not|don't|dont|never)\b[^.!?\n]{0,60}\bcancel\b/i.test(text)
    || /\bcustomer\b[^.!?\n]{0,60}\b(?:did\s+not|didn't|has\s+not|hasn't)\b[^.!?\n]{0,40}\b(?:ask|request)\b[^.!?\n]{0,30}\bcancel/i.test(text)
    || /\b(?:cancel(?:l)?ation|cancel(?:l)?ing)\b[^.!?\n]{0,50}\b(?:not\s+authorized|conditional|only\s+potential)/i.test(text)
  );
  const forceCancellation = !forbidCancellation && operatorRequestsCancellation(instruction);
  const replaceRefundWithCancellation = forceCancellation && (
    /\b(?:instead\s+of|rather\s+than)\b[^.!?\n]{0,30}\b(?:just\s+)?refund/i.test(text)
    || /\bnot\s+just\s+(?:a\s+)?refund\b/i.test(text)
    || /\bcancel\b[^.!?\n]{0,60}\b(?:not|instead)\b[^.!?\n]{0,30}\brefund/i.test(text)
  );
  const keepTicketOpen = (
    /\bkeep\s+(?:(?:the|this)\s+)?ticket\s+open\b/i.test(text)
    || /\b(?:do\s+not|don't|dont|never)\s+(?:resolve|close)\b/i.test(text)
    || /\bleave\s+(?:(?:the|this)\s+)?ticket\s+(?:open|unresolved)\b/i.test(text)
  );
  const suppressReply = (
    /\b(?:do\s+not|don't|dont|never)\s+(?:send\s+(?:(?:the|this)\s+customer\s+)?(?:another\s+)?(?:customer-facing\s+)?(?:reply|response|email)|email(?:\s+(?:the|this)\s+customer)?|reply|respond)\b/i.test(text)
    || /\bno\s+(?:customer\s+)?reply\b/i.test(text)
  );
  return {
    forceCancellation,
    forbidCancellation,
    replaceRefundWithCancellation,
    keepTicketOpen,
    suppressReply,
  };
}

/**
 * Apply reviewer prohibitions before validation. Required actions (such as a
 * forced cancellation) are injected by the grounded repair layer after the
 * target order has been resolved.
 */
export function applyOperatorRevisionDirectives<
  T extends { type?: string; params?: Record<string, unknown> },
>(
  actions: T[],
  directives: OperatorRevisionDirectives,
  cancellationOrderIds: readonly string[],
): T[] {
  const cancellationTargets = new Set(cancellationOrderIds);
  return actions.filter((action) => {
    if (directives.forbidCancellation && action.type === 'cancel_order') return false;
    if (
      directives.replaceRefundWithCancellation
      && action.type === 'refund_order'
      && (
        cancellationTargets.size === 0
        || cancellationTargets.has(String(action.params?.order_id ?? ''))
      )
    ) return false;
    if (
      directives.keepTicketOpen
      && (action.type === 'resolve' || action.type === 'close_not_support')
    ) return false;
    if (directives.suppressReply && action.type === 'send_reply') return false;
    return true;
  });
}

function refundAmountFromReviewerContext(instruction: string, contextText: string): number | undefined {
  const instructionAmounts = claimedCurrencyAmounts(instruction);
  if (instructionAmounts.length === 1) return instructionAmounts[0];
  const contextAmounts = claimedCurrencyAmounts(contextText);
  if (contextAmounts.length === 1) return contextAmounts[0];
  // Subjects often round a precise amount ("$461") while the conversation
  // repeats cents ("$461.30"). Treat near-equal values as one amount and keep
  // the most precise representation; unrelated amounts remain ambiguous.
  if (
    contextAmounts.length > 1
    && Math.max(...contextAmounts) - Math.min(...contextAmounts) < 1
  ) {
    return contextAmounts.find((amount) => Math.abs(amount - Math.trunc(amount)) > 0.0001)
      ?? contextAmounts[0];
  }
  return undefined;
}

/**
 * Compile a reviewer-verified failed-refund recovery into structured facts.
 * This is intentionally narrower than generic refund intent: it activates only
 * when the reviewer says the original refund failed/unavailable and directs an
 * alternate PayPal-account verification workflow. That prevents a model or an
 * old draft from replacing the reviewer-provided amount or payment route.
 */
export function operatorVerifiedPendingRefund(
  instruction: string,
): OperatorVerifiedPendingRefund | null {
  const originalRefundFailed = (
    /\brefund\b[^.!?\n]{0,120}\b(?:fail(?:ed|ure)?|did\s+not|didn't|wasn't|was\s+not|unavailable|expired|expiration|time\s+limit|restriction)\b/i.test(instruction)
    || /\b(?:fail(?:ed|ure)?|unavailable|expired|expiration|time\s+limit|restriction)\b[^.!?\n]{0,120}\brefund\b/i.test(instruction)
  );
  const collectPayPalDetails = (
    /\bpaypal\b/i.test(instruction)
    && (
      /\bemail\s+address\b/i.test(instruction)
      || /\bname\s+(?:displayed|shown|on)\b/i.test(instruction)
      || /\baccount\b[^.!?\n]{0,80}\breceive\b/i.test(instruction)
    )
  );
  if (!originalRefundFailed || !collectPayPalDetails) return null;

  const amounts = claimedCurrencyAmounts(instruction);
  const amount = amounts.length === 1 ? amounts[0] : null;
  const cancellationCompleted = (
    /\b(?:we|i|the\s+order|order)\b[^.!?\n]{0,50}\b(?:have\s+|has\s+|was\s+)?cancel(?:l)?e?d\b/i.test(instruction)
    && !operatorRequestsCancellation(instruction)
  );
  return {
    amount,
    originalRefundFailed,
    collectPayPalDetails,
    cancellationCompleted,
    source: 'operator_revision',
  };
}

/**
 * Human revision facts are trusted historical observations, not requests to
 * repeat a Shopify mutation. Bind them to one referenced order when possible.
 */
export function operatorVerifiedHistoricalOutcomes(input: {
  instruction: string;
  contextText: string;
}): OperatorVerifiedHistoricalOutcome[] {
  const outcomes = explicitOperatorCompletionFacts(input.instruction);
  if (outcomes.length === 0) return [];
  const instructionRefs = referencedOrderNamesFromText(input.instruction);
  const contextRefs = referencedOrderNamesFromText(input.contextText);
  const uniqueContextRef = contextRefs.length === 1 ? contextRefs[0] : null;
  const orderName = instructionRefs.length === 1 ? instructionRefs[0] : uniqueContextRef;
  const refundAmount = outcomes.includes('refund_order')
    ? refundAmountFromReviewerContext(input.instruction, input.contextText)
    : undefined;
  return outcomes.map((type) => ({
    type,
    order_id: 'operator_revision',
    order_name: orderName,
    ...(type === 'refund_order' && refundAmount !== undefined ? { amount: refundAmount } : {}),
    source: 'operator_revision',
  }));
}
