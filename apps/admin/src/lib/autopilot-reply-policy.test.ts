import assert from 'node:assert/strict';
import test from 'node:test';
import { validateFinalReplyOutcomes } from './autopilot-reply-policy';
import type { AutopilotAction } from './types';

function action(type: AutopilotAction['type'], orderName = '#1025'): AutopilotAction {
  return {
    id: `${type}-id`, type, title: type, detail: '',
    params: { order_name: orderName, ...(type === 'cancel_order' ? { refund_expected: true } : {}) },
    confidence: 0.9, status: 'approved',
  };
}

test('a completion claim requires its approved action', () => {
  const result = validateFinalReplyOutcomes({
    replyText: 'I have cancelled order #1025.', actions: [], actionIsAvailable: () => false,
  });
  assert.equal(result.ok, false);
});

test('recognizes a natural now-cancelled completion claim', () => {
  const result = validateFinalReplyOutcomes({
    replyText: "I've now cancelled order #1034 as requested.",
    actions: [action('cancel_order', '#1034')],
    actionIsAvailable: () => true,
  });
  assert.deepEqual(result, { ok: true });
});

test('recognizes deterministic refund and address completion wording', () => {
  assert.deepEqual(validateFinalReplyOutcomes({
    replyText: "I've issued the requested refund for order #1128.",
    actions: [action('refund_order', '#1128')],
    actionIsAvailable: () => true,
  }), { ok: true });
  assert.deepEqual(validateFinalReplyOutcomes({
    replyText: "I've corrected the shipping address on order #1254.",
    actions: [action('update_shipping_address', '#1254')],
    actionIsAvailable: () => true,
  }), { ok: true });
});

test('a cancellation action satisfies its refund claim for the same order', () => {
  const result = validateFinalReplyOutcomes({
    replyText: 'We cancelled order #1025 and your refund is on its way.',
    actions: [action('cancel_order')], actionIsAvailable: () => true,
  });
  assert.deepEqual(result, { ok: true });
});

test('an action for one order cannot unlock a success claim about another', () => {
  const result = validateFinalReplyOutcomes({
    replyText: 'We have cancelled order #1026.',
    actions: [action('cancel_order', '#1025')], actionIsAvailable: () => true,
  });
  assert.equal(result.ok, false);
});

test('historical cancellation never proves a historical refund', () => {
  const result = validateFinalReplyOutcomes({
    replyText: 'The order was cancelled and your refund is on its way.',
    actions: [], actionIsAvailable: () => false, historicalOutcomes: ['cancel_order'],
  });
  assert.equal(result.ok, false);
});

test('a cancel action cannot verify an exact refund amount', () => {
  const result = validateFinalReplyOutcomes({
    replyText: 'We cancelled order #1025 and a refund of $417.95 is on its way.',
    actions: [action('cancel_order')], actionIsAvailable: () => true,
  });
  assert.equal(result.ok, false);
});

test('historical completion evidence is bound to its exact order', () => {
  const evidence = [{ type: 'cancel_order', order_name: '#1025' }];
  assert.deepEqual(validateFinalReplyOutcomes({
    replyText: 'Order 1025 was cancelled previously.', actions: [], actionIsAvailable: () => false,
    historicalOutcomeEvidence: evidence,
  }), { ok: true });
  assert.equal(validateFinalReplyOutcomes({
    replyText: 'Order #9999 was cancelled previously.', actions: [], actionIsAvailable: () => false,
    historicalOutcomeEvidence: evidence,
  }).ok, false);
});

test('one reviewer-verified unbound legacy outcome binds to the reply sole exact order', () => {
  const result = validateFinalReplyOutcomes({
    replyText: 'I double-checked #4806: the order was cancelled, but the original refund did not go through.',
    actions: [],
    actionIsAvailable: () => false,
    historicalOutcomeEvidence: [{ type: 'cancel_order', order_name: null }],
  });
  assert.deepEqual(result, { ok: true });
});

test('unbound legacy evidence cannot unlock a multi-order completion claim', () => {
  const result = validateFinalReplyOutcomes({
    replyText: 'Order #4806 was cancelled. Order #9999 was cancelled.',
    actions: [],
    actionIsAvailable: () => false,
    historicalOutcomeEvidence: [{ type: 'cancel_order', order_name: null }],
  });
  assert.equal(result.ok, false);
});

test('unbound legacy evidence cannot override a mismatched live action target', () => {
  const result = validateFinalReplyOutcomes({
    replyText: 'We cancelled order #1026.',
    actions: [action('cancel_order', '#1025')],
    actionIsAvailable: () => true,
    historicalOutcomeEvidence: [{ type: 'cancel_order', order_name: null }],
  });
  assert.equal(result.ok, false);
});

test('reviewer-verified historical refund evidence carries its exact amount', () => {
  const evidence = [{ type: 'refund_order', order_name: '#4972', amount: 461.3 }];
  assert.deepEqual(validateFinalReplyOutcomes({
    replyText: 'Your refund of $461.30 has been processed successfully.',
    actions: [],
    actionIsAvailable: () => false,
    historicalOutcomeEvidence: evidence,
  }), { ok: true });
  assert.equal(validateFinalReplyOutcomes({
    replyText: 'Your refund of $500.00 has been processed successfully.',
    actions: [],
    actionIsAvailable: () => false,
    historicalOutcomeEvidence: evidence,
  }).ok, false);
});

test('reviewer-verified pending alternate refund amount may be quoted without claiming completion', () => {
  assert.deepEqual(validateFinalReplyOutcomes({
    replyText: 'Please confirm that your PayPal account can receive the $418.30 USD refund.',
    actions: [],
    actionIsAvailable: () => false,
    verifiedPendingRefundAmounts: [418.3],
  }), { ok: true });
  assert.equal(validateFinalReplyOutcomes({
    replyText: 'Please confirm that your PayPal account can receive the $501.75 refund.',
    actions: [],
    actionIsAvailable: () => false,
    verifiedPendingRefundAmounts: [418.3],
  }).ok, false);
});

test('a dollar amount is not mistaken for an order reference', () => {
  const cancel = action('cancel_order');
  const result = validateFinalReplyOutcomes({
    replyText: 'We cancelled your order. The $417.95 charge will not be captured.',
    actions: [cancel], actionIsAvailable: () => true,
  });
  assert.deepEqual(result, { ok: true });
});

test('indirect completion wording still requires a verified action', () => {
  for (const replyText of [
    'I took care of the cancellation.',
    'The order cancellation is all set.',
    'Your refund was taken care of.',
    'A full refund will be returned to your card.',
    'The shipping address change is all set.',
  ]) {
    assert.equal(validateFinalReplyOutcomes({
      replyText, actions: [], actionIsAvailable: () => false,
    }).ok, false);
  }
});

test('configured order prefixes remain bound to the exact action target', () => {
  for (const replyText of [
    'We cancelled order #WBD1026.',
    'We cancelled WBD1026.',
    'Your WBD1026 order was cancelled.',
  ]) {
    assert.equal(validateFinalReplyOutcomes({
      replyText,
      actions: [action('cancel_order', '#WBD1025')],
      actionIsAvailable: () => true,
    }).ok, false);
  }
});

test('done, processed, voided, and went-through wording cannot bypass action guards', () => {
  for (const replyText of [
    'Cancellation is done.',
    'We processed your cancellation.',
    'Your order has been voided.',
    'The refund went through.',
    'Your cancellation has been processed.',
    'Your cancellation has been completed.',
    'Your refund is complete.',
    'We completed your refund.',
    'Your cancellation was successful.',
    'The cancellation succeeded.',
    'Your refund was successful.',
    'The refund succeeded.',
    'Your shipping address update was successful.',
  ]) {
    assert.equal(validateFinalReplyOutcomes({
      replyText, actions: [], actionIsAvailable: () => false,
    }).ok, false);
  }
});

test('additional indirect success wording cannot bypass action guards', () => {
  for (const replyText of [
    'We took care of your refund.',
    'Your refund is done.',
    'We finalized your refund.',
    'Your address change was successful.',
    'The shipping address change succeeded.',
    'Your cancellation request was completed.',
    'We have taken care of the refund.',
    'Your reimbursement is done.',
    'We finalized the reimbursement.',
    'The address correction was successful.',
    'The delivery address change went through.',
    'Your cancellation request succeeded.',
    'The order cancellation request is complete.',
  ]) {
    assert.equal(validateFinalReplyOutcomes({
      replyText, actions: [], actionIsAvailable: () => false,
    }).ok, false);
  }
});

test('questions and inability wording remain non-completion claims', () => {
  for (const replyText of [
    'Did we take care of your refund?',
    'Your refund is not done.',
    'We could not finalize your refund.',
    'Was your address change successful?',
    'The shipping address change did not succeed.',
    'Could the cancellation request be completed?',
  ]) {
    assert.deepEqual(validateFinalReplyOutcomes({
      replyText, actions: [], actionIsAvailable: () => false,
    }), { ok: true });
  }
});

test('word-suffixed refund amounts require an exact refund action', () => {
  assert.equal(validateFinalReplyOutcomes({
    replyText: 'A refund of 10 dollars has been processed.',
    actions: [action('cancel_order')],
    actionIsAvailable: () => true,
  }).ok, false);
});
