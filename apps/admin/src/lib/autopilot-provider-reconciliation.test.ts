import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cancellationRefundWasSubmitted,
  pollProviderPostcondition,
} from './autopilot-provider-reconciliation';

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
