import assert from 'node:assert/strict';
import test from 'node:test';
import {
  selectStorefrontModel,
  storefrontToolRequiresPro,
} from './storefront-model-routing.js';

test('routine product and order-status questions use Flash without thinking', () => {
  assert.deepEqual(selectStorefrontModel({
    currentMessage: 'Is the brass pendant in stock?',
  }), {
    tier: 'flash',
    thinking: 'disabled',
    reasons: ['routine_or_read_only'],
    router_version: 'storefront-router-v1',
  });

  assert.equal(selectStorefrontModel({
    currentMessage: 'Where is order #1042?',
  }).tier, 'flash');
});

test('money, order mutation, return, and sensitive cases use Pro', () => {
  for (const currentMessage of [
    'Cancel order #1042 and refund me.',
    'I need to return a damaged fixture.',
    'Please change the shipping address.',
    'I am filing a chargeback.',
  ]) {
    const route = selectStorefrontModel({ currentMessage });
    assert.equal(route.tier, 'pro', currentMessage);
    assert.equal(route.thinking, 'high', currentMessage);
  }
});

test('multiple orders and conflicting history use Pro', () => {
  const route = selectStorefrontModel({
    currentMessage: 'Actually keep order #1042, but where is order #1043?',
    priorCustomerMessages: ['Please cancel order #1042.'],
  });
  assert.equal(route.tier, 'pro');
  assert.ok(route.reasons.includes('multiple_orders'));
  assert.ok(route.reasons.includes('conflicting_customer_instruction'));
});

test('privileged tool guard requires Pro before execution', () => {
  assert.equal(storefrontToolRequiresPro('cancel_order'), true);
  assert.equal(storefrontToolRequiresPro('initiate_return'), true);
  assert.equal(storefrontToolRequiresPro('lookup_order'), false);
  assert.equal(storefrontToolRequiresPro('search_products'), false);
});
