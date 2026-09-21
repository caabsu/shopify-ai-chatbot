import test from 'node:test';
import assert from 'node:assert/strict';
import { retentionDecision, retentionRefundAmount, retentionOfferReply, retentionOrderIdForRequests, shopifyMoneyAmount, retentionDeliveryAllowed, type RetentionMessage } from './support-retention-policy.js';
const offer: RetentionMessage = { id: 'offer', sender_type: 'agent', content: 'Keep or cancel', created_at: '2026-09-15T10:00:00Z', metadata: { email_status: 'sent', support_retention_offer: { version: 'retention-30-v1', order_id: 'gid://shopify/Order/1', order_name: '#1001', refund_percent: 30 } } };
test('keeping a Warm order requires a supported verified destination', () => {
  assert.equal(retentionDeliveryAllowed('warm-by-design', { province: 'Hawaii' }), false);
  assert.equal(retentionDeliveryAllowed('warm-by-design', { provinceCode: 'HI' }), false);
  assert.equal(retentionDeliveryAllowed('warm-by-design', null), false);
  assert.equal(retentionDeliveryAllowed('warm-by-design', { province: 'California', provinceCode: 'CA' }), true);
  assert.equal(retentionDeliveryAllowed('other-brand', { provinceCode: 'HI' }), true);
});
test('currency-labelled Shopify totals produce exact concessions and reject malformed amounts', () => {
  assert.equal(shopifyMoneyAmount('165.95 USD'), 165.95);
  assert.equal(retentionRefundAmount(shopifyMoneyAmount('331.95 USD'), 50), 49.59);
  assert.equal(retentionRefundAmount(shopifyMoneyAmount('331.95 USD'), 100), null);
  assert.equal(retentionOrderIdForRequests({ cancellationOrderIds: [], refundRequests: new Map([['one', null]]), orders: [{ id: 'one', totalPrice: '165.95 USD' }] }), 'one');
  for (const value of ['100oops', '', null, '1,000 USD', '100 USD extra', 'NaN', Infinity]) assert.equal(Number.isNaN(shopifyMoneyAmount(value)), true);
});
test('full-refund language selects an offer target while partial and ambiguous requests do not', () => {
  const orders = [{ id: 'one', totalPrice: '100' }, { id: 'two', totalPrice: '200' }];
  assert.equal(retentionOrderIdForRequests({ orders, cancellationOrderIds: [], refundRequests: new Map([['one', null]]) }), 'one');
  assert.equal(retentionOrderIdForRequests({ orders, cancellationOrderIds: [], refundRequests: new Map([['one', 100]]) }), 'one');
  assert.equal(retentionOrderIdForRequests({ orders, cancellationOrderIds: ['one'], refundRequests: new Map([['one', 100]]) }), 'one');
  assert.equal(retentionOrderIdForRequests({ orders, cancellationOrderIds: [], refundRequests: new Map([['one', 30]]) }), null);
  assert.equal(retentionOrderIdForRequests({ orders, cancellationOrderIds: ['two'], refundRequests: new Map([['one', null]]) }), null);
  assert.equal(retentionOrderIdForRequests({ orders, cancellationOrderIds: [], refundRequests: new Map([['unknown', null]]) }), null);
});
test('retention offers preserve an answer to the additional order question and both choices', () => {
  const text = retentionOfferReply({ firstName: 'Alex', orderName: '#1001', signoff: 'Support', delayVerified: true, additionalContext: 'Your order has not shipped.', shippingUpdate: "The exact shipping date is unconfirmed, but we're working hard to get everything moving." });
  assert.match(text, /Your order has not shipped/);
  assert.match(text, /30% refund of the amount paid/);
  assert.match(text, /shipping date is unconfirmed/);
  assert.match(text, /working hard to get everything moving/);
  assert.match(text, /reply with “keep my order”/);
  assert.match(text, /“cancel my order” for cancellation/);
  assert.doesNotMatch(text, /has been cancelled|refund has been processed/);
});
test('a prior partial refund is included in the 30% offer instead of stacked on top', () => {
  const text = retentionOfferReply({ firstName: 'Alex', orderName: '#1001', signoff: 'Support', delayVerified: true, alreadyRefunded: 50 });
  assert.match(text, /total refund of 30%/);
  assert.match(text, /including any refund already issued/);
  assert.match(text, /refund the remaining payment/);
  assert.doesNotMatch(text, /additional 30%/);
});
function reply(content: string): RetentionMessage { return { id: 'reply', sender_type: 'customer', created_at: '2026-09-15T11:00:00Z', content }; }
test('a first cancellation request cannot authorize a mutation', () => assert.equal(retentionDecision([reply('Please cancel my order')]).choice, 'none'));
test('a later explicit cancellation confirms the offer', () => assert.equal(retentionDecision([offer, reply('Please cancel my order.')]).choice, 'cancel'));
test('keeping the order confirms only the retention refund', () => assert.equal(retentionDecision([offer, reply('I will keep my order, thanks.')]).choice, 'keep'));
test('ambiguous or conditional agreement always needs review', () => { for (const value of ['yes', 'OK', 'cancel or keep', 'cancel if it is late', 'Can you cancel my order?', "Don't cancel my order", "Don't keep my order", "I do not accept the 30% refund", 'I might cancel my order', 'You said to cancel my order', 'cancel order #1002']) assert.equal(retentionDecision([offer, reply(value)]).choice, 'ambiguous', value); });
test('a failed/reserved offer and internal notes cannot authorize a refund', () => {
  assert.equal(retentionDecision([{ ...offer, metadata: { ...offer.metadata, email_status: 'reserved' } }, reply('keep my order')]).choice, 'none');
  assert.equal(retentionDecision([{ ...offer, is_internal_note: true }, reply('keep my order')]).choice, 'none');
});
test('newest customer instruction supersedes previous acceptance and quoted text is ignored', () => {
  assert.equal(retentionDecision([offer, reply('cancel my order'), { ...reply('Never mind, I am not sure'), id: 'new', created_at: '2026-09-15T12:00:00Z' }]).choice, 'ambiguous');
  assert.equal(retentionDecision([offer, reply('Thanks\n> cancel my order')]).choice, 'ambiguous');
});
test('30% is rounded to cents and previous refunds reduce the concession', () => {
  assert.equal(retentionRefundAmount(99.99, 0), 30);
  assert.equal(retentionRefundAmount(100, 10), 20);
  assert.equal(retentionRefundAmount(100, 30), null);
  assert.equal(retentionRefundAmount(NaN, 0), null);
});
