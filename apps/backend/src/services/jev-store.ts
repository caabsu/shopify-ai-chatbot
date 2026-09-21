import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupportAi, getJevConfig, ticketAiStore, type AiRun, type AiStore } from './support-ai.js';

export function jevEnabledForBrand(brandId: string | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  const allowed = (env.JEV_BRAND_IDS ?? '').split(',').map(id => id.trim()).filter(Boolean);
  return Boolean(brandId && allowed.includes(brandId) && getJevConfig(env).mode !== 'off');
}

/** Persist judgments with their ticket; append only provider telemetry to the
 * existing generation ledger. Cache hits never create another billed run. */
export function scopedJev(db: Pick<SupabaseClient, 'from'>, brandId: string, ticketId?: string) {
  const runs = new Map<string, AiRun>();
  const base: AiStore = ticketId ? ticketAiStore(db, ticketId, brandId) : {
    async find(hash) { return [...runs.values()].find(run => run.request_hash === hash && run.status !== 'running') ?? null; },
    async save(run) { runs.set(run.id, run); },
  };
  const store: AiStore = {
    find: hash => base.find(hash),
    async save(run) {
      await base.save(run);
      if (run.status === 'running' || !run.input || !run.model.startsWith('jev-')) return;
      const { error } = await db.from('ai_generation_runs').insert({
        id: run.id, purpose: `jev_${run.stage}`, brand_id: brandId,
        ticket_id: ticketId ?? null, access_provider: 'typesafe', actual_provider: 'typesafe',
        requested_model: run.model, actual_model: run.model, model_tier: 'evaluator',
        thinking_mode: 'disabled', prompt_version: run.version, prompt_fingerprint: run.request_hash,
        status: run.status === 'completed' ? 'succeeded' : 'failed',
        input_tokens: run.usage?.input_tokens ?? null, output_tokens: run.usage?.output_tokens ?? null,
        cost_usd: run.usage?.estimated_cost_usd ?? null, latency_ms: run.latency_ms,
        started_at: run.created_at, finished_at: new Date().toISOString(),
        metadata: { cost_basis: 'estimated', ticket_event_id: ticketId ? run.id : null },
      });
      // Same run can be finalized again after an event-write retry.
      if (error && error.code !== '23505') console.warn('[jev] Usage ledger unavailable:', error.code);
    },
  };
  const config = getJevConfig();
  return createSupportAi({ store, scope: `${brandId}:${ticketId ?? 'intake'}`,
    config: { ...config, mode: jevEnabledForBrand(brandId) ? config.mode : 'off' } });
}
