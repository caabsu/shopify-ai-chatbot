import type { CancelOrderResult } from './shopify-actions.service.js';

/**
 * Server-side guards for the storefront chat tools that act for a customer.
 *
 * The language model only proposes a tool call; nothing it says is trusted
 * here. A `cancel_order` reaches Shopify when the order number and email in
 * the call match the live order of the session's brand and that order is
 * untouched: not cancelled, nothing fulfilled or with the warehouse, no
 * refund, no dispute, no Dispute OS tag. Anything else is refused without a
 * Shopify write and handed to a human through escalate_to_human.
 */

/**
 * Dispute OS (Misu) holds risky orders and builds chargeback evidence under
 * tags with this prefix. A chat cancel would interfere with both.
 */
export const DISPUTE_OS_ORDER_TAG_PREFIX = 'dispute-os:';

/** Live order facts the gate decides on, read in one Shopify query. */
export interface ChatCancelOrderState {
  id: string;
  name: string;
  email: string | null;
  cancelledAt: string | null;
  displayFulfillmentStatus: string;
  tags: string[];
  fulfillments: Array<{ id: string }>;
  refunds: Array<{ id: string }>;
  disputes: Array<{ status: string }>;
}

export type ChatCancelRefusalReason =
  | 'missing_identity'
  | 'rate_limited_ip'
  | 'rate_limited_order'
  | 'order_unavailable'
  | 'order_not_found'
  | 'identity_mismatch'
  | 'already_cancelled'
  | 'dispute_os_tag'
  | 'dispute'
  | 'refunded'
  | 'not_unfulfilled';

/** The exact order GID, or null. Anything else never reaches Shopify. */
export function parseOrderGid(value: unknown): string | null {
  const match = typeof value === 'string' ? value.trim().match(/^gid:\/\/shopify\/Order\/(\d+)$/) : null;
  return match ? `gid://shopify/Order/${match[1]}` : null;
}

/** As lookup_order reads an order number: no `#`, spaces or leading zeros. Case-insensitive. */
export function normalizeOrderName(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/^[#\s]+/, '').replace(/^0+/, '').toLowerCase();
}

export function normalizeOrderEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/**
 * Why this cancel must not run, or null when it may. `claim` is already
 * normalised. Identity is decided first so that nothing about an order's state
 * is disclosed to a caller who has not proved the order is theirs.
 */
export function evaluateChatCancel(
  claim: { orderId: string; orderName: string; email: string },
  order: ChatCancelOrderState | null,
): ChatCancelRefusalReason | null {
  if (!order) return 'order_not_found';
  if (
    !claim.orderName
    || !claim.email
    || order.id !== claim.orderId
    || normalizeOrderName(order.name) !== claim.orderName
    || normalizeOrderEmail(order.email) !== claim.email
  ) {
    return 'identity_mismatch';
  }
  if (
    typeof order.displayFulfillmentStatus !== 'string'
    || ![order.tags, order.fulfillments, order.refunds, order.disputes].every(Array.isArray)
  ) {
    return 'order_unavailable';
  }
  if (order.cancelledAt) return 'already_cancelled';
  if (order.tags.some((tag) => String(tag).trim().toLowerCase().startsWith(DISPUTE_OS_ORDER_TAG_PREFIX))) {
    return 'dispute_os_tag';
  }
  // WON is the only outcome that leaves the payment with the store and the
  // case closed. Open cases, and cases the bank already paid back, need a person.
  if (order.disputes.some((dispute) => String(dispute?.status).toUpperCase() !== 'WON')) return 'dispute';
  if (order.refunds.length > 0) return 'refunded';
  if (order.fulfillments.length > 0 || order.displayFulfillmentStatus.toUpperCase() !== 'UNFULFILLED') {
    return 'not_unfulfilled';
  }
  return null;
}

export interface ChatCancelRefusal {
  success: false;
  completed: true;
  requires_human: boolean;
  reason: 'identity_not_verified' | 'already_cancelled' | 'needs_team_review';
  message: string;
}

/**
 * The tool result for a refused cancel. It tells the model what to do next and
 * never says why an order is under review: a hold or dispute is not something
 * to announce in chat.
 */
export function chatCancelRefusal(reason: ChatCancelRefusalReason): ChatCancelRefusal {
  const base = { success: false, completed: true } as const;
  switch (reason) {
    case 'missing_identity':
      return {
        ...base,
        requires_human: false,
        reason: 'identity_not_verified',
        message: 'The order was NOT cancelled. cancel_order needs the order ID from lookup_order, the order number and the email address on the order. Ask the customer for the email they used at checkout, then call cancel_order again. If they cannot provide it, use escalate_to_human so a team member can help.',
      };
    case 'order_not_found':
    case 'identity_mismatch':
      return {
        ...base,
        requires_human: true,
        reason: 'identity_not_verified',
        message: 'The order was NOT cancelled: the order number and email could not be verified together. Ask the customer to double-check the order number and the email they used at checkout. If they still cannot be verified, do not keep retrying. Use escalate_to_human so a team member can help.',
      };
    case 'already_cancelled':
      return {
        ...base,
        requires_human: false,
        reason: 'already_cancelled',
        message: 'This order is already cancelled, so nothing was changed. Do not call cancel_order again. If the customer has a question about it, such as the refund, use escalate_to_human.',
      };
    default:
      return {
        ...base,
        requires_human: true,
        reason: 'needs_team_review',
        message: 'The order was NOT cancelled. It cannot be cancelled in chat and needs a team member to review the request. Do not call cancel_order again for this order. Use escalate_to_human with the order number and what the customer asked for, and tell the customer the team will follow up by email.',
      };
  }
}

/** Order name as written to the log: order-number characters only, bounded. */
function orderLabel(value: unknown): string {
  return typeof value === 'string' ? value.replace(/[^A-Za-z0-9#-]/g, '').slice(0, 24) : '';
}

export interface ChatCancelDeps {
  /** Count one cancel attempt for the key; false when over the limit. */
  allowIp(key: string): boolean;
  allowOrder(key: string): boolean;
  loadOrder(orderId: string, brandId?: string): Promise<ChatCancelOrderState | null>;
  cancelOrder(orderId: string, brandId?: string): Promise<CancelOrderResult>;
  log(line: string): void;
}

/**
 * Run a chat cancel through the gate. `deps.cancelOrder` is the only Shopify
 * write and is reached only when every check passes; its result is returned
 * unchanged, so an allowed cancel behaves exactly as before the gate.
 */
export async function runGatedChatCancel(
  input: {
    orderId: unknown;
    orderName: unknown;
    email: unknown;
    brandId?: string;
    clientIp?: string;
    conversationId: string;
  },
  deps: ChatCancelDeps,
): Promise<{ success: boolean; data: CancelOrderResult | ChatCancelRefusal }> {
  const refuse = (reason: ChatCancelRefusalReason, detail?: string) => {
    // Order name only: no email, IP or message text.
    deps.log(`[tool-router] cancel_order refused ${JSON.stringify({
      reason,
      order: orderLabel(input.orderName),
      brandId: input.brandId ?? null,
      conversationId: input.conversationId,
      ...(detail ? { detail } : {}),
    })}`);
    return { success: false, data: chatCancelRefusal(reason) };
  };

  const orderId = parseOrderGid(input.orderId);
  const claim = {
    orderId: orderId ?? '',
    orderName: normalizeOrderName(input.orderName),
    email: normalizeOrderEmail(input.email),
  };
  if (!orderId || !claim.orderName || !claim.email) return refuse('missing_identity');

  // The chat message limit is keyed on a session id the client chooses, so
  // attempts are also counted per client address and per target order.
  if (!deps.allowIp(`ip:${input.clientIp ?? 'unknown'}`)) return refuse('rate_limited_ip');
  if (!deps.allowOrder(`order:${input.brandId ?? 'default'}:${orderId}`)) return refuse('rate_limited_order');

  let order: ChatCancelOrderState | null;
  try {
    order = await deps.loadOrder(orderId, input.brandId);
  } catch (err) {
    // Fail closed. The Shopify error (for example a missing access scope) is
    // kept so an operator can see why every cancel is being handed over.
    return refuse('order_unavailable', (err instanceof Error ? err.message : String(err)).slice(0, 200));
  }

  const reason = evaluateChatCancel(claim, order);
  if (reason) return refuse(reason);

  const result = await deps.cancelOrder(orderId, input.brandId);
  return { success: result.success, data: result };
}

/**
 * Bound escalate_to_human, which creates a ticket and emails an address the
 * model supplies. Counted per conversation and per client address.
 */
export function chatEscalationAllowed(
  input: { conversationId: string; clientIp?: string },
  deps: { allowConversation(key: string): boolean; allowIp(key: string): boolean },
): boolean {
  return deps.allowConversation(`conversation:${input.conversationId}`)
    && deps.allowIp(`ip:${input.clientIp ?? 'unknown'}`);
}

export const CHAT_ESCALATION_LIMIT_MESSAGE = 'No new support ticket was created: this chat has reached its limit for support tickets. Do not call escalate_to_human again in this conversation. If a ticket was already created, tell the customer the team will follow up by email; otherwise ask them to try again later.';

/**
 * True when Shopify refused the order read only because the app lacks the
 * disputes scope. The gate then runs without the dispute check instead of
 * turning every cancel away.
 */
export function isDisputesAccessDenied(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /access denied/i.test(message) && /dispute/i.test(message);
}
