import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calibrateConfidence,
  contributesToAnswerQualityCalibration,
  contributesToSemanticMemory,
  freshnessWeight,
  knowledgeConfidence,
  memoryActivationScore,
  qualityCalibrationEventsForKey,
  redactLearningText,
  resolveMemoryFreshness,
  scopeMatch,
  textSimilarity,
  trustForSignal,
  type CalibrationSample,
} from './autopilot-learning-policy.js';

const NOW = new Date('2026-07-10T12:00:00.000Z');

test('human revisions and edits carry more trust than clean approvals', () => {
  assert.ok(trustForSignal('human_edit') > trustForSignal('human_revision'));
  assert.ok(trustForSignal('human_revision') > trustForSignal('partial_approval'));
  assert.ok(trustForSignal('partial_approval') > trustForSignal('clean_approval'));
  assert.ok(trustForSignal('clean_approval') > trustForSignal('batch_approval'));
});

test('threshold decisions cannot self-calibrate or enter semantic memory distillation', () => {
  assert.equal(contributesToAnswerQualityCalibration('batch_approval'), false);
  assert.equal(contributesToAnswerQualityCalibration('clean_approval'), true);
  assert.equal(contributesToAnswerQualityCalibration('human_edit'), true);

  assert.equal(contributesToSemanticMemory('batch_approval'), false);
  assert.equal(contributesToSemanticMemory('clean_approval'), false);
  assert.equal(contributesToSemanticMemory('human_edit'), true);
  assert.equal(contributesToSemanticMemory('human_revision'), true);
});

test('quality calibration is isolated by exact provider/model/prompt lineage', () => {
  const flashKey = 'vercel-ai-gateway:deepseek/deepseek-v4.1-flash:support-v4';
  const proKey = 'vercel-ai-gateway:deepseek/deepseek-v4-pro:support-v4';
  const events = [
    { id: 'flash', payload: { calibration_key: flashKey } },
    { id: 'pro', payload: { calibration_key: proKey } },
    { id: 'legacy', payload: {} },
  ];

  assert.deepEqual(
    qualityCalibrationEventsForKey(events, flashKey).map((event) => event.id),
    ['flash'],
  );
  assert.deepEqual(
    qualityCalibrationEventsForKey(events, proKey).map((event) => event.id),
    ['pro'],
  );
  assert.deepEqual(
    qualityCalibrationEventsForKey(events).map((event) => event.id),
    [],
  );
});

test('every learned fact gets a bounded TTL even when the model marks it non-time-sensitive', () => {
  assert.deepEqual(resolveMemoryFreshness({
    kind: 'fact',
    timeSensitive: false,
  }), {
    timeSensitive: true,
    validForDays: 90,
  });

  assert.deepEqual(resolveMemoryFreshness({
    kind: 'fact',
    timeSensitive: false,
    validForDays: 365,
  }), {
    timeSensitive: true,
    validForDays: 90,
  });

  // The fact safeguard changes lifetime only; durable non-fact memory keeps
  // its existing policy and scope is handled by the independent matcher.
  assert.deepEqual(resolveMemoryFreshness({
    kind: 'procedure',
    timeSensitive: false,
  }), {
    timeSensitive: false,
    validForDays: null,
  });
});

test('scope mismatch prevents a narrow return lesson from becoming a shipping rule', () => {
  const exact = scopeMatch(
    { intent: 'return_request', category: 'returns', topics: ['damaged', 'photos'] },
    { intent: 'return_request', category: 'returns', topics: ['damaged'] },
  );
  const wrongIntent = scopeMatch(
    { intent: 'shipping_status', category: 'shipping', topics: ['tracking'] },
    { intent: 'return_request', category: 'returns', topics: ['damaged'] },
  );
  assert.ok(exact > 0.8);
  assert.ok(wrongIntent < 0.05);
});

test('expired knowledge is ineligible and time-sensitive knowledge decays quickly', () => {
  const expired = memoryActivationScore({
    status: 'active', confidence: 0.95, trust: 0.98,
    learnedScope: { intent: 'promotion' }, currentScope: { intent: 'promotion' },
    updatedAt: '2026-07-01T00:00:00.000Z', validUntil: '2026-07-09T00:00:00.000Z',
    timeSensitive: true, now: NOW,
  });
  const current = memoryActivationScore({
    status: 'active', confidence: 0.95, trust: 0.98,
    learnedScope: { intent: 'promotion' }, currentScope: { intent: 'promotion' },
    updatedAt: '2026-07-09T00:00:00.000Z', validUntil: '2026-07-20T00:00:00.000Z',
    timeSensitive: true, now: NOW,
  });
  assert.equal(expired, 0);
  assert.ok(current > 0.8);
  assert.ok(freshnessWeight('2026-06-10T12:00:00.000Z', 30, NOW) < 0.51);
});

test('Bayesian calibration shrinks toward reviewed outcomes and preserves sparse priors', () => {
  const raw = 0.8;
  const none = calibrateConfidence(raw, [], 'send_reply', 'shipping_status', NOW);
  assert.equal(none.value, raw);

  const successSamples: CalibrationSample[] = Array.from({ length: 8 }, (_, index) => ({
    predicted: 0.8,
    outcome: 1,
    weight: 0.9,
    occurredAt: `2026-07-0${(index % 8) + 1}T12:00:00.000Z`,
    actionType: 'send_reply',
    intent: 'shipping_status',
  }));
  const correctionSamples: CalibrationSample[] = successSamples.map((sample) => ({ ...sample, outcome: 0.15 }));
  const raised = calibrateConfidence(raw, successSamples, 'send_reply', 'shipping_status', NOW);
  const lowered = calibrateConfidence(raw, correctionSamples, 'send_reply', 'shipping_status', NOW);
  assert.ok(raised.value > raw);
  assert.ok(lowered.value < raw - 0.2);

  const otherIntent = calibrateConfidence(raw, correctionSamples, 'send_reply', 'return_request', NOW);
  assert.ok(otherIntent.value > lowered.value);
});

test('edit similarity distinguishes light copy edits from replacement drafts', () => {
  assert.ok(textSimilarity('Your order ships Friday. Best regards.', 'Your order will ship Friday. Best regards.') > 0.75);
  assert.ok(textSimilarity('Your order ships Friday.', 'Please send photos of the damaged lamp.') < 0.3);
});

test('shared memory text redacts direct identifiers', () => {
  const redacted = redactLearningText('Email jane@example.com about order #123456, $129.95, July 12, 2026, +1 (415) 555-1212, 42 Market Street, and tracking 1Z999AA10123456784 at https://example.com/x');
  assert.equal(redacted.includes('jane@example.com'), false);
  assert.equal(redacted.includes('#123456'), false);
  assert.equal(redacted.includes('https://'), false);
  assert.equal(redacted.includes('555-1212'), false);
  assert.equal(redacted.includes('129.95'), false);
  assert.equal(redacted.includes('Market Street'), false);
  assert.equal(redacted.includes('1Z999AA10123456784'), false);
});

test('knowledge confidence responds to support and contradiction mass', () => {
  assert.ok(knowledgeConfidence(2, 0.1) > 0.8);
  assert.ok(knowledgeConfidence(1, 1) < 0.6);
  assert.ok(knowledgeConfidence(0.1, 2) < 0.2);
});
