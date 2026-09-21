import { supabase } from './supabase';
import type { AutopilotAction, AutopilotPlan, Ticket } from './types';

type LearningSignal =
  | 'human_revision'
  | 'human_edit'
  | 'partial_approval'
  | 'clean_approval'
  | 'batch_approval'
  | 'dismissal'
  | 'execution_failure'
  | 'delayed_outcome';

const TRUST: Record<LearningSignal, number> = {
  human_edit: 0.99,
  human_revision: 0.97,
  partial_approval: 0.93,
  execution_failure: 0.90,
  dismissal: 0.88,
  clean_approval: 0.72,
  batch_approval: 0.58,
  delayed_outcome: 0.84,
};

const STOP_WORDS = new Set([
  'about', 'after', 'before', 'could', 'customer', 'email', 'from', 'have', 'hello',
  'order', 'please', 'support', 'that', 'their', 'there', 'this', 'ticket', 'with',
  'would', 'your',
]);

let schemaWarningLogged = false;

function warnSchemaOnce(message: string): void {
  if (schemaWarningLogged) return;
  schemaWarningLogged = true;
  console.warn(`[autopilot-learning] ${message}. Learning capture is disabled until migration 012 is applied.`);
}

function normalize(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const result = value.trim().toLowerCase().replace(/\s+/g, '_').slice(0, 80);
  return result || undefined;
}

function topics(text: string): string[] {
  const words = text.toLowerCase().match(/[a-z0-9][a-z0-9-]{2,}/g) ?? [];
  return [...new Set(words.filter((word) => !STOP_WORDS.has(word)))].slice(0, 14);
}

function redact(value: string, limit = 2200): string {
  return value
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email]')
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, '[id]')
    .replace(/\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?\b/gi, '[date]')
    .replace(/\b\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}\b/g, '[date]')
    .replace(/[$€£]\s?\d[\d,]*(?:\.\d{1,2})?/g, '[amount]')
    .replace(/\b\d{1,6}\s+[A-Z0-9.' -]{2,45}\s(?:street|st|road|rd|avenue|ave|boulevard|blvd|lane|ln|drive|dr|court|ct|way)\b/gi, '[address]')
    .replace(/\b\+?\d[\d().\s-]{7,}\d\b/g, '[phone-or-number]')
    .replace(/\b(?=[A-Z0-9]{12,}\b)(?=[A-Z0-9]*[A-Z])(?=[A-Z0-9]*\d)[A-Z0-9]+\b/gi, '[tracking-id]')
    .replace(/#\s?\d{4,}/g, '#[order]')
    .replace(/\b\d{8,}\b/g, '[number]')
    .trim()
    .slice(0, limit);
}

function similarity(left: string, right: string): number {
  const tokens = (value: string) => value.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const a = tokens(left);
  const b = tokens(right);
  if (a.length === 0 && b.length === 0) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const token of a) counts.set(token, (counts.get(token) ?? 0) + 1);
  let overlap = 0;
  for (const token of b) {
    const count = counts.get(token) ?? 0;
    if (count > 0) {
      overlap++;
      counts.set(token, count - 1);
    }
  }
  return Math.max(0, Math.min(1, (2 * overlap) / (a.length + b.length)));
}

function editFeatures(original: string, final: string): Record<string, unknown> {
  const paragraphs = (value: string) => value.split(/\n\s*\n/).filter((part) => part.trim()).length;
  const count = (value: string, expression: RegExp) => value.match(expression)?.length ?? 0;
  return {
    length_ratio: Number((final.length / Math.max(1, original.length)).toFixed(3)),
    paragraphs: { delta: paragraphs(final) - paragraphs(original) },
    questions: { delta: count(final, /\?/g) - count(original, /\?/g) },
    exclamations: { delta: count(final, /!/g) - count(original, /!/g) },
  };
}

const REVIEW_METADATA_KEYS = new Set([
  'edited_by_reviewer',
]);

function canonicalLearningValue(value: unknown, key?: string): unknown {
  if (Array.isArray(value)) {
    const items = value.map((item) => canonicalLearningValue(item));
    // These fields are sets from the reviewer's point of view. Reordering them
    // in the UI is not a correction, but adding/removing a target is.
    if (key === 'tags' || key === 'related_ticket_ids' || key === 'related_tickets') {
      return items.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
    }
    return items;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([entryKey]) => !REVIEW_METADATA_KEYS.has(entryKey))
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([entryKey, entryValue]) => [entryKey, canonicalLearningValue(entryValue, entryKey)]),
    );
  }
  return value;
}

function actionParamsChanged(original: AutopilotAction | undefined, final: AutopilotAction): boolean {
  if (!original) return true;
  return JSON.stringify(canonicalLearningValue(original.params))
    !== JSON.stringify(canonicalLearningValue(final.params));
}

function parameterEditFeatures(
  original: AutopilotAction | undefined,
  final: AutopilotAction,
): Record<string, unknown> {
  const keys = (params: Record<string, unknown> | undefined) => new Set(
    Object.keys(params ?? {}).filter((key) => !REVIEW_METADATA_KEYS.has(key)),
  );
  const before = keys(original?.params);
  const after = keys(final.params);
  return {
    added_keys: [...after].filter((key) => !before.has(key)).sort(),
    removed_keys: [...before].filter((key) => !after.has(key)).sort(),
    changed_keys: [...before]
      .filter((key) => after.has(key)
        && JSON.stringify(canonicalLearningValue(original?.params[key], key))
          !== JSON.stringify(canonicalLearningValue(final.params[key], key)))
      .sort(),
  };
}

function scopeFor(ticket: Ticket, plan: AutopilotPlan) {
  const triage = (ticket.metadata?.ai_triage ?? {}) as Record<string, unknown>;
  const tags = Array.isArray(ticket.tags) ? ticket.tags.map(normalize).filter(Boolean) : [];
  return Object.fromEntries(Object.entries({
    intent: normalize(triage.intent),
    category: normalize(ticket.category),
    language: normalize(triage.language),
    action_types: [...new Set(plan.actions.map((action) => action.type))],
    topics: [...new Set([...topics(ticket.subject), ...tags])].slice(0, 14),
  }).filter(([, value]) => value !== undefined && (!Array.isArray(value) || value.length > 0)));
}

function planModelLineage(plan: AutopilotPlan): Record<string, string> {
  const generation = plan.generation;
  return Object.fromEntries(Object.entries({
    model_provider: generation?.provider,
    model_id: generation?.model,
    model_tier: generation?.tier,
    model_prompt_version: plan.prompt_version,
    calibration_key: generation?.calibration_key,
  }).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && Boolean(entry[1].trim())));
}

function manualDraftModelLineage(model: unknown, promptVersion: unknown): Record<string, string> {
  if (typeof model !== 'string' || !model.trim()) return {};
  const prompt = typeof promptVersion === 'string' && promptVersion.trim() ? promptVersion : 'unknown-prompt';
  const provider = model.startsWith('claude')
    ? 'anthropic'
    : model.startsWith('gemini')
      ? 'google'
      : model.includes('deepseek')
        ? 'deepseek'
        : 'unknown';
  return {
    model_provider: provider,
    model_id: model,
    model_prompt_version: prompt,
    calibration_key: `${provider}:${model}:${prompt}`,
  };
}

export function ensurePlanIdentity(plan: AutopilotPlan): string {
  if (!plan.id) plan.id = crypto.randomUUID();
  if (plan.revision === undefined) plan.revision = plan.revision_count ?? 0;
  return plan.id;
}

export function isReviewerGuidedAutopilotRevision(plan: AutopilotPlan): boolean {
  return plan.trigger === 'revision'
    && Number(plan.revision_count ?? 0) > 0
    && typeof plan.operator_instruction === 'string'
    && Boolean(plan.operator_instruction.trim());
}

export interface AutopilotReviewEventRecord {
  id: string;
  brand_id: string;
  ticket_id: string;
  plan_id: string;
  plan_revision: number;
  event_type: 'review';
  signal_type: LearningSignal;
  actor_type: 'admin' | 'agent';
  actor_id: string | null;
  actor_name: string | null;
  scope: Record<string, unknown>;
  trust_score: number;
  outcome_score: number;
  payload: Record<string, unknown>;
  idempotency_key: string;
  occurred_at: string;
}

export function buildAutopilotReviewEvent(input: {
  ticket: Ticket;
  originalPlan: AutopilotPlan;
  finalPlan: AutopilotPlan;
  decision: 'approve' | 'dismiss';
  decisionMode?: 'individual_review' | 'batch_threshold';
  actor: { id?: string | null; name?: string | null; role?: string | null };
}): AutopilotReviewEventRecord {
  const planId = ensurePlanIdentity(input.finalPlan);
  // Automatic customer-reply/staleness replans also have a parent plan, but
  // their model-generated delta is not a human correction. Defensively compare
  // different plan IDs only for an actual operator-guided revision; ordinary
  // reviewer edits keep the same plan ID and still compare against the
  // pre-decision snapshot supplied by the route.
  const comparisonPlan = input.originalPlan.id !== input.finalPlan.id
      && !isReviewerGuidedAutopilotRevision(input.finalPlan)
    ? input.finalPlan
    : input.originalPlan;
  const originalById = new Map(comparisonPlan.actions.map((action) => [action.id, action]));
  const matchKey = (action: AutopilotAction) => {
    const orderId = typeof action.params.order_id === 'string' ? action.params.order_id : '';
    return orderId ? `${action.type}:${orderId}` : action.type;
  };
  const originalBySemanticKey = new Map(comparisonPlan.actions.map((action) => [matchKey(action), action]));
  const actions = input.finalPlan.actions.map((action) => {
    const original = originalById.get(action.id) ?? originalBySemanticKey.get(matchKey(action));
    const originalText = action.type === 'send_reply' ? String(original?.params.reply_text ?? '') : '';
    const finalText = action.type === 'send_reply' ? String(action.params.reply_text ?? '') : '';
    const paramsChanged = actionParamsChanged(original, action);
    const edited = Boolean(action.params.edited_by_reviewer) || paramsChanged;
    const rejected = input.decision === 'dismiss' || action.status === 'skipped';
    const verdict = rejected ? 'rejected' : edited ? 'edited' : 'approved';
    const modelOutcome = rejected
      ? 0
      : edited
        ? action.type === 'send_reply'
          ? similarity(originalText, finalText)
          : 0
        : 1;
    return {
      action_id: action.id,
      action_type: action.type,
      verdict,
      model_confidence: original?.model_confidence ?? original?.confidence ?? action.model_confidence ?? action.confidence,
      model_outcome: modelOutcome,
      execution_status: action.status,
      ...(action.result ? { execution_result: redact(String(action.result), 300) } : {}),
      ...(originalText ? { original_text: redact(originalText) } : {}),
      ...(finalText ? { final_text: redact(finalText) } : {}),
      ...(edited ? {
        edit_similarity: modelOutcome,
        edit_features: action.type === 'send_reply'
          ? editFeatures(originalText, finalText)
          : parameterEditFeatures(original, action),
      } : {}),
    };
  });

  const hasEdit = actions.some((action) => action.verdict === 'edited');
  const hasSkip = actions.some((action) => action.verdict === 'rejected') && input.decision === 'approve';
  const hasFailure = actions.some((action) => action.execution_status === 'failed');
  const revised = isReviewerGuidedAutopilotRevision(input.finalPlan);
  const signal: LearningSignal = input.decision === 'dismiss'
    ? 'dismissal'
    : hasEdit
      ? 'human_edit'
      : revised
        ? 'human_revision'
        : hasSkip
          ? 'partial_approval'
          : hasFailure
            ? 'execution_failure'
            : input.decisionMode === 'batch_threshold'
              ? 'batch_approval'
              : 'clean_approval';
  const planOutcome = actions.length
    ? actions.reduce((sum, action) => sum + action.model_outcome, 0) / actions.length
    : 0;
  return {
    id: crypto.randomUUID(),
    brand_id: input.ticket.brand_id,
    ticket_id: input.ticket.id,
    plan_id: planId,
    plan_revision: input.finalPlan.revision ?? input.finalPlan.revision_count ?? 0,
    event_type: 'review',
    signal_type: signal,
    actor_type: input.actor.role === 'admin' ? 'admin' : 'agent',
    actor_id: input.actor.id ?? null,
    actor_name: input.actor.name ?? null,
    scope: scopeFor(input.ticket, input.finalPlan),
    trust_score: TRUST[signal],
    outcome_score: planOutcome,
    payload: {
      source: 'autopilot_review',
      decision: input.decision,
      decision_mode: input.decisionMode ?? 'individual_review',
      subject: redact(input.ticket.subject, 240),
      operator_instruction: input.finalPlan.operator_instruction
        ? redact(input.finalPlan.operator_instruction, 800)
        : undefined,
      model_overall_confidence: comparisonPlan.analysis.model_confidence
        ?? comparisonPlan.analysis.overall_confidence,
      plan_outcome_score: planOutcome,
      planner_version: comparisonPlan.planner_version,
      prompt_version: comparisonPlan.prompt_version,
      ...planModelLineage(comparisonPlan),
      actions,
    },
    idempotency_key: `review:${planId}:${input.decision}`,
    occurred_at: new Date().toISOString(),
  };
}

export interface ManualDraftLearningInput {
  brandId: string;
  ticketId: string;
  generationId: string;
  messageId: string;
  finalText: string;
  expectedContextVersion: number;
  actor: { id?: string | null; name?: string | null; role?: string | null };
}

export async function buildManualDraftReviewEvent(
  input: ManualDraftLearningInput,
): Promise<Record<string, unknown> | null> {
  const { data: generation, error: generationError } = await supabase
    .from('autopilot_draft_generations')
    .select('id, model, prompt_version, original_text, scope, memory_ids, episode_ids, raw_confidence, evidence_coverage, context_version, created_at, used_at, final_message_id')
    .eq('id', input.generationId)
    .eq('brand_id', input.brandId)
    .eq('ticket_id', input.ticketId)
    .single();
  if (generationError || !generation
      || (generation.used_at && generation.final_message_id !== input.messageId)) return null;
  const replayingSameMessage = Boolean(generation.used_at && generation.final_message_id === input.messageId);
  if (!replayingSameMessage && (
    Number(generation.context_version) !== input.expectedContextVersion
    || new Date(generation.created_at).getTime() < Date.now() - 4 * 60 * 60 * 1000
  )) return null;

  const editSimilarity = similarity(generation.original_text, input.finalText);
  const edited = editSimilarity < 0.995;
  const signal: LearningSignal = edited ? 'human_edit' : 'clean_approval';
  return {
    id: crypto.randomUUID(),
    brand_id: input.brandId,
    ticket_id: input.ticketId,
    plan_id: null,
    plan_revision: 0,
    event_type: 'manual_draft',
    signal_type: signal,
    actor_type: input.actor.role === 'admin' ? 'admin' : 'agent',
    actor_id: input.actor.id ?? null,
    actor_name: input.actor.name ?? null,
    scope: generation.scope ?? {},
    trust_score: TRUST[signal],
    outcome_score: edited ? editSimilarity : 1,
    payload: {
      source: 'ticket_composer_ai_draft',
      generation_id: generation.id,
      model: generation.model,
      prompt_version: generation.prompt_version,
      ...manualDraftModelLineage(generation.model, generation.prompt_version),
      memory_ids: generation.memory_ids ?? [],
      episode_ids: generation.episode_ids ?? [],
      actions: [{
        action_id: input.messageId,
        action_type: 'send_reply',
        verdict: edited ? 'edited' : 'approved',
        model_confidence: Number.isFinite(Number(generation.raw_confidence))
          ? Number(generation.raw_confidence)
          : undefined,
        model_outcome: edited ? editSimilarity : 1,
        evidence_coverage: Number.isFinite(Number(generation.evidence_coverage))
          ? Number(generation.evidence_coverage)
          : undefined,
        execution_status: 'approved',
        original_text: redact(generation.original_text),
        final_text: redact(input.finalText),
        ...(edited ? { edit_similarity: editSimilarity } : {}),
        ...(edited ? { edit_features: editFeatures(generation.original_text, input.finalText) } : {}),
      }],
    },
    idempotency_key: `manual-draft:${generation.id}:${input.messageId}`,
    occurred_at: new Date().toISOString(),
  };
}

export async function recordManualDraftExecutionOutcome(input: {
  brandId: string;
  ticketId: string;
  generationId: string;
  messageId: string;
  delivered: boolean;
  error?: string | null;
  actor: { id?: string | null; name?: string | null; role?: string | null };
}): Promise<boolean> {
  const signal: LearningSignal = input.delivered ? 'delayed_outcome' : 'execution_failure';
  const { data: generation } = await supabase
    .from('autopilot_draft_generations')
    .select('raw_confidence, scope, model, prompt_version')
    .eq('id', input.generationId)
    .eq('brand_id', input.brandId)
    .eq('ticket_id', input.ticketId)
    .maybeSingle();
  const modelConfidence = Number(generation?.raw_confidence);
  const { error } = await supabase.from('autopilot_learning_events').upsert({
    id: crypto.randomUUID(),
    brand_id: input.brandId,
    ticket_id: input.ticketId,
    plan_id: null,
    plan_revision: 0,
    event_type: 'execution',
    signal_type: signal,
    actor_type: input.actor.role === 'admin' ? 'admin' : 'agent',
    actor_id: input.actor.id ?? null,
    actor_name: input.actor.name ?? null,
    scope: { ...((generation?.scope as Record<string, unknown> | null) ?? {}), action_types: ['send_reply'] },
    trust_score: TRUST[signal],
    outcome_score: input.delivered ? 1 : 0,
    payload: {
      source: 'ticket_composer_delivery',
      execution_only: true,
      calibration_channel: 'technical_execution',
      generation_id: input.generationId,
      ...manualDraftModelLineage(generation?.model, generation?.prompt_version),
      actions: [{
        action_id: input.messageId,
        action_type: 'send_reply',
        execution_status: input.delivered ? 'executed' : 'failed',
        ...(Number.isFinite(modelConfidence) ? { model_confidence: modelConfidence } : {}),
        ...(Number.isFinite(modelConfidence) ? { model_outcome: input.delivered ? 1 : 0 } : {}),
        execution_error: input.error ? redact(input.error, 300) : undefined,
      }],
    },
    idempotency_key: `manual-draft-execution:${input.generationId}:${input.messageId}`,
    occurred_at: new Date().toISOString(),
  }, { onConflict: 'brand_id,idempotency_key', ignoreDuplicates: true });
  if (error) {
    warnSchemaOnce(error.message);
    return false;
  }
  return true;
}

export interface AutopilotLearningStats {
  available: boolean;
  reviewed_runs: number;
  active_memories: number;
  candidate_memories: number;
  average_memory_confidence: number;
  human_revisions: number;
  last_reviewed_at: string | null;
}

export interface ReviewedLearningContext {
  prompt: string;
  memory_ids: string[];
  episode_ids: string[];
}

interface ReviewedLearningEpisode {
  signal_type: string;
  payload?: Record<string, unknown> | null;
}

/**
 * Render first, then limit. Non-renderable audit/calibration events (including
 * threshold batch approvals) must not crowd genuine human corrections out of
 * the small precedent window.
 */
export function selectRenderableReviewedLearningEpisodes<T extends ReviewedLearningEpisode>(
  events: T[],
  limit = 5,
): Array<{ event: T; line: string }> {
  return events.map((event) => {
    const payload = (event.payload ?? {}) as Record<string, unknown>;
    const actions = Array.isArray(payload.actions) ? payload.actions as Array<Record<string, unknown>> : [];
    if (event.signal_type === 'dismissal') return { event, line: '' };
    // Never put another customer's draft, reviewer free-text, order facts, or
    // promises directly into a later prompt. The slow learner turns those
    // private episodes into scoped, PII-free memories. The immediate path only
    // contributes aggregate review signals and action-shape precedent.
    const edited = actions
      .filter((action) => action.verdict === 'edited')
      .map((action) => String(action.action_type ?? 'action'));
    if (edited.length) {
      const meanSimilarity = actions
        .filter((action) => action.verdict === 'edited' && Number.isFinite(Number(action.edit_similarity)))
        .reduce((sum, action, _index, matches) => sum + Number(action.edit_similarity) / matches.length, 0);
      const firstFeatures = actions.find((action) => action.verdict === 'edited')?.edit_features as Record<string, unknown> | undefined;
      const ratio = Number(firstFeatures?.length_ratio);
      const lengthGuidance = Number.isFinite(ratio)
        ? ratio < 0.85
          ? ' and made it more concise'
          : ratio > 1.15
            ? ' and added needed detail'
            : ''
        : '';
      return { event, line: `- Human substantially revised ${edited.join(', ')}${lengthGuidance}${meanSimilarity ? ` (mean similarity ${Math.round(meanSimilarity * 100)}%)` : ''}; verify facts and follow scoped learned guidance before drafting.` };
    }
    if (event.signal_type === 'human_revision') {
      const actionTypes = actions.map((action) => String(action.action_type ?? '')).filter(Boolean);
      return { event, line: `- A reviewer-guided plan revision was approved${actionTypes.length ? ` for ${actionTypes.join(', ')}` : ''}; use extra fact verification in this scope.` };
    }
    const rejected = actions
      .filter((action) => action.verdict === 'rejected')
      .map((action) => String(action.action_type ?? 'action'));
    if (rejected.length) return { event, line: `- Human rejected or skipped: ${rejected.join(', ')}.` };
    const approved = actions
      .filter((action) => action.verdict === 'approved')
      .map((action) => String(action.action_type ?? ''))
      .filter(Boolean);
    return {
      event,
      line: event.signal_type === 'clean_approval' && approved.length
        ? `- Clean human approval confirmed these action types in this scope: ${approved.join(', ')}.`
        : '',
    };
  }).filter((episode) => episode.line).slice(0, Math.max(0, limit));
}

export async function loadReviewedLearningContext(input: {
  brandId: string;
  ticketId?: string;
  query: string;
  intent?: string;
  category?: string | null;
  language?: string;
  actionTypes?: string[];
  productHandles?: string[];
}): Promise<ReviewedLearningContext> {
  const now = new Date();
  const queryTopics = new Set(topics(input.query));
  const [memoryResult, eventResult] = await Promise.all([
    supabase
      .from('autopilot_learning_memories')
      .select('id, kind, statement, scope, confidence_score, trust_score, time_sensitive, valid_until, last_supported_at, updated_at')
      .eq('brand_id', input.brandId)
      .eq('status', 'active')
      .order('confidence_score', { ascending: false })
      .limit(60),
    supabase
      .from('autopilot_learning_events')
      .select('id, ticket_id, event_type, signal_type, scope, payload, trust_score, occurred_at')
      .eq('brand_id', input.brandId)
      .in('event_type', ['review', 'manual_draft', 'delayed_outcome'])
      // Audit-only threshold rows are intentionally non-renderable. Exclude
      // them before the DB limit so a large batch cannot evict older, genuinely
      // human-reviewed precedents from the retrieval window.
      .neq('signal_type', 'batch_approval')
      .lt('occurred_at', now.toISOString())
      .gte('occurred_at', new Date(now.getTime() - 120 * 86_400_000).toISOString())
      .order('occurred_at', { ascending: false })
      // Rank locally by ticket scope; a very active unrelated category must not
      // crowd all relevant precedents out of the retrieval window.
      .limit(400),
  ]);
  if (memoryResult.error || eventResult.error) return { prompt: '', memory_ids: [], episode_ids: [] };

  const scopeScore = (raw: unknown): number => {
    const scope = (raw ?? {}) as Record<string, unknown>;
    let score = 1;
    if (scope.intent) score *= normalize(scope.intent) === normalize(input.intent) ? 1 : input.intent ? 0.15 : 0.55;
    if (scope.category) score *= normalize(scope.category) === normalize(input.category) ? 1 : input.category ? 0.4 : 0.7;
    if (scope.language) score *= normalize(scope.language) === normalize(input.language) ? 1 : input.language ? 0.35 : 0.75;
    const scopedActions = Array.isArray(scope.action_types) ? scope.action_types.map(normalize) : [];
    if (scopedActions.length) {
      const current = new Set((input.actionTypes ?? []).map(normalize));
      const overlap = scopedActions.filter((action) => current.has(action)).length / scopedActions.length;
      score *= current.size === 0 ? 0.55 : overlap > 0 ? 0.65 + 0.35 * overlap : 0.12;
    }
    const scopedProducts = Array.isArray(scope.product_handles) ? scope.product_handles.map(normalize) : [];
    if (scopedProducts.length) {
      const current = new Set((input.productHandles ?? []).map(normalize));
      const overlap = scopedProducts.filter((product) => current.has(product)).length / scopedProducts.length;
      score *= current.size === 0 ? 0.55 : overlap > 0 ? 0.65 + 0.35 * overlap : 0.08;
    }
    const scopedTopics = Array.isArray(scope.topics) ? scope.topics.map(String) : [];
    if (scopedTopics.length) {
      const overlap = scopedTopics.filter((topic) => queryTopics.has(topic)).length / scopedTopics.length;
      score *= 0.3 + 0.7 * overlap;
    }
    return score;
  };
  const freshness = (date: string, halfLife: number) => {
    const ageDays = Math.max(0, (now.getTime() - new Date(date).getTime()) / 86_400_000);
    return Math.pow(0.5, ageDays / halfLife);
  };

  const memories = (memoryResult.data ?? [])
    .filter((memory) => !memory.valid_until || new Date(memory.valid_until).getTime() > now.getTime())
    .map((memory) => ({
      ...memory,
      score: Number(memory.confidence_score) * Number(memory.trust_score)
        * freshness(memory.last_supported_at ?? memory.updated_at, memory.time_sensitive ? 30 : 240)
        * scopeScore(memory.scope),
    }))
    .filter((memory) => memory.score >= 0.08)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);

  const events = (eventResult.data ?? [])
    .filter((event) => !input.ticketId || event.ticket_id !== input.ticketId)
    .filter((event) => event.event_type !== 'execution')
    .map((event) => ({
      ...event,
      score: Number(event.trust_score) * freshness(event.occurred_at, 75) * scopeScore(event.scope),
    }))
    .filter((event) => event.score >= 0.08)
    .sort((a, b) => b.score - a.score);

  const memoryLines = memories.map((memory) =>
    `- [${memory.kind}; knowledge ${Math.round(Number(memory.confidence_score) * 100)}%; trust ${Math.round(Number(memory.trust_score) * 100)}%] ${redact(memory.statement, 600)}`,
  );
  const promptEpisodes = selectRenderableReviewedLearningEpisodes(events);
  const episodeLines = promptEpisodes.map((episode) => episode.line);

  const prompt = [
    memoryLines.length ? `SCOPED LEARNED GUIDANCE (subordinate to locked policy and live data):\n${memoryLines.join('\n')}` : '',
    episodeLines.length ? `RECENT REVIEWED PRECEDENTS (copy method/tone only; never transfer customer facts, names, dates, amounts, or promises):\n${episodeLines.join('\n')}` : '',
  ].filter(Boolean).join('\n\n');

  return {
    prompt,
    memory_ids: memories.map((memory) => memory.id),
    episode_ids: promptEpisodes.map(({ event }) => event.id),
  };
}

export async function getAutopilotLearningStats(brandId: string): Promise<AutopilotLearningStats> {
  const [eventResult, memoryResult] = await Promise.all([
    supabase
      .from('autopilot_learning_events')
      .select('event_type, signal_type, occurred_at')
      .eq('brand_id', brandId)
      .order('occurred_at', { ascending: false })
      .limit(1000),
    supabase
      .from('autopilot_learning_memories')
      .select('status, confidence_score, valid_until')
      .eq('brand_id', brandId)
      .in('status', ['active', 'candidate', 'disputed'])
      .limit(1000),
  ]);
  if (eventResult.error || memoryResult.error) {
    return {
      available: false,
      reviewed_runs: 0,
      active_memories: 0,
      candidate_memories: 0,
      average_memory_confidence: 0,
      human_revisions: 0,
      last_reviewed_at: null,
    };
  }

  const events = eventResult.data ?? [];
  const reviewedEvents = events.filter((event) => event.event_type === 'review' || event.event_type === 'manual_draft');
  const memories = memoryResult.data ?? [];
  const active = memories.filter((memory) =>
    memory.status === 'active' && (!memory.valid_until || new Date(memory.valid_until).getTime() > Date.now()),
  );
  const average = active.length
    ? active.reduce((sum, memory) => sum + Number(memory.confidence_score), 0) / active.length
    : 0;
  return {
    available: true,
    reviewed_runs: reviewedEvents.length,
    active_memories: active.length,
    candidate_memories: memories.filter((memory) => memory.status === 'candidate').length,
    average_memory_confidence: average,
    human_revisions: reviewedEvents.filter((event) => ['human_revision', 'human_edit'].includes(event.signal_type)).length,
    last_reviewed_at: reviewedEvents[0]?.occurred_at ?? null,
  };
}
