import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ExecutionScopeDerivationError,
  customerEmailExecutionScopeKey,
  deriveAutopilotExecutionScopeKeys,
  orderExecutionScopeKey,
  shopifyCustomerExecutionScopeKey,
} from './autopilot-execution-scope';
import type { AutopilotAction, AutopilotPlan } from './types';

const primaryTicketId = '11111111-1111-4111-8111-111111111111';
const relatedTicketId = '22222222-2222-4222-8222-222222222222';

function action(overrides: Partial<AutopilotAction> = {}): AutopilotAction {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    type: 'send_reply',
    title: 'Reply',
    detail: 'Reply to customer',
    params: { reply_text: 'Done' },
    confidence: 0.9,
    status: 'approved',
    ...overrides,
  };
}

function plan(actions: AutopilotAction[]): Pick<AutopilotPlan, 'actions'> {
  return { actions };
}

test('normalizes customer identity without exposing raw PII in lock keys', () => {
  const lower = customerEmailExecutionScopeKey(' sally@example.com ');
  assert.equal(lower, customerEmailExecutionScopeKey('SALLY@EXAMPLE.COM'));
  assert.match(lower ?? '', /^customer-email:sha256:[0-9a-f]{64}$/);
  assert.equal(lower?.includes('sally'), false);

  assert.equal(
    shopifyCustomerExecutionScopeKey('gid://shopify/Customer/123'),
    shopifyCustomerExecutionScopeKey('123'),
  );
});

test('canonicalizes numeric and GraphQL Shopify order IDs to the same scope', () => {
  assert.equal(
    orderExecutionScopeKey('gid://shopify/Order/987'),
    orderExecutionScopeKey('987'),
  );
});

test('derives one sorted conservative scope set across the approved plan', () => {
  const keys = deriveAutopilotExecutionScopeKeys({
    ticket: {
      id: primaryTicketId,
      customer_email_normalized: 'same@example.com',
      shopify_customer_id: 'gid://shopify/Customer/123',
      order_id: 'gid://shopify/Order/987',
    },
    plan: plan([
      action(),
      action({
        id: '44444444-4444-4444-8444-444444444444',
        type: 'cancel_order',
        title: 'Cancel',
        params: { order_id: '987' },
      }),
      action({
        id: '55555555-5555-4555-8555-555555555555',
        type: 'consolidate_related_tickets',
        title: 'Consolidate',
        params: { related_tickets: [{ ticket_id: relatedTicketId }] },
      }),
    ]),
  });

  assert.deepEqual(keys, [...keys].sort());
  assert.equal(keys.filter((key) => key.startsWith('order:')).length, 1);
  assert.ok(keys.includes(`ticket:${primaryTicketId}`));
  assert.ok(keys.includes(`ticket:${relatedTicketId}`));
  assert.equal(keys.length, 5);
});

test('does not let an unapproved malformed action poison the execution scope', () => {
  const keys = deriveAutopilotExecutionScopeKeys({
    ticket: { id: primaryTicketId, customer_email: 'customer@example.com' },
    plan: plan([
      action(),
      action({
        id: '66666666-6666-4666-8666-666666666666',
        type: 'refund_order',
        title: 'Skipped malformed refund',
        params: {},
        status: 'skipped',
      }),
    ]),
  });
  assert.equal(keys.length, 2);
});

test('fails closed when an approved mutation lacks an order scope', () => {
  assert.throws(
    () => deriveAutopilotExecutionScopeKeys({
      ticket: { id: primaryTicketId },
      plan: plan([action({ type: 'refund_order', title: 'Refund', params: {} })]),
    }),
    ExecutionScopeDerivationError,
  );
});

test('fails closed on malformed related-ticket identities', () => {
  assert.throws(
    () => deriveAutopilotExecutionScopeKeys({
      ticket: { id: primaryTicketId },
      plan: plan([action({
        type: 'consolidate_related_tickets',
        title: 'Consolidate',
        params: { related_tickets: [{ ticket_id: 'not-a-uuid' }] },
      })]),
    }),
    /invalid ticket ID/,
  );
});
