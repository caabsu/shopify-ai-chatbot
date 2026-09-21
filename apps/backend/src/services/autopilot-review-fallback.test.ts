import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AUTOPILOT_CONTEXT_FALLBACK_REASON,
  AUTOPILOT_REVIEW_FALLBACK_REASON,
  buildAutopilotReviewFallback,
} from './autopilot-review-fallback.js';

test('validator rejection becomes a reviewable plan without a reply or mutation', () => {
  const fallback = buildAutopilotReviewFallback({
    rejection: 'unsafe_validation',
    validationError: 'cancel_order was dropped while its completion reply remained',
    droppedNotes: ['Dropped proposed cancel_order — order was not safely identified.'],
    createId: () => 'fallback-action',
  });

  assert.equal(fallback.raw.overall_confidence, 0);
  assert.deepEqual(fallback.raw.actions, []);
  assert.equal(fallback.actions.length, 1);
  assert.deepEqual(
    fallback.actions.map((action) => action.type),
    ['escalate_human'],
  );
  assert.equal(fallback.actions.some((action) => (
    ['send_reply', 'cancel_order', 'refund_order', 'update_shipping_address']
      .includes(action.type)
  )), false);
  assert.equal(fallback.actions[0].params.review_only, true);
  assert.equal(fallback.actions[0].params.auto_run_allowed, false);
  assert.equal(fallback.actions[0].params.approval_allowed, false);
  assert.equal(fallback.actions[0].params.policy_confidence_cap, 0);
  assert.equal(fallback.actions[0].params.reason_code, AUTOPILOT_REVIEW_FALLBACK_REASON);
  assert.equal('reply_text' in fallback.actions[0].params, false);
});

test('fallback sanitizes and bounds validator diagnostics stored for the reviewer', () => {
  const fallback = buildAutopilotReviewFallback({
    rejection: 'empty_plan',
    validationError: `unsafe\u0000\n${'x'.repeat(800)}`,
    droppedNotes: Array.from({ length: 12 }, (_, index) => `note ${index}`),
    createId: () => 'fallback-action',
  });

  assert.equal(fallback.actions[0].params.validation_error.includes('\u0000'), false);
  assert.equal(fallback.actions[0].params.validation_error.includes('\n'), false);
  assert.equal(fallback.actions[0].params.validation_error.length, 500);
  assert.equal(fallback.actions[0].params.dropped_notes.length, 8);
});

test('context outages use a distinct non-executable reason code', () => {
  const fallback = buildAutopilotReviewFallback({
    rejection: AUTOPILOT_CONTEXT_FALLBACK_REASON,
    reasonCode: AUTOPILOT_CONTEXT_FALLBACK_REASON,
    validationError: 'Live Shopify evidence is unavailable.',
    droppedNotes: [],
    createId: () => 'fallback-action',
  });

  assert.equal(
    fallback.actions[0].params.reason_code,
    AUTOPILOT_CONTEXT_FALLBACK_REASON,
  );
  assert.equal(fallback.actions[0].params.approval_allowed, false);
  assert.equal(fallback.actions[0].params.auto_run_allowed, false);
});
