import assert from 'node:assert/strict';
import test from 'node:test';
import {
  customerHistoryEvidenceMatches,
  planMatchesRefreshExpectation,
} from './autopilot-refresh-policy.js';

const now = Date.parse('2026-07-18T05:00:00.000Z');
const evidence = {
  projection_version: 'customer-support-context-v1',
  hash: 'history-a',
  valid_until: '2026-07-18T06:00:00.000Z',
  ticket_count: 2,
  ticket_message_count: 3,
  conversation_count: 1,
  chat_message_count: 4,
};

test('customer history match requires the complete live projection', () => {
  assert.equal(customerHistoryEvidenceMatches(evidence, {
    projection_version: evidence.projection_version,
    hash: evidence.hash,
    ticket_count: 2,
    ticket_message_count: 3,
    conversation_count: 1,
    chat_message_count: 4,
  }, now), true);

  assert.equal(customerHistoryEvidenceMatches(evidence, {
    projection_version: evidence.projection_version,
    hash: 'history-b',
    ticket_count: 2,
    ticket_message_count: 4,
    conversation_count: 1,
    chat_message_count: 4,
  }, now), false);
});

test('expired evidence is stale even when its projection still matches', () => {
  assert.equal(customerHistoryEvidenceMatches(
    { ...evidence, valid_until: '2026-07-18T04:59:59.000Z' },
    {
      projection_version: evidence.projection_version,
      hash: evidence.hash,
      ticket_count: 2,
      ticket_message_count: 3,
      conversation_count: 1,
      chat_message_count: 4,
    },
    now,
  ), false);
});

test('refresh expectations prevent an old request from replacing a newer plan', () => {
  const plan = {
    id: 'plan-new',
    revision: 3,
    context_fingerprint: 'fingerprint-new',
    context_version: 7,
  };
  assert.equal(planMatchesRefreshExpectation(plan, {
    planId: 'plan-new',
    revision: 3,
    contextFingerprint: 'fingerprint-new',
    contextVersion: 7,
  }), true);
  assert.equal(planMatchesRefreshExpectation(plan, {
    planId: 'plan-old',
    revision: 2,
  }), false);
});
