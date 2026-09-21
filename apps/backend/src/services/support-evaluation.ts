import type { DraftReview, IntakeAssessment } from './support-ai.js';

export interface EvaluationFixture {
  id: string;
  brand: string;
  kind: 'draft' | 'intake';
  workflow?: string;
  origin?: 'synthetic' | 'historical';
  // These are operator attestations, not labels an evaluator may invent.
  audit?: { independent_unit_id: string; held_out: boolean; human_reviewed: boolean; representative_sample: boolean };
}
export interface EvaluationResult extends EvaluationFixture {
  input_fingerprint?: string;
  expected: { status?: 'passed' | 'needs_review'; classification?: string; skip_draft?: boolean };
  actual: DraftReview | IntakeAssessment;
  passed: boolean;
}

// One-sided exact Clopper–Pearson upper bound on the error probability.
// Solve P(X <= errors | n, p) = 1 - confidence. Log-space summation avoids
// underflow for large audits. With zero errors this has a closed form.
export function errorRateUpperBound(errors: number, n: number, confidence = 0.95): number | null {
  if (!Number.isInteger(n) || !Number.isInteger(errors) || n < 0 || errors < 0 || errors > n || !Number.isFinite(confidence) || confidence <= 0 || confidence >= 1) throw new Error('Invalid reliability sample');
  if (n === 0) return null;
  if (errors === n) return 1;
  const alpha = 1 - confidence;
  if (errors === 0) return -Math.expm1(Math.log(alpha) / n);
  const logCdf = (p: number) => {
    let term = n * Math.log1p(-p), total = term;
    for (let k = 1; k <= errors; k++) {
      term += Math.log(n - k + 1) - Math.log(k) + Math.log(p) - Math.log1p(-p);
      const max = Math.max(total, term);
      total = max + Math.log(Math.exp(total - max) + Math.exp(term - max));
    }
    return total;
  };
  let low = 0, high = 1;
  for (let iteration = 0; iteration < 70; iteration++) {
    const middle = (low + high) / 2;
    if (logCdf(middle) > Math.log(alpha)) low = middle; else high = middle;
  }
  return high;
}

export function zeroErrorSampleSize(targetCorrectness = 0.999, confidence = 0.95): number {
  if (!Number.isFinite(targetCorrectness) || !Number.isFinite(confidence) || targetCorrectness <= 0 || targetCorrectness >= 1 || confidence <= 0 || confidence >= 1) throw new Error('Invalid reliability target');
  return Math.ceil(Math.log(1 - confidence) / Math.log(targetCorrectness));
}

export function summarizeSupportEvaluation(results: EvaluationResult[]) {
  const drafts = results.filter(result => result.kind === 'draft');
  const intakes = results.filter(result => result.kind === 'intake');
  const isApproved = (row: EvaluationResult) => (row.actual as DraftReview).status === 'passed';
  const approved = drafts.filter(isApproved);
  const unsafe = approved.filter(row => row.expected.status !== 'passed');
  const good = drafts.filter(row => row.expected.status === 'passed');
  const skipped = intakes.filter(row => (row.actual as IntakeAssessment).skip_draft);
  const qualifying = (row: EvaluationResult) => row.origin === 'historical' && !!row.workflow && !!row.input_fingerprint &&
    row.audit?.human_reviewed === true && row.audit.held_out === true &&
    row.audit.representative_sample === true && !!row.audit.independent_unit_id;

  // Repeated variants of one ticket must not manufacture a larger audit.
  const units = new Map<string, number>();
  const inputs = new Map<string, number>();
  for (const row of results.filter(qualifying)) {
    const key = `${row.brand}:${row.audit!.independent_unit_id}`;
    units.set(key, (units.get(key) ?? 0) + 1);
    const fingerprint = `${row.brand}:${row.input_fingerprint}`;
    inputs.set(fingerprint, (inputs.get(fingerprint) ?? 0) + 1);
  }
  const strata = [...new Set(drafts.map(row => `${row.brand}:${row.workflow ?? 'unspecified'}`))].sort().map(stratum => {
    const rows = drafts.filter(row => `${row.brand}:${row.workflow ?? 'unspecified'}` === stratum);
    const audited = rows.filter(row => qualifying(row) && units.get(`${row.brand}:${row.audit!.independent_unit_id}`) === 1 &&
      inputs.get(`${row.brand}:${row.input_fingerprint}`) === 1 && isApproved(row));
    const errors = audited.filter(row => row.expected.status !== 'passed').length;
    const upper = errorRateUpperBound(errors, audited.length);
    return { stratum, audited_approved_drafts: audited.length, errors,
      correctness_lower_bound_95: upper === null ? null : 1 - upper,
      target_supported: upper !== null && upper <= 0.001 };
  });
  return {
    draft_quality: {
      total: drafts.length,
      approved: approved.length,
      unsafe_approvals: unsafe.length,
      approval_precision: approved.length ? (approved.length - unsafe.length) / approved.length : null,
      approval_coverage: drafts.length ? approved.length / drafts.length : null,
      acceptable_drafts: good.length,
      acceptable_drafts_sent_to_review: good.filter(row => !isApproved(row)).length,
      unacceptable_drafts: drafts.length - good.length,
      unacceptable_drafts_blocked: drafts.length - good.length - unsafe.length,
      unavailable_assessments: drafts.filter(row => ['disabled', 'unavailable'].includes((row.actual as DraftReview).status)).length,
    },
    intake: {
      total: intakes.length,
      classification_mismatches: intakes.filter(row => (row.actual as IntakeAssessment).classification !== row.expected.classification).length,
      raw_classification_mismatches: intakes.filter(row => {
        const answer = (row.actual as IntakeAssessment).evaluation.answers.classification;
        return answer?.type === 'choice' && answer.choice !== row.expected.classification;
      }).length,
      classification_abstentions: intakes.filter(row => (row.actual as IntakeAssessment).classification_requires_review).length,
      customer_support_excluded: intakes.filter(row => row.expected.classification === 'customer_support' && (row.actual as IntakeAssessment).classification !== 'customer_support').length,
      unavailable_assessments: intakes.filter(row => (row.actual as IntakeAssessment).evaluation.status !== 'completed').length,
      skipped_drafts: skipped.length,
      unsafe_skips: skipped.filter(row => row.expected.skip_draft !== true).length,
      unnecessary_drafts: intakes.filter(row => row.expected.skip_draft === true && !(row.actual as IntakeAssessment).skip_draft).length,
    },
    reliability_target: {
      approved_reply_correctness: 0.999, confidence_level: 0.95,
      zero_error_audits_needed_per_stratum: zeroErrorSampleSize(),
      supported_by_held_out_audits: strata.length > 0 && strata.every(row => row.target_supported),
      strata,
      excluded_duplicate_audit_units: [...units.values()].filter(count => count > 1).length,
      excluded_duplicate_audit_inputs: [...inputs.values()].filter(count => count > 1).length,
      note: 'Synthetic examples and tuning data cannot establish production reliability. Audits require independently human-labeled, representative held-out tickets under a frozen policy. Bounds are per stratum, not a simultaneous guarantee across brands. Human approval remains required.',
    },
  };
}
