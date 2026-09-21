import assert from 'node:assert/strict';
import test from 'node:test';
import { SUPPORT_QUALITY_CHECKS, validSupportQuality } from './support-quality-policy.js';

const verified = () => ({ confidence: .97, summary: 'All order facts are verified.', checks: SUPPORT_QUALITY_CHECKS.map(name => ({ name, passed: true, detail: 'Supported by the supplied evidence.' })) });
test('complete independent verification passes', () => assert.equal(validSupportQuality(verified()), true));
test('duplicate success cannot conceal a missing or failed check', () => {
  const duplicate = verified(); duplicate.checks[4] = duplicate.checks[0]; assert.equal(validSupportQuality(duplicate), false);
  const conflict = verified(); conflict.checks.push({ ...conflict.checks[0], passed: false }); assert.equal(validSupportQuality(conflict), false);
});
test('a failed check, missing rationale, or invalid confidence fails closed', () => {
  const failed = verified(); failed.checks[0].passed = false; assert.equal(validSupportQuality(failed), false);
  const empty = verified(); empty.checks[0].detail = ' '; assert.equal(validSupportQuality(empty), false);
  for (const confidence of [NaN, Infinity, -1, 1.01, '0.99', null]) assert.equal(validSupportQuality({ ...verified(), confidence }), false);
});
test('malformed tool output never throws or passes', () => {
  for (const value of [null, undefined, {}, 'verified', { ...verified(), checks: [null] }, { ...verified(), checks: undefined }]) assert.equal(validSupportQuality(value), false);
});
