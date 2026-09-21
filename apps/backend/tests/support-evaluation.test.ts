import test from 'node:test';
import assert from 'node:assert/strict';
import { errorRateUpperBound, zeroErrorSampleSize, summarizeSupportEvaluation, type EvaluationResult } from '../src/services/support-evaluation.js';
import type { DraftReview, IntakeAssessment } from '../src/services/support-ai.js';

function draft(id: string, expected: 'passed' | 'needs_review', actual: DraftReview['status'], audited = false): EvaluationResult {
  return { id, brand: 'test-brand', kind: 'draft', workflow: 'order_status', origin: audited ? 'historical' : 'synthetic',
    input_fingerprint: id, audit: { independent_unit_id: id, held_out: true, human_reviewed: true, representative_sample: true },
    expected: { status: expected }, actual: { status: actual } as DraftReview, passed: actual === expected };
}

test('99.9% needs 2,995 zero-error independent approvals at one-sided 95% confidence', () => {
  assert.equal(zeroErrorSampleSize(), 2995);
  assert.ok(errorRateUpperBound(0, 2994)! > 0.001);
  assert.ok(errorRateUpperBound(0, 2995)! <= 0.001);
  assert.equal(errorRateUpperBound(0, 0), null);
  assert.ok(Math.abs(errorRateUpperBound(0, 1)! - 0.95) < 1e-12);
  assert.ok(Math.abs(errorRateUpperBound(1, 2)! - Math.sqrt(0.95)) < 1e-12);
  assert.equal(errorRateUpperBound(2, 2), 1);
  assert.throws(() => errorRateUpperBound(3, 2));
  assert.throws(() => errorRateUpperBound(0, 2, NaN));
});

test('rejecting everything has zero coverage and undefined approval precision', () => {
  const m = summarizeSupportEvaluation([draft('good', 'passed', 'needs_review'), draft('bad', 'needs_review', 'needs_review')]);
  assert.equal(m.draft_quality.approval_precision, null);
  assert.equal(m.draft_quality.approval_coverage, 0);
  assert.equal(m.draft_quality.acceptable_drafts_sent_to_review, 1);
  assert.equal(m.reliability_target.supported_by_held_out_audits, false);
});

test('a high overall match rate cannot conceal an unsafe approval', () => {
  const cases = Array.from({ length: 99 }, (_, i) => draft(`blocked-${i}`, 'needs_review', 'needs_review'));
  cases.push(draft('unsafe', 'needs_review', 'passed'));
  const m = summarizeSupportEvaluation(cases);
  assert.equal(m.draft_quality.unsafe_approvals, 1);
  assert.equal(m.draft_quality.approval_precision, 0);
  assert.equal(m.draft_quality.approval_coverage, 0.01);
});

test('synthetic and reused tuning samples cannot establish the production target', () => {
  const synthetic = Array.from({ length: 3000 }, (_, i) => draft(String(i), 'passed', 'passed'));
  assert.equal(summarizeSupportEvaluation(synthetic).reliability_target.supported_by_held_out_audits, false);
  const tuning = synthetic.map(row => ({ ...row, origin: 'historical' as const, audit: { ...row.audit!, held_out: false } }));
  assert.equal(summarizeSupportEvaluation(tuning).reliability_target.strata[0].audited_approved_drafts, 0);
});

test('independent historical approvals can support the bound, separately by brand/workflow', () => {
  const cases = Array.from({ length: 2995 }, (_, i) => draft(String(i), 'passed', 'passed', true));
  assert.equal(summarizeSupportEvaluation(cases).reliability_target.supported_by_held_out_audits, true);
  cases.push({ ...draft('refund-1', 'passed', 'passed', true), workflow: 'refund' });
  const m = summarizeSupportEvaluation(cases);
  assert.equal(m.reliability_target.supported_by_held_out_audits, false);
  assert.equal(m.reliability_target.strata.find(s => s.stratum.endsWith(':refund'))?.target_supported, false);
});

test('duplicate tickets or identical inputs cannot inflate the audit sample', () => {
  const first = draft('1', 'passed', 'passed', true);
  const second = { ...draft('2', 'passed', 'passed', true), audit: first.audit };
  const m = summarizeSupportEvaluation([first, second]);
  assert.equal(m.reliability_target.strata[0].audited_approved_drafts, 0);
  assert.equal(m.reliability_target.excluded_duplicate_audit_units, 1);
  second.audit = { ...second.audit!, independent_unit_id: '2' };
  second.input_fingerprint = first.input_fingerprint;
  assert.equal(summarizeSupportEvaluation([first, second]).reliability_target.strata[0].audited_approved_drafts, 0);
});

test('classification abstentions remain distinct from wrong predictions and missed customer work', () => {
  const intake = (id: string, label: string, prediction: string, route: string, skip: boolean): EvaluationResult => ({
    id, brand: 'test-brand', kind: 'intake', expected: { classification: label, skip_draft: false }, passed: false,
    actual: { classification: route, predicted_classification: prediction, classification_requires_review: route !== prediction,
      skip_draft: skip, evaluation: { status: 'completed', answers: { classification: { type: 'choice', choice: prediction } } },
    } as IntakeAssessment,
  });
  const m = summarizeSupportEvaluation([
    intake('uncertain-marketing', 'promotional', 'promotional', 'customer_support', false),
    intake('missed-request', 'customer_support', 'spam', 'spam', true),
  ]).intake;
  assert.equal(m.classification_mismatches, 2);
  assert.equal(m.raw_classification_mismatches, 1);
  assert.equal(m.classification_abstentions, 1);
  assert.equal(m.customer_support_excluded, 1);
  assert.equal(m.unsafe_skips, 1);
});
