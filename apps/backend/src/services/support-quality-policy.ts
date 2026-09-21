export const SUPPORT_QUALITY_CHECKS = ['factual_grounding', 'latest_request_answered', 'policy_compliance', 'customer_authorization', 'no_invented_eta'] as const;

/** Treat the verifier's structured output as untrusted until every required
 * check is present exactly once. Conflicting/extra checks never pass. */
export function validSupportQuality(value: unknown): value is { confidence: number; summary: string; checks: { name: string; passed: true; detail: string }[] } {
  if (!value || typeof value !== 'object') return false;
  const result = value as Record<string, unknown>;
  if (typeof result.confidence !== 'number' || !Number.isFinite(result.confidence) || result.confidence < 0 || result.confidence > 1
    || typeof result.summary !== 'string' || !result.summary.trim() || !Array.isArray(result.checks) || result.checks.length !== SUPPORT_QUALITY_CHECKS.length) return false;
  const seen = new Set<string>();
  for (const item of result.checks) {
    if (!item || typeof item !== 'object') return false;
    const check = item as Record<string, unknown>;
    if (typeof check.name !== 'string' || !SUPPORT_QUALITY_CHECKS.includes(check.name as typeof SUPPORT_QUALITY_CHECKS[number])
      || seen.has(check.name) || check.passed !== true || typeof check.detail !== 'string' || !check.detail.trim()) return false;
    seen.add(check.name);
  }
  return true;
}
