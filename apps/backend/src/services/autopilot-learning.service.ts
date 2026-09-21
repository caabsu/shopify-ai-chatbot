import { randomUUID } from 'node:crypto';
import { supabase } from '../config/supabase.js';
import { isAutopilotBrand } from './autopilot.service.js';
import { callSupportRequiredTool, type SupportModelGeneration } from './support-model-tool.service.js';
import type { RequiredToolDefinition } from './deepseek-tool-call.service.js';
import { recordSupportGenerationRun } from './ai-generation-ledger.service.js';
import {
  compactScope,
  contributesToSemanticMemory,
  redactLearningText,
  resolveMemoryFreshness,
  type LearningMemoryKind,
  type LearningScope,
} from './autopilot-learning-policy.js';

/**
 * Slow path of the learning loop.
 *
 * The fast path is immediate: every committed review episode is already
 * eligible for scoped retrieval and confidence calibration. This worker turns
 * batches of those immutable episodes into atomic semantic memories. It never
 * rewrites one global prompt and never treats a customer/order fact as a brand
 * rule. Database leases make it safe across multiple Railway replicas.
 */

const LEARNER_VERSION = 'scoped-memory-distiller-v2';
const WORKER_ID = `${process.pid}:${randomUUID()}`;
const CLAIM_LIMIT = 24;
const MAX_PROMPT_BYTES = 28_000;
const MAX_PROCESSING_ATTEMPTS = 5;
const HEARTBEAT_INTERVAL_MS = 60_000;

interface LearningEventRow {
  id: string;
  brand_id: string;
  ticket_id: string | null;
  signal_type: string;
  scope: LearningScope | null;
  payload: Record<string, unknown> | null;
  trust_score: number;
  outcome_score: number | null;
  occurred_at: string;
  processing_attempts?: number;
  last_processing_error?: string | null;
  claim_token?: string | null;
}

interface DeadLetterEvent {
  id: string;
  error: string;
}

interface DistillationBatch {
  events: LearningEventRow[];
  calibrationOnlyIds: string[];
  promptJson: string;
  deadLetters: DeadLetterEvent[];
  deferredCount: number;
}

interface MemoryCandidate {
  memory_key: string;
  kind: LearningMemoryKind;
  statement: string;
  scope?: LearningScope;
  stance: 'support' | 'contradict';
  confidence: number;
  time_sensitive: boolean;
  valid_for_days?: number;
  source_event_ids: string[];
  rationale?: string;
}

let schemaWarningLogged = false;

class LearningLeaseLostError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LearningLeaseLostError';
  }
}

function warnSchemaOnce(message: string): void {
  if (schemaWarningLogged) return;
  schemaWarningLogged = true;
  console.warn(`[autopilot-learning] ${message}. Apply docs/migrations/012-autopilot-learning-loop.sql.`);
}

export async function runLearningCycle(): Promise<void> {
  const { data: brands, error } = await supabase.from('brands').select('id, slug, name').eq('enabled', true);
  if (error) throw new Error(`Failed to load brands for learning: ${error.message}`);

  for (const brand of brands ?? []) {
    const brandId = brand.id as string;
    if (!(await isAutopilotBrand(brandId))) continue;
    try {
      await learnForBrand(brandId, String(brand.name || brand.slug));
    } catch (err) {
      console.error(`[autopilot-learning] ${brand.slug} cycle failed:`, err instanceof Error ? err.message : err);
    }
  }
}

async function claimEvents(brandId: string, claimToken: string): Promise<LearningEventRow[]> {
  const { data, error } = await supabase.rpc('claim_autopilot_learning_events', {
    p_brand_id: brandId,
    p_worker_id: WORKER_ID,
    p_claim_token: claimToken,
    p_limit: CLAIM_LIMIT,
  });
  if (error) {
    warnSchemaOnce(error.message);
    return [];
  }
  const rows = (data ?? []) as LearningEventRow[];
  if (rows.some((event) => event.claim_token !== claimToken)) {
    throw new LearningLeaseLostError('Claim RPC returned an event without the requested fencing token');
  }
  return rows;
}

function renewedCount(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  if (value && typeof value === 'object' && 'renewed_count' in value) {
    const count = Number((value as { renewed_count: unknown }).renewed_count);
    return Number.isFinite(count) ? count : null;
  }
  return null;
}

async function heartbeatClaim(
  brandId: string,
  claimToken: string,
  eventIds: string[],
): Promise<void> {
  if (eventIds.length === 0) return;
  const { data, error } = await supabase.rpc('heartbeat_autopilot_learning_events', {
    p_brand_id: brandId,
    p_worker_id: WORKER_ID,
    p_claim_token: claimToken,
    p_event_ids: eventIds,
  });
  if (error) throw new LearningLeaseLostError(`Learning lease heartbeat failed: ${error.message}`);
  const count = renewedCount(data);
  if (count !== eventIds.length) {
    throw new LearningLeaseLostError(`Learning lease renewed ${count ?? 0}/${eventIds.length} event(s)`);
  }
}

async function withLeaseHeartbeat<T>(
  brandId: string,
  claimToken: string,
  eventIds: string[],
  operation: () => Promise<T>,
): Promise<T> {
  await heartbeatClaim(brandId, claimToken, eventIds);
  let heartbeatError: Error | null = null;
  let inFlight: Promise<void> | null = null;
  const timer = setInterval(() => {
    if (inFlight || heartbeatError) return;
    inFlight = heartbeatClaim(brandId, claimToken, eventIds)
      .catch((error: unknown) => {
        heartbeatError = error instanceof Error ? error : new Error(String(error));
      })
      .finally(() => {
        inFlight = null;
      });
  }, HEARTBEAT_INTERVAL_MS);
  timer.unref();

  try {
    const result = await operation();
    if (inFlight) await inFlight;
    if (heartbeatError) throw heartbeatError;
    await heartbeatClaim(brandId, claimToken, eventIds);
    return result;
  } finally {
    clearInterval(timer);
  }
}

async function finalizeClaim(input: {
  brandId: string;
  claimToken: string;
  processedIds: string[];
  deadLetters: DeadLetterEvent[];
  error?: string | null;
}): Promise<void> {
  const { error } = await supabase.rpc('finalize_autopilot_learning_events', {
    p_brand_id: input.brandId,
    p_worker_id: WORKER_ID,
    p_claim_token: input.claimToken,
    p_processed_ids: input.processedIds,
    p_dead_letters: input.deadLetters,
    p_error: input.error?.slice(0, 1000) ?? null,
    p_learner_version: LEARNER_VERSION,
  });
  if (error) throw new LearningLeaseLostError(`Learning claim finalization failed: ${error.message}`);
}

async function learnForBrand(brandId: string, brandName: string): Promise<void> {
  const claimToken = randomUUID();
  const events = await claimEvents(brandId, claimToken);
  if (events.length === 0) return;
  const claimedIds = events.map((event) => event.id);
  // Once an episode has repeatedly failed model/merge processing, isolate it
  // from the batch. A poison episode can then be quarantined without starving
  // every newer approval behind it in FIFO order.
  const repeatedlyFailing = events.find((event) => (
    Number(event.processing_attempts ?? 0) >= MAX_PROCESSING_ATTEMPTS
    && event.last_processing_error?.startsWith('deterministic:')
  ));
  const processingEvents = repeatedlyFailing ? [repeatedlyFailing] : events;
  const batch = buildDistillationBatch(processingEvents);

  try {
    if (batch.events.length === 0) {
      await finalizeClaim({
        brandId,
        claimToken,
        processedIds: batch.calibrationOnlyIds,
        deadLetters: batch.deadLetters,
      });
      console.warn(`[autopilot-learning] ${brandName}: dead-lettered ${batch.deadLetters.length} malformed/oversized episode(s)`);
      return;
    }

    const { candidates, evidenceWrites } = await withLeaseHeartbeat(
      brandId,
      claimToken,
      claimedIds,
      async () => mergeDistilledMemories({
        brandId,
        claimToken,
        events: batch.events,
        promptJson: batch.promptJson,
        brandName,
      }),
    );

    // Only the complete event projections actually shown to the distiller are
    // checkpointed. Events deferred by the byte budget are released by the
    // finalizer and remain eligible for the next claim.
    await finalizeClaim({
      brandId,
      claimToken,
      processedIds: [...batch.events.map((event) => event.id), ...batch.calibrationOnlyIds],
      deadLetters: batch.deadLetters,
    });

    console.log(
      `[autopilot-learning] ${brandName}: adjudicated ${batch.events.length}/${events.length} episode(s) into ${candidates.length} candidate(s), ${evidenceWrites} evidence link(s); ${batch.deferredCount} deferred`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const transient = isTransientLearnerFailure(err);
    const classifiedError = `${transient ? 'transient' : 'deterministic'}:${message}`;

    if (!(err instanceof LearningLeaseLostError) && !transient && repeatedlyFailing && batch.events.length === 1) {
      try {
        await finalizeClaim({
          brandId,
          claimToken,
          processedIds: batch.calibrationOnlyIds,
          deadLetters: [
            ...batch.deadLetters,
            { id: repeatedlyFailing.id, error: `retry_limit_exceeded: ${message}`.slice(0, 500) },
          ],
        });
        console.error(`[autopilot-learning] ${brandName}: quarantined poison episode ${repeatedlyFailing.id} after ${repeatedlyFailing.processing_attempts} attempts`);
        return;
      } catch (finalizeError) {
        console.error('[autopilot-learning] failed to quarantine poison episode:', finalizeError);
      }
    }

    // A worker that lost its token must never mutate or release the new
    // owner's claim. Token checks in merge/finalize make this fence durable.
    if (!(err instanceof LearningLeaseLostError)) {
      try {
        await finalizeClaim({
          brandId,
          claimToken,
          processedIds: batch.calibrationOnlyIds,
          deadLetters: batch.deadLetters,
          error: classifiedError,
        });
      } catch (finalizeError) {
        console.error(
          `[autopilot-learning] failed to release claim ${claimToken}:`,
          finalizeError instanceof Error ? finalizeError.message : finalizeError,
        );
      }
    }
    throw err;
  }
}

function isTransientLearnerFailure(error: unknown): boolean {
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const status = Number(record.status);
  if (status === 408 || status === 409 || status === 429 || status >= 500) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /timeout|timed out|rate limit|overloaded|temporar|network|fetch failed|econn|socket|503|502|504/i.test(message);
}

async function mergeDistilledMemories(input: {
  brandId: string;
  claimToken: string;
  events: LearningEventRow[];
  promptJson: string;
  brandName: string;
}): Promise<{ candidates: MemoryCandidate[]; evidenceWrites: number }> {
    const distilled = await distill(
      input.promptJson,
      input.brandName,
      new Set(input.events.map((event) => event.id)),
    );
    const candidates = distilled.candidates;
    const learnerBuild = [
      LEARNER_VERSION,
      distilled.generation.provider,
      distilled.generation.model,
      distilled.generation.tier,
    ].join(':').slice(0, 250);
    await recordSupportGenerationRun({
      purpose: 'autopilot_memory_distillation',
      generation: distilled.generation,
      brandId: input.brandId,
      promptVersion: LEARNER_VERSION,
      routerVersion: 'learning-distiller-router-v1',
      routerDecision: { tier: 'pro', reason: 'high_trust_shared_memory' },
      metadata: {
        source_event_count: input.events.length,
        candidate_count: candidates.length,
      },
    });
    const eventById = new Map(input.events.map((event) => [event.id, event]));
    let evidenceWrites = 0;

    for (const candidate of candidates.slice(0, 20)) {
      const sources = candidate.source_event_ids
        .map((id) => eventById.get(id))
        .filter((event): event is LearningEventRow => Boolean(event));
      // Clean approvals are calibration evidence, not permission to invent a
      // new policy/fact. A reasonless dismissal is also ambiguous (duplicate,
      // already handled, stale, etc.) and must not become an anti-pattern.
      const memorySources = sources.filter((source) => (
        source.signal_type !== 'clean_approval'
        && source.signal_type !== 'batch_approval'
        && (source.signal_type !== 'dismissal'
          || typeof source.payload?.dismissal_reason === 'string')
      ));
      if (memorySources.length === 0) continue;
      if (candidate.kind === 'fact'
          && !memorySources.some((source) => source.signal_type === 'human_edit' || source.signal_type === 'human_revision')) {
        continue;
      }

      const scope = constrainScope(candidate.scope ?? {}, memorySources);
      const freshness = resolveMemoryFreshness({
        kind: candidate.kind,
        timeSensitive: candidate.time_sensitive,
        ...(candidate.valid_for_days !== undefined ? { validForDays: candidate.valid_for_days } : {}),
      });
      const memoryKey = normalizeMemoryKey(candidate.memory_key);
      const statement = redactLearningText(candidate.statement, 1200);
      if (!memoryKey || !statement || containsUnredactedSharedMemoryPii(statement)) {
        if (statement && containsUnredactedSharedMemoryPii(statement)) {
          console.warn(`[autopilot-learning] quarantined candidate ${memoryKey || '(missing key)'} containing possible PII`);
        }
        continue;
      }

      for (const source of memorySources) {
        const { error } = await supabase.rpc('merge_autopilot_learning_memory', {
          p_brand_id: input.brandId,
          p_memory_key: memoryKey,
          p_kind: candidate.kind,
          p_statement: statement,
          p_scope: scope,
          p_time_sensitive: freshness.timeSensitive,
          p_valid_for_days: freshness.validForDays,
          p_event_id: source.id,
          p_stance: candidate.stance,
          p_source_trust: Math.max(0, Math.min(1, Number(source.trust_score) || 0)),
          p_extraction_confidence: Math.max(0, Math.min(1, Number(candidate.confidence) || 0.5)),
          p_learner_version: learnerBuild,
          p_worker_id: WORKER_ID,
          p_claim_token: input.claimToken,
        });
        if (error) throw new Error(`Memory merge failed (${memoryKey}): ${error.message}`);
        evidenceWrites++;
      }
    }
    return { candidates, evidenceWrites };
}

function finiteNumber(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function containsUnredactedSharedMemoryPii(value: string): boolean {
  return /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(value)
    || /\b\+?\d[\d().\s-]{7,}\d\b/.test(value)
    || /#\s?\d{3,}/.test(value)
    || /\b\d{8,}\b/.test(value)
    || /\b[A-Z][a-z'-]{1,30}\s+[A-Z][a-z'-]{1,30}\b/.test(value);
}

function projectedLearningPayload(payload: Record<string, unknown> | null): Record<string, unknown> {
  const source = payload ?? {};
  const projection: Record<string, unknown> = { projection_version: 1 };

  for (const key of ['source', 'event_reason', 'plan_status', 'sentiment'] as const) {
    if (typeof source[key] === 'string') projection[key] = redactLearningText(source[key], 300);
  }
  if (typeof source.operator_instruction === 'string') {
    projection.operator_instruction = redactLearningText(source.operator_instruction, 800);
  }
  for (const key of ['model_overall_confidence', 'plan_outcome_score', 'csat_score'] as const) {
    const value = finiteNumber(source[key]);
    if (value !== undefined) projection[key] = value;
  }
  if (typeof source.execution_only === 'boolean') projection.execution_only = source.execution_only;

  const rawActions = Array.isArray(source.actions)
    ? source.actions.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    : [];
  projection.actions = rawActions.slice(0, 20).map((action) => {
    const projected: Record<string, unknown> = {};
    for (const key of ['action_type', 'verdict', 'execution_status'] as const) {
      if (typeof action[key] === 'string') projected[key] = redactLearningText(action[key], 120);
    }
    for (const key of ['model_confidence', 'model_outcome'] as const) {
      const value = finiteNumber(action[key]);
      if (value !== undefined) projected[key] = value;
    }
    if (action.edit_features && typeof action.edit_features === 'object') {
      const features = action.edit_features as Record<string, unknown>;
      projected.edit_features = Object.fromEntries(
        Object.entries(features).slice(0, 12).map(([key, value]) => {
          if (typeof value === 'number' && Number.isFinite(value)) return [key, value];
          if (value && typeof value === 'object') {
            return [key, Object.fromEntries(Object.entries(value as Record<string, unknown>)
              .filter(([, item]) => typeof item === 'number' && Number.isFinite(item))
              .slice(0, 4))];
          }
          return [key, undefined];
        }).filter(([, value]) => value !== undefined),
      );
    }
    if (typeof action.original_text === 'string') {
      projected.original_text = redactLearningText(action.original_text, 1200);
    }
    if (typeof action.final_text === 'string') {
      projected.final_text = redactLearningText(action.final_text, 1200);
    }
    if (typeof action.execution_error === 'string') {
      projected.execution_error = redactLearningText(action.execution_error, 400);
    }
    if (typeof action.execution_result === 'string') {
      projected.execution_result = redactLearningText(action.execution_result, 400);
    }
    return projected;
  });
  if (rawActions.length > 20) projection.omitted_action_count = rawActions.length - 20;
  return projection;
}

function projectedLearningEvent(event: LearningEventRow): Record<string, unknown> {
  return {
    id: event.id,
    signal_type: event.signal_type,
    scope: compactScope(event.scope ?? {}),
    trust_score: Math.max(0, Math.min(1, Number(event.trust_score) || 0)),
    outcome_score: event.outcome_score,
    occurred_at: event.occurred_at,
    payload: projectedLearningPayload(event.payload),
  };
}

/**
 * Build one valid JSON array from whole, bounded event projections. We never
 * slice serialized JSON. Once the aggregate budget is full, later events stay
 * unprocessed for the next cycle; a single unrepresentable event is isolated
 * as a dead letter so it cannot permanently block the FIFO queue.
 */
function buildDistillationBatch(events: LearningEventRow[]): DistillationBatch {
  const serialized: string[] = [];
  const included: LearningEventRow[] = [];
  const deadLetters: DeadLetterEvent[] = [];
  const calibrationOnlyIds: string[] = [];
  let byteCount = 2; // opening and closing brackets
  let deferredCount = 0;

  for (let index = 0; index < events.length; index++) {
    const event = events[index];
    if (event.payload?.execution_only === true
        || !contributesToSemanticMemory(event.signal_type)) {
      // Execution receipts feed technical reliability. Clean and threshold
      // approvals remain audit/calibration signals. None is independent
      // semantic evidence, so do not expose it to the memory distiller.
      calibrationOnlyIds.push(event.id);
      continue;
    }
    let item: string;
    try {
      item = JSON.stringify(projectedLearningEvent(event));
    } catch (error) {
      deadLetters.push({
        id: event.id,
        error: `event_projection_failed: ${error instanceof Error ? error.message : String(error)}`.slice(0, 500),
      });
      continue;
    }

    const itemBytes = Buffer.byteLength(item, 'utf8');
    if (itemBytes + 2 > MAX_PROMPT_BYTES) {
      deadLetters.push({ id: event.id, error: `event_projection_exceeds_${MAX_PROMPT_BYTES}_bytes` });
      continue;
    }

    const separatorBytes = serialized.length > 0 ? 1 : 0;
    if (byteCount + separatorBytes + itemBytes > MAX_PROMPT_BYTES) {
      deferredCount = events.length - index;
      break;
    }
    serialized.push(item);
    included.push(event);
    byteCount += separatorBytes + itemBytes;
  }

  return {
    events: included,
    calibrationOnlyIds,
    promptJson: `[${serialized.join(',')}]`,
    deadLetters,
    deferredCount,
  };
}

function normalizeMemoryKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120);
}

/** A single source cannot silently broaden its own applicability. */
function constrainScope(candidate: LearningScope, sources: LearningEventRow[]): LearningScope {
  const sourceScopes = sources.map((source) => source.scope ?? {});
  const first = sourceScopes[0] ?? {};
  const independentTickets = new Set(sources.map((source) => source.ticket_id).filter(Boolean)).size;
  const common = (key: 'intent' | 'category' | 'language'): string | undefined => {
    const values = [...new Set(sourceScopes.map((scope) => scope[key]).filter((value): value is string => Boolean(value)))];
    return values.length === 1 ? values[0] : undefined;
  };
  const constrained = (key: 'intent' | 'category' | 'language'): string | undefined => {
    if (independentTickets < 2) return first[key];
    const proposed = candidate[key];
    const observed = new Set(sourceScopes.map((scope) => scope[key]).filter(Boolean));
    return proposed && observed.has(proposed) ? proposed : common(key);
  };
  const constrainedArray = (key: 'action_types' | 'product_handles' | 'topics'): string[] | undefined => {
    if (independentTickets < 2) return first[key];
    const observed = new Set(sourceScopes.flatMap((scope) => scope[key] ?? []));
    const proposed = (candidate[key] ?? []).filter((value) => observed.has(value));
    return proposed.length ? proposed : undefined;
  };

  // Generalization across intent/category requires at least two independent
  // tickets. Otherwise preserve the episode's narrow scope even if the model
  // omitted it from its candidate.
  return compactScope({
    ...candidate,
    intent: constrained('intent'),
    category: constrained('category'),
    language: constrained('language'),
    action_types: constrainedArray('action_types'),
    product_handles: constrainedArray('product_handles'),
    topics: constrainedArray('topics'),
  });
}

const DISTILL_TOOL: RequiredToolDefinition = {
  name: 'extract_scoped_memories',
  description: 'Extract atomic, scoped memory candidates from human-reviewed support episodes.',
  inputSchema: {
    type: 'object' as const,
    required: ['memories'],
    properties: {
      memories: {
        type: 'array',
        maxItems: 20,
        items: {
          type: 'object',
          required: ['memory_key', 'kind', 'statement', 'stance', 'confidence', 'time_sensitive', 'source_event_ids'],
          properties: {
            memory_key: { type: 'string', description: 'Stable snake_case semantic key.' },
            kind: { type: 'string', enum: ['style', 'procedure', 'fact', 'anti_pattern'] },
            statement: { type: 'string', description: 'One atomic, operational statement.' },
            scope: {
              type: 'object',
              properties: {
                intent: { type: 'string' },
                category: { type: 'string' },
                language: { type: 'string' },
                action_types: { type: 'array', items: { type: 'string' } },
                topics: { type: 'array', items: { type: 'string' } },
                product_handles: { type: 'array', items: { type: 'string' } },
              },
            },
            stance: { type: 'string', enum: ['support', 'contradict'] },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
            time_sensitive: { type: 'boolean' },
            valid_for_days: { type: 'integer', minimum: 1, maximum: 365 },
            source_event_ids: { type: 'array', items: { type: 'string' }, minItems: 1 },
            rationale: { type: 'string' },
          },
        },
      },
    },
  },
};

async function distill(
  promptJson: string,
  brandName: string,
  representedEventIds: Set<string>,
): Promise<{ candidates: MemoryCandidate[]; generation: SupportModelGeneration }> {
  const response = await callSupportRequiredTool<{ memories?: unknown }>({
    tier: 'pro',
    max_tokens: 3_200,
    system: `You consolidate reviewed customer-support episodes for ${brandName} into safe semantic memory.

Rules:
- Extract atomic methodology, tone, procedure, or explicitly human-corrected fact memories only.
- A human edit/revision is high source trust, but it is NOT automatically globally applicable.
- Never promote customer names, emails, addresses, order IDs, tracking data, one-ticket promises, or customer-specific state.
- If a reviewer says a one-off fact such as "the replacement ships Friday", keep it out of shared memory. A reusable procedure inferred from it may be kept with narrow scope.
- Clean approval confirms calibration. It does not, by itself, create a new factual rule.
- Skips/dismissals should become a precise anti-pattern only when the evidence reveals what was wrong.
- Execution failure is operational evidence; do not infer that the draft's language or policy was wrong.
- Facts, offers, dates, inventory, delivery timing, and promotions are time-sensitive unless clearly structural. Give them a short validity window.
- Keep intent/action/product scope as narrow as the evidence. Use only the supplied event IDs as provenance.
- Learned memory never overrides locked policy, live Shopify state, or verified product data.
- It is valid to return zero memories when the episodes only provide calibration evidence.`,
    user: `Extract scoped memory candidates from these immutable reviewed episode projections:\n${promptJson}`,
    tool: DISTILL_TOOL,
    parse(value) {
      if (!value || typeof value !== 'object') {
        throw new Error('Learner tool input must be an object');
      }
      return value as { memories?: unknown };
    },
  });

  const memories = response.value.memories;
  if (!Array.isArray(memories)) throw new Error('Learner response did not contain a memories array');

  const parsed: MemoryCandidate[] = [];
  for (let index = 0; index < memories.length; index++) {
    try {
      parsed.push(parseMemoryCandidate(memories[index], representedEventIds, index));
    } catch (error) {
      // One malformed candidate must not discard valid candidates or replay the
      // whole immutable event batch forever.
      console.warn('[autopilot-learning] ignored malformed memory candidate:', error instanceof Error ? error.message : error);
    }
  }
  return { candidates: parsed, generation: response.generation };
}

function parseMemoryCandidate(value: unknown, representedEventIds: Set<string>, index: number): MemoryCandidate {
  if (!value || typeof value !== 'object') throw new Error(`Learner memory ${index} is not an object`);
  const input = value as Record<string, unknown>;
  const memoryKey = typeof input.memory_key === 'string' ? input.memory_key : '';
  const statement = typeof input.statement === 'string' ? input.statement : '';
  const kind = input.kind;
  const stance = input.stance;
  const confidence = Number(input.confidence);
  const timeSensitive = input.time_sensitive;
  const sourceIds = Array.isArray(input.source_event_ids)
    ? [...new Set(input.source_event_ids.filter((id): id is string => typeof id === 'string' && representedEventIds.has(id)))]
    : [];

  if (!memoryKey.trim() || !statement.trim()) throw new Error(`Learner memory ${index} is missing its key or statement`);
  if (!['style', 'procedure', 'fact', 'anti_pattern'].includes(String(kind))) {
    throw new Error(`Learner memory ${index} has invalid kind`);
  }
  if (stance !== 'support' && stance !== 'contradict') throw new Error(`Learner memory ${index} has invalid stance`);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new Error(`Learner memory ${index} has invalid confidence`);
  }
  if (typeof timeSensitive !== 'boolean') throw new Error(`Learner memory ${index} has invalid time sensitivity`);
  if (sourceIds.length === 0) throw new Error(`Learner memory ${index} cites no represented event`);

  const rawScope = input.scope && typeof input.scope === 'object'
    ? input.scope as Record<string, unknown>
    : {};
  const scopeStrings = (key: 'action_types' | 'topics' | 'product_handles'): string[] | undefined => {
    if (!Array.isArray(rawScope[key])) return undefined;
    const items = [...new Set(rawScope[key].filter((item): item is string => typeof item === 'string' && Boolean(item.trim())))]
      .map((item) => item.trim().toLowerCase().slice(0, 80))
      .slice(0, 16);
    return items.length ? items : undefined;
  };
  const scopeValue = (key: 'intent' | 'category' | 'language'): string | undefined => (
    typeof rawScope[key] === 'string' && rawScope[key].trim()
      ? rawScope[key].trim().toLowerCase().slice(0, 80)
      : undefined
  );
  const validForDays = Number(input.valid_for_days);

  return {
    memory_key: memoryKey,
    kind: kind as LearningMemoryKind,
    statement,
    scope: compactScope({
      intent: scopeValue('intent'),
      category: scopeValue('category'),
      language: scopeValue('language'),
      action_types: scopeStrings('action_types'),
      topics: scopeStrings('topics'),
      product_handles: scopeStrings('product_handles'),
    }),
    stance,
    confidence,
    time_sensitive: timeSensitive,
    ...(Number.isFinite(validForDays) ? { valid_for_days: validForDays } : {}),
    source_event_ids: sourceIds,
    ...(typeof input.rationale === 'string' ? { rationale: redactLearningText(input.rationale, 500) } : {}),
  };
}
