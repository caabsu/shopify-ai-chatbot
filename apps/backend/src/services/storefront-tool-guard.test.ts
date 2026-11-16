import assert from 'node:assert/strict';
import test from 'node:test';
import { createRateLimiter } from '../middleware/rate-limit.middleware.js';
import type { CancelOrderResult } from './shopify-actions.service.js';
import {
  CHAT_ESCALATION_LIMIT_MESSAGE,
  chatCancelRefusal,
  chatEscalationAllowed,
  evaluateChatCancel,
  normalizeOrderEmail,
  normalizeOrderName,
  parseOrderGid,
  runGatedChatCancel,
  type ChatCancelDeps,
  type ChatCancelOrderState,
  type ChatCancelRefusalReason,
} from './storefront-tool-guard.js';

const ORDER_ID = 'gid://shopify/Order/5550001042';
const BRAND = '883e4a28-9f2e-4850-a527-29f297d8b6f8';

// An order a customer may cancel in chat today: paid, nothing shipped.
function order(overrides: Partial<ChatCancelOrderState> = {}): ChatCancelOrderState {
  return {
    id: ORDER_ID,
    name: '#1042',
    email: 'jane@example.com',
    cancelledAt: null,
    displayFulfillmentStatus: 'UNFULFILLED',
    tags: [],
    fulfillments: [],
    refunds: [],
    disputes: [],
    ...overrides,
  };
}

const claim = { orderId: ORDER_ID, orderName: '1042', email: 'jane@example.com' };

const CANCELLED: CancelOrderResult = {
  success: true,
  completed: true,
  jobId: 'gid://shopify/Job/1',
  message: 'Order #1042 has been cancelled and its refund is confirmed.',
};

function harness(options: {
  order?: ChatCancelOrderState | null;
  loadError?: Error;
  allowIp?: boolean;
  allowOrder?: boolean;
} = {}) {
  const loads: Array<[string, string | undefined]> = [];
  const cancels: Array<[string, string | undefined]> = [];
  const limiterKeys: string[] = [];
  const logs: string[] = [];
  const deps: ChatCancelDeps = {
    allowIp: (key) => { limiterKeys.push(key); return options.allowIp ?? true; },
    allowOrder: (key) => { limiterKeys.push(key); return options.allowOrder ?? true; },
    loadOrder: async (orderId, brandId) => {
      loads.push([orderId, brandId]);
      if (options.loadError) throw options.loadError;
      return options.order === undefined ? order() : options.order;
    },
    cancelOrder: async (orderId, brandId) => {
      cancels.push([orderId, brandId]);
      return CANCELLED;
    },
    log: (line) => logs.push(line),
  };
  return { deps, loads, cancels, limiterKeys, logs };
}

const input = {
  orderId: ORDER_ID,
  orderName: '#1042',
  email: 'jane@example.com',
  brandId: BRAND,
  clientIp: '203.0.113.7',
  conversationId: 'conversation-1',
};

test('order ids, order numbers and emails are normalised before they are compared', () => {
  assert.equal(parseOrderGid(' gid://shopify/Order/5550001042 '), ORDER_ID);
  // Only the exact order GID is ever sent to Shopify.
  assert.equal(parseOrderGid('5550001042'), null);
  assert.equal(parseOrderGid('gid://shopify/Order/5550001042?x=1'), null);
  assert.equal(parseOrderGid('gid://shopify/DraftOrder/5550001042'), null);
  assert.equal(parseOrderGid(undefined), null);

  // The same reading lookup_order gives an order number.
  assert.equal(normalizeOrderName('#1042'), '1042');
  assert.equal(normalizeOrderName(' # 01042 '), '1042');
  assert.equal(normalizeOrderName('1042'), '1042');
  assert.equal(normalizeOrderName(1042), '');

  assert.equal(normalizeOrderEmail('  Jane@Example.COM '), 'jane@example.com');
  assert.equal(normalizeOrderEmail(null), '');
});

test('an unfulfilled, undisputed order with matching order number and email may be cancelled', () => {
  assert.equal(evaluateChatCancel(claim, order()), null);
  // Tags from other tools and a dispute the store won do not block.
  assert.equal(evaluateChatCancel(claim, order({ tags: ['vip', 'dispute-os', 'not-dispute-os:held'] })), null);
  assert.equal(evaluateChatCancel(claim, order({ disputes: [{ status: 'WON' }] })), null);
});

test('identity: the order number and the email must both match the order Shopify returns', () => {
  assert.equal(evaluateChatCancel(claim, null), 'order_not_found');
  assert.equal(evaluateChatCancel({ ...claim, email: 'mallory@example.com' }, order()), 'identity_mismatch');
  assert.equal(evaluateChatCancel({ ...claim, orderName: '1043' }, order()), 'identity_mismatch');
  assert.equal(evaluateChatCancel({ ...claim, email: '' }, order({ email: '' })), 'identity_mismatch');
  // An order with no email on file cannot be verified by email.
  assert.equal(evaluateChatCancel(claim, order({ email: null })), 'identity_mismatch');
  // Shopify answered with a different order than the one asked for.
  assert.equal(evaluateChatCancel(claim, order({ id: 'gid://shopify/Order/1' })), 'identity_mismatch');
  // Case and surrounding spaces on the order do not matter.
  assert.equal(evaluateChatCancel(claim, order({ email: ' Jane@Example.com ', name: '#1042' })), null);
});

test('identity is decided before state, so an unverified caller learns nothing about the order', () => {
  const stranger = { ...claim, email: 'mallory@example.com' };
  assert.equal(evaluateChatCancel(stranger, order({ cancelledAt: '2026-11-01T00:00:00Z' })), 'identity_mismatch');
  assert.equal(evaluateChatCancel(stranger, order({ tags: ['dispute-os:held'] })), 'identity_mismatch');
  assert.equal(chatCancelRefusal('identity_mismatch').message, chatCancelRefusal('order_not_found').message);
});

test('state: cancelled, fulfilled, with the warehouse, refunded or disputed orders are refused', () => {
  assert.equal(evaluateChatCancel(claim, order({ cancelledAt: '2026-11-01T00:00:00Z' })), 'already_cancelled');

  assert.equal(evaluateChatCancel(claim, order({ fulfillments: [{ id: 'gid://shopify/Fulfillment/1' }] })), 'not_unfulfilled');
  for (const status of ['FULFILLED', 'PARTIALLY_FULFILLED', 'IN_PROGRESS', 'PENDING_FULFILLMENT', 'ON_HOLD', 'SCHEDULED', 'OPEN', '']) {
    assert.equal(evaluateChatCancel(claim, order({ displayFulfillmentStatus: status })), 'not_unfulfilled', status);
  }

  assert.equal(evaluateChatCancel(claim, order({ refunds: [{ id: 'gid://shopify/Refund/1' }] })), 'refunded');

  for (const status of ['NEEDS_RESPONSE', 'UNDER_REVIEW', 'LOST', 'ACCEPTED', 'CHARGE_REFUNDED', 'A_FUTURE_STATUS']) {
    assert.equal(evaluateChatCancel(claim, order({ disputes: [{ status }] })), 'dispute', status);
  }
  assert.equal(evaluateChatCancel(claim, order({ disputes: [{ status: 'WON' }, { status: 'UNDER_REVIEW' }] })), 'dispute');
});

test('holds: any tag starting dispute-os: is refused', () => {
  for (const tag of ['dispute-os:held', 'dispute-os:verify', 'dispute-os:verified-approved', 'Dispute-OS:High-Risk', ' dispute-os:manual-hold']) {
    assert.equal(evaluateChatCancel(claim, order({ tags: ['vip', tag] })), 'dispute_os_tag', tag);
  }
});

test('an order read that is missing a field the gate decides on is refused', () => {
  const partial = { ...order(), disputes: undefined } as unknown as ChatCancelOrderState;
  assert.equal(evaluateChatCancel(claim, partial), 'order_unavailable');
  const noTags = { ...order(), tags: null } as unknown as ChatCancelOrderState;
  assert.equal(evaluateChatCancel(claim, noTags), 'order_unavailable');
});

test('an allowed cancel runs once on the verified order and returns the Shopify result unchanged', async () => {
  const run = harness();
  const result = await runGatedChatCancel({ ...input, orderName: ' # 01042', email: ' JANE@example.com ' }, run.deps);

  assert.deepEqual(run.loads, [[ORDER_ID, BRAND]]);
  assert.deepEqual(run.cancels, [[ORDER_ID, BRAND]]);
  assert.equal(result.success, true);
  assert.equal(result.data, CANCELLED);
  assert.deepEqual(run.logs, []);
});

test('every refusal skips the Shopify write and sends the model to the escalation path', async () => {
  const refused: Array<[ChatCancelRefusalReason, ChatCancelOrderState | null]> = [
    ['order_not_found', null],
    ['identity_mismatch', order({ email: 'someone-else@example.com' })],
    ['already_cancelled', order({ cancelledAt: '2026-11-01T00:00:00Z' })],
    ['dispute_os_tag', order({ tags: ['dispute-os:held'] })],
    ['dispute', order({ disputes: [{ status: 'NEEDS_RESPONSE' }] })],
    ['refunded', order({ refunds: [{ id: 'gid://shopify/Refund/1' }] })],
    ['not_unfulfilled', order({ displayFulfillmentStatus: 'IN_PROGRESS' })],
  ];

  for (const [reason, state] of refused) {
    const run = harness({ order: state });
    const result = await runGatedChatCancel(input, run.deps);

    assert.deepEqual(run.cancels, [], reason);
    assert.equal(result.success, false, reason);
    assert.deepEqual(result.data, chatCancelRefusal(reason), reason);
    assert.match(result.data.message, /escalate_to_human/, reason);

    // One structured line: the reason and the order name, no customer data.
    assert.equal(run.logs.length, 1, reason);
    const logged = JSON.parse(run.logs[0].replace('[tool-router] cancel_order refused ', ''));
    assert.deepEqual(logged, { reason, order: '#1042', brandId: BRAND, conversationId: 'conversation-1' }, reason);
    assert.doesNotMatch(run.logs[0], /example\.com|203\.0\.113/, reason);
  }
});

test('a refusal never tells the chat that an order is held, tagged or disputed', () => {
  for (const reason of ['dispute_os_tag', 'dispute', 'refunded', 'not_unfulfilled', 'order_unavailable', 'rate_limited_ip', 'rate_limited_order'] as const) {
    const refusal = chatCancelRefusal(reason);
    assert.equal(refusal.reason, 'needs_team_review', reason);
    assert.equal(refusal.requires_human, true, reason);
    assert.doesNotMatch(refusal.message, /dispute|chargeback|hold|held|fraud|risk|tag|refund|limit/i, reason);
  }
});

test('a call without the order id, order number or email is refused before any Shopify request', async () => {
  for (const missing of [
    { email: undefined },
    { email: '   ' },
    { orderName: undefined },
    { orderId: undefined },
    { orderId: '5550001042' },
    { orderId: 'gid://shopify/Order/5550001042?x=1' },
  ]) {
    const run = harness();
    const result = await runGatedChatCancel({ ...input, ...missing }, run.deps);

    assert.equal(result.success, false);
    assert.deepEqual(result.data, chatCancelRefusal('missing_identity'));
    // The model is told to ask the customer for the email, then try again.
    assert.match(result.data.message, /email/);
    assert.deepEqual(run.loads, []);
    assert.deepEqual(run.cancels, []);
    assert.deepEqual(run.limiterKeys, []);
  }
});

test('a failed order read fails closed and keeps the Shopify error for the operator', async () => {
  const run = harness({ loadError: new Error('Shopify GraphQL error: Access denied for disputes field.') });
  const result = await runGatedChatCancel(input, run.deps);

  assert.deepEqual(run.cancels, []);
  assert.deepEqual(result.data, chatCancelRefusal('order_unavailable'));
  const logged = JSON.parse(run.logs[0].replace('[tool-router] cancel_order refused ', ''));
  assert.equal(logged.reason, 'order_unavailable');
  assert.equal(logged.detail, 'Shopify GraphQL error: Access denied for disputes field.');
});

test('an order name is reduced to order-number characters before it is logged', async () => {
  const run = harness({ order: null });
  await runGatedChatCancel({ ...input, orderName: '#1042\n[tool-router] forged line jane@example.com' }, run.deps);
  const logged = JSON.parse(run.logs[0].replace('[tool-router] cancel_order refused ', ''));
  assert.equal(logged.order, '#1042tool-routerforgedli');
  assert.equal(run.logs[0].includes('\n'), false);
});

test('cancel attempts are counted per client address and per order before Shopify is read', async () => {
  const byIp = harness({ allowIp: false });
  const ipResult = await runGatedChatCancel(input, byIp.deps);
  assert.deepEqual(byIp.limiterKeys, ['ip:203.0.113.7']);
  assert.deepEqual(byIp.loads, []);
  assert.deepEqual(byIp.cancels, []);
  assert.deepEqual(ipResult.data, chatCancelRefusal('rate_limited_ip'));

  const byOrder = harness({ allowOrder: false });
  const orderResult = await runGatedChatCancel(input, byOrder.deps);
  assert.deepEqual(byOrder.limiterKeys, ['ip:203.0.113.7', `order:${BRAND}:${ORDER_ID}`]);
  assert.deepEqual(byOrder.loads, []);
  assert.deepEqual(byOrder.cancels, []);
  assert.deepEqual(orderResult.data, chatCancelRefusal('rate_limited_order'));
});

test('a new session id or address does not reset the per-order limit', async () => {
  const perOrder = createRateLimiter({ windowMs: 60_000, max: 5, name: 'test-chat-cancel-order' });
  const perIp = createRateLimiter({ windowMs: 60_000, max: 10, name: 'test-chat-cancel-ip' });
  const run = harness({ order: order({ email: 'owner@example.com' }) });
  const deps: ChatCancelDeps = {
    ...run.deps,
    allowIp: (key) => perIp(key).allowed,
    allowOrder: (key) => perOrder(key).allowed,
  };

  // Guessing the email of one order from a different session and address each time.
  for (let attempt = 1; attempt <= 7; attempt++) {
    await runGatedChatCancel({
      ...input,
      email: `guess-${attempt}@example.com`,
      clientIp: `198.51.100.${attempt}`,
      conversationId: `conversation-${attempt}`,
    }, deps);
  }

  assert.equal(run.loads.length, 5);
  assert.deepEqual(run.cancels, []);
  assert.match(run.logs[5], /"reason":"rate_limited_order"/);
});

test('escalations are bounded per conversation and per client address', () => {
  const perConversation = createRateLimiter({ windowMs: 60_000, max: 3, name: 'test-chat-escalation-conversation' });
  const perIp = createRateLimiter({ windowMs: 60_000, max: 5, name: 'test-chat-escalation-ip' });
  const deps = {
    allowConversation: (key: string) => perConversation(key).allowed,
    allowIp: (key: string) => perIp(key).allowed,
  };
  const allowed = (conversationId: string, clientIp?: string) => chatEscalationAllowed({ conversationId, clientIp }, deps);

  // One conversation: three tickets, then no more.
  assert.deepEqual([1, 2, 3, 4].map(() => allowed('conversation-a', '203.0.113.7')), [true, true, true, false]);
  // A new session from the same address is still counted against that address.
  assert.deepEqual([1, 2, 3].map((n) => allowed(`conversation-b${n}`, '203.0.113.7')), [true, true, false]);
  // Another customer is unaffected.
  assert.equal(allowed('conversation-c', '198.51.100.20'), true);

  assert.match(CHAT_ESCALATION_LIMIT_MESSAGE, /Do not call escalate_to_human again/);
});

test('a missing disputes scope is recognised, and nothing else is', async () => {
  const { isDisputesAccessDenied } = await import('./storefront-tool-guard.js');
  assert.equal(isDisputesAccessDenied(new Error('Shopify GraphQL error: Access denied for disputes field. Required access: `read_shopify_payments_disputes` access scope.')), true);
  assert.equal(isDisputesAccessDenied(new Error('Shopify GraphQL error: Access denied for order field.')), false);
  assert.equal(isDisputesAccessDenied(new Error('Shopify Admin API error (500): upstream')), false);
  assert.equal(isDisputesAccessDenied(undefined), false);
});
