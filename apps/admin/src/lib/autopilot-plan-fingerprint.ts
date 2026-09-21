import { createHash } from 'node:crypto';
import type { AutopilotPlan } from './types';

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
}

/**
 * Freeze all execution-relevant plan content, not only its revision token.
 * The normal ID/revision/context fences remain authoritative; this additional
 * digest lets a batch prove that the exact previewed action parameters are the
 * ones being submitted later.
 */
export function autopilotPlanFingerprint(plan: AutopilotPlan): string {
  const projection = canonicalize({
    version: plan.version,
    id: plan.id,
    revision: plan.revision ?? plan.revision_count ?? 0,
    status: plan.status,
    context_fingerprint: plan.context_fingerprint ?? null,
    context_version: plan.context_version ?? null,
    proposed_at: plan.proposed_at,
    generation: plan.generation ?? null,
    analysis: plan.analysis,
    evidence: plan.evidence ?? null,
    actions: plan.actions,
  });
  return createHash('sha256').update(JSON.stringify(projection)).digest('hex');
}
