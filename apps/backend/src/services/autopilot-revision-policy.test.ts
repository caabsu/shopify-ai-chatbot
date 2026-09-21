import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyOperatorRevisionDirectives,
  compileOperatorRevisionDirectives,
  operatorRequestsCancellation,
  operatorVerifiedPendingRefund,
  operatorVerifiedHistoricalOutcomes,
} from './autopilot-revision-policy.js';

test('prohibiting a success claim is not verification that money moved', () => {
  for (const instruction of ['Do not claim a refund has been issued.', 'Explain the remaining decision without phrases claiming a refund will be issued or has succeeded.', 'Never say the order was cancelled.']) {
    assert.deepEqual(operatorVerifiedHistoricalOutcomes({ instruction, contextText: 'Order #1122' }), []);
  }
});

test('a reviewer-confirmed successful refund becomes historical evidence', () => {
  assert.deepEqual(operatorVerifiedHistoricalOutcomes({
    instruction: 'refunded successfully -- it was an error with the PayPal system and expiration.',
    contextText: 'The customer is following up on legacy Order #4972 for $461.30.',
  }), [{
    type: 'refund_order',
    order_id: 'operator_revision',
    order_name: '#4972',
    amount: 461.3,
    source: 'operator_revision',
  }]);
});

test('compiles a reviewer-verified failed PayPal refund recovery without inventing a new mutation', () => {
  assert.deepEqual(operatorVerifiedPendingRefund(
    'We have canceld the order but the refund failed due to the PayPal Express time limit. Ask for the PayPal email address, displayed name, and confirmation the account can receive the $418.30 USD refund.',
  ), {
    amount: 418.3,
    originalRefundFailed: true,
    collectPayPalDetails: true,
    cancellationCompleted: true,
    source: 'operator_revision',
  });
  assert.equal(
    operatorVerifiedPendingRefund('Please issue a normal $418.30 refund.'),
    null,
  );
  assert.deepEqual(operatorVerifiedHistoricalOutcomes({
    instruction: 'We have canceld the order, but the PayPal refund failed.',
    contextText: 'Legacy order #4806.',
  }), [{
    type: 'cancel_order',
    order_id: 'operator_revision',
    order_name: '#4806',
    source: 'operator_revision',
  }]);
});

test('negated or prospective revision wording does not invent completed evidence', () => {
  assert.deepEqual(operatorVerifiedHistoricalOutcomes({
    instruction: 'It was not refunded successfully. Please prepare a better response.',
    contextText: 'Order #4972',
  }), []);
  assert.deepEqual(operatorVerifiedHistoricalOutcomes({
    instruction: 'Please refund it successfully this time.',
    contextText: 'Order #4972',
  }), []);
});

test('a reviewer instruction to cancel instead of refunding is an executable command', () => {
  assert.equal(
    operatorRequestsCancellation(
      "This means cancel the order, not just refund, because they don't want the order at all.",
    ),
    true,
  );
  assert.equal(operatorRequestsCancellation("Do not cancel the order."), false);
  assert.equal(operatorRequestsCancellation('The order was already cancelled successfully.'), false);
});

test('compiles hard revision constraints instead of treating them as prompt suggestions', () => {
  assert.deepEqual(
    compileOperatorRevisionDirectives(
      "Cancel the order instead of just refunding it, and don't close the ticket yet.",
    ),
    {
      forceCancellation: true,
      forbidCancellation: false,
      replaceRefundWithCancellation: true,
      keepTicketOpen: true,
      suppressReply: false,
    },
  );
  assert.deepEqual(
    compileOperatorRevisionDirectives(
      'The customer did not ask to cancel. Do not send another reply.',
    ),
    {
      forceCancellation: false,
      forbidCancellation: true,
      replaceRefundWithCancellation: false,
      keepTicketOpen: false,
      suppressReply: true,
    },
  );
});

test('a content prohibition does not suppress the required customer reply', () => {
  assert.deepEqual(
    compileOperatorRevisionDirectives(
      'Cancel the order and confirm it after Shopify succeeds. Do not send another shipping status estimate.',
    ),
    {
      forceCancellation: true,
      forbidCancellation: false,
      replaceRefundWithCancellation: false,
      keepTicketOpen: false,
      suppressReply: false,
    },
  );
});

test('applies reviewer prohibitions to a candidate plan before validation', () => {
  const actions = applyOperatorRevisionDirectives([
    { type: 'cancel_order', params: { order_id: 'order-1' } },
    { type: 'refund_order', params: { order_id: 'order-1' } },
    { type: 'send_reply', params: {} },
    { type: 'resolve', params: {} },
  ], {
    forceCancellation: true,
    forbidCancellation: false,
    replaceRefundWithCancellation: true,
    keepTicketOpen: true,
    suppressReply: false,
  }, ['order-1']);
  assert.deepEqual(actions.map((action) => action.type), ['cancel_order', 'send_reply']);
});
