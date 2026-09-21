'use client';

import type { DraftReview } from '@/lib/support-ai';

export function DraftQuality({ review, stale = false }: { review?: DraftReview | null; stale?: boolean }) {
  if (!review) return null;
  const passed = review.status === 'passed' && !stale;
  const label = stale ? 'Draft changed · assessment needs refresh' : passed ? 'Draft checks passed'
    : review.status === 'needs_review' ? 'Review needed' : 'Draft not assessed';
  const tone = passed ? 'var(--color-success)' : 'var(--color-warning)';
  return (
    <section aria-label="Draft quality" className="rounded-lg p-3 text-xs" style={{ border: '1px solid var(--border-primary)', background: 'var(--bg-secondary)' }}>
      <div className="flex items-center justify-between gap-3">
        <strong style={{ color: tone }}>{label}</strong>
        {review.repair_attempted && <span style={{ color: 'var(--text-tertiary)' }}>One revision attempted</span>}
      </div>
      {review.mode === 'shadow' && <p className="mt-1" style={{ color: 'var(--text-tertiary)' }}>Observation only · findings do not change the draft.</p>}
      {!stale && Object.keys(review.scores).length > 0 && (
        <dl className="grid grid-cols-3 gap-3 mt-3">
          {(['coverage', 'clarity', 'brand_tone'] as const).map(key => {
            const score = review.scores[key];
            if (!score) return null;
            return <div key={key}>
              <dt style={{ color: 'var(--text-tertiary)' }}>{key === 'brand_tone' ? 'Brand tone' : key === 'coverage' ? 'Coverage' : 'Clarity'}</dt>
              <dd className="font-semibold mt-1" style={{ color: 'var(--text-primary)' }}>{score.score.toFixed(1)} / 3</dd>
              <dd className="mt-0.5 text-[10px]" style={{ color: 'var(--text-tertiary)' }} title="Certainty describes the evaluator's distribution, not the probability that the reply is correct.">
                Assessment certainty: {score.confidence >= 0.8 ? 'high' : score.confidence >= 0.5 ? 'moderate' : 'low'}
              </dd>
            </div>;
          })}
        </dl>
      )}
      {!stale && review.findings.length > 0 && <ul className="mt-2 list-disc pl-4 space-y-1" style={{ color: 'var(--text-secondary)' }}>
        {review.findings.map(finding => <li key={finding}>{finding}</li>)}
      </ul>}
      {passed && <p className="mt-2" style={{ color: 'var(--text-tertiary)' }}>No material issues detected against the supplied evidence. Approval is still required.</p>}
      <details className="mt-2" style={{ color: 'var(--text-tertiary)' }}>
        <summary className="cursor-pointer">Assessment details</summary>
        <p className="mt-1">{review.model} · {review.version}{review.cached ? ' · saved assessment reused' : ''}</p>
        {review.usage && <p>{review.usage.input_tokens.toLocaleString()} input tokens · {review.usage.estimated_cost_usd === null ? 'Cost unavailable' : `$${review.usage.estimated_cost_usd.toFixed(6)} estimated assessment cost`}</p>}
      </details>
    </section>
  );
}
