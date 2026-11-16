import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { toolDefinitions } from './definitions.js';
import { executeTool, type ToolContext } from './router.js';

/**
 * cancel_order through the real router and Shopify service, with Shopify
 * itself replaced by a stub. Nothing here leaves the process: every request
 * the stub does not recognise fails the test.
 */
interface ShopifyRequest {
  query: string;
  variables: Record<string, unknown>;
}

function orderState(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
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

async function withShopify<T>(
  order: Record<string, unknown> | null,
  run: (requests: ShopifyRequest[], warnings: string[]) => Promise<T>,
): Promise<T> {
  const requests: ShopifyRequest[] = [];
  const warnings: string[] = [];
  let cancelled = false;
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

  const realFetch = globalThis.fetch;
  const realWarn = console.warn;
  globalThis.fetch = (async (url: unknown, init?: { body?: unknown }) => {
    const target = String(url);
    if (target.endsWith('/admin/oauth/access_token')) {
      return json({ access_token: 'stub-token', scope: 'read_orders,write_orders', expires_in: 86399 });
    }
    assert.match(target, /\.myshopify\.com\/admin\/api\/[^/]+\/graphql\.json$/);
    const request = JSON.parse(String(init?.body)) as ShopifyRequest;
    requests.push(request);

    if (request.query.includes('query ChatCancelGate')) return json({ data: { order } });
    if (request.query.includes('query CurrentAppAccessScopes')) {
      return json({ data: { currentAppInstallation: { accessScopes: [{ handle: 'write_orders' }] } } });
    }
    if (request.query.includes('query OrderCancellationEvidence')) {
      return json({
        data: {
          order: {
            id: request.variables.id,
            name: '#1042',
            cancelledAt: cancelled ? '2026-11-16T00:00:00Z' : null,
            displayFinancialStatus: cancelled ? 'REFUNDED' : 'PAID',
            displayFulfillmentStatus: 'UNFULFILLED',
            totalPriceSet: { shopMoney: { amount: '50.00' } },
            totalRefundedSet: { shopMoney: { amount: cancelled ? '50.00' : '0.00' } },
            transactions: [{ kind: 'SALE', status: 'SUCCESS', amountSet: { shopMoney: { amount: '50.00' } } }],
            fulfillments: [],
          },
        },
      });
    }
    if (request.query.includes('mutation OrderCancel')) {
      cancelled = true;
      return json({ data: { orderCancel: { job: null, orderCancelUserErrors: [] } } });
    }
    throw new Error(`Unexpected Shopify request in test: ${request.query.slice(0, 60)}`);
  }) as typeof fetch;
  console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(' ')); };

  try {
    return await run(requests, warnings);
  } finally {
    globalThis.fetch = realFetch;
    console.warn = realWarn;
  }
}

const mutations = (requests: ShopifyRequest[]) => requests.filter((request) => request.query.includes('mutation'));

function context(clientIp: string): ToolContext {
  // No brand: the service uses the store from the environment, never the database.
  return { conversationId: 'conversation-router-test', clientIp };
}

test('cancel_order asks the model for the email on the order', () => {
  const cancel = toolDefinitions.find((tool) => tool.name === 'cancel_order');
  assert.ok(cancel);
  const schema = cancel.input_schema as { properties: Record<string, unknown>; required: string[] };
  assert.deepEqual(schema.required, ['order_id', 'order_name', 'email']);
  assert.ok(schema.properties.email);
  assert.match(cancel.description, /email address on the order/);
});

test('a customer with their own order number and email still cancels an unfulfilled order as before', async () => {
  const id = 'gid://shopify/Order/7001';
  await withShopify(orderState(id), async (requests, warnings) => {
    const result = await executeTool(
      'cancel_order',
      { order_id: id, order_name: '#1042', email: 'Jane@Example.com ' },
      context('203.0.113.10'),
    );

    assert.equal(result.success, true);
    assert.deepEqual(result.data, {
      success: true,
      completed: true,
      jobId: undefined,
      message: 'Order #1042 has been cancelled and its refund is confirmed.',
    });

    // The gate read comes first; the one write is the same mutation as before.
    assert.match(requests[0].query, /query ChatCancelGate/);
    assert.deepEqual(requests[0].variables, { id });
    const writes = mutations(requests);
    assert.equal(writes.length, 1);
    assert.match(writes[0].query, /mutation OrderCancel/);
    assert.deepEqual(writes[0].variables, {
      orderId: id,
      reason: 'CUSTOMER',
      refundMethod: { originalPaymentMethodsRefund: true },
      restock: true,
    });
    assert.deepEqual(warnings, []);
  });
});

test('the gate reads identity, state, disputes and tags in one order query', async () => {
  const id = 'gid://shopify/Order/7002';
  await withShopify(orderState(id, { email: 'someone-else@example.com' }), async (requests) => {
    await executeTool('cancel_order', { order_id: id, order_name: '#1042', email: 'jane@example.com' }, context('203.0.113.11'));
    assert.equal(requests.length, 1);
    for (const field of ['name', 'email', 'cancelledAt', 'displayFulfillmentStatus', 'tags', 'fulfillments', 'refunds', 'disputes']) {
      assert.match(requests[0].query, new RegExp(`\\b${field}\\b`), field);
    }
  });
});

test('whatever the model sends, a cancel the server cannot verify never reaches the Shopify mutation', async () => {
  const refused: Array<[string, Record<string, unknown> | null, Record<string, unknown>]> = [
    ['the email does not match the order', orderState('gid://shopify/Order/7101'), { email: 'mallory@example.com' }],
    ['the order number does not match the order', orderState('gid://shopify/Order/7102'), { order_name: '#9999' }],
    ['the order does not exist for this brand', null, {}],
    ['the order is already cancelled', orderState('gid://shopify/Order/7104', { cancelledAt: '2026-11-01T00:00:00Z' }), {}],
    ['the order has a fulfillment', orderState('gid://shopify/Order/7105', { fulfillments: [{ id: 'gid://shopify/Fulfillment/1' }] }), {}],
    ['the order is in progress with the warehouse', orderState('gid://shopify/Order/7106', { displayFulfillmentStatus: 'IN_PROGRESS' }), {}],
    ['the order has a refund', orderState('gid://shopify/Order/7107', { refunds: [{ id: 'gid://shopify/Refund/1' }] }), {}],
    ['the order has an open chargeback', orderState('gid://shopify/Order/7108', { disputes: [{ status: 'NEEDS_RESPONSE' }] }), {}],
    ['the order carries a dispute-os: tag', orderState('gid://shopify/Order/7109', { tags: ['dispute-os:held'] }), {}],
  ];

  for (const [label, order, input] of refused) {
    const id = (order?.id as string | undefined) ?? 'gid://shopify/Order/7103';
    await withShopify(order, async (requests, warnings) => {
      const result = await executeTool(
        'cancel_order',
        { order_id: id, order_name: '#1042', email: 'jane@example.com', ...input },
        context('203.0.113.12'),
      );

      assert.equal(result.success, false, label);
      assert.deepEqual(mutations(requests), [], label);
      assert.equal(requests.length, 1, label);
      const data = result.data as { message: string };
      assert.match(data.message, /escalate_to_human/, label);
      // One structured line, with the order name and no customer data.
      assert.equal(warnings.length, 1, label);
      assert.match(warnings[0], /^\[tool-router\] cancel_order refused \{"reason":"[a-z_]+","order":"#(1042|9999)"/, label);
      assert.doesNotMatch(warnings[0], /example\.com|203\.0\.113/, label);
    });
  }
});

test('a cancel_order call without an email makes no Shopify request at all', async () => {
  await withShopify(orderState('gid://shopify/Order/7201'), async (requests) => {
    // The call shape the tool accepted before the gate.
    const result = await executeTool(
      'cancel_order',
      { order_id: 'gid://shopify/Order/7201', order_name: '#1042' },
      context('203.0.113.13'),
    );
    assert.equal(result.success, false);
    assert.deepEqual(requests, []);
    assert.match((result.data as { message: string }).message, /Ask the customer for the email/);
  });
});

test('cancel attempts on one order are limited whatever session or address they come from', async () => {
  const id = 'gid://shopify/Order/7301';
  await withShopify(orderState(id, { email: 'owner@example.com' }), async (requests, warnings) => {
    for (let attempt = 1; attempt <= 7; attempt++) {
      const result = await executeTool(
        'cancel_order',
        { order_id: id, order_name: '#1042', email: `guess-${attempt}@example.com` },
        { conversationId: `conversation-${attempt}`, clientIp: `198.51.100.${attempt}` },
      );
      assert.equal(result.success, false);
    }
    // Five reads, then the order is closed to chat cancels for the window.
    assert.equal(requests.length, 5);
    assert.deepEqual(mutations(requests), []);
    assert.equal(warnings.filter((line) => line.includes('"reason":"rate_limited_order"')).length, 2);
  });
});

test('cancel attempts from one address are limited across orders and sessions', async () => {
  await withShopify(null, async (requests, warnings) => {
    for (let attempt = 1; attempt <= 12; attempt++) {
      const result = await executeTool(
        'cancel_order',
        { order_id: `gid://shopify/Order/74${String(attempt).padStart(2, '0')}`, order_name: '#1042', email: 'jane@example.com' },
        { conversationId: `conversation-ip-${attempt}`, clientIp: '203.0.113.99' },
      );
      assert.equal(result.success, false);
    }
    assert.equal(requests.length, 10);
    assert.equal(warnings.filter((line) => line.includes('"reason":"rate_limited_ip"')).length, 2);
  });
});

test('escalate_to_human is bounded before it touches the conversation, ticket or email', () => {
  const source = readFileSync(path.resolve(__dirname, 'router.ts'), 'utf8');
  const escalate = source.slice(source.indexOf("case 'escalate_to_human': {"), source.indexOf('default:'));
  const guard = escalate.indexOf('if (!chatEscalationAllowed(context, {');
  assert.ok(guard > 0);
  assert.ok(guard < escalate.indexOf('conversationService.updateConversation('));
  assert.ok(guard < escalate.indexOf('ticketService.createTicketFromEscalation('));
  assert.match(escalate, /allowConversation: \(key\) => escalationConversationLimit\(key\)\.allowed/);
  assert.match(escalate, /allowIp: \(key\) => escalationIpLimit\(key\)\.allowed/);
  assert.match(source, /escalationConversationLimit = createRateLimiter\(\{ windowMs: 60 \* 60 \* 1000, max: 3,/);
  assert.match(source, /escalationIpLimit = createRateLimiter\(\{ windowMs: 10 \* 60 \* 1000, max: 10,/);

  // The cancel case has no path to the Shopify write except through the gate.
  const cancel = source.slice(source.indexOf("case 'cancel_order': {"), source.indexOf("case 'escalate_to_human': {"));
  assert.match(cancel, /return await runGatedChatCancel\(/);
  assert.equal(source.split('shopifyActions.cancelOrder(').length - 1, 1);
});
