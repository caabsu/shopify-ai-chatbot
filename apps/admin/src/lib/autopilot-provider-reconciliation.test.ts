import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cancellationRefundWasSubmitted,
  partialRefundWasSubmitted,
  pollProviderPostcondition,
} from './autopilot-provider-reconciliation';

test('partial refunds require a receipt and a new accepted payment, not a failed refund record', () => {
  const input = {refundId: 'refund-new', expectedAmount: 44.25, refundedBefore: 0, refundedAfter: 0,
    refunds: [{id: 'refund-new', amount: '0'}], refundTransactionIdsBefore: new Set<string>(),
    transactions: [{id: 'tx-new', kind: 'REFUND', status: 'FAILURE', amount: '44.25'}]};
  assert.equal(partialRefundWasSubmitted(input), false);
  assert.equal(partialRefundWasSubmitted({...input, transactions: [{...input.transactions[0], status: 'PENDING'}]}), true);
  assert.equal(partialRefundWasSubmitted({...input, transactions: [{...input.transactions[0], status: 'SUCCESS'}]}), true);
  assert.equal(partialRefundWasSubmitted({...input, refunds: [], transactions: [{...input.transactions[0], status: 'SUCCESS'}]}), false);
  assert.equal(partialRefundWasSubmitted({...input, refundTransactionIdsBefore: new Set(['tx-new']), transactions: [{...input.transactions[0], status: 'SUCCESS'}]}), false);
  assert.equal(partialRefundWasSubmitted({...input, transactions: [{...input.transactions[0], status: 'SUCCESS', amount: '25'}]}), false);
});

test('partial refund financial proof must match the returned receipt and exclude prior refunds', () => {
  const input = {refundId: 'refund-new', expectedAmount: 25, refundedBefore: 10, refundedAfter: 35,
    refunds: [{id: 'refund-new', amount: '25'}], refundTransactionIdsBefore: new Set<string>(), transactions: []};
  assert.equal(partialRefundWasSubmitted(input), true);
  assert.equal(partialRefundWasSubmitted({...input, refundedAfter: 10}), false);
  assert.equal(partialRefundWasSubmitted({...input, refundId: undefined}), false);
  assert.equal(partialRefundWasSubmitted({...input, refunds: [{id: 'refund-old', amount: '25'}]}), false);
});

test('accepts a newly submitted full pending Shopify refund', () => {
  assert.equal(cancellationRefundWasSubmitted({
    financialStatus: 'PAID',
    refundedBefore: 0,
    refundedAfter: 0,
    expectedOutstanding: 207.95,
    refundTransactionIdsBefore: new Set(),
    transactions: [{
      id: 'gid://shopify/OrderTransaction/new',
      kind: 'REFUND',
      status: 'PENDING',
      amount: '207.95',
    }],
  }), true);
});

test('does not mistake a pre-existing pending refund for the cancellation refund', () => {
  assert.equal(cancellationRefundWasSubmitted({
    financialStatus: 'PARTIALLY_REFUNDED',
    refundedBefore: 25,
    refundedAfter: 25,
    expectedOutstanding: 182.95,
    refundTransactionIdsBefore: new Set(['gid://shopify/OrderTransaction/old']),
    transactions: [{
      id: 'gid://shopify/OrderTransaction/old',
      kind: 'REFUND',
      status: 'PENDING',
      amount: '207.95',
    }],
  }), false);
});

test('does not accept a new pending refund below the expected amount', () => {
  assert.equal(cancellationRefundWasSubmitted({
    financialStatus: 'PAID',
    refundedBefore: 0,
    refundedAfter: 0,
    expectedOutstanding: 207.95,
    refundTransactionIdsBefore: new Set(),
    transactions: [{
      id: 'gid://shopify/OrderTransaction/new',
      kind: 'REFUND',
      status: 'PENDING',
      amount: '50.00',
    }],
  }), false);
});

test('provider postcondition polling returns immediately when the first read is current', async () => {
  const result = await pollProviderPostcondition({
    load: async () => ({ refunded: true }),
    isSatisfied: (value) => value.refunded,
    signal: new AbortController().signal,
    timeoutMs: 20,
    intervalMs: 1,
  });
  assert.deepEqual(result, {
    value: { refunded: true },
    satisfied: true,
    attempts: 1,
  });
});

test('provider postcondition polling absorbs eventual-consistency lag', async () => {
  let reads = 0;
  const result = await pollProviderPostcondition({
    load: async () => ({ refunded: ++reads >= 3 }),
    isSatisfied: (value) => value.refunded,
    signal: new AbortController().signal,
    timeoutMs: 50,
    intervalMs: 1,
  });
  assert.equal(result.satisfied, true);
  assert.equal(result.attempts, 3);
});

test('provider postcondition polling returns the latest readable state at its bound', async () => {
  const result = await pollProviderPostcondition({
    load: async () => ({ refunded: false }),
    isSatisfied: (value) => value.refunded,
    signal: new AbortController().signal,
    timeoutMs: 3,
    intervalMs: 1,
  });
  assert.equal(result.satisfied, false);
  assert.ok(result.attempts >= 1);
  assert.deepEqual(result.value, { refunded: false });
});
