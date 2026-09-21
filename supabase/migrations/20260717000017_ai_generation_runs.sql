-- 017 - Append-only AI generation observability ledger
--
-- One row represents one provider attempt. The ledger stores normalized usage
-- and lineage, but never prompt or response bodies. Reference UUIDs deliberately
-- have no foreign keys so observability history survives operational cleanup.
--
-- Apply before enabling generation recording. Idempotent by design.

BEGIN;

CREATE TABLE IF NOT EXISTS public.ai_generation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose text NOT NULL,
  brand_id uuid,
  ticket_id uuid,
  plan_id uuid,
  access_provider text NOT NULL,
  actual_provider text,
  requested_model text NOT NULL,
  actual_model text,
  model_tier text NOT NULL,
  thinking_mode text NOT NULL,
  prompt_version text,
  prompt_fingerprint text,
  router_version text,
  router_decision jsonb NOT NULL DEFAULT '{}'::jsonb,
  calibration_version text,
  calibration_scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL,
  attempt integer NOT NULL DEFAULT 1,
  request_id text,
  response_id text,
  input_tokens bigint,
  output_tokens bigint,
  reasoning_tokens bigint,
  cache_read_tokens bigint,
  cache_write_tokens bigint,
  total_tokens bigint,
  latency_ms integer,
  cost_usd numeric(16, 10),
  error_code text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_generation_runs_purpose_check
    CHECK (length(btrim(purpose)) BETWEEN 1 AND 100),
  CONSTRAINT ai_generation_runs_provider_check
    CHECK (
      length(btrim(access_provider)) BETWEEN 1 AND 100
      AND (actual_provider IS NULL OR length(btrim(actual_provider)) BETWEEN 1 AND 100)
    ),
  CONSTRAINT ai_generation_runs_model_check
    CHECK (
      length(btrim(requested_model)) BETWEEN 1 AND 200
      AND (actual_model IS NULL OR length(btrim(actual_model)) BETWEEN 1 AND 200)
      AND length(btrim(model_tier)) BETWEEN 1 AND 50
      AND length(btrim(thinking_mode)) BETWEEN 1 AND 50
    ),
  CONSTRAINT ai_generation_runs_status_check
    CHECK (status IN ('started', 'succeeded', 'failed', 'cancelled', 'timeout')),
  CONSTRAINT ai_generation_runs_attempt_check
    CHECK (attempt >= 1),
  CONSTRAINT ai_generation_runs_usage_check
    CHECK (
      (input_tokens IS NULL OR input_tokens >= 0)
      AND (output_tokens IS NULL OR output_tokens >= 0)
      AND (reasoning_tokens IS NULL OR reasoning_tokens >= 0)
      AND (cache_read_tokens IS NULL OR cache_read_tokens >= 0)
      AND (cache_write_tokens IS NULL OR cache_write_tokens >= 0)
      AND (total_tokens IS NULL OR total_tokens >= 0)
      AND (latency_ms IS NULL OR latency_ms >= 0)
      AND (cost_usd IS NULL OR cost_usd >= 0)
    ),
  CONSTRAINT ai_generation_runs_json_check
    CHECK (
      jsonb_typeof(router_decision) = 'object'
      AND jsonb_typeof(calibration_scope) = 'object'
      AND jsonb_typeof(metadata) = 'object'
    ),
  CONSTRAINT ai_generation_runs_time_check
    CHECK (finished_at IS NULL OR finished_at >= started_at)
);

CREATE INDEX IF NOT EXISTS ai_generation_runs_created_idx
  ON public.ai_generation_runs (created_at DESC);
CREATE INDEX IF NOT EXISTS ai_generation_runs_purpose_created_idx
  ON public.ai_generation_runs (purpose, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_generation_runs_brand_created_idx
  ON public.ai_generation_runs (brand_id, created_at DESC)
  WHERE brand_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ai_generation_runs_ticket_created_idx
  ON public.ai_generation_runs (ticket_id, created_at DESC)
  WHERE ticket_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ai_generation_runs_plan_created_idx
  ON public.ai_generation_runs (plan_id, created_at DESC)
  WHERE plan_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ai_generation_runs_model_created_idx
  ON public.ai_generation_runs (requested_model, actual_provider, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_generation_runs_failures_idx
  ON public.ai_generation_runs (status, created_at DESC)
  WHERE status IN ('failed', 'cancelled', 'timeout');
CREATE INDEX IF NOT EXISTS ai_generation_runs_request_idx
  ON public.ai_generation_runs (request_id, attempt)
  WHERE request_id IS NOT NULL;

ALTER TABLE public.ai_generation_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role reads AI generation runs"
  ON public.ai_generation_runs;
DROP POLICY IF EXISTS "Service role inserts AI generation runs"
  ON public.ai_generation_runs;
CREATE POLICY "Service role reads AI generation runs"
  ON public.ai_generation_runs
  FOR SELECT TO service_role
  USING (true);
CREATE POLICY "Service role inserts AI generation runs"
  ON public.ai_generation_runs
  FOR INSERT TO service_role
  WITH CHECK (true);

REVOKE ALL ON public.ai_generation_runs
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.ai_generation_runs TO service_role;

CREATE OR REPLACE FUNCTION public.guard_ai_generation_runs_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'ai_generation_runs is append-only';
END
$$;

REVOKE ALL ON FUNCTION public.guard_ai_generation_runs_append_only() FROM PUBLIC;

DROP TRIGGER IF EXISTS ai_generation_runs_append_only_guard
  ON public.ai_generation_runs;
CREATE TRIGGER ai_generation_runs_append_only_guard
  BEFORE UPDATE OR DELETE ON public.ai_generation_runs
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_ai_generation_runs_append_only();

COMMIT;
