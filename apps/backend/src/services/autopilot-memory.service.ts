import { randomUUID } from 'node:crypto';
import { supabase } from '../config/supabase.js';
import type { Ticket } from '../types/index.js';
import {
  buildLearningScope,
  calibrateConfidence,
  contributesToAnswerQualityCalibration,
  freshnessWeight,
  memoryActivationScore,
  qualityCalibrationEventsForKey,
  redactLearningText,
  scopeMatch,
  textSimilarity,
  trustForSignal,
  type CalibrationResult,
  type CalibrationSample,
  type LearningScope,
} from './autopilot-learning-policy.js';
import type { AutopilotAction, AutopilotPlan } from './autopilot.service.js';

export interface AppliedLearningReference {
  id: string;
  kind: 'memory' | 'episode';
  score: number;
  confidence?: number;
  trust: number;
}

export interface AutopilotLearningContext {
  scope: LearningScope;
  promptBlock: string;
  references: AppliedLearningReference[];
  calibrationSamples: CalibrationSample[];
  /** Provider/DB success history, kept separate from answer-quality review. */
  operationalCalibrationSamples: CalibrationSample[];
  reviewedRunCount: number;
  memoryCount: number;
}

export type CsatOutcomeLineage =
  | {
      kind: 'autopilot_plan';
      plan_id: string;
      plan_revision: number;
      execution_attempt_id: string;
      resolution_action_id: string;
      reply_action_id?: string;
      model_overall_confidence?: number;
      resolution_model_confidence?: number;
      reply_model_confidence?: number;
    }
  | {
      kind: 'manual_draft';
      generation_id: string;
      message_id: string;
      model_confidence?: number;
    }
  | { kind: 'manual_message'; message_id: string }
  | { kind: 'manual_resolution' };

interface MemoryRow {
  id: string;
  kind: string;
  statement: string;
  scope: LearningScope | null;
  status: string;
  confidence_score: number;
  trust_score: number;
  time_sensitive: boolean;
  valid_until: string | null;
  last_supported_at: string | null;
  updated_at: string;
}

interface EventRow {
  id: string;
  event_type: string;
  signal_type: string;
  scope: LearningScope | null;
  payload: Record<string, unknown> | null;
  trust_score: number;
  outcome_score: number | null;
  occurred_at: string;
}

interface RevisionActor {
  id?: string;
  name?: string;
}

interface AutopilotGenerationProvenance {
  provider?: string;
  model?: string;
  tier?: string;
  calibration_key?: string;
}

type PlanWithGeneration = AutopilotPlan & {
  generation?: AutopilotGenerationProvenance;
  analysis: AutopilotPlan['analysis'] & {
    generation?: AutopilotGenerationProvenance;
  };
};

const MODEL_LINEAGE_PAYLOAD_KEYS = [
  'model_provider',
  'model_id',
  'model_tier',
  'model_prompt_version',
  'calibration_key',
] as const;

/**
 * Flat event fields make the lineage queryable in JSONB without coupling the
 * learning schema to one provider response shape.
 */
export function learningModelLineageForPlan(plan: AutopilotPlan): Record<string, string> {
  const versionedPlan = plan as PlanWithGeneration;
  const generation = versionedPlan.generation ?? versionedPlan.analysis.generation;
  return Object.fromEntries(Object.entries({
    model_provider: generation?.provider,
    model_id: generation?.model,
    model_tier: generation?.tier,
    model_prompt_version: plan.prompt_version,
    calibration_key: generation?.calibration_key,
  }).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && Boolean(entry[1].trim())));
}

function learningModelLineageFromPayload(payload: Record<string, unknown> | null | undefined): Record<string, string> {
  if (!payload) return {};
  return Object.fromEntries(MODEL_LINEAGE_PAYLOAD_KEYS
    .map((key) => [key, payload[key]] as const)
    .filter((entry): entry is readonly [typeof MODEL_LINEAGE_PAYLOAD_KEYS[number], string] => (
      typeof entry[1] === 'string' && Boolean(entry[1].trim())
    )));
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

const APPROVED_REVISION_STATUSES = new Set<AutopilotPlan['status']>([
  'approved',
  'executing',
  'executed',
  'partially_executed',
]);

let schemaWarningLogged = false;

function warnSchemaOnce(message: string): void {
  if (schemaWarningLogged) return;
  schemaWarningLogged = true;
  console.warn(`[autopilot-memory] ${message}. Apply docs/migrations/012-autopilot-learning-loop.sql to enable learning.`);
}

export function scopeForTicket(ticket: Ticket, actionTypes?: string[]): LearningScope {
  const triage = (ticket.metadata?.ai_triage ?? {}) as Record<string, unknown>;
  return buildLearningScope({
    subject: ticket.subject,
    intent: triage.intent,
    category: ticket.category,
    language: triage.language,
    tags: ticket.tags,
    actionTypes,
  });
}

function eventRelevance(event: EventRow, currentScope: LearningScope, now: Date): number {
  const scoped = scopeMatch(currentScope, event.scope ?? {});
  const halfLife = event.signal_type === 'human_revision' || event.signal_type === 'human_edit' ? 90 : 60;
  return Math.max(0, Number(event.trust_score) || 0) * scoped * freshnessWeight(event.occurred_at, halfLife, now);
}

function formatMemory(memory: MemoryRow): string {
  const confidence = Math.round(Number(memory.confidence_score) * 100);
  const trust = Math.round(Number(memory.trust_score) * 100);
  const expiry = memory.valid_until ? `; valid until ${memory.valid_until.slice(0, 10)}` : '';
  return `- [${memory.kind}; knowledge ${confidence}%; source trust ${trust}%${expiry}] ${redactLearningText(memory.statement, 600)}`;
}

function actionRows(payload: Record<string, unknown> | null): Array<Record<string, unknown>> {
  return Array.isArray(payload?.actions)
    ? payload.actions.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    : [];
}

function numericFeature(value: unknown): number | undefined {
  if (value === null || value === undefined || typeof value === 'boolean') return undefined;
  if (typeof value === 'string' && !value.trim()) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function countFeature(value: unknown): { before?: number; after?: number; delta?: number } {
  if (typeof value === 'number' && Number.isFinite(value)) return { after: value };
  if (!value || typeof value !== 'object') return {};
  const record = value as Record<string, unknown>;
  return {
    before: numericFeature(record.before ?? record.original ?? record.draft),
    after: numericFeature(record.after ?? record.final ?? record.approved),
    delta: numericFeature(record.delta),
  };
}

function describeCountFeature(
  value: unknown,
  singular: string,
  plural: string,
): string | null {
  const metric = countFeature(value);
  const delta = metric.delta ?? (
    metric.before !== undefined && metric.after !== undefined ? metric.after - metric.before : undefined
  );
  if (delta !== undefined && delta !== 0) {
    return `${delta > 0 ? 'added' : 'removed'} ${Math.abs(delta)} ${Math.abs(delta) === 1 ? singular : plural}`;
  }
  if (metric.after !== undefined) {
    return `approved version used ${metric.after} ${metric.after === 1 ? singular : plural}`;
  }
  return null;
}

/**
 * Turn a reply edit into transferable writing-method signals. Draft text is
 * deliberately never returned: a reviewed reply may contain accurate details
 * for one customer that are dangerously wrong for the next one.
 */
function describeReplyEdit(action: Record<string, unknown>): string {
  const similarity = Number(action.model_outcome);
  const changes: string[] = [];

  if (Number.isFinite(similarity)) {
    const label = similarity >= 0.9 ? 'lightly copy-edited' : similarity >= 0.55 ? 'substantially edited' : 'rewritten';
    changes.push(`${label} (${Math.round(Math.max(0, Math.min(1, similarity)) * 100)}% token similarity)`);
  } else {
    changes.push('edited');
  }

  // Review writers compute these PII-free aggregates at commit time. Do not
  // inspect original_text/final_text here: prompt precedents must never carry
  // another customer's draft, even transiently while formatting.
  const features = action.edit_features && typeof action.edit_features === 'object'
    ? action.edit_features as Record<string, unknown>
    : null;
  if (features) {
    const lengthRatio = numericFeature(features.length_ratio);
    if (lengthRatio !== undefined && lengthRatio > 0 && lengthRatio <= 0.85) {
      changes.push(`made about ${Math.round((1 - lengthRatio) * 100)}% shorter`);
    }
    if (lengthRatio !== undefined && lengthRatio >= 1.15) {
      changes.push(`made about ${Math.round((lengthRatio - 1) * 100)}% longer`);
    }
    const paragraphChange = describeCountFeature(features.paragraphs, 'paragraph', 'paragraphs');
    const questionChange = describeCountFeature(features.questions, 'question', 'questions');
    const exclamationChange = describeCountFeature(features.exclamations, 'exclamation', 'exclamations');
    if (paragraphChange) changes.push(paragraphChange);
    if (questionChange) changes.push(questionChange);
    if (exclamationChange) changes.push(exclamationChange);
  }

  return `human ${changes.join(', ')}`;
}

function formatEpisode(event: EventRow): string | null {
  const payload = event.payload ?? {};
  if (event.signal_type === 'dismissal' && typeof payload.dismissal_reason !== 'string') return null;
  const actions = actionRows(payload);
  const edits = actions
    .filter((action) => action.verdict === 'edited')
    .map((action) => {
      const actionType = String(action.action_type ?? 'action');
      return actionType === 'send_reply'
        ? `send_reply: ${describeReplyEdit(action)}`
        : `${actionType}: human changed the proposed parameters`;
    })
    .filter(Boolean)
    .slice(0, 2);
  const rejected = actions
    .filter((action) => action.verdict === 'rejected' || action.execution_status === 'failed')
    .map((action) => String(action.action_type ?? 'action'))
    .slice(0, 4);

  const pieces = [
    (event.signal_type === 'human_revision' || event.signal_type === 'human_edit')
      && typeof payload.operator_instruction === 'string'
      ? `reviewer correction: ${redactLearningText(payload.operator_instruction, 500)}`
      : '',
    ...edits,
    rejected.length ? `rejected/failed: ${rejected.join(', ')}` : '',
  ].filter(Boolean);

  if (pieces.length === 0 && event.signal_type === 'clean_approval') {
    const approvedTypes = actions.map((action) => String(action.action_type ?? '')).filter(Boolean).join(', ');
    return approvedTypes ? `- Clean human approval confirmed a ${approvedTypes} plan in this scope.` : null;
  }
  if (pieces.length === 0 && event.signal_type === 'human_revision') {
    const revisedTypes = actions.map((action) => String(action.action_type ?? '')).filter(Boolean).join(', ');
    return `- Reviewer-guided revision approved${revisedTypes ? ` for ${revisedTypes}` : ''}; apply extra fact verification in this scope.`;
  }
  return pieces.length ? `- ${pieces.join('; ')}` : null;
}

function samplesFromEvents(events: EventRow[]): CalibrationSample[] {
  const samples: CalibrationSample[] = [];
  for (const event of events) {
    if (!contributesToAnswerQualityCalibration(event.signal_type)) continue;
    const intent = event.scope?.intent;
    const eventWeight = Math.max(0, Number(event.trust_score) || 0);
    for (const action of actionRows(event.payload)) {
      const predicted = Number(action.model_confidence);
      const outcome = Number(action.model_outcome);
      const actionType = typeof action.action_type === 'string' ? action.action_type : '';
      if (!actionType || !Number.isFinite(predicted) || !Number.isFinite(outcome)) continue;
      samples.push({
        predicted,
        outcome,
        weight: eventWeight,
        occurredAt: event.occurred_at,
        actionType,
        intent,
      });
    }

    const payload = event.payload ?? {};
    const predicted = Number(payload.model_overall_confidence);
    const outcome = Number(payload.plan_outcome_score ?? event.outcome_score);
    if (Number.isFinite(predicted) && Number.isFinite(outcome)) {
      samples.push({
        predicted,
        outcome,
        weight: eventWeight,
        occurredAt: event.occurred_at,
        actionType: '__plan__',
        intent,
      });
    }
  }
  return samples;
}

export async function loadAutopilotLearningContext(
  ticket: Ticket,
  exactCalibrationKey?: string,
): Promise<AutopilotLearningContext> {
  const currentScope = scopeForTicket(ticket);
  const now = new Date();
  const eventCutoff = new Date(now.getTime() - 180 * 86_400_000).toISOString();

  const [memoryResult, reviewEventResult, operationEventResult] = await Promise.all([
    supabase
      .from('autopilot_learning_memories')
      .select('id, kind, statement, scope, status, confidence_score, trust_score, time_sensitive, valid_until, last_supported_at, updated_at')
      .eq('brand_id', ticket.brand_id)
      .eq('status', 'active')
      .order('confidence_score', { ascending: false })
      .limit(80),
    supabase
      .from('autopilot_learning_events')
      .select('id, event_type, signal_type, scope, payload, trust_score, outcome_score, occurred_at')
      .eq('brand_id', ticket.brand_id)
      .in('event_type', ['review', 'manual_draft', 'delayed_outcome'])
      // Threshold batch approvals are audit/exposure rows, not human quality
      // labels. Filter before the DB cap so volume cannot crowd stronger human
      // or objective evidence out of retrieval.
      .neq('signal_type', 'batch_approval')
      .lt('occurred_at', now.toISOString())
      .gte('occurred_at', eventCutoff)
      .order('occurred_at', { ascending: false })
      // Scope is ranked locally; keep enough candidates that a busy unrelated
      // intent cannot crowd all relevant reviewed episodes out of the window.
      .limit(500),
    supabase
      .from('autopilot_learning_events')
      .select('id, event_type, signal_type, scope, payload, trust_score, outcome_score, occurred_at')
      .eq('brand_id', ticket.brand_id)
      .eq('event_type', 'execution')
      .contains('payload', { calibration_channel: 'technical_execution' })
      .lt('occurred_at', now.toISOString())
      .gte('occurred_at', eventCutoff)
      .order('occurred_at', { ascending: false })
      .limit(500),
  ]);

  if (memoryResult.error || reviewEventResult.error || operationEventResult.error) {
    warnSchemaOnce(
      memoryResult.error?.message
      ?? reviewEventResult.error?.message
      ?? operationEventResult.error?.message
      ?? 'learning schema unavailable',
    );
  }

  const rankedMemories = ((memoryResult.data ?? []) as MemoryRow[])
    .map((memory) => ({
      memory,
      score: memoryActivationScore({
        status: memory.status,
        confidence: Number(memory.confidence_score),
        trust: Number(memory.trust_score),
        learnedScope: memory.scope ?? {},
        currentScope,
        updatedAt: memory.last_supported_at ?? memory.updated_at,
        validUntil: memory.valid_until,
        timeSensitive: memory.time_sensitive,
        now,
      }),
    }))
    .filter(({ score }) => score >= 0.08)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);

  const allEvents = (reviewEventResult.data ?? []) as EventRow[];
  const relevantEvents = allEvents
    .map((event) => ({ event, score: eventRelevance(event, currentScope, now) }))
    .filter(({ score }) => score >= 0.08)
    .sort((a, b) => b.score - a.score);
  const reviewedEvents = relevantEvents.filter(({ event }) => event.event_type !== 'execution');
  const promptEpisodes = reviewedEvents
    .map(({ event, score }) => ({ event, score, line: formatEpisode(event) }))
    .filter((episode): episode is typeof episode & { line: string } => Boolean(episode.line))
    .slice(0, 5);
  const calibrationEvents = qualityCalibrationEventsForKey(
    reviewedEvents
      .filter(({ event }) => contributesToAnswerQualityCalibration(event.signal_type))
      .map(({ event }) => event),
    exactCalibrationKey,
  ).slice(0, 100);
  const operationalEvents = ((operationEventResult.data ?? []) as EventRow[])
    .map((event) => ({ event, score: eventRelevance(event, currentScope, now) }))
    .filter(({ score }) => score >= 0.08)
    .sort((left, right) => right.score - left.score)
    .slice(0, 200)
    .map(({ event }) => event);

  const memoryLines = rankedMemories.map(({ memory }) => formatMemory(memory));
  const episodeLines = promptEpisodes.map(({ line }) => line);
  const promptBlock = [
    memoryLines.length
      ? `SCOPED LEARNED GUIDANCE (never overrides locked facts or live Shopify data):\n${memoryLines.join('\n')}`
      : '',
    episodeLines.length
      ? `RECENT HUMAN-REVIEWED PRECEDENTS (copy methodology/tone only; NEVER transfer names, order facts, dates, amounts, promises, or customer-specific details):\n${episodeLines.join('\n')}`
      : '',
  ].filter(Boolean).join('\n\n');

  return {
    scope: currentScope,
    promptBlock,
    references: [
      ...rankedMemories.map(({ memory, score }) => ({
        id: memory.id,
        kind: 'memory' as const,
        score,
        confidence: Number(memory.confidence_score),
        trust: Number(memory.trust_score),
      })),
      ...promptEpisodes.map(({ event, score }) => ({
        id: event.id,
        kind: 'episode' as const,
        score,
        trust: Number(event.trust_score),
      })),
    ],
    calibrationSamples: samplesFromEvents(calibrationEvents),
    operationalCalibrationSamples: samplesFromEvents(operationalEvents),
    reviewedRunCount: reviewedEvents.length,
    memoryCount: rankedMemories.length,
  };
}

export function calibratePlanConfidence(
  raw: number,
  learning: AutopilotLearningContext,
): CalibrationResult {
  return calibrateConfidence(raw, learning.calibrationSamples, '__plan__', learning.scope.intent);
}

export function calibrateActionConfidence(
  raw: number,
  actionType: string,
  learning: AutopilotLearningContext,
): CalibrationResult {
  const quality = calibrateConfidence(raw, learning.calibrationSamples, actionType, learning.scope.intent);
  const feasibility = calibrateConfidence(
    raw,
    learning.operationalCalibrationSamples,
    actionType,
    learning.scope.intent,
  );
  if (feasibility.sampleCount === 0) return quality;
  const value = Math.min(quality.value, feasibility.value);
  return {
    raw: quality.raw,
    value,
    delta: value - quality.raw,
    sampleCount: quality.sampleCount + feasibility.sampleCount,
    effectiveSampleWeight: quality.effectiveSampleWeight + feasibility.effectiveSampleWeight,
    method: 'bayesian_local_v1',
  };
}

function actionByType(plan: AutopilotPlan, type: string): AutopilotAction | undefined {
  return plan.actions.find((action) => action.type === type);
}

function comparableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(comparableValue).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, comparableValue(item)]),
    );
  }
  return value;
}

function nonReplyRevisionOutcome(before: AutopilotAction, after: AutopilotAction | undefined): number {
  if (!after) return 0;
  if (JSON.stringify(comparableValue(before.params)) === JSON.stringify(comparableValue(after.params))) return 1;

  const keys = [...new Set([...Object.keys(before.params), ...Object.keys(after.params)])];
  if (keys.length === 0) return 1;
  const matchingFields = keys.filter((key) => (
    JSON.stringify(comparableValue(before.params[key])) === JSON.stringify(comparableValue(after.params[key]))
  )).length;
  return matchingFields / keys.length;
}

export async function recordRevisionLearningEvent(input: {
  ticket: Ticket;
  previousPlan: AutopilotPlan;
  revisedPlan: AutopilotPlan;
  instruction: string;
  actor?: RevisionActor;
}): Promise<string | null> {
  const { ticket, previousPlan, revisedPlan } = input;

  // A revision request is only a candidate draft. Recording it immediately
  // would teach the system from text the reviewer might subsequently reject or
  // revise again. The approval endpoint records the authoritative review. This
  // guard also keeps this helper safe if a future caller invokes it after an
  // explicitly approved/executing revision.
  if (!APPROVED_REVISION_STATUSES.has(revisedPlan.status)) return null;

  const actions = previousPlan.actions.map((before) => {
    const after = actionByType(revisedPlan, before.type);
    const originalText = before.type === 'send_reply' ? String(before.params.reply_text ?? '') : '';
    const finalText = after?.type === 'send_reply' ? String(after.params.reply_text ?? '') : '';
    const similarity = before.type === 'send_reply'
      ? (after ? textSimilarity(originalText, finalText) : 0)
      : nonReplyRevisionOutcome(before, after);
    const verdict = !after ? 'rejected' : similarity === 1 ? 'approved' : 'edited';
    return {
      action_id: before.id,
      action_type: before.type,
      verdict,
      model_confidence: before.model_confidence ?? before.confidence,
      model_outcome: similarity,
      ...(originalText ? { original_text: redactLearningText(originalText) } : {}),
      ...(finalText ? { final_text: redactLearningText(finalText) } : {}),
    };
  });
  const planOutcome = actions.length
    ? actions.reduce((sum, action) => sum + Number(action.model_outcome), 0) / actions.length
    : 0;
  const eventId = randomUUID();
  const planId = previousPlan.id ?? randomUUID();
  const scope = scopeForTicket(ticket, previousPlan.actions.map((action) => action.type));
  const { error } = await supabase.from('autopilot_learning_events').upsert({
    id: eventId,
    brand_id: ticket.brand_id,
    ticket_id: ticket.id,
    plan_id: planId,
    plan_revision: previousPlan.revision ?? previousPlan.revision_count ?? 0,
    event_type: 'review',
    signal_type: 'human_revision',
    actor_type: 'agent',
    actor_id: input.actor?.id || null,
    actor_name: input.actor?.name || null,
    scope,
    trust_score: trustForSignal('human_revision'),
    outcome_score: planOutcome,
    payload: {
      source: 'autopilot_revision',
      operator_instruction: redactLearningText(input.instruction, 800),
      model_overall_confidence: previousPlan.analysis.model_confidence ?? previousPlan.analysis.overall_confidence,
      plan_outcome_score: planOutcome,
      planner_version: previousPlan.planner_version,
      prompt_version: previousPlan.prompt_version,
      ...learningModelLineageForPlan(previousPlan),
      revised_plan_id: revisedPlan.id,
      actions,
    },
    idempotency_key: `revision:${planId}:${revisedPlan.id ?? revisedPlan.proposed_at}`,
    occurred_at: new Date().toISOString(),
  }, { onConflict: 'brand_id,idempotency_key', ignoreDuplicates: true });

  if (error) {
    warnSchemaOnce(error.message);
    return null;
  }
  return eventId;
}

export async function recordDelayedTicketOutcome(
  ticket: Pick<Ticket, 'id' | 'brand_id'>,
  score: number,
  lineage: CsatOutcomeLineage,
  requestId: string,
): Promise<void> {
  if (lineage.kind === 'manual_message' || lineage.kind === 'manual_resolution') return;

  const normalizedScore = Math.max(0, Math.min(1, (score - 1) / 4));
  let planId: string | null = null;
  let planRevision = 0;
  let scope: LearningScope = { action_types: ['send_reply'] };
  let modelOverallConfidence: number | undefined;
  let actions: Array<Record<string, unknown>> = [];
  let payloadLineage: Record<string, unknown> = { ...lineage };

  if (lineage.kind === 'autopilot_plan') {
    const { data: ledger, error: ledgerError } = await supabase
      .from('ticket_action_plans')
      .select('id, revision, actions')
      .eq('id', lineage.plan_id)
      .eq('ticket_id', ticket.id)
      .eq('brand_id', ticket.brand_id)
      .eq('revision', lineage.plan_revision)
      .maybeSingle();
    if (ledgerError) {
      warnSchemaOnce(ledgerError.message);
      return;
    }
    if (!ledger || !Array.isArray(ledger.actions)) return;
    const ledgerActions = ledger.actions.filter(
      (value): value is Record<string, unknown> => Boolean(value) && typeof value === 'object',
    );
    const resolution = ledgerActions.find((action) => action.id === lineage.resolution_action_id && action.type === 'resolve');
    const reply = lineage.reply_action_id
      ? ledgerActions.find((action) => action.id === lineage.reply_action_id && action.type === 'send_reply')
      : undefined;
    if (!resolution || (lineage.reply_action_id && !reply)) return;

    const executionKey = `execution:${lineage.plan_id}:${lineage.execution_attempt_id}`;
    const [executionResult, reviewResult] = await Promise.all([
      supabase
        .from('autopilot_learning_events')
        .select('scope, payload')
        .eq('brand_id', ticket.brand_id)
        .eq('ticket_id', ticket.id)
        .eq('plan_id', lineage.plan_id)
        .eq('plan_revision', lineage.plan_revision)
        .eq('idempotency_key', executionKey)
        .maybeSingle(),
      supabase
        .from('autopilot_learning_events')
        .select('scope, payload')
        .eq('brand_id', ticket.brand_id)
        .eq('ticket_id', ticket.id)
        .eq('plan_id', lineage.plan_id)
        .eq('plan_revision', lineage.plan_revision)
        .eq('event_type', 'review')
        .order('occurred_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    if (executionResult.error || reviewResult.error) {
      warnSchemaOnce(executionResult.error?.message ?? reviewResult.error?.message ?? 'CSAT lineage lookup failed');
      return;
    }
    const executionEvent = executionResult.data;
    const reviewEvent = reviewResult.data;
    const executionPayload = (executionEvent?.payload ?? {}) as Record<string, unknown>;
    const reviewPayload = (reviewEvent?.payload ?? {}) as Record<string, unknown>;
    if (executionEvent && executionPayload.execution_attempt_id !== lineage.execution_attempt_id) return;

    planId = lineage.plan_id;
    planRevision = lineage.plan_revision;
    scope = (reviewEvent?.scope ?? executionEvent?.scope ?? {
      action_types: reply ? ['send_reply', 'resolve'] : ['resolve'],
    }) as LearningScope;
    modelOverallConfidence = finiteUnit(lineage.model_overall_confidence);
    payloadLineage = {
      ...payloadLineage,
      ...learningModelLineageFromPayload(reviewPayload),
    };
    actions = [
      ...(reply ? [{
        action_id: lineage.reply_action_id,
        action_type: 'send_reply',
        model_confidence: finiteUnit(lineage.reply_model_confidence),
        model_outcome: normalizedScore,
      }] : []),
      {
        action_id: lineage.resolution_action_id,
        action_type: 'resolve',
        model_confidence: finiteUnit(lineage.resolution_model_confidence),
        model_outcome: normalizedScore,
      },
    ];
  } else {
    const { data: generation, error: generationError } = await supabase
      .from('autopilot_draft_generations')
      .select('id, final_message_id, raw_confidence, scope, model, prompt_version')
      .eq('id', lineage.generation_id)
      .eq('ticket_id', ticket.id)
      .eq('brand_id', ticket.brand_id)
      .eq('final_message_id', lineage.message_id)
      .maybeSingle();
    if (generationError) {
      warnSchemaOnce(generationError.message);
      return;
    }
    if (!generation) return;

    // A survey can still be delivered when the support reply itself failed.
    // Never teach answer quality from text the customer did not receive.
    const { data: deliveryEvent, error: deliveryError } = await supabase
      .from('autopilot_learning_events')
      .select('outcome_score, payload')
      .eq('brand_id', ticket.brand_id)
      .eq('ticket_id', ticket.id)
      .eq('idempotency_key', `manual-draft-execution:${lineage.generation_id}:${lineage.message_id}`)
      .maybeSingle();
    if (deliveryError) {
      warnSchemaOnce(deliveryError.message);
      return;
    }
    if (!deliveryEvent || Number(deliveryEvent.outcome_score) < 1) return;

    scope = (generation.scope ?? { action_types: ['send_reply'] }) as LearningScope;
    modelOverallConfidence = finiteUnit(lineage.model_confidence ?? generation.raw_confidence);
    actions = [{
      action_id: lineage.message_id,
      action_type: 'send_reply',
      model_confidence: modelOverallConfidence,
      model_outcome: normalizedScore,
    }];
    payloadLineage = {
      kind: lineage.kind,
      generation_id: lineage.generation_id,
      message_id: lineage.message_id,
      ...manualDraftModelLineage(generation.model, generation.prompt_version),
    };
  }

  const { error } = await supabase.from('autopilot_learning_events').upsert({
    id: randomUUID(),
    brand_id: ticket.brand_id,
    ticket_id: ticket.id,
    plan_id: planId,
    plan_revision: planRevision,
    event_type: 'delayed_outcome',
    signal_type: 'delayed_outcome',
    actor_type: 'customer',
    scope,
    trust_score: trustForSignal('delayed_outcome'),
    outcome_score: normalizedScore,
    payload: {
      source: 'csat',
      csat_request_id: requestId,
      csat_score: score,
      lineage: payloadLineage,
      ...learningModelLineageFromPayload(payloadLineage),
      model_overall_confidence: modelOverallConfidence,
      plan_outcome_score: normalizedScore,
      actions,
    },
    idempotency_key: `csat:${requestId}`,
    occurred_at: new Date().toISOString(),
  }, { onConflict: 'brand_id,idempotency_key', ignoreDuplicates: true });
  if (error) warnSchemaOnce(error.message);
}

function finiteUnit(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 1 ? number : undefined;
}

/**
 * A later customer reply is an outcome label for the last completed plan. It
 * is weaker than an explicit CSAT score and is interpreted conservatively:
 * requested follow-ups and positive replies are successes, while a frustrated
 * reopen after resolve is negative. Neutral continuations stay near 0.5.
 */
export async function recordCustomerFollowupOutcome(ticket: Ticket): Promise<void> {
  const metadata = (ticket.metadata ?? {}) as Record<string, unknown>;
  const plan = metadata.autopilot as AutopilotPlan | undefined;
  if (!plan?.id || !['executed', 'partially_executed'].includes(plan.status)) return;

  const { data: latest } = await supabase
    .from('ticket_messages')
    .select('id, created_at')
    .eq('ticket_id', ticket.id)
    .eq('sender_type', 'customer')
    .eq('is_internal_note', false)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!latest?.id) return;

  const triage = (metadata.ai_triage ?? {}) as Record<string, unknown>;
  const sentiment = typeof triage.sentiment === 'string' ? triage.sentiment : 'neutral';
  const awaitedCustomer = (ticket.tags ?? []).includes('awaiting-customer')
    || plan.actions.some((action) => action.type === 'add_tags'
      && Array.isArray(action.params.tags)
      && action.params.tags.includes('awaiting-customer'));
  const resolvedByPlan = plan.actions.some((action) => action.type === 'resolve' && action.status === 'executed');
  const negativeSentiment = sentiment === 'angry' || sentiment === 'frustrated';
  // A requested response is a process success, not proof that the answer was
  // good. Explicit negative sentiment is the stronger answer-quality label.
  const outcome = negativeSentiment
    ? 0.15
    : awaitedCustomer
      ? 0.85
      : sentiment === 'positive'
      ? 0.90
      : resolvedByPlan
          ? 0.35
          : 0.50;
  const scope = scopeForTicket(ticket, plan.actions.map((action) => action.type));
  const { error } = await supabase.from('autopilot_learning_events').upsert({
    id: randomUUID(),
    brand_id: ticket.brand_id,
    ticket_id: ticket.id,
    plan_id: plan.id,
    plan_revision: plan.revision ?? plan.revision_count ?? 0,
    event_type: 'delayed_outcome',
    signal_type: 'delayed_outcome',
    actor_type: 'customer',
    scope,
    trust_score: trustForSignal('delayed_outcome'),
    outcome_score: outcome,
    payload: {
      source: 'customer_followup',
      event_reason: awaitedCustomer ? 'requested_followup' : resolvedByPlan ? 'post_resolution_reply' : 'continued_conversation',
      sentiment,
      ...learningModelLineageForPlan(plan),
      model_overall_confidence: plan.analysis.model_confidence ?? plan.analysis.overall_confidence,
      plan_outcome_score: outcome,
      actions: plan.actions.map((action) => ({
        action_id: action.id,
        action_type: action.type,
        model_confidence: action.model_confidence ?? action.confidence,
        model_outcome: action.type === 'add_tags' && awaitedCustomer && !negativeSentiment ? 0.9 : outcome,
      })),
    },
    idempotency_key: `customer-followup:${plan.id}:${latest.id}`,
    occurred_at: latest.created_at ?? new Date().toISOString(),
  }, { onConflict: 'brand_id,idempotency_key', ignoreDuplicates: true });
  if (error) warnSchemaOnce(error.message);
}
