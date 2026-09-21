import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SHOPIFY_SUPPORT_EVIDENCE_PROJECTION,
  canonicalShopifySupportEvidence,
  shopifyOrderEvidenceHashes,
  shopifySupportEvidenceHash,
  type ShopifyEvidenceCustomer,
  type ShopifyEvidenceOrder,
} from './autopilot-evidence.js';

const customer: ShopifyEvidenceCustomer = {
  id: 'gid://shopify/Customer/1',
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
  phone: '+15551234567',
  ordersCount: 2,
  totalSpent: '249.00 USD',
  createdAt: '2026-01-01T00:00:00.000Z',
  tags: ['vip', 'trade'],
  note: 'Prefers email',
  state: 'ENABLED',
};

const orders: ShopifyEvidenceOrder[] = [{
  id: 'gid://shopify/Order/1',
  name: '#1001',
  totalPrice: '149.00 USD',
  financialStatus: 'PAID',
  fulfillmentStatus: 'FULFILLED',
  lineItems: [
    { title: 'Pendant', quantity: 1, variantTitle: 'Brass' },
    { title: 'Bulb', quantity: 2, variantTitle: '2700K' },
  ],
  tracking: [
    { number: 'TRACK-2', url: 'https://store.test/track', company: 'UPS' },
    { number: 'TRACK-1', url: 'https://store.test/track', company: 'USPS' },
  ],
  fulfillments: [{
    status: 'SUCCESS',
    createdAt: '2026-07-01T08:00:00.000Z',
    trackingInfo: [{ number: 'TRACK-1', url: 'https://store.test/track', company: 'USPS' }],
  }],
  createdAt: '2026-06-30T12:00:00.000Z',
  cancelledAt: null,
  closedAt: '2026-07-02T12:00:00.000Z',
}];

test('Shopify prompt evidence is deterministic across unordered collections', () => {
  const reorderedCustomer = { ...customer, tags: [...customer.tags].reverse() };
  const reorderedOrders = structuredClone(orders);
  reorderedOrders[0].lineItems.reverse();
  reorderedOrders[0].tracking.reverse();

  assert.equal(
    shopifySupportEvidenceHash(customer, orders),
    shopifySupportEvidenceHash(reorderedCustomer, reorderedOrders),
  );
  assert.equal(canonicalShopifySupportEvidence(customer, orders).projection, SHOPIFY_SUPPORT_EVIDENCE_PROJECTION);
});

test('Shopify prompt evidence changes for profile, tracking, fulfillment, and date mutations', () => {
  const baseline = shopifySupportEvidenceHash(customer, orders);
  const mutations: Array<[string, () => [ShopifyEvidenceCustomer | null, ShopifyEvidenceOrder[]]]> = [
    ['customer profile', () => [{ ...customer, note: 'Call first' }, structuredClone(orders)]],
    ['tracking URL', () => {
      const changed = structuredClone(orders);
      changed[0].tracking[0].url = 'https://store.test/new-track';
      return [customer, changed];
    }],
    ['carrier', () => {
      const changed = structuredClone(orders);
      changed[0].tracking[0].company = 'FedEx';
      return [customer, changed];
    }],
    ['fulfillment timestamp', () => {
      const changed = structuredClone(orders);
      changed[0].fulfillments[0].createdAt = '2026-07-02T08:00:00.000Z';
      return [customer, changed];
    }],
    ['cancellation timestamp', () => {
      const changed = structuredClone(orders);
      changed[0].cancelledAt = '2026-07-03T08:00:00.000Z';
      return [customer, changed];
    }],
    ['order timestamp', () => {
      const changed = structuredClone(orders);
      changed[0].createdAt = '2026-06-29T12:00:00.000Z';
      return [customer, changed];
    }],
  ];

  for (const [label, mutate] of mutations) {
    const [changedCustomer, changedOrders] = mutate();
    assert.notEqual(shopifySupportEvidenceHash(changedCustomer, changedOrders), baseline, label);
  }
});

test('per-order evidence isolates an expected mutation from unrelated orders', () => {
  const second = { ...structuredClone(orders[0]), id: 'gid://shopify/Order/2', name: '#1002' };
  const baseline = shopifyOrderEvidenceHashes([...orders, second]);
  const changed = structuredClone([...orders, second]);
  changed[0].cancelledAt = '2026-07-03T08:00:00.000Z';
  const after = shopifyOrderEvidenceHashes(changed);
  assert.notEqual(after[orders[0].id], baseline[orders[0].id]);
  assert.equal(after[second.id], baseline[second.id]);
});
