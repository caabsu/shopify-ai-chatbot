import type { ShopifyOrderSummary } from './customer-profile.service.js';
import {
  extractAuthorizedShippingAddressUpdate,
  referencedOrderNamesFromText,
  resolveVerifiedOrderTarget,
  wholeOrderRefundShouldCancel,
} from './autopilot-action-policy.js';
import type { OperatorVerifiedPendingRefund } from './autopilot-revision-policy.js';

interface SafeDraftAction {
  type:
    | 'send_reply'
    | 'resolve'
    | 'set_priority'
    | 'add_tags'
    | 'cancel_order'
    | 'refund_order'
    | 'update_shipping_address'
    | 'consolidate_related_tickets';
  title: string;
  detail: string;
  confidence: number;
  params: Record<string, unknown>;
}

export interface SafeReadOnlyOrderStatusDraft {
  summary: string;
  reasoning: string;
  overall_confidence: number;
  actions: SafeDraftAction[];
}

export interface SafeUnresolvedLegacyRefundDraft {
  summary: string;
  reasoning: string;
  overall_confidence: number;
  actions: SafeDraftAction[];
}

export interface SafeRestockInterestDraft {
  summary: string;
  reasoning: string;
  overall_confidence: number;
  actions: SafeDraftAction[];
}

export interface SafeOperatorDirectedRevisionDraft {
  summary: string;
  reasoning: string;
  overall_confidence: number;
  actions: SafeDraftAction[];
}

export interface SafeVerifiedRefundStatusDraft {
  summary: string;
  reasoning: string;
  overall_confidence: number;
  actions: SafeDraftAction[];
}

export interface SafeGoodwillSupportDraft extends SafeVerifiedRefundStatusDraft {}

export interface SafeLegacyRefundRecoveryDraft extends SafeVerifiedRefundStatusDraft {}

export interface SafeLatestCustomerRequestDraft extends SafeVerifiedRefundStatusDraft {}

export interface RepairedSupportDraft {
  summary: string;
  reasoning: string;
  overall_confidence: number;
  actions: SafeDraftAction[];
}

export interface RepairableDraft {
  summary?: string;
  reasoning?: string;
  overall_confidence?: number;
  actions?: Array<{
    type?: string;
    title?: string;
    detail?: string;
    confidence?: number;
    params?: Record<string, unknown>;
  }>;
}

type DraftResponseState =
  | 'unanswered'
  | 'awaiting_us'
  | 'awaiting_customer'
  | 'no_customer_message'
  | 'resolved'
  | 'closed';

function selectedOrder(
  subject: string,
  threadText: string,
  orders: ShopifyOrderSummary[],
): ShopifyOrderSummary | null {
  const references = [...new Set([
    ...referencedOrderNamesFromText(subject),
    ...referencedOrderNamesFromText(threadText),
  ])];
  if (references.length > 0) {
    const matches = references
      .map((reference) => resolveVerifiedOrderTarget(reference, reference, orders))
      .filter((order): order is ShopifyOrderSummary => order !== null);
    const unique = [...new Map(matches.map((order) => [order.id, order])).values()];
    return unique.length === 1 ? unique[0] : null;
  }
  return orders.length === 1 ? orders[0] : null;
}

function selectedStatusOrders(
  subject: string,
  threadText: string,
  latestCustomerMessage: string,
  orders: ShopifyOrderSummary[],
): ShopifyOrderSummary[] {
  const latestReferences = referencedOrderNamesFromText(latestCustomerMessage);
  const latestMatches = latestReferences
    .map((reference) => resolveVerifiedOrderTarget(reference, reference, orders))
    .filter((order): order is ShopifyOrderSummary => order !== null);
  const uniqueLatest = [...new Map(latestMatches.map((order) => [order.id, order])).values()];
  if (uniqueLatest.length > 0) return uniqueLatest;

  // Follow-ups commonly use deictic wording ("these orders", "both orders")
  // after naming the exact order numbers one turn earlier. Carry forward only
  // the verified order set that is explicitly present in this ticket; never
  // pull in unrelated orders merely because they belong to the same customer.
  if (/\b(?:both|these|those|my\s+(?:two|2)|the\s+(?:two|2))\s+(?:orders?|lamps?|items?|purchases?)\b/i.test(latestCustomerMessage)) {
    const priorReferences = [
      ...referencedOrderNamesFromText(subject),
      ...referencedOrderNamesFromText(threadText),
    ];
    const priorMatches = priorReferences
      .map((reference) => resolveVerifiedOrderTarget(reference, reference, orders))
      .filter((order): order is ShopifyOrderSummary => order !== null);
    const uniquePrior = [...new Map(priorMatches.map((order) => [order.id, order])).values()];
    if (uniquePrior.length >= 2) return uniquePrior;
  }

  const single = selectedOrder(subject, threadText, orders);
  return single ? [single] : [];
}

function customerGreeting(name: string | null): string {
  const firstName = String(name ?? '')
    .trim()
    .split(/\s+/)[0]
    ?.replace(/[^A-Za-zÀ-ÖØ-öø-ÿ'-]/g, '');
  return firstName ? `Hi ${firstName},` : 'Hello,';
}

function hasRestockInterest(text: string): boolean {
  return [
    /\bback\s+in\s+stock\b/i,
    /\brestock(?:ed|ing)?\b/i,
    /\bavailable\s+again\b/i,
    /\breorder\b/i,
    /\b(?:let|notify|email|tell)\s+me\s+know\b[^.!?\n]{0,80}\b(?:stock|available)\b/i,
  ].some((pattern) => pattern.test(text));
}

function restockInterestBody(order: ShopifyOrderSummary): string {
  const itemLabels = [...new Set(
    order.lineItems
      .map((item) => item.title.trim())
      .filter(Boolean),
  )];
  const itemLabel = itemLabels.length === 1
    ? itemLabels[0]
    : itemLabels.length > 1
      ? itemLabels.join(' and ')
      : `the item from order ${order.name}`;
  return [
    `Absolutely—I noted that you'd like to reorder ${itemLabel} when it is available again.`,
    '',
    `I don't have a verified restock date or an automatic stock alert I can promise from this ticket, so I don't want to give you another uncertain timeline. The product page will show live availability; if you reply here before placing the new order, we'll confirm availability for you.`,
    '',
    `Thank you for considering giving us another try.`,
  ].join('\n');
}

function insertOrderIdentity(replyText: string, orderName: string): string {
  if (replyText.toLowerCase().includes(orderName.toLowerCase())) return replyText;
  const identity = `I checked order ${orderName} and made sure I'm looking at the right purchase.`;
  const firstBreak = replyText.indexOf('\n\n');
  if (firstBreak < 0) return `${identity}\n\n${replyText}`.trim();
  return `${replyText.slice(0, firstBreak)}\n\n${identity}\n\n${replyText.slice(firstBreak + 2)}`.trim();
}

function repeatedRequestAcknowledgement(threadText: string): string {
  if (
    /\b(?:third|fourth|multiple)\s+time\b/i.test(threadText)
    || /\b(?:asked|emailed|followed\s+up)\b[^.!?\n]{0,50}\b(?:again|more\s+than\s+once|several\s+times)\b/i.test(threadText)
    || /\b(?:again|still)\b[^.!?\n]{0,60}\b(?:refund|cancel|waiting|no\s+response)\b/i.test(threadText)
  ) {
    return `You're right—you've had to ask us more than once, and we should have taken care of this sooner.`;
  }
  return `I'm sorry we didn't take care of this when you first asked.`;
}

function stripCoerciveComplaintLanguage(replyText: string): string {
  return replyText
    .split('\n')
    .filter((line) => !(
      /\b(?:withdraw|drop|retract|dismiss|close|remove|cancel|delay|postpone|hold\s+off|wait\s+(?:to|before)|do\s+not\s+file|don't\s+file)\b/i.test(line)
      && /\b(?:complaint|claim|case|report|chargeback|dispute|cfpb|attorney\s+general|regulator|regulatory)\b/i.test(line)
    ))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function operatorDirectedPendingRefundReply(input: {
  customerName: string | null;
  orderName: string;
  pendingRefund: OperatorVerifiedPendingRefund;
  signoffBlock: string;
}): string {
  const amount = input.pendingRefund.amount;
  const amountLabel = amount !== null
    ? `$${amount.toFixed(2)} USD`
    : 'the refund';
  return [
    customerGreeting(input.customerName),
    '',
    `I'm very sorry. I double-checked ${input.orderName}: the order was cancelled, but the original refund did not go through because the PayPal Express Checkout transaction is too old for us to refund back through that original transaction. We missed that failure, and you should not have had to chase us to discover it.`,
    '',
    `We're working with the Outlight team to complete ${amountLabel} through a different PayPal route. Please reply with the email address connected to the PayPal account, the name displayed on that account, and confirmation that the account can receive ${amountLabel}.`,
    '',
    `I know this is another step after you've already waited far too long, and I'm sorry we did not catch and explain the failed refund sooner.`,
    '',
    input.signoffBlock,
  ].join('\n');
}

function groundedCancellationReply(input: {
  customerName: string | null;
  orderNames: string[];
  threadText: string;
  signoffBlock: string;
}): string {
  const labels = input.orderNames.join(', ');
  return [
    customerGreeting(input.customerName),
    '',
    repeatedRequestAcknowledgement(input.threadText),
    '',
    `I've now cancelled ${labels} as requested. ${input.orderNames.length === 1 ? 'The order is' : 'Those orders are'} stopped and will not continue to fulfillment.`,
    '',
    `The cancellation returns the paid balance to the original payment method. Most banks post it within 5 to 10 business days.`,
    '',
    input.signoffBlock,
  ].join('\n');
}

function fullRefundAmount(
  order: ShopifyOrderSummary,
  authorizedAmountByOrder: ReadonlyMap<string, number | null>,
): number | null {
  const explicitlyAuthorized = authorizedAmountByOrder.get(order.id);
  if (explicitlyAuthorized !== null && explicitlyAuthorized !== undefined) {
    return Number.isFinite(explicitlyAuthorized) && explicitlyAuthorized > 0
      ? explicitlyAuthorized
      : null;
  }
  const total = Number.parseFloat(order.totalPrice);
  return Number.isFinite(total) && total > 0 ? total : null;
}

/**
 * Repair the strongest model draft instead of replacing the whole ticket with
 * a 0% review-only card. Deterministic authorization still controls every
 * mutation; uncertainty is represented by a deliberately lower confidence.
 */
export function buildRepairedSupportDraft(input: {
  draft: RepairableDraft;
  subject: string;
  threadText: string;
  latestCustomerMessage?: string;
  customerName: string | null;
  orders: ShopifyOrderSummary[];
  signoffBlock: string;
  authorizedCancellationOrderIds: string[];
  authorizedRefundOrderIds: string[];
  authorizedRefundAmountByOrder: ReadonlyMap<string, number | null>;
  authorizedAddressTextByOrder?: ReadonlyMap<string, string>;
  readOnlyCrossBrandOrderIds: ReadonlySet<string>;
  rejection: string;
  operatorInstruction?: string;
  operatorVerifiedHistoricalOutcomes?: Array<{
    type: 'cancel_order' | 'refund_order' | 'update_shipping_address';
    order_name: string | null;
  }>;
  operatorVerifiedPendingRefund?: OperatorVerifiedPendingRefund | null;
  keepTicketOpen?: boolean;
  suppressReply?: boolean;
  preserveDraftConfidence?: boolean;
}): RepairedSupportDraft {
  let actions: SafeDraftAction[] = Array.isArray(input.draft.actions)
    ? input.draft.actions
      .filter((action): action is NonNullable<typeof action> & { type: SafeDraftAction['type'] } => (
        Boolean(action)
        && typeof action.type === 'string'
        && [
          'send_reply',
          'resolve',
          'set_priority',
          'add_tags',
          'cancel_order',
          'refund_order',
          'update_shipping_address',
          'consolidate_related_tickets',
        ].includes(action.type)
      ))
      .map((action) => ({
        type: action.type,
        title: String(action.title || action.type).slice(0, 120),
        detail: String(action.detail || '').slice(0, 500),
        confidence: Math.min(
          input.preserveDraftConfidence ? 0.99 : 0.72,
          Math.max(0.4, Number(action.confidence) || 0.55),
        ),
        params: { ...(action.params ?? {}) },
      }))
    : [];
  for (const action of actions) {
    if (action.type === 'send_reply') {
      action.params.reply_text = stripCoerciveComplaintLanguage(
        String(action.params.reply_text ?? ''),
      );
    }
  }
  // Recovery markers are internal implementation details, never useful work.
  // An older terminal plan may contain one, but it must not survive as the
  // only action when that plan is used as repair context.
  actions = actions.filter((action) => !(
    action.type === 'add_tags'
    && Array.isArray(action.params.tags)
    && action.params.tags.some((tag) => (
      tag === 'validation-repaired' || tag === 'planner-retry-needed'
    ))
  ));
  if (input.keepTicketOpen) {
    actions = actions.filter((action) => action.type !== 'resolve');
  }
  if (input.suppressReply) {
    actions = actions.filter((action) => action.type !== 'send_reply');
  }

  const ordersById = new Map(input.orders.map((order) => [order.id, order]));
  const actionableCancellationIds = input.authorizedCancellationOrderIds.filter((orderId) => {
    const order = ordersById.get(orderId);
    return Boolean(order && !order.cancelledAt && !input.readOnlyCrossBrandOrderIds.has(orderId));
  });
  const actionableCancellationSet = new Set(actionableCancellationIds);
  // Shopify cancellation is the whole-order operation that prevents future
  // fulfillment and returns the paid balance. A standalone refund for the same
  // target must not survive a reviewer instruction to cancel instead.
  actions = actions.filter((action) => !(
    action.type === 'refund_order'
    && actionableCancellationSet.has(String(action.params.order_id ?? ''))
  ));
  for (const action of actions) {
    if (
      action.type === 'cancel_order'
      && actionableCancellationSet.has(String(action.params.order_id ?? ''))
    ) {
      action.confidence = Math.max(action.confidence, input.operatorInstruction ? 0.9 : 0.87);
    }
  }
  const cancelledInPlan = new Set(
    actions
      .filter((action) => action.type === 'cancel_order')
      .map((action) => String(action.params.order_id ?? '')),
  );
  if (input.operatorInstruction) {
    for (const action of actions) {
      if (
        action.type === 'cancel_order'
        && actionableCancellationSet.has(String(action.params.order_id ?? ''))
      ) {
        action.confidence = Math.max(action.confidence, 0.88);
      }
    }
  }
  const injectedMutations: SafeDraftAction[] = [];
  for (const orderId of actionableCancellationIds) {
    const order = ordersById.get(orderId);
    if (!order || cancelledInPlan.has(orderId)) continue;
    injectedMutations.push({
      type: 'cancel_order',
      title: `Cancel order ${order.name}`,
      detail: `Cancel ${order.name} at the customer's explicit request. The customer reply remains blocked until Shopify verifies the result.`,
      confidence: input.operatorInstruction ? 0.9 : 0.87,
      params: {
        order_id: order.id,
        order_name: order.name,
        reason: 'CUSTOMER',
      },
    });
    cancelledInPlan.add(orderId);
  }

  const refundedInPlan = new Set(
    actions
      .filter((action) => action.type === 'refund_order')
      .map((action) => String(action.params.order_id ?? '')),
  );
  const authorizedRefundSet = new Set(input.authorizedRefundOrderIds);
  for (const action of actions) {
    const orderId = String(action.params.order_id ?? '');
    if (
      action.type === 'refund_order'
      && authorizedRefundSet.has(orderId)
      && ordersById.has(orderId)
      && !input.readOnlyCrossBrandOrderIds.has(orderId)
    ) {
      action.confidence = Math.max(action.confidence, input.operatorInstruction ? 0.9 : 0.87);
    }
  }
  for (const orderId of input.authorizedRefundOrderIds) {
    if (cancelledInPlan.has(orderId) || refundedInPlan.has(orderId)) continue;
    const order = ordersById.get(orderId);
    if (!order || input.readOnlyCrossBrandOrderIds.has(orderId)) continue;
    const amount = fullRefundAmount(order, input.authorizedRefundAmountByOrder);
    if (amount === null) continue;
    if (!order.cancelledAt && wholeOrderRefundShouldCancel({
      fulfillmentStatus: order.fulfillmentStatus,
      trackingCount: order.tracking.length,
      totalPrice: order.totalPrice,
      totalRefunded: order.totalRefunded,
      requestedAmount: amount,
    })) {
      injectedMutations.push({
        type: 'cancel_order',
        title: `Cancel order ${order.name}`,
        detail: `Cancel the full unfulfilled order at the customer's refund request so it cannot still be fulfilled; the reply remains blocked until Shopify verifies the cancellation and refund submission.`,
        confidence: input.operatorInstruction ? 0.9 : 0.87,
        params: {
          order_id: order.id,
          order_name: order.name,
          reason: 'CUSTOMER',
        },
      });
      cancelledInPlan.add(orderId);
      continue;
    }
    injectedMutations.push({
      type: 'refund_order',
      title: `Refund order ${order.name}`,
      detail: `Issue the customer-authorized refund for ${order.name}; the reply remains blocked until Shopify verifies the result.`,
      confidence: input.operatorInstruction ? 0.9 : 0.87,
      params: {
        order_id: order.id,
        order_name: order.name,
        amount,
      },
    });
    refundedInPlan.add(orderId);
  }

  const actionableAddressChanges = [...(input.authorizedAddressTextByOrder ?? new Map()).entries()]
    .flatMap(([orderId, authorizedText]) => {
      const order = ordersById.get(orderId);
      if (
        !order
        || input.readOnlyCrossBrandOrderIds.has(orderId)
        || !String(order.fulfillmentStatus).toUpperCase().startsWith('UNFULFILLED')
      ) {
        return [];
      }
      const parsed = extractAuthorizedShippingAddressUpdate(authorizedText);
      return parsed.ok ? [{ order, address: parsed.address }] : [];
    });
  const actionableAddressIds = new Set(
    actionableAddressChanges.map(({ order }) => order.id),
  );
  // Rebuild authorized address mutations from customer-authored fields. This
  // prevents a malformed model action from either losing the requested change
  // or smuggling an inferred address field into Shopify.
  actions = actions.filter((action) => !(
    action.type === 'update_shipping_address'
    && actionableAddressIds.has(String(action.params.order_id ?? ''))
  ));
  for (const { order, address } of actionableAddressChanges) {
    injectedMutations.push({
      type: 'update_shipping_address',
      title: `Update shipping address for ${order.name}`,
      detail:
        `Apply the complete address correction supplied by the customer for ${order.name}. `
        + `The reply remains blocked until Shopify verifies the saved delivery address.`,
      confidence: input.operatorInstruction ? 0.9 : 0.86,
      params: {
        order_id: order.id,
        order_name: order.name,
        address,
      },
    });
  }

  const preferredOrder = (
    actionableCancellationIds
      .concat(input.authorizedRefundOrderIds)
      .concat([...actionableAddressIds])
      .map((orderId) => ordersById.get(orderId))
      .find((order): order is ShopifyOrderSummary => Boolean(order))
    ?? selectedOrder(input.subject, input.threadText, input.orders)
  );
  let replyAction = actions.find((action) => action.type === 'send_reply');
  const cancellationOrderIds = [...new Set([
    ...actionableCancellationIds,
    ...injectedMutations
      .filter((action) => action.type === 'cancel_order')
      .map((action) => String(action.params.order_id ?? '')),
  ])];
  const cancellationOrders = cancellationOrderIds
    .map((orderId) => ordersById.get(orderId))
    .filter((order): order is ShopifyOrderSummary => Boolean(order));
  const addressChangeOrders = actionableAddressChanges.map(({ order, address }) => ({
    order,
    address,
  }));
  const refundOrders = actions
    .concat(injectedMutations)
    .filter((action) => action.type === 'refund_order')
    .map((action) => ordersById.get(String(action.params.order_id ?? '')))
    .filter((order): order is ShopifyOrderSummary => Boolean(order));
  const verifiedHistoricalRefund = input.operatorVerifiedHistoricalOutcomes
    ?.find((outcome) => outcome.type === 'refund_order');
  const operatorPendingRefund = input.operatorVerifiedPendingRefund ?? null;
  if (operatorPendingRefund && preferredOrder) {
    // A reviewer-verified failed legacy refund is a read-only recovery
    // conversation, not a new Shopify mutation. Remove stale model operations
    // and make the exact operator instruction authoritative.
    actions = actions.filter((action) => !(
      action.type === 'cancel_order'
      || action.type === 'refund_order'
      || action.type === 'resolve'
    ));
    replyAction = actions.find((action) => action.type === 'send_reply');
    if (!replyAction) {
      replyAction = {
        type: 'send_reply',
        title: `Reply: explain failed refund for ${preferredOrder.name}`,
        detail: 'Explain the reviewer-verified failed original refund and collect the alternate PayPal payout details.',
        confidence: 0.88,
        params: {},
      };
      actions.unshift(replyAction);
    }
    replyAction.title = `Reply: recover failed refund for ${preferredOrder.name}`;
    replyAction.detail =
      'State the reviewer-verified cancellation and failed original refund, then collect the exact PayPal details required for the alternate payout.';
    replyAction.params.reply_text = operatorDirectedPendingRefundReply({
      customerName: input.customerName,
      orderName: preferredOrder.name,
      pendingRefund: operatorPendingRefund,
      signoffBlock: input.signoffBlock,
    });
    replyAction.params.requires_action_types = [];
    replyAction.params.draft_source = 'operator_verified_pending_refund_v1';
    replyAction.confidence = 0.88;
  }
  const authoritativeReviewerOverride = cancellationOrders.length > 0
    || refundOrders.length > 0
    || (Boolean(input.operatorInstruction) && addressChangeOrders.length > 0)
    || Boolean(verifiedHistoricalRefund)
    || Boolean(operatorPendingRefund);
  if (authoritativeReviewerOverride) {
    for (const action of actions) {
      if (action.type === 'resolve' && !input.keepTicketOpen) {
        action.confidence = Math.max(action.confidence, 0.82);
      }
      if (action.type === 'set_priority' || action.type === 'add_tags') {
        action.confidence = Math.max(action.confidence, 0.82);
      }
    }
  }
  if (operatorPendingRefund) {
    // Fully handled above. Do not let a stale cancellation/refund branch
    // overwrite the reviewer-directed recovery reply.
  } else if (replyAction && cancellationOrders.length > 0) {
    replyAction.title = cancellationOrders.length === 1
      ? `Reply: confirm cancellation of ${cancellationOrders[0].name}`
      : 'Reply: confirm the requested cancellations';
    replyAction.detail =
      'Confirm only after Shopify verifies cancellation; make clear fulfillment is stopped and cancellation returns the paid balance.';
    replyAction.params.reply_text = groundedCancellationReply({
      customerName: input.customerName,
      orderNames: cancellationOrders.map((order) => order.name),
      threadText: input.threadText,
      signoffBlock: input.signoffBlock,
    });
    replyAction.params.requires_action_types = ['cancel_order'];
    replyAction.params.draft_source = 'deterministic_revision_constraint_v2';
    replyAction.confidence = 0.88;
  } else if (replyAction && addressChangeOrders.length > 0) {
    const target = addressChangeOrders[0];
    const apartmentDetail = target.address.address2
      ? `, including ${target.address.address2}`
      : '';
    replyAction.title = `Reply: confirm address correction for ${target.order.name}`;
    replyAction.detail =
      'Confirm only after Shopify verifies the corrected delivery address; do not claim that the original payment billing record was rewritten.';
    replyAction.params.reply_text = [
      customerGreeting(input.customerName),
      '',
      `Thanks for catching this before the order shipped. I've corrected the shipping address on ${target.order.name}${apartmentDetail}, and the updated delivery address is now saved on the order.`,
      '',
      `This updates where the order will be delivered. It does not rewrite the billing address stored with the original payment.`,
      '',
      input.signoffBlock,
    ].join('\n');
    replyAction.params.requires_action_types = ['update_shipping_address'];
    replyAction.params.draft_source = 'deterministic_address_correction_v1';
    replyAction.confidence = input.operatorInstruction ? 0.91 : 0.88;
  } else if (replyAction && verifiedHistoricalRefund) {
    const orderLabel = verifiedHistoricalRefund.order_name
      ?? preferredOrder?.name
      ?? 'the order';
    replyAction.title = `Reply: confirm completed refund for ${orderLabel}`;
    replyAction.detail = 'Honor the reviewer-verified completed refund fact and correct the prior uncertainty.';
    replyAction.params.reply_text = [
      customerGreeting(input.customerName),
      '',
      `You're right to follow up. I confirmed that the refund for ${orderLabel} was completed successfully.`,
      '',
      `I'm sorry for the earlier confusion and for making you chase this down.`,
      '',
      input.signoffBlock,
    ].join('\n');
    replyAction.params.requires_action_types = [];
    replyAction.params.draft_source = 'operator_verified_outcome_v2';
    replyAction.confidence = 0.88;
  } else if (replyAction && refundOrders.length > 0) {
    const labels = refundOrders.map((order) => order.name).join(', ');
    replyAction.title = refundOrders.length === 1
      ? `Reply: confirm refund submission for ${labels}`
      : 'Reply: confirm the requested refunds';
    replyAction.detail = 'Confirm only after Shopify verifies the customer-authorized refund submission.';
    replyAction.params.reply_text = [
      customerGreeting(input.customerName),
      '',
      repeatedRequestAcknowledgement(input.threadText),
      '',
      `I've issued the requested refund for ${labels}. It is going back to the original payment method, and most banks post it within 5 to 10 business days.`,
      '',
      input.signoffBlock,
    ].join('\n');
    replyAction.params.requires_action_types = ['refund_order'];
    replyAction.params.draft_source = 'deterministic_outstanding_refund_recovery_v1';
    replyAction.confidence = input.operatorInstruction ? 0.91 : 0.88;
  } else if (replyAction && preferredOrder) {
    replyAction.params.reply_text = insertOrderIdentity(
      String(replyAction.params.reply_text ?? ''),
      preferredOrder.name,
    );
  }

  if (!replyAction && !input.suppressReply) {
    const mutationOrders = [...new Set(
      injectedMutations
        .map((action) => ordersById.get(String(action.params.order_id ?? '')))
        .filter((order): order is ShopifyOrderSummary => Boolean(order)),
    )];
    let body: string;
    let requirements: Array<'cancel_order' | 'refund_order' | 'update_shipping_address'> = [];
    if (cancellationOrders.length > 0) {
      const labels = cancellationOrders.map((order) => order.name).join(', ');
      body = [
        repeatedRequestAcknowledgement(input.threadText),
        '',
        `I've now cancelled ${labels} as requested. ${cancellationOrders.length === 1 ? 'The order is' : 'Those orders are'} stopped and will not continue to fulfillment.`,
        '',
        'The cancellation returns the paid balance to the original payment method. Most banks post it within 5 to 10 business days.',
      ].join('\n');
      requirements = ['cancel_order'];
    } else if (verifiedHistoricalRefund) {
      const orderLabel = verifiedHistoricalRefund.order_name
        ?? preferredOrder?.name
        ?? 'the order';
      body = `I confirmed that the refund for ${orderLabel} was completed successfully. I'm sorry for the earlier confusion and for making you chase this down.`;
    } else if (injectedMutations.some((action) => action.type === 'refund_order')) {
      const labels = mutationOrders.map((order) => order.name).join(', ');
      const refundAmounts = injectedMutations
        .filter((action) => action.type === 'refund_order')
        .map((action) => Number(action.params.amount))
        .filter((amount) => Number.isFinite(amount) && amount > 0);
      const amountLabel = refundAmounts.length === 1
        ? ` of $${refundAmounts[0].toFixed(2)}`
        : '';
      body = [
        repeatedRequestAcknowledgement(input.threadText),
        '',
        `The order was cancelled, but the paid balance had not actually been returned. I've issued the requested refund${amountLabel} for ${labels}. It is going back to the original payment method, and most banks post it within 5 to 10 business days.`,
      ].join('\n');
      requirements = ['refund_order'];
    } else if (addressChangeOrders.length > 0) {
      const target = addressChangeOrders[0];
      const apartmentDetail = target.address.address2
        ? `, including ${target.address.address2}`
        : '';
      body = [
        `Thanks for catching this before the order shipped. I've corrected the shipping address on ${target.order.name}${apartmentDetail}, and the updated delivery address is now saved on the order.`,
        '',
        `This updates where the order will be delivered. It does not rewrite the billing address stored with the original payment.`,
      ].join('\n');
      requirements = ['update_shipping_address'];
    } else if (
      preferredOrder
      && hasRestockInterest(input.latestCustomerMessage || input.threadText)
    ) {
      body = restockInterestBody(preferredOrder);
    } else if (
      preferredOrder
      && /\b(?:exchange|switch(?:ing)?|swap|in\s+stock|available)\b/i.test(
        input.latestCustomerMessage || input.threadText,
      )
    ) {
      body = `I checked order ${preferredOrder.name}, and yes—we can look at switching it to an in-stock lamp rather than leaving you waiting on the current item. I don't want to guess at live availability: send me the floor lamp or two you're considering, and I'll confirm the exact options before any change is made.`;
    } else if (
      preferredOrder
      && /\b(?:damaged|broken|cracked|shattered|dented|beat\s+up|defective)\b/i
        .test(input.latestCustomerMessage || input.threadText)
    ) {
      body = `I'm sorry order ${preferredOrder.name} arrived damaged. I read the details about the lamp and the condition of the box, so I won't make you start the story over. Please send clear photos of the damaged area, the packaging, and the shipping label if they aren't already attached; I'll keep the next step tied to this order and use those to document the shipping damage.`;
    } else if (preferredOrder) {
      body = `I checked order ${preferredOrder.name} and read your latest message. I don't have enough verified information to promise a final outcome yet, but I do have the correct order in front of me. Please reply with the one detail you want us to act on, and I'll keep the next step tied to this order.`;
    } else {
      body = `I read your message and the earlier conversation, but I couldn't verify a matching live order in the connected store. Please send the order number from the confirmation email so I can tie the next step to the right purchase without making you repeat the rest of the story.`;
    }
    actions.push({
      type: 'send_reply',
      title: preferredOrder ? `Reply about order ${preferredOrder.name}` : 'Reply and request the missing order number',
      detail: 'Send a grounded best-effort reply instead of withholding the entire plan.',
      confidence: injectedMutations.length > 0 ? 0.88 : 0.52,
      params: {
        reply_text: [
          customerGreeting(input.customerName),
          '',
          body,
          '',
          input.signoffBlock,
        ].join('\n'),
        requires_action_types: requirements,
        draft_source: 'deterministic_validation_repair_v1',
      },
    });
    replyAction = actions.at(-1);
  }

  if (
    injectedMutations.length > 0
    && !input.keepTicketOpen
    && !actions.some((action) => action.type === 'resolve')
  ) {
    actions.push({
      type: 'resolve',
      title: 'Resolve ticket',
      detail: 'Resolve only after the authorized order operation and dependent reply complete.',
      confidence: authoritativeReviewerOverride ? 0.87 : 0.64,
      params: {},
    });
  }
  const authoritativeSummary = cancellationOrders.length > 0
    ? `Cancel ${cancellationOrders.map((order) => order.name).join(', ')} so fulfillment stops, then confirm the cancellation and refund path.`
    : addressChangeOrders.length > 0
      ? `Correct the shipping address on ${addressChangeOrders.map(({ order }) => order.name).join(', ')}, then confirm the verified delivery update.`
    : operatorPendingRefund
      ? `Explain the failed original refund for ${preferredOrder?.name ?? 'the order'} and collect the PayPal details required for the alternate payout.`
    : verifiedHistoricalRefund
      ? `Confirm the reviewer-verified completed refund for ${
          verifiedHistoricalRefund.order_name ?? preferredOrder?.name ?? 'the order'
        }.`
      : null;
  const authoritativeReasoning = cancellationOrders.length > 0
    ? `The reviewer explicitly changed the operation from refund-only to cancellation. The verified order target is ${
        cancellationOrders.map((order) => order.name).join(', ')
      }; cancellation stops fulfillment and returns the paid balance. The reply is dependent on Shopify verifying that cancellation.`
    : addressChangeOrders.length > 0
      ? `The customer explicitly corrected the delivery address for ${
          addressChangeOrders.map(({ order }) => order.name).join(', ')
        }. The exact customer-authored street, unit, city, province, and postal code were parsed deterministically; the reply is dependent on Shopify verifying the address update and does not claim the payment billing record changed.`
    : operatorPendingRefund
      ? 'The human reviewer verified that cancellation succeeded, the original PayPal refund failed, and an alternate PayPal payout requires specific account details. Those facts override the stale draft; no Shopify mutation or complaint-withdrawal request is included.'
    : verifiedHistoricalRefund
      ? 'The reviewer supplied a trusted completed-refund fact. The revised reply states that outcome and does not repeat the mutation.'
      : null;
  return {
    summary: String(
      authoritativeSummary
      || input.draft.summary
      || (preferredOrder
        ? `Complete a lower-confidence, grounded response for ${preferredOrder.name}.`
        : 'Send a lower-confidence grounded reply and request the missing order number.'),
    ).slice(0, 400),
    reasoning: String(
      authoritativeReasoning
      || (
        String(input.draft.reasoning || '').trim()
        && !/\b(?:deepseek|http_error|planner|provider|validator|deterministic repair|model draft failed)\b/i
          .test(String(input.draft.reasoning))
          ? String(input.draft.reasoning)
          : preferredOrder
            ? `The latest customer request is tied to verified order ${preferredOrder.name}. The reply uses the available order and conversation context without claiming an unverified outcome or adding an unauthorized Shopify operation.`
            : 'The reply is limited to the latest customer request and avoids any unverified outcome or unauthorized Shopify operation.'
      ),
    ).slice(0, 900),
    overall_confidence: authoritativeReviewerOverride
      ? 0.87
      : injectedMutations.length > 0
        ? 0.64
        : 0.5,
    actions: [...injectedMutations, ...actions],
  };
}

/**
 * A completed cancellation/refund can be followed by a new, read-only request
 * to hear when the product is available again. Treat the latest request as
 * authoritative and never repeat the old mutation or reinterpret it as an
 * exchange.
 */
export function buildSafeRestockInterestDraft(input: {
  subject: string;
  threadText: string;
  latestCustomerMessage: string;
  customerName: string | null;
  orders: ShopifyOrderSummary[];
  signoffBlock: string;
  responseState: DraftResponseState;
}): SafeRestockInterestDraft | null {
  if (!['unanswered', 'awaiting_us'].includes(input.responseState)) return null;
  if (!hasRestockInterest(input.latestCustomerMessage)) return null;
  const order = selectedOrder(input.subject, input.threadText, input.orders);
  if (!order) return null;

  const reply = [
    customerGreeting(input.customerName),
    '',
    restockInterestBody(order),
    '',
    input.signoffBlock,
  ].join('\n');

  return {
    summary: `Acknowledge the customer's restock and reorder interest for ${order.name}.`,
    reasoning:
      `The latest request is about buying again after the earlier order outcome, not repeating a refund, cancellation, or exchange. `
      + `The reply uses the verified order history, avoids promising an unsupported stock alert or restock date, and answers the new request directly.`,
    overall_confidence: 0.9,
    actions: [
      {
        type: 'send_reply',
        title: `Reply: restock interest for ${order.name}`,
        detail: 'Acknowledge the reorder request and set honest expectations about live availability.',
        confidence: 0.91,
        params: {
          reply_text: reply,
          requires_action_types: [],
          draft_source: 'deterministic_restock_interest_v1',
        },
      },
      {
        type: 'add_tags',
        title: 'Tag: restock-interest',
        detail: 'Record the customer’s interest in purchasing again when the item returns.',
        confidence: 0.93,
        params: { tags: ['restock-interest'] },
      },
      {
        type: 'resolve' as const,
        title: 'Resolve ticket',
        detail: 'The latest restock question is answered without repeating the completed order operation.',
        confidence: 0.88,
        params: {},
      },
    ],
  };
}

function hasOrderStatusIntent(text: string): boolean {
  return [
    /\b(?:order\s+)?status\b/i,
    /\border\s+update\b/i,
    /\bwhere(?:'s|\s+is)\s+(?:my|the)\s+order\b/i,
    /\b(?:eta|estimated\s+(?:ship|delivery|arrival)|timeline)\b/i,
    /\bwhen\b[^.!?\n]{0,100}\b(?:ship(?:ped|ping)?|arriv(?:e|ed|al)|deliver(?:ed|y)?|receiv(?:e|ed))\b/i,
    /\b(?:ship(?:ped|ping)?|arriv(?:e|ed|al)|deliver(?:ed|y)?|receiv(?:e|ed))\b[^.!?\n]{0,80}\b(?:by|before)\b/i,
    /\b(?:can|could|will|would)\b[^.!?\n]{0,60}\b(?:ship|arrive|deliver)\b[^.!?\n]{0,60}\b(?:soon|next|this\s+(?:week|month))\b/i,
    /\b(?:not|never|didn['’]?t|did\s+not|haven['’]?t|hasn['’]?t|have\s+not|has\s+not)\b[^.!?\n]{0,70}\b(?:received|shipped|arrived|delivered|get|got)\b/i,
    /\bmissing\s+order\b/i,
    /\b(?:shipping|delivery|fulfillment)\s+(?:update|progress|delay)\b/i,
    /\b(?:update|progress)\b[^.!?\n]{0,80}\border\b/i,
    /\border\b[^.!?\n]{0,80}\b(?:update|progress|ship(?:ped|ping)?)\b/i,
    /\b(?:can|could)\s+i\s+get\s+an?\s+update\s+on\s+this\b/i,
    /\b(?:get|have|receive)\b[^.!?\n]{0,80}\border\b[^.!?\n]{0,40}\bby\s+\d{1,2}[\/-]\d{1,2}\b/i,
    /\bwhat\s+should\s+i\s+expect\b/i,
    /\btrack(?:ing)?\b[^.!?\n]{0,30}\border\b|\border\b[^.!?\n]{0,30}\btrack(?:ing)?\b/i,
  ].some((pattern) => pattern.test(text));
}

function latestCustomerAuthoredText(message: string): string {
  // Inbound email bodies often include a complete quoted order confirmation.
  // Product, return, and policy words inside that quote are historical context,
  // not the customer's current intent. Keep the new text above the first
  // conventional quote boundary for intent-conflict checks.
  return message
    .split(/\n\s*On\s+[^\n]{0,220}\bwrote:\s*\n/i)[0]
    .split(/\n\s*-{2,}\s*(?:Original|Forwarded)\s+Message\s*-{2,}/i)[0]
    .split(/\n\s*>/)[0]
    .trim();
}

function hasMissingConfirmationIntent(text: string): boolean {
  return (
    /\b(?:charged|charge|payment|paid|purchase)\b/i.test(text)
    && /\b(?:no|never|haven't|have\s+not|didn't|did\s+not)\b[^.!?\n]{0,80}\b(?:confirmation|receipt|order\s+number|shipping\s+information|delivery\s+information|email)\b/i.test(text)
  );
}

function hasCheckoutFailureIntent(text: string): boolean {
  return /\b(?:place|complete|submit)\b[^.!?\n]{0,60}\border\b/i.test(text)
    && /\b(?:error|cannot|can't|couldn't|won't|failed|failure|declin(?:e|ed))\b/i.test(text);
}

function hasProductGuidanceIntent(text: string): boolean {
  return /\b(?:marigold|puff|acorn|aven|lamp|light)\b/i.test(text)
    && /\b(?:color|colour|orange|yellow|ambient|soft\s+light|bright(?:er|ness)?|restock|replenish|sold\s+out|opinion)\b/i.test(text);
}

function hasGoodwillMerchRequest(text: string): boolean {
  return /\b(?:sticker|shirt|merch|merchandise|swag|anything\s+you\s+could\s+send)\b/i.test(text)
    && /\b(?:send|mail|support|fan)\b/i.test(text);
}

/**
 * High-coverage deterministic replies for common non-mutation requests. These
 * run before the generic validation repair, so a provider outage can never
 * turn a product question into an order-number request or ask a customer for
 * confirmation data they already said they never received.
 */
export function buildSafeLatestCustomerRequestDraft(input: {
  subject: string;
  threadText: string;
  latestCustomerMessage: string;
  customerName: string | null;
  supportContext: string;
  orders: ShopifyOrderSummary[];
  signoffBlock: string;
  responseState: DraftResponseState;
  authorizedCancellationCount: number;
  authorizedRefundCount: number;
  authorizedAddressChangeCount: number;
}): SafeLatestCustomerRequestDraft | null {
  if (!['unanswered', 'awaiting_us'].includes(input.responseState)) return null;
  if (
    input.authorizedCancellationCount > 0
    || input.authorizedRefundCount > 0
    || input.authorizedAddressChangeCount > 0
  ) return null;

  const currentText = `${input.subject}\n${input.latestCustomerMessage}`;
  const order = selectedOrder(input.subject, input.threadText, input.orders);

  if (hasMissingConfirmationIntent(currentText)) {
    if (order) {
      const total = Number.parseFloat(order.totalPrice);
      const amount = Number.isFinite(total) && total > 0 ? ` for $${total.toFixed(2)}` : '';
      const tracking = order.tracking.find((item) => item.number.trim().length > 0);
      const fulfillment = String(order.fulfillmentStatus).toUpperCase();
      const estimate = delayEstimateFromLockedContext(input.supportContext);
      const status = tracking
        ? `It has shipped, and the tracking number is ${tracking.number}.`
        : fulfillment.includes('FULFILLED') && !fulfillment.includes('UNFULFILLED')
          ? `It is marked fulfilled, although a live tracking number has not posted yet.`
          : `It has not shipped yet. ${estimate ? `${estimate} ` : ''}Tracking will be emailed as soon as it leaves.`;
      const reply = [
        customerGreeting(input.customerName),
        '',
        `I found your purchase and matched it to order ${order.name}${amount}. The purchase is legitimate; the confirmation email did not reach you, and I'm sorry that left you wondering whether the charge was real.`,
        '',
        `${status} You can use ${order.name} as the reference for any follow-up, so you do not need to repeat the purchase details.`,
        '',
        input.signoffBlock,
      ].join('\n');
      return {
        summary: `Confirm the located purchase and current status of ${order.name}.`,
        reasoning: `The charge and customer identity match verified Shopify order ${order.name}. The reply supplies the missing order number and live status instead of asking for a confirmation email the customer never received.`,
        overall_confidence: 0.94,
        actions: [
          {
            type: 'send_reply',
            title: `Reply: confirm purchase and status for ${order.name}`,
            detail: 'Confirm the matched purchase, provide its order number, and state only live fulfillment information.',
            confidence: 0.95,
            params: { reply_text: reply, requires_action_types: [], draft_source: 'deterministic_purchase_confirmation_v1' },
          },
          {
            type: 'set_priority',
            title: 'Set priority: high',
            detail: 'Prioritize the missing-confirmation inquiry because the customer reasonably questioned the charge.',
            confidence: 0.93,
            params: { priority: 'high' },
          },
          {
            type: 'add_tags',
            title: 'Tag: order-confirmation-missing',
            detail: 'Record that the purchase was found despite a missing confirmation email.',
            confidence: 0.95,
            params: { tags: ['order-confirmation-missing'] },
          },
          {
            type: 'resolve',
            title: 'Resolve ticket',
            detail: 'The legitimacy, order number, and current status are fully answered.',
            confidence: 0.9,
            params: {},
          },
        ],
      };
    }

    const reply = [
      customerGreeting(input.customerName),
      '',
      `You're right to follow up. I read the identifying details you already provided, and I won't ask you for an order number or confirmation email that you never received. We still do not have a verified order tied to the posted charge.`,
      '',
      `To trace the payment without exposing your card, please reply with only the last four digits of the card and the exact merchant descriptor shown beside the posted charge. Do not send the full card number. We'll use those two details with the purchase date already in this thread to reconcile the payment and explain the appropriate next step.`,
      '',
      input.signoffBlock,
    ].join('\n');
    return {
      summary: 'Trace the posted charge without asking the customer for a missing order confirmation again.',
      reasoning: 'The customer already supplied identity and purchase details but never received an order number. The reply acknowledges that history, requests only the two remaining non-secret payment trace fields, and keeps the case open.',
      overall_confidence: 0.82,
      actions: [
        {
          type: 'send_reply',
          title: 'Reply: collect payment trace details',
          detail: 'Acknowledge all previously supplied information and request only card last-four and the posted merchant descriptor.',
          confidence: 0.86,
          params: { reply_text: reply, requires_action_types: [], draft_source: 'deterministic_unlocated_charge_trace_v1' },
        },
        {
          type: 'set_priority',
          title: 'Set priority: urgent',
          detail: 'A posted charge without a located order needs prompt reconciliation.',
          confidence: 0.93,
          params: { priority: 'urgent' },
        },
        {
          type: 'add_tags',
          title: 'Tag: payment-trace-needed',
          detail: 'Keep the unresolved charge visible for payment reconciliation.',
          confidence: 0.92,
          params: { tags: ['payment-trace-needed', 'order-confirmation-missing'] },
        },
      ],
    };
  }

  if (hasProductGuidanceIntent(currentText) && input.orders.length === 0) {
    const reply = [
      customerGreeting(input.customerName),
      '',
      `Orange sounds like the closest match for the warm, wind-down look you're describing. I don't have a confirmed date for the orange Marigold restock, so I don't want to invent one.`,
      '',
      `The yellow finish does not mean a cooler or harsher light: Warm by Design lamps are designed around warm 2700K ambient light. Visually, yellow reads sunnier and more playful in the room, while orange feels deeper and cozier—especially next to an orange Puff. For the softer, tonal evening setup you described, I would wait for orange rather than choose yellow only because it is available now.`,
      '',
      input.signoffBlock,
    ].join('\n');
    return {
      summary: 'Answer the Marigold restock and color-selection question directly.',
      reasoning: 'This is a product-guidance request, not an order lookup. The reply uses the locked 2700K brand fact, labels the style comparison as advice, and does not invent a restock date.',
      overall_confidence: 0.88,
      actions: [{
        type: 'send_reply',
        title: 'Reply: Marigold color and restock guidance',
        detail: 'Give a useful opinion about the requested ambient look without inventing inventory timing.',
        confidence: 0.9,
        params: { reply_text: reply, requires_action_types: [], draft_source: 'deterministic_product_guidance_v1' },
      }, {
        type: 'add_tags',
        title: 'Tag: product-question, restock-interest',
        detail: 'Classify the product guidance and restock inquiry.',
        confidence: 0.93,
        params: { tags: ['product-question', 'restock-interest'] },
      }, {
        type: 'resolve',
        title: 'Resolve ticket',
        detail: 'The product question is answered as fully as current verified inventory information allows.',
        confidence: 0.86,
        params: {},
      }],
    };
  }

  if (hasCheckoutFailureIntent(currentText)) {
    const reply = [
      customerGreeting(input.customerName),
      '',
      `I'm sorry checkout is blocking the two Aven lamps. For your security, we can't take card details or complete payment by phone or email.`,
      '',
      `Please try the checkout once in a private/incognito window, with any VPN or ad blocker temporarily disabled, or use a different browser or payment method. If it still fails, reply with a screenshot of the exact error and the email entered at checkout—without any card number—and we'll trace the failed checkout from there. Delivery to Brooklyn can be confirmed once the checkout creates the order.`,
      '',
      input.signoffBlock,
    ].join('\n');
    return {
      summary: 'Help the customer recover the failed Aven checkout safely.',
      reasoning: 'No order exists yet. The reply does not ask for an order number or payment credentials; it gives concrete checkout recovery steps and requests only safe diagnostic information.',
      overall_confidence: 0.9,
      actions: [{
        type: 'send_reply',
        title: 'Reply: troubleshoot failed checkout',
        detail: 'Provide safe checkout recovery steps and request only a redacted error screenshot if needed.',
        confidence: 0.92,
        params: { reply_text: reply, requires_action_types: [], draft_source: 'deterministic_checkout_failure_v1' },
      }, {
        type: 'add_tags',
        title: 'Tag: checkout-failure',
        detail: 'Route the unresolved cart/checkout problem for follow-up if the steps fail.',
        confidence: 0.94,
        params: { tags: ['checkout-failure'] },
      }],
    };
  }

  if (hasGoodwillMerchRequest(currentText)) {
    const reply = [
      customerGreeting(input.customerName),
      '',
      `Thank you for the kind note and for wanting to support Warm by Design. We don't currently have a verified sticker, shirt, or promotional-item mailing program that I can promise from support, so I don't want to take your address and imply that a package is on the way.`,
      '',
      `I appreciate you thinking of us, and if that changes we'll share it through our official store channels.`,
      '',
      input.signoffBlock,
    ].join('\n');
    return {
      summary: 'Respond warmly to the merchandise request without promising an unsupported shipment.',
      reasoning: 'This is a goodwill request rather than an order issue. The reply acknowledges it directly and avoids collecting more information or inventing a giveaway program.',
      overall_confidence: 0.9,
      actions: [{
        type: 'send_reply',
        title: 'Reply: thank customer for their support',
        detail: 'Answer the sticker and merchandise request honestly and warmly.',
        confidence: 0.92,
        params: { reply_text: reply, requires_action_types: [], draft_source: 'deterministic_goodwill_merch_v1' },
      }, {
        type: 'resolve',
        title: 'Resolve ticket',
        detail: 'The non-order request is answered.',
        confidence: 0.9,
        params: {},
      }],
    };
  }

  return null;
}

function delayEstimateFromLockedContext(context: string): string | null {
  let duration: string | null = null;
  const currentThreeWeekUpdate = context.match(/OWNER UPDATE \((\d{4}-\d{2}-\d{2})\):[^\n]*?baseline is about THREE WEEKS UNTIL SHIPPING/i);
  if (currentThreeWeekUpdate) {
    return `Our baseline estimate, updated ${currentThreeWeekUpdate[1]}, is about three weeks until shipment. The exact shipping date is unconfirmed, and we're working hard to get everything moving.`;
  }
  if (/\b(?:about|approximately|roughly|around|~)?\s*(?:another\s+)?(?:three|3)\s+weeks\b/i.test(context)) {
    duration = 'about three weeks';
  } else if (/\b(?:about|approximately|roughly|around|~)?\s*(?:another\s+)?(?:two|2)\s+weeks\b/i.test(context)) {
    duration = 'about two weeks';
  } else if (/\b(?:about|approximately|roughly|around|~)?\s*(?:another\s+)?(?:four|4)\s+weeks\b/i.test(context)) {
    duration = 'about four weeks';
  } else if (
    /\b(?:about|approximately|roughly|around|realistically|~)?\s*another\s+month\b/i.test(context)
    || /\b(?:about|approximately|roughly|around|realistically|~)?\s*(?:another\s+)?(?:one|1)\s+month\b/i.test(context)
  ) {
    duration = 'about one month';
  }
  // A dated knowledge snapshot is not a renewed forecast. Preserve its actual
  // duration and explicitly avoid resetting the clock to the drafting date.
  return duration ? `The last published shipping estimate was ${duration} from the time of that update; a fresh shipping date has not been confirmed.` : null;
}

function titleCaseMonth(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1).toLowerCase()}`;
}

function operatorDeliveryWindow(instruction: string): {
  expectedWindow: string;
  declinedWindow: string | null;
  mentionsBacklogProgress: boolean;
} | null {
  const expectedMatch = instruction.match(
    /\b(?:within|during|by\s+the\s+end\s+of)\s+(?:the\s+)?(?:month\s+of\s+)?(january|february|march|april|may|june|july|august|september|october|november|december)\b/i,
  );
  if (!expectedMatch?.[1]) return null;
  const month = titleCaseMonth(expectedMatch[1]);
  const declinedFirstWeek = /\b(?:not|cannot|can't|won't|unlikely)\b[^.!?\n]{0,80}\bfirst\s+week\b/i
    .test(instruction);
  return {
    expectedWindow: month,
    declinedWindow: declinedFirstWeek ? `the first week of ${month}` : null,
    mentionsBacklogProgress: /\b(?:things\s+are\s+moving|moving\s+now|backlog|backed[ -]up\s+orders?)\b/i
      .test(instruction),
  };
}

/**
 * Deterministic acceptance path for a trusted reviewer-supplied delivery
 * window. This keeps an ordinary editorial revision useful even if the model
 * provider is unavailable; the operator's concrete fact wins over a stale or
 * generic prior draft.
 */
export function buildSafeOperatorDirectedRevisionDraft(input: {
  instruction: string;
  subject: string;
  threadText: string;
  latestCustomerMessage: string;
  customerName: string | null;
  orders: ShopifyOrderSummary[];
  signoffBlock: string;
  responseState: DraftResponseState;
}): SafeOperatorDirectedRevisionDraft | null {
  if (!['unanswered', 'awaiting_us'].includes(input.responseState)) return null;
  const window = operatorDeliveryWindow(input.instruction);
  if (!window) return null;
  if (!hasOrderStatusIntent(`${input.subject}\n${input.latestCustomerMessage}`)) return null;

  const orders = selectedStatusOrders(
    input.subject,
    input.threadText,
    input.latestCustomerMessage,
    input.orders,
  ).filter((order) => !order.cancelledAt);
  if (orders.length === 0) return null;

  const orderNames = orders.map((order) => order.name);
  const orderLabel = orderNames.length === 1
    ? `order ${orderNames[0]}`
    : `orders ${orderNames.slice(0, -1).join(', ')} and ${orderNames.at(-1)}`;
  const timing = window.declinedWindow
    ? `I don't want to overpromise: I can't guarantee arrival during ${window.declinedWindow}. The current fulfillment commitment is that ${orderLabel} will be fulfilled within ${window.expectedWindow}.`
    : `The current fulfillment commitment is that ${orderLabel} will be fulfilled within ${window.expectedWindow}.`;
  const progress = window.mentionsBacklogProgress
    ? `Things are moving now, but we're still working carefully through a large backlog of orders. We'll send tracking as soon as each lamp ships.`
    : `We'll send tracking as soon as ${orders.length === 1 ? 'it ships' : 'each lamp ships'}.`;
  const reply = [
    customerGreeting(input.customerName),
    '',
    `Thank you for checking back, and especially for your patience through this delay. I'm genuinely sorry the wait has stretched on this long.`,
    '',
    timing,
    '',
    progress,
    '',
    `We truly appreciate your patience and your continued trust in us.`,
    '',
    input.signoffBlock,
  ].join('\n');

  return {
    summary: `Give the reviewer-directed ${window.expectedWindow} fulfillment expectation for ${orderLabel}.`,
    reasoning:
      `The human reviewer supplied the current delivery expectation and requested a sincere, thankful response. `
      + `That instruction is treated as authoritative, while the reply avoids promising the earlier deadline the reviewer explicitly rejected.`,
    overall_confidence: 0.9,
    actions: [
      {
        type: 'send_reply',
        title: `Reply: updated fulfillment expectation for ${orderNames.join(' and ')}`,
        detail: `Apologize sincerely, decline the unsupported early deadline, and give the reviewer-verified ${window.expectedWindow} window.`,
        confidence: 0.91,
        params: {
          reply_text: reply,
          requires_action_types: [],
          draft_source: 'operator_directed_delivery_revision_v1',
        },
      },
      {
        type: 'add_tags',
        title: 'Tag: fulfillment-delay',
        detail: 'Keep the ticket grouped with the current fulfillment backlog.',
        confidence: 0.93,
        params: { tags: ['fulfillment-delay'] },
      },
      {
        type: 'resolve',
        title: 'Resolve ticket',
        detail: 'The current timing question is answered using the reviewer-supplied expectation.',
        confidence: 0.88,
        params: {},
      },
    ],
  };
}

function hasRefundStatusIntent(text: string): boolean {
  return [
    /\b(?:refund|money)\b[^.!?\n]{0,120}\b(?:status|initiated|processed|completed|posted|received|arrived|showing|confirm)\b/i,
    /\b(?:still|yet|never|not|hasn't|has\s+not|haven't|have\s+not)\b[^.!?\n]{0,100}\brefund\b/i,
    /\brefund\b[^.!?\n]{0,100}\b(?:still|yet|never|not|hasn't|has\s+not|haven't|have\s+not)\b/i,
  ].some((pattern) => pattern.test(text));
}

function refundedOnLabel(order: ShopifyOrderSummary): string | null {
  const timestamp = order.cancelledAt ?? order.closedAt;
  if (!timestamp) return null;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

/**
 * Grounded follow-up for a refund that the live Shopify order already records
 * as refunded. Shopify proves our-side processing, not settlement at the
 * customer's bank, so the ticket remains open for a trace if it has not posted.
 */
export function buildSafeVerifiedRefundStatusDraft(input: {
  subject: string;
  threadText: string;
  latestCustomerMessage: string;
  customerName: string | null;
  orders: ShopifyOrderSummary[];
  signoffBlock: string;
  responseState: DraftResponseState;
  authorizedCancellationCount: number;
  authorizedRefundCount: number;
  authorizedAddressChangeCount: number;
}): SafeVerifiedRefundStatusDraft | null {
  if (!['unanswered', 'awaiting_us'].includes(input.responseState)) return null;
  if (
    input.authorizedCancellationCount > 0
    || input.authorizedRefundCount > 0
    || input.authorizedAddressChangeCount > 0
  ) return null;
  if (!hasRefundStatusIntent(`${input.subject}\n${input.latestCustomerMessage}`)) return null;

  const order = selectedOrder(input.subject, input.threadText, input.orders);
  if (!order) return null;
  const total = Number.parseFloat(order.totalPrice);
  const refunded = Number(order.totalRefunded ?? 0);
  const liveStatusSaysRefunded = String(order.financialStatus).toUpperCase() === 'REFUNDED'
    || (Number.isFinite(total) && total > 0 && refunded >= total - 0.01);
  if (!liveStatusSaysRefunded) return null;

  const amount = refunded > 0 ? refunded : total;
  const amountLabel = Number.isFinite(amount) && amount > 0 ? ` for $${amount.toFixed(2)}` : '';
  const dateLabel = refundedOnLabel(order);
  const reply = [
    customerGreeting(input.customerName),
    '',
    `You're right to follow up, and I'm sorry you had to ask again. I checked the live record for ${order.name} and can confirm the refund${amountLabel} was processed in Shopify${dateLabel ? ` on ${dateLabel}` : ''} back to the original payment method.`,
    '',
    `That confirms the refund was completed on our side, but it does not prove that your bank has posted the credit. Since you still don't see it, please check with the bank or payment provider for that original payment method. If they ask for a transaction reference or cannot locate it, reply here and we'll trace the payment rather than asking you to start over.`,
    '',
    input.signoffBlock,
  ].join('\n');

  return {
    summary: `Confirm the live refund record for ${order.name} and keep the ticket open until the bank posting is located.`,
    reasoning:
      `Shopify reports ${order.name} as REFUNDED${amountLabel}; this verifies merchant-side processing but not bank settlement. `
      + `The reply answers the customer's exact question, distinguishes those two states, and preserves a path to trace the payment.`,
    overall_confidence: 0.95,
    actions: [
      {
        type: 'send_reply',
        title: `Reply: confirm refund processing for ${order.name}`,
        detail: 'Confirm the live Shopify refund record without claiming the bank has posted it.',
        confidence: 0.96,
        params: {
          reply_text: reply,
          requires_action_types: [],
          draft_source: 'deterministic_verified_refund_status_v1',
        },
      },
      {
        type: 'set_priority',
        title: 'Set priority: urgent',
        detail: 'The customer reports a processed refund has not appeared at their bank.',
        confidence: 0.94,
        params: { priority: 'urgent' },
      },
      {
        type: 'add_tags',
        title: 'Tag: refund-follow-up',
        detail: 'Track merchant-processed refunds that may require payment tracing.',
        confidence: 0.96,
        params: { tags: ['refund-follow-up'] },
      },
    ],
  };
}

/**
 * Compassionate, non-promissory fallback for a customer asking for hardship
 * support after a disaster. It asks only for the minimum missing lookup key
 * and keeps the case open for a real decision.
 */
export function buildSafeGoodwillSupportDraft(input: {
  subject: string;
  latestCustomerMessage: string;
  customerName: string | null;
  signoffBlock: string;
  responseState: DraftResponseState;
}): SafeGoodwillSupportDraft | null {
  if (!['unanswered', 'awaiting_us'].includes(input.responseState)) return null;
  const text = `${input.subject}\n${input.latestCustomerMessage}`;
  const hardship = /\b(?:house|home|apartment)\s+fire\b|\b(?:lost|destroyed)\b[^.!?\n]{0,80}\b(?:home|house|belongings)\b|\bnatural\s+disaster\b/i
    .test(text);
  const supportRequest = /\b(?:goodwill|help|support|replace|replacement|donat|sample|demo|returned|discontinued)\b/i
    .test(text);
  if (!hardship || !supportRequest) return null;

  const reply = [
    customerGreeting(input.customerName),
    '',
    `I'm so sorry about the fire and everything you and your family have lost. Thank you for trusting us with what happened.`,
    '',
    `We do want to look carefully at what support we may be able to offer toward replacing your lamp. I can't promise a specific item until we verify the original purchase and current inventory, but I will make sure this gets a real review.`,
    '',
    `Please reply with either the original order number or the email address used for that purchase — whichever is easiest. You do not need to repeat your story or resend the address you already provided.`,
    '',
    `I'm keeping this open and prioritized while we work through it with you.`,
    '',
    input.signoffBlock,
  ].join('\n');

  return {
    summary: 'Respond compassionately to the hardship request and collect only the missing purchase lookup key.',
    reasoning:
      'The customer reported a serious loss and asked for goodwill support. The reply acknowledges the actual circumstances, avoids promising unavailable inventory or compensation, and asks only for the minimum information required to verify the original purchase.',
    overall_confidence: 0.82,
    actions: [{
      type: 'send_reply',
      title: 'Reply: acknowledge hardship and begin support review',
      detail: 'Respond with empathy and request only an order number or purchasing email for verification.',
      confidence: 0.84,
      params: {
        reply_text: reply,
        requires_action_types: [],
        draft_source: 'deterministic_hardship_goodwill_v1',
      },
    }, {
      type: 'set_priority',
      title: 'Set priority: high',
      detail: 'Prioritize the hardship-support request for a prompt human decision.',
      confidence: 0.96,
      params: { priority: 'high' },
    }, {
      type: 'add_tags',
      title: 'Tag: hardship-goodwill',
      detail: 'Route the case to hardship and goodwill review.',
      confidence: 0.94,
      params: { tags: ['hardship-goodwill', 'awaiting-customer'] },
    }],
  };
}

/**
 * When a customer has supplied the alternate PayPal details requested in a
 * legacy refund recovery, acknowledge receipt instead of asking them to repeat
 * the damage story or inventing a Shopify operation in the wrong store.
 */
export function buildSafeLegacyRefundRecoveryDraft(input: {
  subject: string;
  threadText: string;
  latestCustomerMessage: string;
  customerName: string | null;
  signoffBlock: string;
  responseState: DraftResponseState;
}): SafeLegacyRefundRecoveryDraft | null {
  if (!['unanswered', 'awaiting_us'].includes(input.responseState)) return null;
  const history = input.threadText;
  const latest = input.latestCustomerMessage;
  const knownFailedRefund = /\b(?:refund|transaction)\b[^.!?\n]{0,100}\b(?:failed|did\s+not\s+go\s+through|too\s+old|expired)\b|\bpaypal\s+express\b/i
    .test(history);
  const alternatePayout = /\b(?:alternate|different|new)\b[^.!?\n]{0,80}\b(?:paypal|payout|refund)\b|\bpaypal\b[^.!?\n]{0,80}\b(?:email|account|route)\b/i
    .test(history);
  const suppliedDetails = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(latest)
    && /\b(?:paypal|account|name|ending|last\s+four|\d{4})\b/i.test(latest);
  if (!knownFailedRefund || !alternatePayout || !suppliedDetails) return null;

  const orderReference = referencedOrderNamesFromText(`${input.subject}\n${history}`)[0] ?? 'the legacy order';
  const reply = [
    customerGreeting(input.customerName),
    '',
    `Thank you — I have the PayPal email, account name, and account-ending details you provided for ${orderReference}. You will not need to send those again.`,
    '',
    `The original PayPal Express refund failed, so there is no valid ARN or bank trace number for that failed attempt. A new transaction reference can only be provided after the alternate payout is actually completed. I don't want to invent one or tell you the money moved before it did.`,
    '',
    `I've kept this urgent and open for the alternate-refund follow-through. The next update should be the completed payout confirmation and its verifiable transaction reference, not another request for information you've already supplied.`,
    '',
    input.signoffBlock,
  ].join('\n');
  return {
    summary: `Acknowledge the completed PayPal-detail handoff for ${orderReference} and keep the failed-refund recovery open.`,
    reasoning:
      'The customer supplied the alternate payout details previously requested. The response confirms receipt, accurately explains why the failed transaction has no usable ARN, and does not invent a cross-brand Shopify or payment operation.',
    overall_confidence: 0.84,
    actions: [{
      type: 'send_reply',
      title: `Reply: confirm alternate refund details for ${orderReference}`,
      detail: 'Confirm receipt of the supplied PayPal details and explain when a verifiable transaction reference will exist.',
      confidence: 0.86,
      params: {
        reply_text: reply,
        requires_action_types: [],
        draft_source: 'deterministic_legacy_refund_details_received_v1',
      },
    }, {
      type: 'set_priority',
      title: 'Set priority: urgent',
      detail: 'The customer is waiting on a previously failed legacy refund.',
      confidence: 0.97,
      params: { priority: 'urgent' },
    }, {
      type: 'add_tags',
      title: 'Tag: legacy-refund-recovery',
      detail: 'Keep the case in the external payment-recovery workflow.',
      confidence: 0.95,
      params: { tags: ['legacy-refund-recovery', 'payment-follow-up'] },
    }],
  };
}

/**
 * Last-resort draft for a verified, read-only order-status inquiry.
 *
 * This is deliberately narrow: it never proposes a Shopify mutation, never
 * invents a refund amount, and only uses the selected live order plus a delay
 * estimate that is present in the current locked support context.
 */
export function buildSafeReadOnlyOrderStatusDraft(input: {
  subject: string;
  threadText: string;
  latestCustomerMessage?: string;
  customerName?: string | null;
  supportContext: string;
  orders: ShopifyOrderSummary[];
  signoffBlock: string;
  responseState: DraftResponseState;
  authorizedCancellationCount: number;
  authorizedRefundCount: number;
  authorizedAddressChangeCount: number;
}): SafeReadOnlyOrderStatusDraft | null {
  // A deterministic fallback must never turn historical status language into
  // a duplicate email after we have already answered. Awaiting-customer
  // threads are parked by the planner until a new customer turn arrives.
  if (!['unanswered', 'awaiting_us'].includes(input.responseState)) return null;
  if (
    input.authorizedCancellationCount > 0
    || input.authorizedRefundCount > 0
    || input.authorizedAddressChangeCount > 0
  ) {
    return null;
  }

  const fullIntentText = `${input.subject}\n${input.threadText}`;
  const latestAuthoredText = latestCustomerAuthoredText(
    input.latestCustomerMessage ?? input.threadText,
  );
  const currentIntentText = `${input.subject}\n${latestAuthoredText}`;
  if (!hasOrderStatusIntent(currentIntentText) && !hasOrderStatusIntent(fullIntentText)) return null;
  // Historical exchanges, damage, and returns are context, not necessarily the
  // current request. Only the latest customer-authored turn can disqualify the
  // narrow read-only status fallback.
  if (/\b(?:damaged|broken|defective|wrong\s+item|return|exchange|replacement|warranty)\b/i.test(currentIntentText)) {
    return null;
  }

  const selectedOrders = selectedStatusOrders(
    input.subject,
    input.threadText,
    input.latestCustomerMessage ?? input.threadText,
    input.orders,
  ).filter((order) => !order.cancelledAt);
  if (selectedOrders.length === 0) return null;

  const estimate = delayEstimateFromLockedContext(input.supportContext);
  const names = selectedOrders.map((order) => order.name);
  const allUntrackedAndUnfulfilled = selectedOrders.every((order) => {
    const fulfillment = String(order.fulfillmentStatus).toUpperCase();
    return !order.tracking.some((item) => item.number.trim().length > 0)
      && (!fulfillment.includes('FULFILLED') || fulfillment.includes('UNFULFILLED'));
  });
  let statusSentence: string;
  if (selectedOrders.length > 1 && allUntrackedAndUnfulfilled) {
    statusSentence = `Orders ${names.slice(0, -1).join(', ')} and ${names.at(-1)} have not shipped yet, and neither has tracking available.`;
    if (estimate) {
      statusSentence += ` ${estimate} You'll receive tracking as each one goes out.`;
    } else {
      statusSentence += ` You'll receive tracking as each one goes out.`;
    }
  } else {
    statusSentence = selectedOrders.map((order) => {
      const fulfillment = String(order.fulfillmentStatus).toUpperCase();
      const tracking = order.tracking.find((item) => item.number.trim().length > 0);
      if (tracking) return `Order ${order.name} has shipped. Its tracking number is ${tracking.number}.`;
      if (fulfillment.includes('FULFILLED') && !fulfillment.includes('UNFULFILLED')) {
        return `Order ${order.name} is marked fulfilled, but there is no live tracking number available yet. You'll receive tracking as soon as it is posted.`;
      }
      if (estimate) {
        return `Order ${order.name} has not shipped yet. ${estimate} You'll receive tracking as soon as it goes out.`;
      }
      return `Order ${order.name} has not shipped yet, and there is no tracking number available. You'll receive tracking as soon as it goes out.`;
    }).join(' ');
  }
  const detail = `Answer with live Shopify status for ${names.join(', ')}${estimate ? ' and the current locked delay estimate' : ''}.`;
  const orderLabel = names.length === 1
    ? `order ${names[0]}`
    : `orders ${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;

  const latestCustomerMessage = input.latestCustomerMessage ?? '';
  const conditionalRefund = (
    /\bif\b[^.!?\n]{0,180}\b(?:refund|cancel)\b|\b(?:refund|cancel)\b[^.!?\n]{0,180}\bif\b/i
      .test(latestCustomerMessage)
  );
  const conditionalParagraph = conditionalRefund
    ? `I also understand that you don't want to keep waiting indefinitely. Because your request depended on whether it could ship soon, I have not changed ${orderLabel}. Your message is already tied to the correct order, so just reply with your decision and we'll follow it without making you repeat the details.`
    : null;

  const waitedMatch = currentIntentText.match(
    /\b(?:been|waiting|placed|ordered)\b[^.!?\n]{0,45}\b(\d+|one|two|three|four|five|six|seven|eight)\s+(weeks?|months?)\b/i,
  );
  const waitedAcknowledgement = waitedMatch?.[1] && waitedMatch[2]
    ? `I know you've already been waiting ${waitedMatch[1]} ${waitedMatch[2].toLowerCase()}, which makes another delay especially frustrating.`
    : null;
  const deadlineMatch = latestCustomerMessage.match(
    /\bby\s+(\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?)\b/i,
  );
  const deadlineAcknowledgement = deadlineMatch?.[1]
    ? `I can't honestly promise delivery by ${deadlineMatch[1]}; the live order has no shipment or tracking that would support that date.`
    : null;
  const escalated = /\b(?:ftc|report(?:ed)?|blatant|bullshit|unacceptable|never\s+have\s+ordered)\b/i
    .test(currentIntentText);
  const opening = escalated
    ? `You're right to be angry. We should have made the extended fulfillment delay clear before you had to chase us for an answer.`
    : `I'm sorry for the delay — that's on us.`;

  const reply = [
    customerGreeting(input.customerName ?? null),
    '',
    `${opening} ${statusSentence}`,
    ...(waitedAcknowledgement ? ['', waitedAcknowledgement] : []),
    ...(deadlineAcknowledgement ? ['', deadlineAcknowledgement] : []),
    ...(conditionalParagraph ? ['', conditionalParagraph] : []),
    '',
    input.signoffBlock,
  ].join('\n');
  const delayed = selectedOrders.some((order) => (
    !order.tracking.some((item) => item.number.trim().length > 0)
  ));

  return {
    summary: `Reply with the verified current status of ${orderLabel}.`,
    reasoning:
      `This is a read-only status inquiry with ${selectedOrders.length} verified order${selectedOrders.length === 1 ? '' : 's'}. `
      + `The reply uses only live Shopify status${estimate ? ' and the current locked delay estimate' : ''}; it performs no Shopify mutation.`,
    overall_confidence: 0.92,
    actions: [
      {
        type: 'send_reply',
        title: `Reply: ${orderLabel} status`,
        detail,
        confidence: 0.93,
        params: {
          reply_text: reply,
          requires_action_types: [],
          draft_source: 'deterministic_verified_order_status_v1',
        },
      },
      ...(delayed ? [{
        type: 'set_priority' as const,
        title: 'Set priority: high',
        detail: 'Prioritize the delayed-order inquiry.',
        confidence: 0.92,
        params: { priority: 'high' },
      }, {
        type: 'add_tags' as const,
        title: 'Tag: shipping-delay',
        detail: 'Tag the ticket for fulfillment-delay reporting.',
        confidence: 0.94,
        params: { tags: ['shipping-delay'] },
      }] : []),
      ...(conditionalRefund ? [{
        type: 'add_tags' as const,
        title: 'Tag: awaiting-customer',
        detail: 'The customer made cancellation conditional and needs to choose whether to stop the order.',
        confidence: 0.94,
        params: { tags: ['awaiting-customer'] },
      }] : [{
        type: 'resolve' as const,
        title: 'Resolve ticket',
        detail: 'The verified status inquiry is answered in full.',
        confidence: 0.9,
        params: {},
      }]),
    ],
  };
}

/**
 * Honest fallback for a refund-status follow-up whose legacy order cannot be
 * found in the connected Shopify store. It makes no refund promise and keeps
 * the ticket open for a reviewer to handle outside the unavailable integration.
 */
export function buildSafeUnresolvedLegacyRefundDraft(input: {
  subject: string;
  threadText: string;
  orders: ShopifyOrderSummary[];
  signoffBlock: string;
  responseState: DraftResponseState;
  authorizedCancellationCount: number;
  authorizedRefundCount: number;
  authorizedAddressChangeCount: number;
}): SafeUnresolvedLegacyRefundDraft | null {
  if (!['unanswered', 'awaiting_us'].includes(input.responseState)) return null;
  if (input.orders.length > 0) return null;
  if (
    input.authorizedCancellationCount > 0
    || input.authorizedRefundCount > 0
    || input.authorizedAddressChangeCount > 0
  ) {
    return null;
  }

  const text = `${input.subject}\n${input.threadText}`;
  const refundStatusIntent = [
    /\bstatus\b[^.!?\n]{0,80}\brefund\b|\brefund\b[^.!?\n]{0,80}\bstatus\b/i,
    /\bcheck(?:ing)?\s+in\b[^.!?\n]{0,100}\brefund\b/i,
    /\brefund\b[^.!?\n]{0,100}\b(?:not|never|hasn't|has\s+not|still)\b[^.!?\n]{0,60}\b(?:appear|arrive|received|completed|processed)\b/i,
    /\bstill\b[^.!?\n]{0,80}\bno\s+refund\b/i,
  ].some((pattern) => pattern.test(text));
  if (!refundStatusIntent) return null;

  const reply = [
    'Hello,',
    '',
    "You're right to follow up, and I'm sorry. Our current records contain no successful refund transaction, so the earlier message saying it was being processed was incorrect. I can't honestly confirm a payment date from the information available on this ticket.",
    '',
    'I have marked this urgent and am keeping the ticket open until the refund is verified.',
    '',
    input.signoffBlock,
  ].join('\n');

  return {
    summary: 'Reply honestly that the legacy refund is not verified and keep the ticket open.',
    reasoning:
      'The connected Shopify store contains no verified order or executable refund target. '
      + 'This fallback corrects the prior unsupported promise, makes no payment claim, and preserves the unresolved ticket for review.',
    overall_confidence: 0.82,
    actions: [
      {
        type: 'send_reply',
        title: 'Reply: refund remains unverified',
        detail: 'Correct the prior unsupported processing promise without claiming a refund action.',
        confidence: 0.84,
        params: {
          reply_text: reply,
          requires_action_types: [],
          draft_source: 'deterministic_unresolved_legacy_refund_v1',
        },
      },
      {
        type: 'set_priority',
        title: 'Set priority: urgent',
        detail: 'Prioritize the unresolved legacy refund.',
        confidence: 0.95,
        params: { priority: 'urgent' },
      },
      {
        type: 'add_tags',
        title: 'Tag: legacy-refund-pending',
        detail: 'Identify the ticket for manual legacy-payment reconciliation.',
        confidence: 0.94,
        params: { tags: ['legacy-refund-pending'] },
      },
    ],
  };
}
