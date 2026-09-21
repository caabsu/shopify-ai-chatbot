import { supabase } from '../config/supabase.js';
import type { SupportModelGeneration } from './support-model-tool.service.js';
import { normalizedGenerationRunTimestamps } from './ai-generation-ledger-policy.js';

export type AiGenerationRunStatus =
  | 'started'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'timeout';

export interface AiGenerationTokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  /**
   * A detail of output usage for providers that expose it; it is not added to
   * totalTokens because most APIs already include reasoning in output tokens.
   */
  reasoningTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  totalTokens?: number;
}

export interface AiGenerationLineage {
  promptVersion?: string;
  /** A one-way prompt/template hash. Do not pass prompt text. */
  promptFingerprint?: string;
  routerVersion?: string;
  routerDecision?: Record<string, unknown>;
  calibrationVersion?: string;
  calibrationScope?: Record<string, unknown>;
}

export interface RecordAiGenerationRunInput {
  purpose: string;
  brandId?: string;
  ticketId?: string;
  planId?: string;
  accessProvider: string;
  actualProvider?: string;
  requestedModel: string;
  actualModel?: string;
  modelTier: string;
  thinkingMode: string;
  lineage?: AiGenerationLineage;
  status: AiGenerationRunStatus;
  attempt?: number;
  requestId?: string;
  responseId?: string;
  usage?: AiGenerationTokenUsage;
  latencyMs?: number;
  costUsd?: number;
  errorCode?: string;
  /**
   * Non-sensitive provider diagnostics only. Prompt and response bodies must
   * never be stored in this ledger.
   */
  metadata?: Record<string, unknown>;
  startedAt?: string | Date;
  finishedAt?: string | Date;
}

interface SupabaseLikeError {
  code?: string;
  message?: string;
  details?: string;
}

let warnedAboutMissingMigration = false;

function finiteNonNegative(value: number | undefined): number | null {
  return value !== undefined && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function nonNegativeInteger(value: number | undefined): number | null {
  const normalized = finiteNonNegative(value);
  return normalized === null ? null : Math.trunc(normalized);
}

function isMissingLedgerMigration(error: SupabaseLikeError): boolean {
  if (error.code === '42P01' || error.code === 'PGRST205') return true;
  const text = `${error.message ?? ''} ${error.details ?? ''}`.toLowerCase();
  return (
    text.includes('ai_generation_runs')
    && (
      text.includes('does not exist')
      || text.includes('not find')
      || text.includes('schema cache')
      || text.includes('undefined table')
    )
  );
}

/**
 * Appends one provider-attempt observation and returns its UUID.
 *
 * Recording is deliberately best-effort: observability must never make a
 * customer-support generation fail. A missing migration is warned about once
 * per process while subsequent calls continue probing, so recording starts
 * automatically after migration 017 is applied.
 */
export async function recordAiGenerationRun(
  input: RecordAiGenerationRunInput,
): Promise<string | null> {
  const usage = input.usage;
  const inferredTotal = usage?.totalTokens
    ?? (
      usage?.inputTokens !== undefined || usage?.outputTokens !== undefined
        ? (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0)
        : undefined
    );
  const timestamps = normalizedGenerationRunTimestamps({
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    latencyMs: input.latencyMs,
  });

  const row = {
    purpose: input.purpose,
    brand_id: input.brandId ?? null,
    ticket_id: input.ticketId ?? null,
    plan_id: input.planId ?? null,
    access_provider: input.accessProvider,
    actual_provider: input.actualProvider ?? null,
    requested_model: input.requestedModel,
    actual_model: input.actualModel ?? null,
    model_tier: input.modelTier,
    thinking_mode: input.thinkingMode,
    prompt_version: input.lineage?.promptVersion ?? null,
    prompt_fingerprint: input.lineage?.promptFingerprint ?? null,
    router_version: input.lineage?.routerVersion ?? null,
    router_decision: input.lineage?.routerDecision ?? {},
    calibration_version: input.lineage?.calibrationVersion ?? null,
    calibration_scope: input.lineage?.calibrationScope ?? {},
    status: input.status,
    attempt: Math.max(1, Math.trunc(input.attempt ?? 1)),
    request_id: input.requestId ?? null,
    response_id: input.responseId ?? null,
    input_tokens: nonNegativeInteger(usage?.inputTokens),
    output_tokens: nonNegativeInteger(usage?.outputTokens),
    reasoning_tokens: nonNegativeInteger(usage?.reasoningTokens),
    cache_read_tokens: nonNegativeInteger(usage?.cacheReadTokens),
    cache_write_tokens: nonNegativeInteger(usage?.cacheWriteTokens),
    total_tokens: nonNegativeInteger(inferredTotal),
    latency_ms: nonNegativeInteger(input.latencyMs),
    cost_usd: finiteNonNegative(input.costUsd),
    error_code: input.errorCode ?? null,
    metadata: input.metadata ?? {},
    started_at: timestamps.startedAt,
    finished_at: timestamps.finishedAt,
  };

  try {
    const { data, error } = await supabase
      .from('ai_generation_runs')
      .insert(row)
      .select('id')
      .single();

    if (error) {
      if (isMissingLedgerMigration(error)) {
        if (!warnedAboutMissingMigration) {
          warnedAboutMissingMigration = true;
          console.warn(
            '[ai-generation-ledger] Migration 017 is not applied; generation observability is temporarily disabled.',
          );
        }
        return null;
      }

      console.error('[ai-generation-ledger] Failed to record generation run', {
        purpose: input.purpose,
        status: input.status,
        code: error.code,
      });
      return null;
    }

    return typeof data?.id === 'string' ? data.id : null;
  } catch (error) {
    const candidate = error as SupabaseLikeError;
    if (isMissingLedgerMigration(candidate)) {
      if (!warnedAboutMissingMigration) {
        warnedAboutMissingMigration = true;
        console.warn(
          '[ai-generation-ledger] Migration 017 is not applied; generation observability is temporarily disabled.',
        );
      }
      return null;
    }

    console.error('[ai-generation-ledger] Failed to record generation run', {
      purpose: input.purpose,
      status: input.status,
      code: candidate.code,
    });
    return null;
  }
}

/** Convenience mapper for the normalized support-model boundary. */
export async function recordSupportGenerationRun(input: {
  purpose: string;
  generation: SupportModelGeneration;
  brandId?: string;
  ticketId?: string;
  planId?: string;
  promptVersion?: string;
  routerVersion?: string;
  routerDecision?: Record<string, unknown>;
  calibrationVersion?: string;
  calibrationScope?: Record<string, unknown>;
  status?: AiGenerationRunStatus;
  attempt?: number;
  errorCode?: string;
  metadata?: Record<string, unknown>;
}): Promise<string | null> {
  return recordAiGenerationRun({
    purpose: input.purpose,
    brandId: input.brandId,
    ticketId: input.ticketId,
    planId: input.planId,
    accessProvider: input.generation.access_provider,
    actualProvider: input.generation.provider,
    requestedModel: input.generation.requested_model,
    actualModel: input.generation.model,
    modelTier: input.generation.tier,
    thinkingMode: input.generation.thinking,
    lineage: {
      promptVersion: input.promptVersion,
      routerVersion: input.routerVersion,
      routerDecision: input.routerDecision,
      calibrationVersion: input.calibrationVersion,
      calibrationScope: input.calibrationScope,
    },
    status: input.status ?? 'succeeded',
    attempt: input.attempt,
    requestId: input.generation.request_id,
    responseId: input.generation.response_id,
    usage: {
      inputTokens: input.generation.usage.inputTokens,
      outputTokens: input.generation.usage.outputTokens,
      reasoningTokens: input.generation.usage.reasoningTokens,
      cacheReadTokens: input.generation.usage.cachedInputTokens,
      totalTokens: input.generation.usage.totalTokens,
    },
    latencyMs: input.generation.latency_ms,
    costUsd: input.generation.cost_usd,
    errorCode: input.errorCode,
    metadata: input.metadata,
    finishedAt: new Date(),
  });
}
