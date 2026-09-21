import type { AutopilotBatchCandidate } from './autopilot-batch-policy';

export interface AutopilotDecisionResult {
  ok: boolean;
  status: number;
  code: string | null;
  error: string | null;
  data: Record<string, unknown>;
}

export interface AutopilotRefreshResult {
  ok: boolean;
  status: number;
  error: string | null;
  plan: Record<string, unknown> | null;
  refreshed: boolean;
  refreshReason: string | null;
}

const REGENERATE_CONFLICT_CODES = new Set([
  'CONTEXT_CHANGED',
  'EVIDENCE_STALE',
  'LEGACY_PLAN',
]);

export function autopilotConflictNeedsRegeneration(code: string | null | undefined): boolean {
  return Boolean(code && REGENERATE_CONFLICT_CODES.has(code));
}

export function consolidatedTicketIdsFromPlan(plan: unknown): string[] {
  if (!plan || typeof plan !== 'object') return [];
  const actions = Array.isArray((plan as Record<string, unknown>).actions)
    ? (plan as Record<string, unknown>).actions as unknown[]
    : [];
  const ticketIds = new Set<string>();
  for (const value of actions) {
    if (!value || typeof value !== 'object') continue;
    const action = value as Record<string, unknown>;
    if (action.type !== 'consolidate_related_tickets') continue;
    const params = action.params && typeof action.params === 'object'
      ? action.params as Record<string, unknown>
      : {};
    if (Array.isArray(params.related_ticket_ids)) {
      for (const ticketId of params.related_ticket_ids) {
        if (typeof ticketId === 'string' && ticketId) ticketIds.add(ticketId);
      }
    }
    if (Array.isArray(params.related_tickets)) {
      for (const related of params.related_tickets) {
        if (!related || typeof related !== 'object') continue;
        const ticketId = (related as Record<string, unknown>).ticket_id;
        if (typeof ticketId === 'string' && ticketId) ticketIds.add(ticketId);
      }
    }
  }
  return [...ticketIds];
}

export async function requestAutopilotPlanRefresh(input: {
  ticketId: string;
  planId?: string;
  planRevision?: number;
  contextFingerprint?: string;
  contextVersion?: number;
  reason: string;
  signal?: AbortSignal;
}): Promise<AutopilotRefreshResult> {
  try {
    const response = await fetch(`/api/autopilot/${input.ticketId}/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: input.signal,
      body: JSON.stringify({
        plan_id: input.planId,
        plan_revision: input.planRevision,
        context_fingerprint: input.contextFingerprint,
        context_version: input.contextVersion,
        reason: input.reason,
      }),
    });
    const data = await response.json().catch(() => ({})) as Record<string, unknown>;
    return {
      ok: response.ok,
      status: response.status,
      error: typeof data.error === 'string' ? data.error : response.ok ? null : 'Plan refresh failed.',
      plan: data.plan && typeof data.plan === 'object'
        ? data.plan as Record<string, unknown>
        : null,
      refreshed: data.refreshed === true,
      refreshReason: typeof data.refresh_reason === 'string' ? data.refresh_reason : null,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error instanceof Error ? error.message : 'Plan refresh failed.',
      plan: null,
      refreshed: false,
      refreshReason: 'network_error',
    };
  }
}

export function batchDecisionCompletion(result: AutopilotDecisionResult): {
  completed: boolean;
  message: string;
} {
  if (!result.ok) {
    return { completed: false, message: result.error || 'Execution failed.' };
  }
  const plan = result.data.plan && typeof result.data.plan === 'object'
    ? result.data.plan as Record<string, unknown>
    : null;
  const planStatus = typeof plan?.status === 'string' ? plan.status : null;
  const actions = Array.isArray(plan?.actions)
    ? plan.actions.filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === 'object')
    : [];
  const failed = actions.filter((action) => action.status === 'failed');
  const unfinished = actions.filter((action) => (
    action.status !== 'executed' && action.status !== 'skipped'
  ));
  if (planStatus !== 'executed' || actions.length === 0 || failed.length > 0 || unfinished.length > 0) {
    const detail = failed
      .map((action) => typeof action.result === 'string' ? action.result : null)
      .find(Boolean);
    return {
      completed: false,
      message: detail
        || `The durable run ended ${planStatus || 'without a terminal success state'}; review it before continuing.`,
    };
  }
  return {
    completed: true,
    message: result.data.replayed === true
      ? 'Already completed; the exact durable result was replayed.'
      : 'Approved, executed, and captured for learning.',
  };
}

export async function submitAutopilotBatchCandidate(input: {
  candidate: AutopilotBatchCandidate;
  idempotencyKey: string;
  signal?: AbortSignal;
}): Promise<AutopilotDecisionResult> {
  try {
    const response = await fetch(`/api/autopilot/${input.candidate.ticketId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: input.signal,
      body: JSON.stringify({
        decision: 'approve',
        decision_mode: 'batch_threshold',
        plan_id: input.candidate.planId,
        plan_revision: input.candidate.planRevision,
        context_fingerprint: input.candidate.contextFingerprint,
        context_version: input.candidate.contextVersion,
        plan_fingerprint: input.candidate.planFingerprint,
        idempotency_key: input.idempotencyKey,
        actions: input.candidate.actionVerdicts,
      }),
    });
    const data = await response.json().catch(() => ({})) as Record<string, unknown>;
    return {
      ok: response.ok,
      status: response.status,
      code: typeof data.code === 'string' ? data.code : null,
      error: typeof data.error === 'string' ? data.error : response.ok ? null : 'The run failed.',
      data,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      code: 'NETWORK_ERROR',
      error: error instanceof Error ? error.message : 'The request could not be completed.',
      data: {},
    };
  }
}
