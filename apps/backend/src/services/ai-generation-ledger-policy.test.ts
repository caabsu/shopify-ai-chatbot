import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizedGenerationRunTimestamps } from './ai-generation-ledger-policy.js';

test('a finished-only generation derives a valid earlier start from latency', () => {
  const times = normalizedGenerationRunTimestamps({
    finishedAt: '2026-07-18T08:00:10.000Z',
    latencyMs: 2_500,
    now: new Date('2026-07-18T08:00:11.000Z'),
  });
  assert.equal(times.startedAt, '2026-07-18T08:00:07.500Z');
  assert.equal(times.finishedAt, '2026-07-18T08:00:10.000Z');
  assert.ok(Date.parse(times.finishedAt) >= Date.parse(times.startedAt));
});

test('an explicit start is preserved', () => {
  assert.deepEqual(normalizedGenerationRunTimestamps({
    startedAt: '2026-07-18T08:00:00.000Z',
    finishedAt: '2026-07-18T08:00:01.000Z',
  }), {
    startedAt: '2026-07-18T08:00:00.000Z',
    finishedAt: '2026-07-18T08:00:01.000Z',
  });
});
