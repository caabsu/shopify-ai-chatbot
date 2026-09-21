import assert from 'node:assert/strict';
import test from 'node:test';
import { SHOPIFY_SUPPORT_EVIDENCE_PROJECTION } from './autopilot-evidence.js';
import { CUSTOMER_HISTORY_PROJECTION } from './customer-support-context.service.js';
import {
  autopilotPlanRefreshReasons,
  autopilotTerminalRunNeedsRecovery,
} from './autopilot-coverage-policy.js';

const now = Date.parse('2026-07-18T04:00:00.000Z');

function supportPlan(validUntil: string) {
  return {
    status: 'proposed',
    context_version: 4,
    actions: [{ type: 'send_reply' }],
    evidence: {
      shopify_orders: {
        projection_version: SHOPIFY_SUPPORT_EVIDENCE_PROJECTION,
        valid_until: validUntil,
      },
      customer_history: {
        projection_version: CUSTOMER_HISTORY_PROJECTION,
        valid_until: validUntil,
      },
    },
  };
}

test('keeps a proposal stable when only its evidence TTL has elapsed', () => {
  assert.deepEqual(
    autopilotPlanRefreshReasons({
      plan: supportPlan('2026-07-18T03:30:00.000Z'),
      ticketContextVersion: 4,
      hasCustomerEmail: true,
      refreshBeforeMs: now + 60 * 60_000,
      nowMs: now,
    }),
    [],
  );
});

test('retries deterministic provider fallbacks on their own schedule', () => {
  assert.deepEqual(
    autopilotPlanRefreshReasons({
      plan: {
        ...supportPlan('2026-07-19T04:00:00.000Z'),
        prompt_version: 'deterministic-nonblocking-fallback-v1',
        analysis: { planner_retry_after: '2026-07-18T03:59:00.000Z' },
      },
      ticketContextVersion: 4,
      hasCustomerEmail: true,
      refreshBeforeMs: now,
      nowMs: now,
    }),
    ['provider_fallback_retry'],
  );
  assert.deepEqual(
    autopilotPlanRefreshReasons({
      plan: {
        ...supportPlan('2026-07-19T04:00:00.000Z'),
        prompt_version: 'deterministic-nonblocking-fallback-v1',
        analysis: { planner_retry_after: '2026-07-18T04:15:00.000Z' },
      },
      ticketContextVersion: 4,
      hasCustomerEmail: true,
      refreshBeforeMs: now,
      nowMs: now,
    }),
    [],
  );
});

test('keeps a current proposal and ignores decided plans', () => {
  assert.deepEqual(
    autopilotPlanRefreshReasons({
      plan: supportPlan('2026-07-19T04:00:01.000Z'),
      ticketContextVersion: 4,
      hasCustomerEmail: true,
      refreshBeforeMs: now + 60 * 60_000,
    }),
    [],
  );
  assert.deepEqual(
    autopilotPlanRefreshReasons({
      plan: { ...supportPlan('2026-07-18T03:00:00.000Z'), status: 'dismissed' },
      ticketContextVersion: 4,
      hasCustomerEmail: true,
      refreshBeforeMs: now,
    }),
    [],
  );
});

test('refreshes stale context and missing evidence but not read-only cards', () => {
  assert.deepEqual(
    autopilotPlanRefreshReasons({
      plan: {
        status: 'proposed',
        context_version: 3,
        actions: [{ type: 'cancel_order' }],
      },
      ticketContextVersion: 4,
      hasCustomerEmail: true,
      refreshBeforeMs: now,
    }),
    ['stale_context', 'missing_shopify_evidence', 'missing_customer_history_evidence'],
  );
  assert.deepEqual(
    autopilotPlanRefreshReasons({
      plan: {
        status: 'proposed',
        context_version: 4,
        actions: [{ type: 'set_priority' }, { type: 'add_tags' }],
      },
      ticketContextVersion: 4,
      hasCustomerEmail: true,
      refreshBeforeMs: now,
    }),
    [],
  );
});

test('recovers only old executing plans whose durable receipts are all terminal', () => {
  const decidedAt = '2026-07-18T03:50:00.000Z';
  assert.equal(autopilotTerminalRunNeedsRecovery({
    planStatus: 'executing',
    decidedAt,
    receipts: [{ status: 'executed' }, { status: 'failed' }],
    nowMs: now,
  }), true);
  assert.equal(autopilotTerminalRunNeedsRecovery({
    planStatus: 'executing',
    decidedAt,
    receipts: [{ status: 'uncertain' }],
    nowMs: now,
  }), false);
  assert.equal(autopilotTerminalRunNeedsRecovery({
    planStatus: 'executing',
    decidedAt: '2026-07-18T03:59:00.000Z',
    receipts: [],
    nowMs: now,
  }), false);
});
