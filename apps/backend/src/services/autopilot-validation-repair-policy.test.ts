import assert from 'node:assert/strict';
import test from 'node:test';
import {
  plannerAttemptTiers,
  shouldRetryProPlannerError,
  validatorFallbackNeedsRetry,
  VALIDATION_REPAIR_VERSION,
} from './autopilot-validation-repair-policy.js';

test('planner gets one bounded Pro self-correction attempt', () => {
  assert.deepEqual(plannerAttemptTiers('flash'), ['flash', 'pro', 'pro']);
  assert.deepEqual(plannerAttemptTiers('pro'), ['pro', 'pro']);
});

test('Pro transport repair retries transient failures but not configuration or auth errors', () => {
  assert.equal(shouldRetryProPlannerError({ code: 'timeout' }), true);
  assert.equal(shouldRetryProPlannerError({ code: 'http_error', status: 429 }), true);
  assert.equal(shouldRetryProPlannerError({ code: 'http_error', status: 503 }), true);
  assert.equal(shouldRetryProPlannerError({ code: 'http_error', status: 401 }), false);
  assert.equal(shouldRetryProPlannerError({ code: 'invalid_config' }), false);
  assert.equal(shouldRetryProPlannerError(new Error('missing key')), false);
});

test('only old validator fallbacks are retried by the coverage sweep', () => {
  const validatorFallback = {
    status: 'proposed',
    analysis: { review_only: true },
    actions: [{ params: { reason_code: 'validator_rejected_plan' } }],
  };
  assert.equal(validatorFallbackNeedsRetry(validatorFallback), true);
  assert.equal(validatorFallbackNeedsRetry({
    ...validatorFallback,
    analysis: {
      review_only: true,
      validation_repair_version: VALIDATION_REPAIR_VERSION,
    },
  }), false);
  assert.equal(validatorFallbackNeedsRetry({
    analysis: { review_only: true },
    actions: [{ params: { reason_code: 'required_context_unavailable' } }],
  }), false);
  assert.equal(validatorFallbackNeedsRetry({
    ...validatorFallback,
    status: 'dismissed',
  }), false);
});
