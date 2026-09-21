export interface CustomerHistoryEvidenceSnapshot {
  projection_version?: string;
  hash?: string;
  valid_until?: string;
  ticket_count?: number;
  ticket_message_count?: number;
  conversation_count?: number;
  chat_message_count?: number;
}

export interface CustomerHistoryCurrentSnapshot {
  projection_version?: string;
  hash?: string;
  ticket_count?: number;
  ticket_message_count?: number;
  conversation_count?: number;
  chat_message_count?: number;
}

export interface RefreshablePlanIdentity {
  id?: string;
  revision?: number;
  revision_count?: number;
  context_fingerprint?: string;
  context_version?: number;
}

export interface PlanRefreshExpectation {
  planId?: string;
  revision?: number;
  contextFingerprint?: string;
  contextVersion?: number;
}

/**
 * Compare the exact customer-history projection used by the planner with a
 * freshly loaded projection. The full same-customer history is intentional:
 * a replacement plan must see replies and commitments made in sibling threads.
 */
export function customerHistoryEvidenceMatches(
  evidence: CustomerHistoryEvidenceSnapshot | null | undefined,
  current: CustomerHistoryCurrentSnapshot | null | undefined,
  nowMs = Date.now(),
): boolean {
  if (!evidence || !current) return false;
  const validUntil = Date.parse(evidence.valid_until ?? '');
  return (
    Number.isFinite(validUntil)
    && validUntil > nowMs
    && current.projection_version === evidence.projection_version
    && current.hash === evidence.hash
    && Number(current.ticket_count ?? -1) === Number(evidence.ticket_count ?? -2)
    && Number(current.ticket_message_count ?? -1) === Number(evidence.ticket_message_count ?? -2)
    && Number(current.conversation_count ?? -1) === Number(evidence.conversation_count ?? -2)
    && Number(current.chat_message_count ?? -1) === Number(evidence.chat_message_count ?? -2)
  );
}

/**
 * A stale browser request must never regenerate over a plan that another
 * worker already replaced. Any supplied execution token participates in the
 * comparison; omitted legacy fields do not prevent a safe v2 upgrade.
 */
export function planMatchesRefreshExpectation(
  plan: RefreshablePlanIdentity,
  expected: PlanRefreshExpectation,
): boolean {
  if (expected.planId !== undefined && plan.id !== expected.planId) return false;
  const revision = plan.revision ?? plan.revision_count ?? 0;
  if (expected.revision !== undefined && revision !== expected.revision) return false;
  if (
    expected.contextFingerprint !== undefined
    && plan.context_fingerprint !== expected.contextFingerprint
  ) return false;
  if (
    expected.contextVersion !== undefined
    && plan.context_version !== expected.contextVersion
  ) return false;
  return true;
}
