import assert from 'node:assert/strict';
import test from 'node:test';
import {
  countReferencedKnownOrders,
  selectAutopilotModel,
  type AutopilotModelRoutingInput,
} from './autopilot-model-routing.js';

function route(patch: Partial<AutopilotModelRoutingInput> = {}) {
  return selectAutopilotModel({
    trigger: 'new_ticket',
    subject: 'Where is my order?',
    currentThreadText: 'Can you send me the tracking link?',
    triageIntent: 'order_status',
    authorizedCancellationCount: 0,
    authorizedRefundCount: 0,
    authorizedAddressChangeCount: 0,
    relatedTickets: [],
    knownOrderNames: ['#1025', '#1163'],
    previousActionTypes: [],
    ...patch,
  });
}

test('reviewed informational revisions use Flash but authorized money actions still use Pro', () => {
  const patch = { trigger: 'revision' as const, reviewedReadOnlyRevision: true, currentThreadText: 'Explain the cancellation options without changing the order.', triageIntent: 'cancel_order' };
  assert.equal(route(patch).tier, 'flash');
  assert.equal(route({ ...patch, authorizedRefundCount: 1 }).tier, 'pro');
  assert.equal(route({ ...patch, authorizedCancellationCount: 1 }).tier, 'pro');
  assert.equal(route({ ...patch, authorizedAddressChangeCount: 1 }).tier, 'pro');
  assert.equal(route({ ...patch, trigger: 'customer_reply' }).tier, 'pro');
});

test('routes routine drafting, status, and one related-thread link to Flash', () => {
  assert.equal(route().tier, 'flash');
  assert.equal(route({
    relatedTickets: [{ response_state: 'awaiting_us' }],
  }).tier, 'flash');
});

test('routes money and order mutations to Pro even before deterministic authorization', () => {
  assert.equal(route({ triageIntent: 'cancel_order' }).tier, 'pro');
  assert.equal(route({ triageIntent: 'return_refund' }).tier, 'pro');
  assert.equal(route({ triageIntent: 'address_change' }).tier, 'pro');
  assert.equal(route({ authorizedCancellationCount: 1 }).tier, 'pro');
  assert.equal(route({ authorizedRefundCount: 1 }).tier, 'pro');
  assert.equal(route({
    triageIntent: null,
    currentThreadText: 'Can I return this damaged item for a refund?',
  }).tier, 'pro');
});

test('a server-verified first retention offer uses Flash; confirmed or disputed money changes still use Pro', () => {
  const offer = { retentionOfferOnly: true, triageIntent: 'cancel_order', currentThreadText: 'Please cancel my order.' };
  assert.equal(route(offer).tier, 'flash');
  assert.equal(route({ ...offer, authorizedCancellationCount: 1 }).tier, 'pro');
  assert.equal(route({ ...offer, currentThreadText: 'Cancel it or I will file a chargeback.' }).tier, 'pro');
  assert.equal(route({ ...offer, previousActionTypes: ['refund_order'] }).tier, 'pro');
});

test('routes routine editorial revisions to Flash but keeps risky revisions on Pro', () => {
  assert.equal(route({ trigger: 'revision' }).tier, 'flash');
  assert.deepEqual(route({ trigger: 'revision' }).reasons, ['routine_human_revision']);
  assert.equal(route({ trigger: 'revision', authorizedCancellationCount: 1 }).tier, 'pro');
  assert.equal(route({
    currentThreadText: 'Please cancel order #1025. Never mind, keep my order.',
  }).tier, 'pro');
  assert.equal(route({
    relatedTickets: [{ response_state: 'awaiting_us' }, { response_state: 'awaiting_customer' }],
  }).tier, 'pro');
  assert.equal(route({ previousActionTypes: ['cancel_order'] }).tier, 'pro');
});

test('routes a current request about multiple known orders to Pro without penalizing order history alone', () => {
  assert.equal(countReferencedKnownOrders('Cancel #1025, but ship order #1163', ['#1025', '#1163']), 2);
  assert.equal(route({
    subject: 'Orders #1025 and #1163',
    currentThreadText: 'Please compare both.',
  }).tier, 'pro');
  assert.equal(route({
    knownOrderNames: ['#1025', '#1163', '#1299'],
    currentThreadText: 'Where is my most recent order?',
  }).tier, 'flash');
});

test('routes sensitive or uncertain policy cases to Pro', () => {
  assert.equal(route({ currentThreadText: 'This is outside the return window. Can you make an exception?' }).tier, 'pro');
  assert.equal(route({ currentThreadText: 'I filed a chargeback.' }).tier, 'pro');
});
