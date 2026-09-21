-- 012 — Autopilot learning loop v2
--
-- Replaces the single mutable `autopilot_learned_lessons` support_fact with:
--   1. immutable, idempotent review/execution episodes (fast path);
--   2. scoped, expiring, confidence-scored semantic memories (slow path);
--   3. evidence links and durable multi-worker claims;
--   4. stable plan identity and provenance on ticket_action_plans.
--
-- Apply before deploying the v2 backend/admin code. Idempotent by design.

BEGIN;

-- ── Canonical plan ledger ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ticket_action_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'proposed',
  trigger text NOT NULL,
  analysis jsonb NOT NULL DEFAULT '{}'::jsonb,
  actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  overall_confidence real,
  proposed_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  decided_by text,
  executed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ticket_action_plans ADD COLUMN IF NOT EXISTS parent_plan_id uuid REFERENCES public.ticket_action_plans(id) ON DELETE SET NULL;
-- Add revision without a default first. 011 could already contain several rows
-- for one ticket; assigning every legacy row revision=0 before the unique index
-- is therefore unsafe. The deterministic backfill below is intentionally run
-- before the NOT NULL/check/unique constraints.
ALTER TABLE public.ticket_action_plans ADD COLUMN IF NOT EXISTS revision integer;
ALTER TABLE public.ticket_action_plans ADD COLUMN IF NOT EXISTS planner_version text;
ALTER TABLE public.ticket_action_plans ADD COLUMN IF NOT EXISTS prompt_version text;
ALTER TABLE public.ticket_action_plans ADD COLUMN IF NOT EXISTS context_fingerprint text;
ALTER TABLE public.ticket_action_plans ADD COLUMN IF NOT EXISTS context_version bigint;
ALTER TABLE public.ticket_action_plans ADD COLUMN IF NOT EXISTS learning_context jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.ticket_action_plans ADD COLUMN IF NOT EXISTS raw_overall_confidence real;
ALTER TABLE public.ticket_action_plans ADD COLUMN IF NOT EXISTS decision_context_version bigint;
ALTER TABLE public.ticket_action_plans ADD COLUMN IF NOT EXISTS execution_context_version bigint;
ALTER TABLE public.ticket_action_plans ADD COLUMN IF NOT EXISTS evidence jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS context_version bigint NOT NULL DEFAULT 0;

-- Repair only legacy/invalid revision sets from stable chronology. Valid
-- revisions are never renumbered on rerun because learning events reference
-- them immutably. Dropping the index makes a partially-applied 012 recoverable.
DROP INDEX IF EXISTS public.ticket_action_plans_ticket_revision_idx;
WITH tickets_to_repair AS (
  SELECT ticket_id
  FROM public.ticket_action_plans
  GROUP BY ticket_id
  HAVING bool_or(revision IS NULL OR revision < 0)
     OR count(*) <> count(DISTINCT revision)
), ranked_plans AS (
  SELECT plan.id,
         row_number() OVER (
           PARTITION BY plan.ticket_id
           ORDER BY plan.proposed_at ASC NULLS FIRST, plan.created_at ASC NULLS FIRST, plan.id ASC
         ) - 1 AS deterministic_revision
  FROM public.ticket_action_plans plan
  JOIN tickets_to_repair repair ON repair.ticket_id = plan.ticket_id
)
UPDATE public.ticket_action_plans plan
SET revision = ranked.deterministic_revision::integer
FROM ranked_plans ranked
WHERE plan.id = ranked.id
  AND plan.revision IS DISTINCT FROM ranked.deterministic_revision::integer;

UPDATE public.ticket_action_plans plan
SET context_version = ticket.context_version
FROM public.tickets ticket
WHERE ticket.id = plan.ticket_id
  AND plan.context_version IS NULL;

ALTER TABLE public.ticket_action_plans ALTER COLUMN revision SET DEFAULT 0;
ALTER TABLE public.ticket_action_plans ALTER COLUMN revision SET NOT NULL;
ALTER TABLE public.ticket_action_plans ALTER COLUMN context_version SET DEFAULT 0;
ALTER TABLE public.ticket_action_plans ALTER COLUMN context_version SET NOT NULL;

ALTER TABLE public.ticket_action_plans DROP CONSTRAINT IF EXISTS ticket_action_plans_trigger_check;
ALTER TABLE public.ticket_action_plans DROP CONSTRAINT IF EXISTS ticket_action_plans_status_check;
ALTER TABLE public.ticket_action_plans DROP CONSTRAINT IF EXISTS ticket_action_plans_trigger_v2_check;
ALTER TABLE public.ticket_action_plans DROP CONSTRAINT IF EXISTS ticket_action_plans_status_v2_check;
ALTER TABLE public.ticket_action_plans DROP CONSTRAINT IF EXISTS ticket_action_plans_overall_confidence_check;
ALTER TABLE public.ticket_action_plans DROP CONSTRAINT IF EXISTS ticket_action_plans_raw_confidence_check;
ALTER TABLE public.ticket_action_plans DROP CONSTRAINT IF EXISTS ticket_action_plans_revision_check;
ALTER TABLE public.ticket_action_plans DROP CONSTRAINT IF EXISTS ticket_action_plans_context_version_check;
ALTER TABLE public.ticket_action_plans DROP CONSTRAINT IF EXISTS ticket_action_plans_evidence_check;

ALTER TABLE public.ticket_action_plans
  ADD CONSTRAINT ticket_action_plans_trigger_v2_check
  CHECK (trigger IN ('new_ticket','customer_reply','sweep','revision','stale_check'));
ALTER TABLE public.ticket_action_plans
  ADD CONSTRAINT ticket_action_plans_status_v2_check
  CHECK (status IN ('proposed','approved','executing','executed','partially_executed','failed','dismissed','stale','superseded'));
ALTER TABLE public.ticket_action_plans
  ADD CONSTRAINT ticket_action_plans_overall_confidence_check
  CHECK (overall_confidence IS NULL OR overall_confidence BETWEEN 0 AND 1);
ALTER TABLE public.ticket_action_plans
  ADD CONSTRAINT ticket_action_plans_raw_confidence_check
  CHECK (raw_overall_confidence IS NULL OR raw_overall_confidence BETWEEN 0 AND 1);
ALTER TABLE public.ticket_action_plans
  ADD CONSTRAINT ticket_action_plans_revision_check
  CHECK (revision >= 0);
ALTER TABLE public.ticket_action_plans
  ADD CONSTRAINT ticket_action_plans_context_version_check
  CHECK (
    context_version >= 0
    AND (decision_context_version IS NULL OR decision_context_version >= context_version)
    AND (execution_context_version IS NULL OR execution_context_version >= context_version)
  );
ALTER TABLE public.ticket_action_plans
  ADD CONSTRAINT ticket_action_plans_evidence_check CHECK (jsonb_typeof(evidence) = 'object');

CREATE UNIQUE INDEX IF NOT EXISTS ticket_action_plans_ticket_revision_idx
  ON public.ticket_action_plans (ticket_id, revision);
CREATE INDEX IF NOT EXISTS ticket_action_plans_brand_status_proposed_idx
  ON public.ticket_action_plans (brand_id, status, proposed_at DESC);
CREATE INDEX IF NOT EXISTS ticket_action_plans_context_idx
  ON public.ticket_action_plans (ticket_id, context_fingerprint);

ALTER TABLE public.ticket_action_plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role manages ticket action plans" ON public.ticket_action_plans;
CREATE POLICY "Service role manages ticket action plans" ON public.ticket_action_plans
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.ticket_action_plans FROM anon, authenticated;

-- Durable per-action execution receipts. The review transaction claims a
-- plan; each side effect then gets a stable operation key and a before/after
-- receipt. Reservations are fenced by a per-request worker token and kept
-- alive by a short renewable lease. A concurrent retry observes a live lease
-- as in progress; only an expired lease becomes uncertain, because the
-- provider may have committed just before a worker crash.
CREATE TABLE IF NOT EXISTS public.autopilot_action_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES public.ticket_action_plans(id) ON DELETE CASCADE,
  ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  action_id uuid NOT NULL,
  execution_attempt_id uuid NOT NULL,
  action_type text NOT NULL CHECK (length(action_type) BETWEEN 1 AND 80),
  operation_key text NOT NULL CHECK (length(operation_key) BETWEEN 1 AND 240),
  status text NOT NULL DEFAULT 'reserved'
    CHECK (status IN ('reserved','executed','failed','uncertain')),
  context_before bigint NOT NULL CHECK (context_before >= 0),
  expected_context_after bigint NOT NULL CHECK (
    expected_context_after BETWEEN context_before AND context_before + 1
  ),
  context_after bigint CHECK (context_after IS NULL OR context_after >= context_before),
  result text,
  error text,
  provider_reference text,
  worker_token uuid,
  lease_expires_at timestamptz,
  heartbeat_at timestamptz,
  provider_deadline_at timestamptz,
  failure_reconcile_after timestamptz,
  provider_checked_at timestamptz,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT autopilot_action_executions_action_unique
    UNIQUE (plan_id, execution_attempt_id, action_id),
  CONSTRAINT autopilot_action_executions_operation_unique
    UNIQUE (brand_id, operation_key)
);
ALTER TABLE public.autopilot_action_executions ADD COLUMN IF NOT EXISTS worker_token uuid;
ALTER TABLE public.autopilot_action_executions ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz;
ALTER TABLE public.autopilot_action_executions ADD COLUMN IF NOT EXISTS heartbeat_at timestamptz;
ALTER TABLE public.autopilot_action_executions ADD COLUMN IF NOT EXISTS provider_deadline_at timestamptz;
ALTER TABLE public.autopilot_action_executions ADD COLUMN IF NOT EXISTS failure_reconcile_after timestamptz;
ALTER TABLE public.autopilot_action_executions ADD COLUMN IF NOT EXISTS provider_checked_at timestamptz;
ALTER TABLE public.autopilot_action_executions ADD COLUMN IF NOT EXISTS expected_context_after bigint;
UPDATE public.autopilot_action_executions
SET expected_context_after = LEAST(COALESCE(context_after, context_before), context_before + 1)
WHERE expected_context_after IS NULL;
ALTER TABLE public.autopilot_action_executions
  ALTER COLUMN expected_context_after SET NOT NULL;
ALTER TABLE public.autopilot_action_executions
  DROP CONSTRAINT IF EXISTS autopilot_action_executions_expected_context_check;
ALTER TABLE public.autopilot_action_executions
  ADD CONSTRAINT autopilot_action_executions_expected_context_check
  CHECK (expected_context_after BETWEEN context_before AND context_before + 1);
-- Rows created by a pre-lease deployment cannot prove that their worker is
-- still alive. Fail them closed once during upgrade instead of granting a new
-- worker permission to repeat the provider operation.
UPDATE public.autopilot_action_executions
SET status = 'uncertain',
    error = COALESCE(error, 'Reservation predates worker leases; verify the provider outcome before resuming.'),
    completed_at = COALESCE(completed_at, now()),
    updated_at = now()
WHERE status = 'reserved'
  AND (worker_token IS NULL OR lease_expires_at IS NULL);
UPDATE public.autopilot_action_executions
SET failure_reconcile_after = GREATEST(
      COALESCE(lease_expires_at, started_at),
      COALESCE(provider_deadline_at, started_at)
    ) + interval '90 seconds'
WHERE failure_reconcile_after IS NULL;
ALTER TABLE public.autopilot_action_executions
  DROP CONSTRAINT IF EXISTS autopilot_action_executions_live_lease_check;
ALTER TABLE public.autopilot_action_executions
  ADD CONSTRAINT autopilot_action_executions_live_lease_check CHECK (
    status <> 'reserved'
    OR (worker_token IS NOT NULL AND lease_expires_at IS NOT NULL AND heartbeat_at IS NOT NULL)
  );
CREATE INDEX IF NOT EXISTS autopilot_action_executions_attempt_idx
  ON public.autopilot_action_executions (plan_id, execution_attempt_id, started_at);
CREATE INDEX IF NOT EXISTS autopilot_action_executions_ticket_idx
  ON public.autopilot_action_executions (ticket_id, started_at DESC);
CREATE INDEX IF NOT EXISTS autopilot_action_executions_live_lease_idx
  ON public.autopilot_action_executions (lease_expires_at)
  WHERE status = 'reserved';
ALTER TABLE public.autopilot_action_executions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role manages Autopilot action executions" ON public.autopilot_action_executions;
CREATE POLICY "Service role manages Autopilot action executions" ON public.autopilot_action_executions
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.autopilot_action_executions FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.autopilot_action_executions FROM service_role;
GRANT SELECT ON public.autopilot_action_executions TO service_role;

-- Ticket-context concurrency clock. Plans record the version they were
-- drafted from; projection/timestamp-only writes deliberately do not advance
-- it, while customer/agent messages and decision-relevant ticket fields do.
ALTER TABLE public.tickets DROP CONSTRAINT IF EXISTS tickets_context_version_check;
ALTER TABLE public.tickets
  ADD CONSTRAINT tickets_context_version_check CHECK (context_version >= 0);

CREATE OR REPLACE FUNCTION public.bump_ticket_context_version_on_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_meaningful_change boolean;
BEGIN
  v_meaningful_change := ROW(
    NEW.status, NEW.priority, NEW.category, NEW.subject,
    NEW.customer_email, NEW.customer_name, NEW.customer_phone,
    NEW.shopify_customer_id, NEW.tags,
    NEW.conversation_id, NEW.order_id,
    NEW.classification, NEW.classification_confidence
  ) IS DISTINCT FROM ROW(
    OLD.status, OLD.priority, OLD.category, OLD.subject,
    OLD.customer_email, OLD.customer_name, OLD.customer_phone,
    OLD.shopify_customer_id, OLD.tags,
    OLD.conversation_id, OLD.order_id,
    OLD.classification, OLD.classification_confidence
  );
  v_meaningful_change := v_meaningful_change
    OR NEW.metadata->'ai_triage' IS DISTINCT FROM OLD.metadata->'ai_triage';

  IF v_meaningful_change THEN
    NEW.context_version := OLD.context_version + 1;
  ELSIF NEW.context_version IS DISTINCT FROM OLD.context_version THEN
    -- Only the nested ticket_messages trigger may advance the clock directly.
    IF pg_trigger_depth() < 2 OR NEW.context_version <> OLD.context_version + 1 THEN
      RAISE EXCEPTION 'tickets.context_version is database-managed';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tickets_context_version_guard ON public.tickets;
CREATE TRIGGER tickets_context_version_guard
  BEFORE UPDATE ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.bump_ticket_context_version_on_change();

CREATE OR REPLACE FUNCTION public.bump_ticket_context_version_for_message()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_old_relevant boolean := false;
  v_new_relevant boolean := false;
  v_message_changed boolean := false;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    v_old_relevant := COALESCE(OLD.is_internal_note, false) = false
      AND OLD.sender_type IN ('customer', 'agent');
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    v_new_relevant := COALESCE(NEW.is_internal_note, false) = false
      AND NEW.sender_type IN ('customer', 'agent');
  END IF;

  IF TG_OP = 'INSERT' AND v_new_relevant THEN
    UPDATE public.tickets SET context_version = context_version + 1 WHERE id = NEW.ticket_id;
  ELSIF TG_OP = 'DELETE' AND v_old_relevant THEN
    UPDATE public.tickets SET context_version = context_version + 1 WHERE id = OLD.ticket_id;
  ELSIF TG_OP = 'UPDATE' THEN
    v_message_changed := ROW(
      NEW.ticket_id, NEW.sender_type, NEW.content, NEW.content_html,
      NEW.is_internal_note, NEW.attachments
    ) IS DISTINCT FROM ROW(
      OLD.ticket_id, OLD.sender_type, OLD.content, OLD.content_html,
      OLD.is_internal_note, OLD.attachments
    );

    IF v_message_changed AND OLD.ticket_id = NEW.ticket_id
       AND (v_old_relevant OR v_new_relevant) THEN
      UPDATE public.tickets SET context_version = context_version + 1 WHERE id = NEW.ticket_id;
    ELSIF v_message_changed AND OLD.ticket_id IS DISTINCT FROM NEW.ticket_id THEN
      IF v_old_relevant THEN
        UPDATE public.tickets SET context_version = context_version + 1 WHERE id = OLD.ticket_id;
      END IF;
      IF v_new_relevant THEN
        UPDATE public.tickets SET context_version = context_version + 1 WHERE id = NEW.ticket_id;
      END IF;
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS ticket_messages_context_version_bump ON public.ticket_messages;
CREATE TRIGGER ticket_messages_context_version_bump
  AFTER INSERT OR UPDATE OR DELETE ON public.ticket_messages
  FOR EACH ROW EXECUTE FUNCTION public.bump_ticket_context_version_for_message();

-- ── Immutable feedback/learning episodes ────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.autopilot_learning_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ingest_seq bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  ticket_id uuid REFERENCES public.tickets(id) ON DELETE SET NULL,
  plan_id uuid,
  plan_revision integer NOT NULL DEFAULT 0,
  event_type text NOT NULL
    CHECK (event_type IN ('review','execution','manual_draft','delayed_outcome')),
  signal_type text NOT NULL
    CHECK (signal_type IN (
      'human_revision','human_edit','partial_approval','clean_approval',
      'dismissal','execution_failure','delayed_outcome'
    )),
  actor_type text NOT NULL DEFAULT 'agent'
    CHECK (actor_type IN ('agent','admin','system','customer')),
  actor_id text,
  actor_name text,
  scope jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(scope) = 'object'),
  trust_score real NOT NULL CHECK (trust_score BETWEEN 0 AND 1),
  outcome_score real CHECK (outcome_score BETWEEN 0 AND 1),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
  idempotency_key text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  processing_started_at timestamptz,
  processor_id text,
  processed_at timestamptz,
  learner_version text,
  CONSTRAINT autopilot_learning_events_brand_key_unique UNIQUE (brand_id, idempotency_key)
);

ALTER TABLE public.autopilot_learning_events
  ADD COLUMN IF NOT EXISTS ingest_seq bigint GENERATED ALWAYS AS IDENTITY;
ALTER TABLE public.autopilot_learning_events ADD COLUMN IF NOT EXISTS claim_token uuid;
ALTER TABLE public.autopilot_learning_events ADD COLUMN IF NOT EXISTS lease_until timestamptz;
ALTER TABLE public.autopilot_learning_events ADD COLUMN IF NOT EXISTS processing_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE public.autopilot_learning_events ADD COLUMN IF NOT EXISTS last_processing_error text;
ALTER TABLE public.autopilot_learning_events ADD COLUMN IF NOT EXISTS last_processing_error_at timestamptz;
ALTER TABLE public.autopilot_learning_events ADD COLUMN IF NOT EXISTS dead_lettered_at timestamptz;
ALTER TABLE public.autopilot_learning_events ADD COLUMN IF NOT EXISTS dead_letter_reason text;

-- Release any lease shape left by the pre-token worker before enforcing the
-- fenced-lease invariant.
UPDATE public.autopilot_learning_events
SET processing_started_at = NULL, processor_id = NULL, claim_token = NULL, lease_until = NULL
WHERE claim_token IS NULL OR processor_id IS NULL OR lease_until IS NULL
   OR processed_at IS NOT NULL OR dead_lettered_at IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS autopilot_learning_events_ingest_seq_idx
  ON public.autopilot_learning_events (ingest_seq);
ALTER TABLE public.autopilot_learning_events DROP CONSTRAINT IF EXISTS autopilot_learning_events_attempts_check;
ALTER TABLE public.autopilot_learning_events
  ADD CONSTRAINT autopilot_learning_events_attempts_check CHECK (processing_attempts >= 0);
ALTER TABLE public.autopilot_learning_events DROP CONSTRAINT IF EXISTS autopilot_learning_events_lease_shape_check;
ALTER TABLE public.autopilot_learning_events
  ADD CONSTRAINT autopilot_learning_events_lease_shape_check CHECK (
    (claim_token IS NULL AND processor_id IS NULL AND processing_started_at IS NULL AND lease_until IS NULL)
    OR
    (claim_token IS NOT NULL AND processor_id IS NOT NULL AND processing_started_at IS NOT NULL
      AND lease_until IS NOT NULL AND processed_at IS NULL AND dead_lettered_at IS NULL)
  );

DROP INDEX IF EXISTS public.autopilot_learning_events_learning_queue_idx;
CREATE INDEX autopilot_learning_events_learning_queue_idx
  ON public.autopilot_learning_events (brand_id, ingest_seq)
  WHERE processed_at IS NULL AND dead_lettered_at IS NULL;
CREATE INDEX IF NOT EXISTS autopilot_learning_events_ticket_idx
  ON public.autopilot_learning_events (ticket_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS autopilot_learning_events_brand_type_time_idx
  ON public.autopilot_learning_events (brand_id, event_type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS autopilot_learning_events_scope_idx
  ON public.autopilot_learning_events USING gin (scope);
CREATE INDEX IF NOT EXISTS autopilot_learning_events_claim_idx
  ON public.autopilot_learning_events (brand_id, claim_token, processor_id)
  WHERE claim_token IS NOT NULL;

ALTER TABLE public.autopilot_learning_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role manages autopilot learning events" ON public.autopilot_learning_events;
CREATE POLICY "Service role manages autopilot learning events" ON public.autopilot_learning_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.autopilot_learning_events FROM anon, authenticated;
-- Business evidence is insert/read-only to the application role. Lease and
-- checkpoint mutation is available only through fenced SECURITY DEFINER RPCs.
REVOKE UPDATE, DELETE, TRUNCATE ON public.autopilot_learning_events FROM service_role;
GRANT SELECT, INSERT ON public.autopilot_learning_events TO service_role;

-- Business evidence is append-only. The learner may only mutate its processing
-- lease/checkpoint columns.
CREATE OR REPLACE FUNCTION public.guard_autopilot_learning_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'autopilot_learning_events is append-only';
  END IF;
  IF (NEW.id, NEW.ingest_seq, NEW.brand_id, NEW.ticket_id, NEW.plan_id, NEW.plan_revision, NEW.event_type,
      NEW.signal_type, NEW.actor_type, NEW.actor_id, NEW.actor_name, NEW.scope,
      NEW.trust_score, NEW.outcome_score, NEW.payload, NEW.idempotency_key,
      NEW.occurred_at, NEW.recorded_at)
     IS DISTINCT FROM
     (OLD.id, OLD.ingest_seq, OLD.brand_id, OLD.ticket_id, OLD.plan_id, OLD.plan_revision, OLD.event_type,
      OLD.signal_type, OLD.actor_type, OLD.actor_id, OLD.actor_name, OLD.scope,
      OLD.trust_score, OLD.outcome_score, OLD.payload, OLD.idempotency_key,
      OLD.occurred_at, OLD.recorded_at) THEN
    RAISE EXCEPTION 'immutable autopilot learning evidence cannot be changed';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS autopilot_learning_events_guard ON public.autopilot_learning_events;
CREATE TRIGGER autopilot_learning_events_guard
  BEFORE UPDATE OR DELETE ON public.autopilot_learning_events
  FOR EACH ROW EXECUTE FUNCTION public.guard_autopilot_learning_event_mutation();

-- Manual ticket-composer drafts use the same feedback loop. The client carries
-- only this opaque generation ID; original text and learning lineage are loaded
-- server-side when the final reply is sent.
CREATE TABLE IF NOT EXISTS public.autopilot_draft_generations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  context_version bigint CHECK (context_version >= 0),
  created_by text,
  model text NOT NULL,
  prompt_version text NOT NULL,
  original_text text NOT NULL,
  scope jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(scope) = 'object'),
  memory_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  episode_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  raw_confidence real CHECK (raw_confidence BETWEEN 0 AND 1),
  evidence_coverage real CHECK (evidence_coverage BETWEEN 0 AND 1),
  uncertainties text[] NOT NULL DEFAULT '{}'::text[],
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(evidence) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  used_at timestamptz,
  final_message_id uuid REFERENCES public.ticket_messages(id) ON DELETE SET NULL
);
ALTER TABLE public.autopilot_draft_generations ADD COLUMN IF NOT EXISTS raw_confidence real;
ALTER TABLE public.autopilot_draft_generations ADD COLUMN IF NOT EXISTS evidence_coverage real;
ALTER TABLE public.autopilot_draft_generations ADD COLUMN IF NOT EXISTS uncertainties text[] NOT NULL DEFAULT '{}'::text[];
ALTER TABLE public.autopilot_draft_generations ADD COLUMN IF NOT EXISTS context_version bigint;
ALTER TABLE public.autopilot_draft_generations ADD COLUMN IF NOT EXISTS evidence jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.autopilot_draft_generations DROP CONSTRAINT IF EXISTS autopilot_draft_generations_evidence_check;
ALTER TABLE public.autopilot_draft_generations
  ADD CONSTRAINT autopilot_draft_generations_evidence_check CHECK (jsonb_typeof(evidence) = 'object');
ALTER TABLE public.autopilot_draft_generations DROP CONSTRAINT IF EXISTS autopilot_draft_generations_raw_confidence_check;
ALTER TABLE public.autopilot_draft_generations DROP CONSTRAINT IF EXISTS autopilot_draft_generations_evidence_coverage_check;
ALTER TABLE public.autopilot_draft_generations DROP CONSTRAINT IF EXISTS autopilot_draft_generations_context_version_check;
ALTER TABLE public.autopilot_draft_generations
  ADD CONSTRAINT autopilot_draft_generations_raw_confidence_check
  CHECK (raw_confidence IS NULL OR raw_confidence BETWEEN 0 AND 1);
ALTER TABLE public.autopilot_draft_generations
  ADD CONSTRAINT autopilot_draft_generations_evidence_coverage_check
  CHECK (evidence_coverage IS NULL OR evidence_coverage BETWEEN 0 AND 1);
ALTER TABLE public.autopilot_draft_generations
  ADD CONSTRAINT autopilot_draft_generations_context_version_check
  CHECK (context_version IS NULL OR context_version >= 0);
CREATE INDEX IF NOT EXISTS autopilot_draft_generations_ticket_idx
  ON public.autopilot_draft_generations (ticket_id, created_at DESC);
WITH duplicate_generation_links AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY final_message_id
           ORDER BY used_at ASC NULLS LAST, created_at ASC, id ASC
         ) AS keep_rank
  FROM public.autopilot_draft_generations
  WHERE final_message_id IS NOT NULL
)
UPDATE public.autopilot_draft_generations generation
SET final_message_id = NULL
FROM duplicate_generation_links duplicate
WHERE generation.id = duplicate.id AND duplicate.keep_rank > 1;
CREATE UNIQUE INDEX IF NOT EXISTS autopilot_draft_generations_final_message_idx
  ON public.autopilot_draft_generations (final_message_id)
  WHERE final_message_id IS NOT NULL;
ALTER TABLE public.autopilot_draft_generations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role manages autopilot draft generations" ON public.autopilot_draft_generations;
CREATE POLICY "Service role manages autopilot draft generations" ON public.autopilot_draft_generations
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.autopilot_draft_generations FROM anon, authenticated;

-- ── Scoped semantic memory + provenance ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.autopilot_learning_memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  memory_key text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('style','procedure','fact','anti_pattern')),
  statement text NOT NULL CHECK (length(statement) BETWEEN 1 AND 1200),
  scope jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(scope) = 'object'),
  status text NOT NULL DEFAULT 'candidate'
    CHECK (status IN ('candidate','active','disputed','quarantined','expired','superseded')),
  confidence_score real NOT NULL DEFAULT 0.5 CHECK (confidence_score BETWEEN 0 AND 1),
  trust_score real NOT NULL DEFAULT 0.5 CHECK (trust_score BETWEEN 0 AND 1),
  evidence_count integer NOT NULL DEFAULT 0 CHECK (evidence_count >= 0),
  positive_evidence_count integer NOT NULL DEFAULT 0 CHECK (positive_evidence_count >= 0),
  contradiction_count integer NOT NULL DEFAULT 0 CHECK (contradiction_count >= 0),
  human_revision_count integer NOT NULL DEFAULT 0 CHECK (human_revision_count >= 0),
  positive_mass real NOT NULL DEFAULT 0 CHECK (positive_mass >= 0),
  negative_mass real NOT NULL DEFAULT 0 CHECK (negative_mass >= 0),
  time_sensitive boolean NOT NULL DEFAULT false,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz,
  last_supported_at timestamptz,
  statement_hash text,
  learner_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT autopilot_learning_memories_brand_key_unique UNIQUE (brand_id, memory_key),
  CONSTRAINT autopilot_learning_memories_validity_check CHECK (valid_until IS NULL OR valid_until > valid_from)
);

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.autopilot_scope_hash(p_scope jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, extensions
AS $$
  SELECT encode(digest(COALESCE(p_scope, '{}'::jsonb)::text, 'sha256'), 'hex')
$$;

CREATE OR REPLACE FUNCTION public.autopilot_statement_hash(p_statement text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, extensions
AS $$
  SELECT encode(digest(
    lower(regexp_replace(trim(COALESCE(p_statement, '')), '\s+', ' ', 'g')),
    'sha256'
  ), 'hex')
$$;

ALTER TABLE public.autopilot_learning_memories ADD COLUMN IF NOT EXISTS scope_hash text;
ALTER TABLE public.autopilot_learning_memories ADD COLUMN IF NOT EXISTS statement_hash text;
ALTER TABLE public.autopilot_learning_memories ADD COLUMN IF NOT EXISTS last_supported_at timestamptz;
UPDATE public.autopilot_learning_memories
SET scope_hash = public.autopilot_scope_hash(scope),
    statement_hash = public.autopilot_statement_hash(statement)
WHERE scope_hash IS DISTINCT FROM public.autopilot_scope_hash(scope)
   OR statement_hash IS NULL;

CREATE OR REPLACE FUNCTION public.set_autopilot_memory_scope_hash()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
BEGIN
  NEW.scope_hash := public.autopilot_scope_hash(NEW.scope);
  NEW.statement_hash := public.autopilot_statement_hash(NEW.statement);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS autopilot_learning_memories_scope_hash ON public.autopilot_learning_memories;
CREATE TRIGGER autopilot_learning_memories_scope_hash
  BEFORE INSERT OR UPDATE OF scope, statement ON public.autopilot_learning_memories
  FOR EACH ROW EXECUTE FUNCTION public.set_autopilot_memory_scope_hash();

ALTER TABLE public.autopilot_learning_memories ALTER COLUMN scope_hash SET NOT NULL;
ALTER TABLE public.autopilot_learning_memories ALTER COLUMN statement_hash SET NOT NULL;
ALTER TABLE public.autopilot_learning_memories DROP CONSTRAINT IF EXISTS autopilot_learning_memories_brand_key_unique;
ALTER TABLE public.autopilot_learning_memories DROP CONSTRAINT IF EXISTS autopilot_learning_memories_brand_key_scope_unique;
ALTER TABLE public.autopilot_learning_memories DROP CONSTRAINT IF EXISTS autopilot_learning_memories_identity_unique;
ALTER TABLE public.autopilot_learning_memories DROP CONSTRAINT IF EXISTS autopilot_learning_memories_scope_hash_check;
ALTER TABLE public.autopilot_learning_memories
  ADD CONSTRAINT autopilot_learning_memories_identity_unique
  UNIQUE (brand_id, memory_key, scope_hash, kind, statement_hash);
ALTER TABLE public.autopilot_learning_memories
  ADD CONSTRAINT autopilot_learning_memories_scope_hash_check CHECK (length(scope_hash) = 64);
ALTER TABLE public.autopilot_learning_memories DROP CONSTRAINT IF EXISTS autopilot_learning_memories_statement_hash_check;
ALTER TABLE public.autopilot_learning_memories
  ADD CONSTRAINT autopilot_learning_memories_statement_hash_check CHECK (length(statement_hash) = 64);

CREATE INDEX IF NOT EXISTS autopilot_learning_memories_retrieval_idx
  ON public.autopilot_learning_memories (brand_id, status, confidence_score DESC, updated_at DESC);
CREATE INDEX IF NOT EXISTS autopilot_learning_memories_freshness_idx
  ON public.autopilot_learning_memories (brand_id, status, last_supported_at DESC);
CREATE INDEX IF NOT EXISTS autopilot_learning_memories_scope_idx
  ON public.autopilot_learning_memories USING gin (scope);
CREATE INDEX IF NOT EXISTS autopilot_learning_memories_search_idx
  ON public.autopilot_learning_memories
  USING gin (to_tsvector('english', coalesce(statement, '')));

CREATE TABLE IF NOT EXISTS public.autopilot_learning_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_id uuid NOT NULL REFERENCES public.autopilot_learning_memories(id) ON DELETE RESTRICT,
  event_id uuid NOT NULL REFERENCES public.autopilot_learning_events(id) ON DELETE RESTRICT,
  stance text NOT NULL CHECK (stance IN ('support','contradict')),
  source_trust real NOT NULL CHECK (source_trust BETWEEN 0 AND 1),
  extraction_confidence real NOT NULL CHECK (extraction_confidence BETWEEN 0 AND 1),
  evidence_weight real NOT NULL CHECK (evidence_weight BETWEEN 0 AND 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT autopilot_learning_evidence_unique UNIQUE (memory_id, event_id)
);

ALTER TABLE public.autopilot_learning_evidence DROP CONSTRAINT IF EXISTS autopilot_learning_evidence_unique;
ALTER TABLE public.autopilot_learning_evidence DROP CONSTRAINT IF EXISTS autopilot_learning_evidence_memory_id_fkey;
ALTER TABLE public.autopilot_learning_evidence DROP CONSTRAINT IF EXISTS autopilot_learning_evidence_event_id_fkey;

-- If a partially deployed build recorded both stances for the same source,
-- retain exactly one. Contradiction wins deterministically (fail-safe), then
-- the earliest immutable evidence row breaks ties.
WITH ranked_evidence AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY memory_id, event_id
           ORDER BY CASE stance WHEN 'contradict' THEN 0 ELSE 1 END,
                    created_at ASC, id ASC
         ) AS keep_rank
  FROM public.autopilot_learning_evidence
)
DELETE FROM public.autopilot_learning_evidence evidence
USING ranked_evidence ranked
WHERE evidence.id = ranked.id AND ranked.keep_rank > 1;

ALTER TABLE public.autopilot_learning_evidence
  ADD CONSTRAINT autopilot_learning_evidence_memory_id_fkey
  FOREIGN KEY (memory_id) REFERENCES public.autopilot_learning_memories(id) ON DELETE RESTRICT;
ALTER TABLE public.autopilot_learning_evidence
  ADD CONSTRAINT autopilot_learning_evidence_event_id_fkey
  FOREIGN KEY (event_id) REFERENCES public.autopilot_learning_events(id) ON DELETE RESTRICT;
ALTER TABLE public.autopilot_learning_evidence
  ADD CONSTRAINT autopilot_learning_evidence_unique UNIQUE (memory_id, event_id);

WITH evidence_stats AS (
  SELECT memory.id,
         COALESCE(sum(CASE WHEN evidence.stance = 'support' THEN evidence.evidence_weight ELSE 0 END), 0)::real AS positive_mass,
         COALESCE(sum(CASE WHEN evidence.stance = 'contradict' THEN evidence.evidence_weight ELSE 0 END), 0)::real AS negative_mass,
         count(evidence.id)::integer AS evidence_count,
         count(evidence.id) FILTER (WHERE evidence.stance = 'support')::integer AS positive_count,
         count(evidence.id) FILTER (WHERE evidence.stance = 'contradict')::integer AS contradiction_count,
         count(evidence.id) FILTER (
           WHERE evidence.stance = 'support' AND event.signal_type IN ('human_revision', 'human_edit')
         )::integer AS revision_count,
         COALESCE(avg(evidence.source_trust), 0.5)::real AS average_trust,
         max(event.occurred_at) FILTER (WHERE evidence.stance = 'support') AS last_supported_at
  FROM public.autopilot_learning_memories memory
  LEFT JOIN public.autopilot_learning_evidence evidence ON evidence.memory_id = memory.id
  LEFT JOIN public.autopilot_learning_events event ON event.id = evidence.event_id
  GROUP BY memory.id
), scored AS (
  SELECT stats.*,
         ((0.25 + stats.positive_mass) / (0.5 + stats.positive_mass + stats.negative_mass))::real AS confidence
  FROM evidence_stats stats
)
UPDATE public.autopilot_learning_memories memory
SET positive_mass = scored.positive_mass,
    negative_mass = scored.negative_mass,
    evidence_count = scored.evidence_count,
    positive_evidence_count = scored.positive_count,
    contradiction_count = scored.contradiction_count,
    human_revision_count = scored.revision_count,
    trust_score = scored.average_trust,
    last_supported_at = scored.last_supported_at,
    confidence_score = scored.confidence,
    status = CASE
      WHEN memory.status IN ('quarantined', 'superseded') THEN memory.status
      WHEN memory.valid_until IS NOT NULL AND memory.valid_until <= now() THEN 'expired'
      WHEN scored.negative_mass >= GREATEST(0.35, scored.positive_mass * 0.75) THEN 'disputed'
      WHEN (scored.revision_count > 0 OR scored.positive_count >= 2) AND scored.confidence >= 0.60 THEN 'active'
      ELSE 'candidate'
    END,
    updated_at = now()
FROM scored
WHERE memory.id = scored.id;

CREATE TABLE IF NOT EXISTS public.autopilot_run_memory_attributions (
  plan_id uuid NOT NULL,
  memory_id uuid NOT NULL REFERENCES public.autopilot_learning_memories(id) ON DELETE RESTRICT,
  rank integer NOT NULL CHECK (rank > 0),
  retrieval_score real NOT NULL CHECK (retrieval_score BETWEEN 0 AND 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (plan_id, memory_id)
);

ALTER TABLE public.autopilot_learning_memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.autopilot_learning_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.autopilot_run_memory_attributions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages autopilot memories" ON public.autopilot_learning_memories;
CREATE POLICY "Service role manages autopilot memories" ON public.autopilot_learning_memories
  FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Service role manages autopilot evidence" ON public.autopilot_learning_evidence;
CREATE POLICY "Service role manages autopilot evidence" ON public.autopilot_learning_evidence
  FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Service role manages autopilot attributions" ON public.autopilot_run_memory_attributions;
CREATE POLICY "Service role manages autopilot attributions" ON public.autopilot_run_memory_attributions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE ALL ON public.autopilot_learning_memories FROM anon, authenticated;
REVOKE ALL ON public.autopilot_learning_evidence FROM anon, authenticated;
REVOKE ALL ON public.autopilot_run_memory_attributions FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.is_canonical_uuid(p_value text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN p_value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN (p_value::uuid)::text = lower(p_value)
    ELSE false
  END
$$;
REVOKE ALL ON FUNCTION public.is_canonical_uuid(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.is_valid_autopilot_actions(p_actions jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
BEGIN
  IF jsonb_typeof(p_actions) <> 'array' OR jsonb_array_length(p_actions) = 0 THEN RETURN false; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_actions) action
    WHERE jsonb_typeof(action) <> 'object'
       OR NOT public.is_canonical_uuid(action->>'id')
       OR length(trim(COALESCE(action->>'type', ''))) = 0
       OR (action ? 'depends_on' AND jsonb_typeof(action->'depends_on') <> 'array')
  ) THEN RETURN false; END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(p_actions))
     <> (SELECT count(DISTINCT action->>'id') FROM jsonb_array_elements(p_actions) action) THEN
    RETURN false;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_actions) action
    CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(action->'depends_on', '[]'::jsonb)) dependency(id)
    WHERE NOT public.is_canonical_uuid(dependency.id)
       OR dependency.id = action->>'id'
       OR NOT EXISTS (
         SELECT 1 FROM jsonb_array_elements(p_actions) candidate
         WHERE candidate->>'id' = dependency.id
       )
  ) THEN RETURN false; END IF;
  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END $$;
REVOKE ALL ON FUNCTION public.is_valid_autopilot_actions(jsonb) FROM PUBLIC;

-- ── Durable worker claim ────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.claim_autopilot_learning_events(uuid, text, integer);

CREATE OR REPLACE FUNCTION public.claim_autopilot_learning_events(
  p_brand_id uuid,
  p_worker_id text,
  p_claim_token uuid,
  p_limit integer
)
RETURNS SETOF public.autopilot_learning_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_brand_id IS NULL OR p_claim_token IS NULL OR length(trim(COALESCE(p_worker_id, ''))) = 0 THEN
    RAISE EXCEPTION 'brand, worker, and claim token are required';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_claim_token::text, 0));

  IF EXISTS (
    SELECT 1 FROM public.autopilot_learning_events
    WHERE claim_token = p_claim_token
      AND (brand_id <> p_brand_id OR processor_id IS DISTINCT FROM p_worker_id)
  ) THEN
    RAISE EXCEPTION 'claim token is already owned by another worker or brand';
  END IF;
  -- Network-safe claim replay: renew and return the original batch instead of
  -- silently attaching a second batch to the same token.
  IF EXISTS (
    SELECT 1 FROM public.autopilot_learning_events
    WHERE brand_id = p_brand_id AND processor_id = p_worker_id
      AND claim_token = p_claim_token AND processed_at IS NULL AND dead_lettered_at IS NULL
  ) THEN
    RETURN QUERY
    WITH renewed AS (
      UPDATE public.autopilot_learning_events event
      SET lease_until = now() + interval '15 minutes'
      WHERE event.brand_id = p_brand_id
        AND event.processor_id = p_worker_id
        AND event.claim_token = p_claim_token
        AND event.processed_at IS NULL
        AND event.dead_lettered_at IS NULL
      RETURNING event.*
    )
    SELECT * FROM renewed ORDER BY ingest_seq ASC;
    RETURN;
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT event.id
    FROM public.autopilot_learning_events event
    WHERE event.brand_id = p_brand_id
      AND event.processed_at IS NULL
      AND event.dead_lettered_at IS NULL
      AND (event.claim_token IS NULL OR event.lease_until IS NULL OR event.lease_until <= now())
      AND (
        event.last_processing_error NOT LIKE 'transient:%'
        OR event.last_processing_error_at IS NULL
        OR event.last_processing_error_at <= now() - interval '5 minutes'
      )
    ORDER BY event.ingest_seq ASC
    FOR UPDATE SKIP LOCKED
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 24), 1), 100)
  ), claimed AS (
    UPDATE public.autopilot_learning_events event
    SET processing_started_at = now(),
        processor_id = p_worker_id,
        claim_token = p_claim_token,
        lease_until = now() + interval '15 minutes',
        processing_attempts = event.processing_attempts + 1
    FROM candidates
    WHERE event.id = candidates.id
    RETURNING event.*
  )
  SELECT * FROM claimed ORDER BY ingest_seq ASC;
END $$;

CREATE OR REPLACE FUNCTION public.heartbeat_autopilot_learning_events(
  p_brand_id uuid,
  p_worker_id text,
  p_claim_token uuid,
  p_event_ids uuid[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_renewed integer;
BEGIN
  IF p_claim_token IS NULL OR COALESCE(cardinality(p_event_ids), 0) = 0 THEN RETURN 0; END IF;

  UPDATE public.autopilot_learning_events event
  SET lease_until = now() + interval '15 minutes'
  WHERE event.brand_id = p_brand_id
    AND event.processor_id = p_worker_id
    AND event.claim_token = p_claim_token
    AND event.processed_at IS NULL
    AND event.dead_lettered_at IS NULL
    AND event.id = ANY(p_event_ids);
  GET DIAGNOSTICS v_renewed = ROW_COUNT;
  RETURN v_renewed;
END $$;

CREATE OR REPLACE FUNCTION public.finalize_autopilot_learning_events(
  p_brand_id uuid,
  p_worker_id text,
  p_claim_token uuid,
  p_processed_ids uuid[],
  p_dead_letters jsonb,
  p_error text,
  p_learner_version text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_processed integer := 0;
  v_dead_lettered integer := 0;
  v_released integer := 0;
  v_dead_ids uuid[] := '{}'::uuid[];
BEGIN
  IF p_claim_token IS NULL OR length(trim(COALESCE(p_worker_id, ''))) = 0 THEN
    RAISE EXCEPTION 'worker and claim token are required';
  END IF;
  IF p_dead_letters IS NOT NULL AND jsonb_typeof(p_dead_letters) <> 'array' THEN
    RAISE EXCEPTION 'dead_letters must be a JSON array';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(p_dead_letters, '[]'::jsonb)) item
    WHERE NOT public.is_canonical_uuid(item->>'id')
       OR length(trim(COALESCE(item->>'error', ''))) = 0
  ) THEN
    RAISE EXCEPTION 'each dead letter requires a canonical UUID id and non-empty error';
  END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(COALESCE(p_dead_letters, '[]'::jsonb)))
     <> (SELECT count(DISTINCT item->>'id') FROM jsonb_array_elements(COALESCE(p_dead_letters, '[]'::jsonb)) item) THEN
    RAISE EXCEPTION 'dead letter ids must be unique';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT (item->>'id')::uuid), '{}'::uuid[])
  INTO v_dead_ids
  FROM jsonb_array_elements(COALESCE(p_dead_letters, '[]'::jsonb)) item;

  IF COALESCE(p_processed_ids, '{}'::uuid[]) && v_dead_ids THEN
    RAISE EXCEPTION 'an event cannot be both processed and dead-lettered';
  END IF;

  -- Fence every explicitly finalized event before mutating any of them. An old
  -- worker whose lease was stolen must fail the whole checkpoint.
  IF EXISTS (
    SELECT 1
    FROM unnest(COALESCE(p_processed_ids, '{}'::uuid[]) || v_dead_ids) requested(id)
    LEFT JOIN public.autopilot_learning_events event
      ON event.id = requested.id
     AND event.brand_id = p_brand_id
     AND event.processor_id = p_worker_id
     AND event.claim_token = p_claim_token
     AND event.processed_at IS NULL
     AND event.dead_lettered_at IS NULL
    WHERE event.id IS NULL
  ) THEN
    RAISE EXCEPTION 'one or more events are no longer owned by this claim';
  END IF;

  UPDATE public.autopilot_learning_events event
  SET processed_at = now(),
      learner_version = p_learner_version,
      processing_started_at = NULL,
      processor_id = NULL,
      claim_token = NULL,
      lease_until = NULL,
      last_processing_error = NULL,
      last_processing_error_at = NULL
  WHERE event.brand_id = p_brand_id
    AND event.processor_id = p_worker_id
    AND event.claim_token = p_claim_token
    AND event.id = ANY(COALESCE(p_processed_ids, '{}'::uuid[]));
  GET DIAGNOSTICS v_processed = ROW_COUNT;

  WITH dead AS (
    SELECT (item->>'id')::uuid AS id, left(item->>'error', 2000) AS error
    FROM jsonb_array_elements(COALESCE(p_dead_letters, '[]'::jsonb)) item
  )
  UPDATE public.autopilot_learning_events event
  SET dead_lettered_at = now(),
      dead_letter_reason = dead.error,
      learner_version = p_learner_version,
      processing_started_at = NULL,
      processor_id = NULL,
      claim_token = NULL,
      lease_until = NULL,
      last_processing_error = dead.error,
      last_processing_error_at = now()
  FROM dead
  WHERE event.id = dead.id
    AND event.brand_id = p_brand_id
    AND event.processor_id = p_worker_id
    AND event.claim_token = p_claim_token;
  GET DIAGNOSTICS v_dead_lettered = ROW_COUNT;

  UPDATE public.autopilot_learning_events event
  SET processing_started_at = NULL,
      processor_id = NULL,
      claim_token = NULL,
      lease_until = NULL,
      last_processing_error = left(p_error, 2000),
      last_processing_error_at = CASE WHEN p_error IS NULL THEN event.last_processing_error_at ELSE now() END
  WHERE event.brand_id = p_brand_id
    AND event.processor_id = p_worker_id
    AND event.claim_token = p_claim_token;
  GET DIAGNOSTICS v_released = ROW_COUNT;

  RETURN jsonb_build_object(
    'processed_count', v_processed,
    'dead_letter_count', v_dead_lettered,
    'released_count', v_released
  );
END $$;

REVOKE ALL ON FUNCTION public.claim_autopilot_learning_events(uuid, text, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_autopilot_learning_events(uuid, text, uuid, integer) TO service_role;
REVOKE ALL ON FUNCTION public.heartbeat_autopilot_learning_events(uuid, text, uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.heartbeat_autopilot_learning_events(uuid, text, uuid, uuid[]) TO service_role;
REVOKE ALL ON FUNCTION public.finalize_autopilot_learning_events(uuid, text, uuid, uuid[], jsonb, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_autopilot_learning_events(uuid, text, uuid, uuid[], jsonb, text, text) TO service_role;

-- Manual replies/status-changing work invalidate a pending plan under a row
-- lock. This prevents the separate ticket composer from leaving stale actions
-- executable in the Autopilot queue.
CREATE OR REPLACE FUNCTION public.invalidate_ticket_autopilot_plan(
  p_ticket_id uuid,
  p_brand_id uuid,
  p_reason text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_metadata jsonb;
  v_plan jsonb;
  v_plan_id text;
  v_history jsonb;
BEGIN
  SELECT COALESCE(metadata, '{}'::jsonb)
  INTO v_metadata
  FROM public.tickets
  WHERE id = p_ticket_id AND brand_id = p_brand_id
  FOR UPDATE;

  IF v_metadata IS NULL THEN RETURN NULL; END IF;
  v_plan := v_metadata->'autopilot';
  IF v_plan IS NULL OR v_plan->>'status' <> 'proposed' THEN RETURN NULL; END IF;

  v_plan_id := COALESCE(v_plan->>'id', v_plan->>'proposed_at', 'legacy');
  v_history := COALESCE(v_metadata->'autopilot_history', '[]'::jsonb)
    || jsonb_build_array(v_plan || jsonb_build_object(
      'status', 'superseded',
      'superseded_reason', left(COALESCE(p_reason, 'manual_change'), 120),
      'superseded_at', now()
    ));

  UPDATE public.tickets
  SET metadata = jsonb_set(v_metadata - 'autopilot', '{autopilot_history}', v_history, true),
      updated_at = now()
  WHERE id = p_ticket_id AND brand_id = p_brand_id;

  IF public.is_canonical_uuid(v_plan->>'id') THEN
    UPDATE public.ticket_action_plans
    SET status = 'superseded', updated_at = now()
    WHERE id = (v_plan->>'id')::uuid AND brand_id = p_brand_id;
  END IF;
  RETURN v_plan_id;
END $$;

REVOKE ALL ON FUNCTION public.invalidate_ticket_autopilot_plan(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.invalidate_ticket_autopilot_plan(uuid, uuid, text) TO service_role;

-- Validate and insert one immutable learning event supplied by an RPC caller.
-- Duplicate idempotency keys are accepted only for identical evidence.
CREATE OR REPLACE FUNCTION public.insert_autopilot_learning_event_json(
  p_event jsonb,
  p_brand_id uuid,
  p_ticket_id uuid,
  p_plan_id uuid,
  p_plan_revision integer,
  p_expected_event_type text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id uuid;
  v_existing public.autopilot_learning_events%ROWTYPE;
  v_inserted_id uuid;
  v_idempotency_key text;
  v_scope jsonb;
  v_payload jsonb;
  v_trust real;
  v_outcome real;
BEGIN
  IF jsonb_typeof(p_event) <> 'object' THEN RAISE EXCEPTION 'learning event must be an object'; END IF;
  IF NOT public.is_canonical_uuid(p_event->>'id') THEN RAISE EXCEPTION 'learning event id must be a canonical UUID'; END IF;
  v_event_id := (p_event->>'id')::uuid;
  IF NOT public.is_canonical_uuid(p_event->>'brand_id') OR (p_event->>'brand_id')::uuid <> p_brand_id THEN
    RAISE EXCEPTION 'learning event brand mismatch';
  END IF;
  IF NOT public.is_canonical_uuid(p_event->>'ticket_id') OR (p_event->>'ticket_id')::uuid <> p_ticket_id THEN
    RAISE EXCEPTION 'learning event ticket mismatch';
  END IF;
  IF p_plan_id IS NULL THEN
    IF NULLIF(p_event->>'plan_id', '') IS NOT NULL THEN RAISE EXCEPTION 'learning event plan must be null'; END IF;
  ELSIF NOT public.is_canonical_uuid(p_event->>'plan_id') OR (p_event->>'plan_id')::uuid <> p_plan_id THEN
    RAISE EXCEPTION 'learning event plan mismatch';
  END IF;
  IF COALESCE((p_event->>'plan_revision')::integer, 0) <> COALESCE(p_plan_revision, 0) THEN
    RAISE EXCEPTION 'learning event revision mismatch';
  END IF;
  IF p_event->>'event_type' IS DISTINCT FROM p_expected_event_type THEN
    RAISE EXCEPTION 'learning event type mismatch';
  END IF;

  v_idempotency_key := trim(COALESCE(p_event->>'idempotency_key', ''));
  IF length(v_idempotency_key) = 0 OR length(v_idempotency_key) > 240 THEN
    RAISE EXCEPTION 'learning event idempotency key is invalid';
  END IF;
  v_scope := COALESCE(p_event->'scope', '{}'::jsonb);
  v_payload := COALESCE(p_event->'payload', '{}'::jsonb);
  IF jsonb_typeof(v_scope) <> 'object' OR jsonb_typeof(v_payload) <> 'object' THEN
    RAISE EXCEPTION 'learning event scope and payload must be objects';
  END IF;
  v_trust := (p_event->>'trust_score')::real;
  v_outcome := NULLIF(p_event->>'outcome_score', '')::real;
  IF v_trust NOT BETWEEN 0 AND 1 OR (v_outcome IS NOT NULL AND v_outcome NOT BETWEEN 0 AND 1) THEN
    RAISE EXCEPTION 'learning event scores are out of range';
  END IF;

  INSERT INTO public.autopilot_learning_events (
    id, brand_id, ticket_id, plan_id, plan_revision, event_type, signal_type,
    actor_type, actor_id, actor_name, scope, trust_score, outcome_score, payload,
    idempotency_key, occurred_at
  ) VALUES (
    v_event_id, p_brand_id, p_ticket_id, p_plan_id, COALESCE(p_plan_revision, 0),
    p_expected_event_type, p_event->>'signal_type', COALESCE(p_event->>'actor_type', 'agent'),
    NULLIF(p_event->>'actor_id', ''), NULLIF(p_event->>'actor_name', ''),
    v_scope, v_trust, v_outcome, v_payload, v_idempotency_key,
    COALESCE(NULLIF(p_event->>'occurred_at', '')::timestamptz, now())
  )
  ON CONFLICT (brand_id, idempotency_key) DO NOTHING
  RETURNING id INTO v_inserted_id;

  IF v_inserted_id IS NOT NULL THEN
    RETURN jsonb_build_object('captured', true, 'event_id', v_inserted_id);
  END IF;

  SELECT * INTO v_existing
  FROM public.autopilot_learning_events
  WHERE brand_id = p_brand_id AND idempotency_key = v_idempotency_key;
  IF v_existing.ticket_id IS DISTINCT FROM p_ticket_id
     OR v_existing.plan_id IS DISTINCT FROM p_plan_id
     OR v_existing.plan_revision IS DISTINCT FROM COALESCE(p_plan_revision, 0)
     OR v_existing.event_type IS DISTINCT FROM p_expected_event_type
     OR v_existing.signal_type IS DISTINCT FROM p_event->>'signal_type'
     OR v_existing.actor_type IS DISTINCT FROM COALESCE(p_event->>'actor_type', 'agent')
     OR v_existing.actor_id IS DISTINCT FROM NULLIF(p_event->>'actor_id', '')
     OR v_existing.actor_name IS DISTINCT FROM NULLIF(p_event->>'actor_name', '')
     OR v_existing.scope IS DISTINCT FROM v_scope
     OR v_existing.trust_score IS DISTINCT FROM v_trust
     OR v_existing.outcome_score IS DISTINCT FROM v_outcome
     OR v_existing.payload IS DISTINCT FROM v_payload THEN
    RAISE EXCEPTION 'learning event idempotency key was reused with different evidence';
  END IF;
  RETURN jsonb_build_object('captured', false, 'replayed', true, 'event_id', v_existing.id);
END $$;
REVOKE ALL ON FUNCTION public.insert_autopilot_learning_event_json(jsonb, uuid, uuid, uuid, integer, text) FROM PUBLIC;

-- Persist the ticket projection, immutable plan ledger, parent supersession,
-- retrieval attributions, and proposal audit as one transaction.
CREATE OR REPLACE FUNCTION public.persist_autopilot_plan(
  p_ticket_id uuid,
  p_brand_id uuid,
  p_expected_updated_at timestamptz,
  p_expected_context_version bigint,
  p_expected_previous_plan_id uuid,
  p_expected_previous_proposed_at timestamptz,
  p_plan jsonb,
  p_ledger jsonb,
  p_attributions jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ticket public.tickets%ROWTYPE;
  v_current jsonb;
  v_metadata jsonb;
  v_history jsonb;
  v_plan_id uuid;
  v_revision integer;
  v_parent_plan_id uuid;
  v_updated_at timestamptz;
  v_context_version bigint;
  v_attr record;
  v_memory_id uuid;
  v_score real;
BEGIN
  SELECT * INTO v_ticket
  FROM public.tickets
  WHERE id = p_ticket_id AND brand_id = p_brand_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ticket not found'; END IF;
  IF jsonb_typeof(p_plan) <> 'object' OR jsonb_typeof(p_ledger) <> 'object' THEN
    RAISE EXCEPTION 'plan and ledger must be objects';
  END IF;
  IF jsonb_typeof(COALESCE(p_attributions, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'attributions must be an array';
  END IF;
  IF NOT public.is_canonical_uuid(p_plan->>'id') THEN RAISE EXCEPTION 'plan id must be a canonical UUID'; END IF;
  v_plan_id := (p_plan->>'id')::uuid;
  IF NOT public.is_canonical_uuid(p_ledger->>'id') OR (p_ledger->>'id')::uuid <> v_plan_id THEN
    RAISE EXCEPTION 'ledger id mismatch';
  END IF;
  IF NOT public.is_canonical_uuid(p_ledger->>'ticket_id') OR (p_ledger->>'ticket_id')::uuid <> p_ticket_id
     OR NOT public.is_canonical_uuid(p_ledger->>'brand_id') OR (p_ledger->>'brand_id')::uuid <> p_brand_id THEN
    RAISE EXCEPTION 'ledger ownership mismatch';
  END IF;
  IF p_plan->>'status' <> 'proposed' OR p_ledger->>'status' <> 'proposed' THEN
    RAISE EXCEPTION 'a new plan must be proposed';
  END IF;
  IF NOT public.is_valid_autopilot_actions(p_plan->'actions')
     OR NOT public.is_valid_autopilot_actions(p_ledger->'actions')
     OR p_plan->'actions' IS DISTINCT FROM p_ledger->'actions'
     OR COALESCE(p_plan->'analysis', '{}'::jsonb) IS DISTINCT FROM COALESCE(p_ledger->'analysis', '{}'::jsonb)
     OR COALESCE(p_plan->'evidence', '{}'::jsonb) IS DISTINCT FROM COALESCE(p_ledger->'evidence', '{}'::jsonb)
     OR p_plan->>'trigger' IS DISTINCT FROM p_ledger->>'trigger'
     OR p_plan->>'context_fingerprint' IS DISTINCT FROM p_ledger->>'context_fingerprint' THEN
    RAISE EXCEPTION 'plan and ledger content mismatch';
  END IF;
  v_revision := COALESCE((p_plan->>'revision')::integer, 0);
  IF v_revision < 0 OR COALESCE((p_ledger->>'revision')::integer, -1) <> v_revision THEN
    RAISE EXCEPTION 'invalid plan revision';
  END IF;
  IF (p_plan->>'context_version')::bigint IS DISTINCT FROM p_expected_context_version
     OR COALESCE((p_ledger->>'context_version')::bigint, -1) <> p_expected_context_version THEN
    RAISE EXCEPTION 'plan context version mismatch';
  END IF;
  IF NULLIF(p_plan->>'parent_plan_id', '') IS NOT NULL THEN
    IF NOT public.is_canonical_uuid(p_plan->>'parent_plan_id') THEN RAISE EXCEPTION 'parent plan id is invalid'; END IF;
    v_parent_plan_id := (p_plan->>'parent_plan_id')::uuid;
  END IF;

  v_metadata := COALESCE(v_ticket.metadata, '{}'::jsonb);
  v_current := v_metadata->'autopilot';

  -- Replay after a successful commit: only an exactly identical projection is
  -- accepted, and no duplicate ledger/event/attribution is written.
  IF v_current IS NOT NULL AND v_current->>'id' = v_plan_id::text THEN
    IF v_current IS DISTINCT FROM p_plan THEN RAISE EXCEPTION 'plan id was reused with different content'; END IF;
    RETURN jsonb_build_object(
      'persisted', true, 'replayed', true, 'plan_id', v_plan_id,
      'updated_at', v_ticket.updated_at, 'context_version', v_ticket.context_version
    );
  END IF;

  IF v_ticket.updated_at IS DISTINCT FROM p_expected_updated_at
     OR v_ticket.context_version IS DISTINCT FROM p_expected_context_version THEN
    RAISE EXCEPTION 'ticket context changed while planning' USING ERRCODE = '40001';
  END IF;

  IF v_current IS NULL THEN
    IF p_expected_previous_plan_id IS NOT NULL OR p_expected_previous_proposed_at IS NOT NULL THEN
      RAISE EXCEPTION 'expected previous plan is missing' USING ERRCODE = '40001';
    END IF;
  ELSIF public.is_canonical_uuid(v_current->>'id') THEN
    IF p_expected_previous_plan_id IS NULL OR (v_current->>'id')::uuid <> p_expected_previous_plan_id THEN
      RAISE EXCEPTION 'previous plan identity changed' USING ERRCODE = '40001';
    END IF;
  ELSE
    IF p_expected_previous_plan_id IS NOT NULL
       OR p_expected_previous_proposed_at IS NULL
       OR NULLIF(v_current->>'proposed_at', '')::timestamptz IS DISTINCT FROM p_expected_previous_proposed_at THEN
      RAISE EXCEPTION 'legacy previous plan identity changed' USING ERRCODE = '40001';
    END IF;
  END IF;

  IF v_parent_plan_id IS DISTINCT FROM p_expected_previous_plan_id
     AND NOT (v_parent_plan_id IS NULL AND p_expected_previous_plan_id IS NULL) THEN
    RAISE EXCEPTION 'parent plan does not match expected previous plan';
  END IF;

  IF v_current IS NOT NULL THEN
    v_history := COALESCE(v_metadata->'autopilot_history', '[]'::jsonb) || jsonb_build_array(v_current);
    IF jsonb_array_length(v_history) > 20 THEN
      SELECT jsonb_agg(item ORDER BY ord) INTO v_history
      FROM jsonb_array_elements(v_history) WITH ORDINALITY expanded(item, ord)
      WHERE ord > jsonb_array_length(v_history) - 20;
    END IF;
    v_metadata := jsonb_set(v_metadata, '{autopilot_history}', v_history, true);
  END IF;
  v_metadata := jsonb_set(
    v_metadata
      - 'autopilot_attempts'
      - 'autopilot_last_attempt_at'
      - 'autopilot_next_attempt_at',
    '{autopilot}', p_plan, true
  );

  IF p_expected_previous_plan_id IS NOT NULL THEN
    UPDATE public.ticket_action_plans
    SET status = 'superseded', updated_at = now()
    WHERE id = p_expected_previous_plan_id
      AND ticket_id = p_ticket_id
      AND brand_id = p_brand_id
      AND status IN ('proposed', 'approved', 'executing');
  END IF;

  INSERT INTO public.ticket_action_plans (
    id, ticket_id, brand_id, parent_plan_id, revision, status, trigger,
    planner_version, prompt_version, context_fingerprint, context_version,
    analysis, actions, evidence, learning_context, overall_confidence,
    raw_overall_confidence, proposed_at, created_at, updated_at
  ) VALUES (
    v_plan_id, p_ticket_id, p_brand_id, v_parent_plan_id, v_revision, 'proposed',
    p_ledger->>'trigger', NULLIF(p_ledger->>'planner_version', ''),
    NULLIF(p_ledger->>'prompt_version', ''), NULLIF(p_ledger->>'context_fingerprint', ''),
    p_expected_context_version, COALESCE(p_ledger->'analysis', '{}'::jsonb),
    COALESCE(p_ledger->'actions', '[]'::jsonb), COALESCE(p_ledger->'evidence', '{}'::jsonb),
    COALESCE(p_ledger->'learning_context', '{}'::jsonb),
    NULLIF(p_ledger->>'overall_confidence', '')::real,
    NULLIF(p_ledger->>'raw_overall_confidence', '')::real,
    COALESCE(NULLIF(p_ledger->>'proposed_at', '')::timestamptz, now()), now(), now()
  );

  FOR v_attr IN
    SELECT item, ordinality::integer AS rank
    FROM jsonb_array_elements(COALESCE(p_attributions, '[]'::jsonb)) WITH ORDINALITY expanded(item, ordinality)
  LOOP
    IF NOT public.is_canonical_uuid(COALESCE(v_attr.item->>'memory_id', v_attr.item->>'id')) THEN
      RAISE EXCEPTION 'attribution memory id is invalid';
    END IF;
    v_memory_id := COALESCE(v_attr.item->>'memory_id', v_attr.item->>'id')::uuid;
    v_score := COALESCE(NULLIF(v_attr.item->>'retrieval_score', '')::real, NULLIF(v_attr.item->>'score', '')::real);
    IF v_score IS NULL OR v_score NOT BETWEEN 0 AND 1
       OR NOT EXISTS (
         SELECT 1 FROM public.autopilot_learning_memories
         WHERE id = v_memory_id AND brand_id = p_brand_id
       ) THEN
      RAISE EXCEPTION 'attribution is invalid or belongs to another brand';
    END IF;
    INSERT INTO public.autopilot_run_memory_attributions(plan_id, memory_id, rank, retrieval_score)
    VALUES (v_plan_id, v_memory_id, v_attr.rank, v_score);
  END LOOP;

  UPDATE public.tickets ticket
  SET metadata = v_metadata, updated_at = now()
  WHERE ticket.id = p_ticket_id AND ticket.brand_id = p_brand_id
  RETURNING ticket.updated_at, ticket.context_version INTO v_updated_at, v_context_version;

  INSERT INTO public.ticket_events(ticket_id, event_type, actor, new_value, metadata)
  VALUES (
    p_ticket_id, 'autopilot_proposed', 'ai',
    (SELECT string_agg(action->>'type', ',') FROM jsonb_array_elements(COALESCE(p_plan->'actions', '[]'::jsonb)) action),
    jsonb_build_object(
      'plan_id', v_plan_id, 'revision', v_revision, 'trigger', p_plan->>'trigger',
      'context_version', p_expected_context_version
    )
  );

  RETURN jsonb_build_object(
    'persisted', true, 'replayed', false, 'plan_id', v_plan_id,
    'updated_at', v_updated_at, 'context_version', v_context_version
  );
END $$;
REVOKE ALL ON FUNCTION public.persist_autopilot_plan(uuid, uuid, timestamptz, bigint, uuid, timestamptz, jsonb, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.persist_autopilot_plan(uuid, uuid, timestamptz, bigint, uuid, timestamptz, jsonb, jsonb, jsonb) TO service_role;

-- Atomically claim one human decision and append its immutable review episode.
-- The returned claimed=false/replayed=true result must never execute actions.
CREATE OR REPLACE FUNCTION public.claim_autopilot_plan_decision(
  p_ticket_id uuid,
  p_brand_id uuid,
  p_plan_id uuid,
  p_plan_revision integer,
  p_expected_context_version bigint,
  p_expected_context_fingerprint text,
  p_decision text,
  p_decided_plan jsonb,
  p_learning_event jsonb,
  p_actor_id uuid,
  p_actor_name text,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ticket public.tickets%ROWTYPE;
  v_current jsonb;
  v_metadata jsonb;
  v_learning_result jsonb;
  v_expected_status text;
  v_rows integer;
  v_existing_event uuid;
  v_updated_at timestamptz;
BEGIN
  IF p_decision NOT IN ('approve', 'dismiss') THEN RAISE EXCEPTION 'invalid decision'; END IF;
  IF p_plan_revision < 0 THEN RAISE EXCEPTION 'invalid plan revision'; END IF;
  IF jsonb_typeof(p_decided_plan) <> 'object' OR jsonb_typeof(p_learning_event) <> 'object' THEN
    RAISE EXCEPTION 'decided plan and learning event must be objects';
  END IF;
  IF NOT public.is_canonical_uuid(p_decided_plan->>'id') OR (p_decided_plan->>'id')::uuid <> p_plan_id THEN
    RAISE EXCEPTION 'decided plan id mismatch';
  END IF;
  IF COALESCE((p_decided_plan->>'revision')::integer, 0) <> p_plan_revision THEN
    RAISE EXCEPTION 'decided plan revision mismatch';
  END IF;
  IF (p_decided_plan->>'context_version')::bigint IS DISTINCT FROM p_expected_context_version THEN
    RAISE EXCEPTION 'decided plan context version mismatch';
  END IF;
  IF p_decided_plan->>'context_fingerprint' IS DISTINCT FROM p_expected_context_fingerprint THEN
    RAISE EXCEPTION 'decided plan fingerprint mismatch';
  END IF;
  IF NOT public.is_valid_autopilot_actions(p_decided_plan->'actions') THEN
    RAISE EXCEPTION 'decided plan actions are invalid';
  END IF;
  IF trim(COALESCE(p_idempotency_key, '')) = ''
     OR p_learning_event->>'idempotency_key' IS DISTINCT FROM p_idempotency_key THEN
    RAISE EXCEPTION 'decision idempotency key mismatch';
  END IF;
  v_expected_status := CASE p_decision WHEN 'approve' THEN 'executing' ELSE 'dismissed' END;
  IF p_decided_plan->>'status' <> v_expected_status THEN RAISE EXCEPTION 'decided plan has invalid status'; END IF;

  SELECT * INTO v_ticket
  FROM public.tickets
  WHERE id = p_ticket_id AND brand_id = p_brand_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ticket not found'; END IF;
  v_metadata := COALESCE(v_ticket.metadata, '{}'::jsonb);
  v_current := v_metadata->'autopilot';

  SELECT id INTO v_existing_event
  FROM public.autopilot_learning_events
  WHERE brand_id = p_brand_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    v_learning_result := public.insert_autopilot_learning_event_json(
      p_learning_event, p_brand_id, p_ticket_id, p_plan_id, p_plan_revision, 'review'
    );
    RETURN jsonb_build_object(
      'claimed', false, 'replayed', true, 'plan_id', p_plan_id,
      'status', COALESCE(v_current->>'status', v_expected_status),
      'context_version', v_ticket.context_version,
      'learning_captured', true,
      'learning', v_learning_result
    );
  END IF;

  IF v_ticket.context_version IS DISTINCT FROM p_expected_context_version THEN
    RAISE EXCEPTION 'ticket context changed before decision' USING ERRCODE = '40001';
  END IF;
  IF v_current IS NULL OR v_current->>'status' <> 'proposed'
     OR NOT public.is_canonical_uuid(v_current->>'id')
     OR (v_current->>'id')::uuid <> p_plan_id
     OR COALESCE((v_current->>'revision')::integer, 0) <> p_plan_revision
     OR v_current->>'context_fingerprint' IS DISTINCT FROM p_expected_context_fingerprint
     OR (v_current->>'context_version')::bigint IS DISTINCT FROM p_expected_context_version THEN
    RAISE EXCEPTION 'proposed plan identity or context changed' USING ERRCODE = '40001';
  END IF;
  IF NOT public.is_valid_autopilot_actions(v_current->'actions')
     OR jsonb_array_length(v_current->'actions') <> jsonb_array_length(p_decided_plan->'actions')
     OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(v_current->'actions') action
       WHERE NOT EXISTS (
         SELECT 1 FROM jsonb_array_elements(p_decided_plan->'actions') decided
         WHERE decided->>'id' = action->>'id' AND decided->>'type' = action->>'type'
       )
     ) THEN
    RAISE EXCEPTION 'decided actions do not match the proposed plan';
  END IF;

  v_learning_result := public.insert_autopilot_learning_event_json(
    p_learning_event, p_brand_id, p_ticket_id, p_plan_id, p_plan_revision, 'review'
  );

  INSERT INTO public.ticket_action_plans (
    id, ticket_id, brand_id, parent_plan_id, revision, status, trigger,
    planner_version, prompt_version, context_fingerprint, context_version,
    analysis, actions, learning_context, overall_confidence,
    raw_overall_confidence, proposed_at, created_at, updated_at
  ) VALUES (
    p_plan_id, p_ticket_id, p_brand_id,
    CASE WHEN public.is_canonical_uuid(v_current->>'parent_plan_id') THEN (v_current->>'parent_plan_id')::uuid ELSE NULL END,
    p_plan_revision, 'proposed', v_current->>'trigger',
    NULLIF(v_current->>'planner_version', ''), NULLIF(v_current->>'prompt_version', ''),
    NULLIF(v_current->>'context_fingerprint', ''), p_expected_context_version,
    COALESCE(v_current->'analysis', '{}'::jsonb), COALESCE(v_current->'actions', '[]'::jsonb),
    COALESCE(v_current->'learning', '{}'::jsonb),
    NULLIF(v_current->'analysis'->>'overall_confidence', '')::real,
    COALESCE(NULLIF(v_current->'analysis'->>'model_confidence', '')::real,
             NULLIF(v_current->'analysis'->>'overall_confidence', '')::real),
    COALESCE(NULLIF(v_current->>'proposed_at', '')::timestamptz, now()), now(), now()
  ) ON CONFLICT (id) DO NOTHING;

  UPDATE public.ticket_action_plans
  SET status = v_expected_status,
      actions = COALESCE(p_decided_plan->'actions', '[]'::jsonb),
      analysis = COALESCE(p_decided_plan->'analysis', '{}'::jsonb),
      decided_at = COALESCE(NULLIF(p_decided_plan->>'decided_at', '')::timestamptz, now()),
      decided_by = COALESCE(NULLIF(p_actor_name, ''), 'agent'),
      decision_context_version = p_expected_context_version,
      execution_context_version = CASE WHEN v_expected_status = 'executing' THEN p_expected_context_version ELSE NULL END,
      updated_at = now()
  WHERE id = p_plan_id AND ticket_id = p_ticket_id AND brand_id = p_brand_id AND status = 'proposed';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION 'plan ledger could not be claimed' USING ERRCODE = '40001'; END IF;

  v_metadata := jsonb_set(v_metadata, '{autopilot}', p_decided_plan, true);
  UPDATE public.tickets ticket
  SET metadata = v_metadata, updated_at = now()
  WHERE ticket.id = p_ticket_id AND ticket.brand_id = p_brand_id
  RETURNING ticket.updated_at INTO v_updated_at;

  INSERT INTO public.ticket_events(ticket_id, event_type, actor, actor_id, new_value, metadata)
  VALUES (
    p_ticket_id,
    CASE p_decision WHEN 'approve' THEN 'autopilot_approved' ELSE 'autopilot_dismissed' END,
    'agent', p_actor_id,
    CASE p_decision WHEN 'approve' THEN (
      SELECT string_agg(action->>'type', ',')
      FROM jsonb_array_elements(COALESCE(p_decided_plan->'actions', '[]'::jsonb)) action
      WHERE action->>'status' = 'approved'
    ) ELSE NULL END,
    jsonb_build_object(
      'plan_id', p_plan_id, 'revision', p_plan_revision,
      'idempotency_key', p_idempotency_key, 'context_version', p_expected_context_version
    )
  );

  RETURN jsonb_build_object(
    'claimed', true, 'replayed', false, 'plan_id', p_plan_id,
    'status', v_expected_status, 'updated_at', v_updated_at,
    'context_version', v_ticket.context_version,
    'learning_captured', COALESCE((v_learning_result->>'captured')::boolean, false),
    'learning', v_learning_result
  );
END $$;
REVOKE ALL ON FUNCTION public.claim_autopilot_plan_decision(uuid, uuid, uuid, integer, bigint, text, text, jsonb, jsonb, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_autopilot_plan_decision(uuid, uuid, uuid, integer, bigint, text, text, jsonb, jsonb, uuid, text, text) TO service_role;

-- Drop the pre-lease overload so PostgREST can never resolve a reservation
-- call that bypasses worker fencing.
DROP FUNCTION IF EXISTS public.reserve_autopilot_action_execution(uuid, uuid, uuid, uuid, uuid, text, text, bigint);
DROP FUNCTION IF EXISTS public.reserve_autopilot_action_execution(uuid, uuid, uuid, uuid, uuid, text, text, bigint, uuid, integer);
CREATE OR REPLACE FUNCTION public.reserve_autopilot_action_execution(
  p_ticket_id uuid,
  p_brand_id uuid,
  p_plan_id uuid,
  p_execution_attempt_id uuid,
  p_action_id uuid,
  p_action_type text,
  p_operation_key text,
  p_context_before bigint,
  p_expected_context_after bigint,
  p_worker_token uuid,
  p_lease_seconds integer DEFAULT 120
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ticket public.tickets%ROWTYPE;
  v_plan public.ticket_action_plans%ROWTYPE;
  v_projection jsonb;
  v_action jsonb;
  v_receipt public.autopilot_action_executions%ROWTYPE;
  v_inserted integer;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_execution_attempt_id IS NULL OR p_action_id IS NULL
     OR p_worker_token IS NULL
     OR length(trim(COALESCE(p_operation_key, ''))) = 0
     OR length(p_operation_key) > 240 OR p_context_before < 0
     OR p_expected_context_after NOT BETWEEN p_context_before AND p_context_before + 1
     OR p_lease_seconds NOT BETWEEN 30 AND 300 THEN
    RAISE EXCEPTION 'invalid action reservation identity';
  END IF;

  -- Look for an existing receipt before checking ticket context. The active
  -- worker may already have advanced ticket context inside the provider
  -- operation (for example, by reserving an outbound message). A concurrent
  -- retry must still observe its live lease as in progress rather than
  -- misclassifying the action as stale or uncertain.
  SELECT * INTO v_receipt FROM public.autopilot_action_executions
  WHERE plan_id = p_plan_id AND execution_attempt_id = p_execution_attempt_id
    AND action_id = p_action_id
  FOR UPDATE;
  IF FOUND THEN
    IF v_receipt.operation_key IS DISTINCT FROM p_operation_key
       OR v_receipt.action_type IS DISTINCT FROM p_action_type
       OR v_receipt.context_before IS DISTINCT FROM p_context_before
       OR v_receipt.expected_context_after IS DISTINCT FROM p_expected_context_after
       OR v_receipt.ticket_id <> p_ticket_id OR v_receipt.brand_id <> p_brand_id THEN
      RAISE EXCEPTION 'action receipt identity conflict';
    END IF;
    IF v_receipt.status = 'reserved' AND v_receipt.lease_expires_at > v_now THEN
      RETURN jsonb_build_object(
        'reserved', false, 'can_execute', false, 'replayed', true,
        'in_progress', true, 'reconciliation_required', false,
        'receipt', to_jsonb(v_receipt)
      );
    END IF;
    IF v_receipt.status = 'reserved' THEN
      UPDATE public.autopilot_action_executions receipt
      SET status = 'uncertain',
          error = COALESCE(receipt.error, 'Worker lease expired before its provider outcome was recorded; reconciliation is required.'),
          completed_at = COALESCE(receipt.completed_at, v_now),
          updated_at = v_now
      WHERE receipt.id = v_receipt.id
      RETURNING receipt.* INTO v_receipt;
      RETURN jsonb_build_object(
        'reserved', false, 'can_execute', false, 'replayed', true,
        'in_progress', false, 'lease_expired', true,
        'reconciliation_required', true, 'receipt', to_jsonb(v_receipt)
      );
    END IF;
    RETURN jsonb_build_object(
      'reserved', false, 'can_execute', false, 'replayed', true,
      'in_progress', false,
      'reconciliation_required', v_receipt.status = 'uncertain',
      'receipt', to_jsonb(v_receipt)
    );
  END IF;

  SELECT * INTO v_ticket FROM public.tickets
  WHERE id = p_ticket_id AND brand_id = p_brand_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ticket not found'; END IF;
  SELECT * INTO v_plan FROM public.ticket_action_plans
  WHERE id = p_plan_id AND ticket_id = p_ticket_id AND brand_id = p_brand_id
  FOR UPDATE;
  IF NOT FOUND OR v_plan.status <> 'executing' THEN RAISE EXCEPTION 'plan is not executing'; END IF;

  -- Both contenders can miss the optimistic receipt lookup. The loser then
  -- waits on the ticket lock while the winner commits its reservation. Check
  -- again under the plan/ticket locks before validating context, because the
  -- active worker may already be advancing that context.
  v_now := clock_timestamp();
  SELECT * INTO v_receipt FROM public.autopilot_action_executions
  WHERE plan_id = p_plan_id AND execution_attempt_id = p_execution_attempt_id
    AND action_id = p_action_id
  FOR UPDATE;
  IF FOUND THEN
    IF v_receipt.operation_key IS DISTINCT FROM p_operation_key
       OR v_receipt.action_type IS DISTINCT FROM p_action_type
       OR v_receipt.context_before IS DISTINCT FROM p_context_before
       OR v_receipt.expected_context_after IS DISTINCT FROM p_expected_context_after
       OR v_receipt.ticket_id <> p_ticket_id OR v_receipt.brand_id <> p_brand_id THEN
      RAISE EXCEPTION 'action receipt identity conflict';
    END IF;
    IF v_receipt.status = 'reserved' AND v_receipt.lease_expires_at > v_now THEN
      RETURN jsonb_build_object(
        'reserved', false, 'can_execute', false, 'replayed', true,
        'in_progress', true, 'reconciliation_required', false,
        'receipt', to_jsonb(v_receipt)
      );
    END IF;
    IF v_receipt.status = 'reserved' THEN
      UPDATE public.autopilot_action_executions receipt
      SET status = 'uncertain',
          error = COALESCE(receipt.error, 'Worker lease expired before its provider outcome was recorded; reconciliation is required.'),
          completed_at = COALESCE(receipt.completed_at, v_now),
          updated_at = v_now
      WHERE receipt.id = v_receipt.id
      RETURNING receipt.* INTO v_receipt;
      RETURN jsonb_build_object(
        'reserved', false, 'can_execute', false, 'replayed', true,
        'in_progress', false, 'lease_expired', true,
        'reconciliation_required', true, 'receipt', to_jsonb(v_receipt)
      );
    END IF;
    RETURN jsonb_build_object(
      'reserved', false, 'can_execute', false, 'replayed', true,
      'in_progress', false,
      'reconciliation_required', v_receipt.status = 'uncertain',
      'receipt', to_jsonb(v_receipt)
    );
  END IF;

  v_projection := COALESCE(v_ticket.metadata, '{}'::jsonb)->'autopilot';
  IF v_ticket.context_version IS DISTINCT FROM p_context_before
     OR v_projection IS NULL OR v_projection->>'status' <> 'executing'
     OR NOT public.is_canonical_uuid(v_projection->>'id')
     OR (v_projection->>'id')::uuid <> p_plan_id
     OR NOT public.is_canonical_uuid(v_projection->>'execution_attempt_id')
     OR (v_projection->>'execution_attempt_id')::uuid <> p_execution_attempt_id THEN
    RAISE EXCEPTION 'Autopilot execution projection changed' USING ERRCODE = '40001';
  END IF;

  SELECT action INTO v_action
  FROM jsonb_array_elements(v_plan.actions) action
  WHERE action->>'id' = p_action_id::text;
  IF v_action IS NULL OR v_action->>'type' IS DISTINCT FROM p_action_type
     OR v_action->>'status' NOT IN ('approved','executed','failed') THEN
    RAISE EXCEPTION 'action does not belong to the approved plan';
  END IF;

  INSERT INTO public.autopilot_action_executions (
    plan_id, ticket_id, brand_id, action_id, execution_attempt_id,
    action_type, operation_key, context_before, expected_context_after,
    worker_token, lease_expires_at, heartbeat_at, failure_reconcile_after
  ) VALUES (
    p_plan_id, p_ticket_id, p_brand_id, p_action_id, p_execution_attempt_id,
    p_action_type, p_operation_key, p_context_before, p_expected_context_after,
    p_worker_token, v_now + make_interval(secs => p_lease_seconds), v_now,
    v_now + make_interval(secs => p_lease_seconds + 90)
  )
  ON CONFLICT (plan_id, execution_attempt_id, action_id) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  SELECT * INTO v_receipt FROM public.autopilot_action_executions
  WHERE plan_id = p_plan_id AND execution_attempt_id = p_execution_attempt_id
    AND action_id = p_action_id
  FOR UPDATE;
  IF v_receipt.operation_key IS DISTINCT FROM p_operation_key
     OR v_receipt.action_type IS DISTINCT FROM p_action_type
     OR v_receipt.context_before IS DISTINCT FROM p_context_before
     OR v_receipt.expected_context_after IS DISTINCT FROM p_expected_context_after
     OR v_receipt.ticket_id <> p_ticket_id OR v_receipt.brand_id <> p_brand_id THEN
    RAISE EXCEPTION 'action receipt identity conflict';
  END IF;

  -- A contender can lose the unique-key race after its initial lookup. Apply
  -- the same live/expired lease rules to the winning receipt.
  IF v_inserted = 0 AND v_receipt.status = 'reserved' AND v_receipt.lease_expires_at > v_now THEN
    RETURN jsonb_build_object(
      'reserved', false, 'can_execute', false, 'replayed', true,
      'in_progress', true, 'reconciliation_required', false,
      'receipt', to_jsonb(v_receipt)
    );
  END IF;
  IF v_inserted = 0 AND v_receipt.status = 'reserved' THEN
    UPDATE public.autopilot_action_executions receipt
    SET status = 'uncertain',
        error = COALESCE(receipt.error, 'Worker lease expired before its provider outcome was recorded; reconciliation is required.'),
        completed_at = COALESCE(receipt.completed_at, v_now),
        updated_at = v_now
    WHERE receipt.id = v_receipt.id
    RETURNING receipt.* INTO v_receipt;
    RETURN jsonb_build_object(
      'reserved', false, 'can_execute', false, 'replayed', true,
      'in_progress', false, 'lease_expired', true,
      'reconciliation_required', true, 'receipt', to_jsonb(v_receipt)
    );
  END IF;

  RETURN jsonb_build_object(
    'reserved', v_inserted > 0,
    'can_execute', v_inserted > 0,
    'replayed', v_inserted = 0,
    'in_progress', false,
    'reconciliation_required', v_inserted = 0 AND v_receipt.status = 'uncertain',
    'receipt', to_jsonb(v_receipt)
  );
END $$;
REVOKE ALL ON FUNCTION public.reserve_autopilot_action_execution(uuid, uuid, uuid, uuid, uuid, text, text, bigint, bigint, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reserve_autopilot_action_execution(uuid, uuid, uuid, uuid, uuid, text, text, bigint, bigint, uuid, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.heartbeat_autopilot_action_execution(
  p_receipt_id uuid,
  p_brand_id uuid,
  p_worker_token uuid,
  p_lease_seconds integer DEFAULT 120
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_receipt public.autopilot_action_executions%ROWTYPE;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_receipt_id IS NULL OR p_worker_token IS NULL
     OR p_lease_seconds NOT BETWEEN 30 AND 300 THEN
    RAISE EXCEPTION 'invalid action heartbeat identity';
  END IF;
  SELECT * INTO v_receipt FROM public.autopilot_action_executions
  WHERE id = p_receipt_id AND brand_id = p_brand_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'action receipt not found'; END IF;
  IF v_receipt.worker_token IS DISTINCT FROM p_worker_token THEN
    RAISE EXCEPTION 'action lease is owned by another worker' USING ERRCODE = '40001';
  END IF;
  IF v_receipt.status <> 'reserved' THEN
    RETURN jsonb_build_object(
      'renewed', false, 'terminal', true, 'receipt', to_jsonb(v_receipt)
    );
  END IF;
  IF v_receipt.lease_expires_at <= v_now THEN
    UPDATE public.autopilot_action_executions receipt
    SET status = 'uncertain',
        error = COALESCE(receipt.error, 'Worker lease expired before its provider outcome was recorded; reconciliation is required.'),
        completed_at = COALESCE(receipt.completed_at, v_now),
        updated_at = v_now
    WHERE receipt.id = v_receipt.id
    RETURNING receipt.* INTO v_receipt;
    RETURN jsonb_build_object(
      'renewed', false, 'lease_expired', true,
      'reconciliation_required', true, 'receipt', to_jsonb(v_receipt)
    );
  END IF;
  UPDATE public.autopilot_action_executions receipt
  SET heartbeat_at = v_now,
      lease_expires_at = v_now + make_interval(secs => p_lease_seconds),
      failure_reconcile_after = GREATEST(
        v_now + make_interval(secs => p_lease_seconds),
        COALESCE(receipt.provider_deadline_at, v_now)
      ) + interval '90 seconds',
      updated_at = v_now
  WHERE receipt.id = v_receipt.id
  RETURNING receipt.* INTO v_receipt;
  RETURN jsonb_build_object(
    'renewed', true, 'lease_expires_at', v_receipt.lease_expires_at,
    'receipt', to_jsonb(v_receipt)
  );
END $$;
REVOKE ALL ON FUNCTION public.heartbeat_autopilot_action_execution(uuid, uuid, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.heartbeat_autopilot_action_execution(uuid, uuid, uuid, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.begin_autopilot_action_provider_operation(
  p_receipt_id uuid,
  p_brand_id uuid,
  p_worker_token uuid,
  p_provider_timeout_seconds integer DEFAULT 75,
  p_lease_seconds integer DEFAULT 120
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_receipt public.autopilot_action_executions%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_provider_deadline timestamptz;
  v_lease_deadline timestamptz;
BEGIN
  IF p_receipt_id IS NULL OR p_worker_token IS NULL
     OR p_provider_timeout_seconds NOT BETWEEN 5 AND 90
     OR p_lease_seconds NOT BETWEEN 30 AND 300
     OR p_provider_timeout_seconds >= p_lease_seconds THEN
    RAISE EXCEPTION 'invalid provider operation window';
  END IF;
  SELECT * INTO v_receipt FROM public.autopilot_action_executions
  WHERE id = p_receipt_id AND brand_id = p_brand_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'action receipt not found'; END IF;
  IF v_receipt.worker_token IS DISTINCT FROM p_worker_token THEN
    RAISE EXCEPTION 'provider operation is fenced to another worker' USING ERRCODE = '40001';
  END IF;
  IF v_receipt.status <> 'reserved' THEN
    RETURN jsonb_build_object('started', false, 'terminal', true, 'receipt', to_jsonb(v_receipt));
  END IF;
  IF v_receipt.lease_expires_at <= v_now THEN
    UPDATE public.autopilot_action_executions receipt
    SET status = 'uncertain',
        error = COALESCE(receipt.error, 'Worker lease expired before a provider operation could be fenced; reconciliation is required.'),
        completed_at = COALESCE(receipt.completed_at, v_now),
        updated_at = v_now
    WHERE receipt.id = v_receipt.id
    RETURNING receipt.* INTO v_receipt;
    RETURN jsonb_build_object(
      'started', false, 'lease_expired', true,
      'reconciliation_required', true, 'receipt', to_jsonb(v_receipt)
    );
  END IF;
  v_provider_deadline := v_now + make_interval(secs => p_provider_timeout_seconds);
  v_lease_deadline := v_now + make_interval(secs => p_lease_seconds);
  UPDATE public.autopilot_action_executions receipt
  SET heartbeat_at = v_now,
      lease_expires_at = v_lease_deadline,
      provider_deadline_at = v_provider_deadline,
      failure_reconcile_after = GREATEST(v_lease_deadline, v_provider_deadline) + interval '90 seconds',
      updated_at = v_now
  WHERE receipt.id = v_receipt.id
  RETURNING receipt.* INTO v_receipt;
  RETURN jsonb_build_object(
    'started', true,
    'provider_deadline_at', v_provider_deadline,
    'lease_expires_at', v_lease_deadline,
    'failure_reconcile_after', v_receipt.failure_reconcile_after,
    'receipt', to_jsonb(v_receipt)
  );
END $$;
REVOKE ALL ON FUNCTION public.begin_autopilot_action_provider_operation(uuid, uuid, uuid, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.begin_autopilot_action_provider_operation(uuid, uuid, uuid, integer, integer) TO service_role;

-- Remove the unfenced completion overload before publishing its replacement.
DROP FUNCTION IF EXISTS public.complete_autopilot_action_execution(uuid, uuid, uuid, uuid, uuid, text, text, bigint, text, text, text);
CREATE OR REPLACE FUNCTION public.complete_autopilot_action_execution(
  p_ticket_id uuid,
  p_brand_id uuid,
  p_plan_id uuid,
  p_execution_attempt_id uuid,
  p_action_id uuid,
  p_operation_key text,
  p_status text,
  p_context_after bigint,
  p_result text,
  p_error text,
  p_provider_reference text,
  p_worker_token uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_receipt public.autopilot_action_executions%ROWTYPE;
  v_plan public.ticket_action_plans%ROWTYPE;
  v_action jsonb;
  v_confidence real;
  v_outcome real;
  v_learning jsonb;
  v_event jsonb;
BEGIN
  IF p_status NOT IN ('executed','failed','uncertain') THEN RAISE EXCEPTION 'invalid action outcome'; END IF;
  IF p_worker_token IS NULL THEN RAISE EXCEPTION 'worker token is required'; END IF;
  SELECT * INTO v_receipt FROM public.autopilot_action_executions
  WHERE plan_id = p_plan_id AND execution_attempt_id = p_execution_attempt_id
    AND action_id = p_action_id AND ticket_id = p_ticket_id AND brand_id = p_brand_id
  FOR UPDATE;
  IF NOT FOUND OR v_receipt.operation_key IS DISTINCT FROM p_operation_key THEN
    RAISE EXCEPTION 'action receipt not found';
  END IF;
  IF (p_status = 'executed' AND p_context_after IS DISTINCT FROM v_receipt.expected_context_after)
     OR (p_status IN ('failed','uncertain')
       AND p_context_after IS DISTINCT FROM v_receipt.context_before
       AND p_context_after IS DISTINCT FROM v_receipt.expected_context_after) THEN
    RAISE EXCEPTION 'action context outcome differs from its reserved range';
  END IF;

  IF v_receipt.status <> 'reserved' THEN
    IF v_receipt.status IS DISTINCT FROM p_status
       OR (v_receipt.status <> 'uncertain' AND v_receipt.context_after IS DISTINCT FROM p_context_after) THEN
      RAISE EXCEPTION 'immutable action outcome conflict';
    END IF;
    RETURN jsonb_build_object('completed', true, 'replayed', true, 'receipt', to_jsonb(v_receipt));
  END IF;
  IF v_receipt.worker_token IS DISTINCT FROM p_worker_token THEN
    RAISE EXCEPTION 'action completion is fenced to another worker' USING ERRCODE = '40001';
  END IF;

  UPDATE public.autopilot_action_executions receipt
  SET status = p_status,
      -- An uncertain provider outcome does not prove which local context
      -- transition committed. Reconciliation establishes it later while
      -- holding the ticket lock.
      context_after = CASE WHEN p_status = 'uncertain' THEN NULL ELSE p_context_after END,
      result = left(NULLIF(p_result, ''), 1200),
      error = left(NULLIF(p_error, ''), 600),
      provider_reference = left(NULLIF(p_provider_reference, ''), 300),
      completed_at = now(), updated_at = now()
  WHERE receipt.id = v_receipt.id
  RETURNING receipt.* INTO v_receipt;

  SELECT * INTO v_plan FROM public.ticket_action_plans
  WHERE id = p_plan_id AND ticket_id = p_ticket_id AND brand_id = p_brand_id;
  SELECT action INTO v_action FROM jsonb_array_elements(v_plan.actions) action
  WHERE action->>'id' = p_action_id::text;
  v_confidence := LEAST(1, GREATEST(0, COALESCE(
    NULLIF(v_action->>'model_confidence', '')::real,
    NULLIF(v_action->>'confidence', '')::real,
    0.5
  )));
  v_outcome := CASE
    WHEN p_status = 'executed' THEN 1.0
    WHEN p_status = 'failed' THEN 0.0
    ELSE NULL
  END;
  v_event := jsonb_build_object(
    'id', gen_random_uuid(), 'brand_id', p_brand_id, 'ticket_id', p_ticket_id,
    'plan_id', p_plan_id, 'plan_revision', v_plan.revision,
    'event_type', 'execution',
    'signal_type', CASE WHEN p_status = 'executed' THEN 'delayed_outcome' ELSE 'execution_failure' END,
    'actor_type', 'system',
    'scope', jsonb_build_object('action_types', jsonb_build_array(v_receipt.action_type)),
    'trust_score', CASE WHEN p_status = 'executed' THEN 0.84 ELSE 0.92 END,
    'outcome_score', v_outcome,
    'payload', jsonb_build_object(
      'source', 'autopilot_action_receipt',
      'execution_only', true,
      'calibration_channel', 'technical_execution',
      'execution_attempt_id', p_execution_attempt_id,
      'operation_key', p_operation_key,
      'actions', jsonb_build_array(jsonb_build_object(
        'action_id', p_action_id,
        'action_type', v_receipt.action_type,
        'model_confidence', v_confidence,
        'model_outcome', v_outcome,
        'execution_status', p_status
      ))
    ),
    'idempotency_key', 'execution-action:' || p_plan_id::text || ':'
      || p_execution_attempt_id::text || ':' || p_action_id::text,
    'occurred_at', now()
  );
  v_learning := public.insert_autopilot_learning_event_json(
    v_event, p_brand_id, p_ticket_id, p_plan_id, v_plan.revision, 'execution'
  );
  RETURN jsonb_build_object(
    'completed', true, 'replayed', false,
    'receipt', to_jsonb(v_receipt), 'learning', v_learning
  );
END $$;
REVOKE ALL ON FUNCTION public.complete_autopilot_action_execution(uuid, uuid, uuid, uuid, uuid, text, text, bigint, text, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_autopilot_action_execution(uuid, uuid, uuid, uuid, uuid, text, text, bigint, text, text, text, uuid) TO service_role;

DROP FUNCTION IF EXISTS public.reconcile_autopilot_action_execution(uuid, uuid, text, text, text, uuid);
DROP FUNCTION IF EXISTS public.reconcile_autopilot_action_execution(uuid, uuid, text, text, text, uuid, timestamptz);
CREATE OR REPLACE FUNCTION public.reconcile_autopilot_action_execution(
  p_receipt_id uuid,
  p_brand_id uuid,
  p_outcome text,
  p_provider_reference text,
  p_note text,
  p_actor_id uuid,
  p_provider_verified boolean,
  p_provider_checked_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_receipt public.autopilot_action_executions%ROWTYPE;
  v_ticket public.tickets%ROWTYPE;
  v_plan public.ticket_action_plans%ROWTYPE;
  v_projection jsonb;
  v_action jsonb;
  v_confidence real;
  v_learning jsonb;
  v_event jsonb;
  v_now timestamptz := clock_timestamp();
  v_verified_context_after bigint;
  v_resume_safe boolean := false;
  v_local_effect_verified boolean := false;
  v_terminal_actions jsonb;
  v_expected_actions integer := 0;
  v_terminal_receipts integer := 0;
  v_executed_receipts integer := 0;
  v_failed_receipts integer := 0;
  v_terminal_status text;
  v_final_plan jsonb;
  v_finalization jsonb;
BEGIN
  IF p_outcome NOT IN ('executed','failed') THEN RAISE EXCEPTION 'reconciliation outcome must be executed or failed'; END IF;
  IF p_provider_verified IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'explicit provider verification is required';
  END IF;
  IF length(trim(COALESCE(p_provider_reference, ''))) = 0
     AND length(trim(COALESCE(p_note, ''))) = 0 THEN
    RAISE EXCEPTION 'provider reference or reconciliation note is required';
  END IF;
  SELECT * INTO v_receipt FROM public.autopilot_action_executions
  WHERE id = p_receipt_id AND brand_id = p_brand_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'action receipt not found'; END IF;

  -- Use the global ticket -> plan -> receipt lock order. The first unlocked
  -- read only discovers the receipt's immutable parent ids; the locked read
  -- below revalidates them before any decision is made.
  SELECT * INTO v_ticket FROM public.tickets
  WHERE id = v_receipt.ticket_id AND brand_id = p_brand_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ticket not found'; END IF;
  SELECT * INTO v_plan FROM public.ticket_action_plans
  WHERE id = v_receipt.plan_id AND ticket_id = v_receipt.ticket_id AND brand_id = p_brand_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'plan ledger not found'; END IF;
  SELECT * INTO v_receipt FROM public.autopilot_action_executions
  WHERE id = p_receipt_id AND brand_id = p_brand_id
    AND ticket_id = v_ticket.id AND plan_id = v_plan.id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'action receipt identity changed'; END IF;
  v_now := clock_timestamp();

  IF v_receipt.status = 'reserved' AND v_receipt.lease_expires_at > v_now THEN
    RAISE EXCEPTION 'action reservation may still be active; wait before reconciling';
  END IF;
  IF v_receipt.status NOT IN ('uncertain','reserved') THEN
    IF v_receipt.status = p_outcome AND v_receipt.provider_checked_at IS NOT NULL THEN
      RETURN jsonb_build_object(
        'reconciled', true, 'replayed', true,
        'resume_safe', v_receipt.context_after IS NOT NULL
          AND v_ticket.context_version = v_receipt.context_after
          AND v_plan.status = 'executing'
          AND COALESCE(v_ticket.metadata, '{}'::jsonb)->'autopilot'->>'status' = 'executing'
          AND COALESCE(v_ticket.metadata, '{}'::jsonb)->'autopilot'->>'id' = v_receipt.plan_id::text
          AND COALESCE(v_ticket.metadata, '{}'::jsonb)->'autopilot'->>'execution_attempt_id' = v_receipt.execution_attempt_id::text,
        'terminalized', v_plan.status IN ('executed','partially_executed','failed','superseded'),
        'receipt', to_jsonb(v_receipt)
      );
    END IF;
    RAISE EXCEPTION 'only a stale reserved or uncertain action can be reconciled';
  END IF;

  -- A failed provider observation is authoritative only after both the worker
  -- lease and the bounded provider request have been quiescent. The API
  -- records when the administrator actually checked the provider, so a stale
  -- observation cannot be submitted after merely waiting out the timer.
  IF p_provider_checked_at IS NULL
     OR p_provider_checked_at > v_now + interval '30 seconds'
     OR p_provider_checked_at < v_now - interval '15 minutes'
     OR p_provider_checked_at < COALESCE(v_receipt.completed_at, v_receipt.lease_expires_at, v_receipt.started_at) THEN
    RAISE EXCEPTION 'a recent post-lease provider verification is required';
  END IF;
  IF p_outcome = 'failed' AND (
    v_receipt.failure_reconcile_after IS NULL
    OR v_now < v_receipt.failure_reconcile_after
    OR p_provider_checked_at < v_receipt.failure_reconcile_after
  ) THEN
    RAISE EXCEPTION 'provider failure cannot be confirmed until the operation is quiescent at %',
      v_receipt.failure_reconcile_after;
  END IF;

  -- Only an exact before/expected version with a linked local artifact is safe
  -- to resume. Otherwise this same transaction terminalizes the plan without
  -- attempting another side effect.
  SELECT action INTO v_action FROM jsonb_array_elements(v_plan.actions) action
  WHERE action->>'id' = v_receipt.action_id::text;
  IF v_action IS NULL OR v_action->>'type' IS DISTINCT FROM v_receipt.action_type THEN
    RAISE EXCEPTION 'receipt action does not match the plan ledger';
  END IF;

  IF v_receipt.expected_context_after = v_receipt.context_before THEN
    v_local_effect_verified := v_ticket.context_version = v_receipt.context_before;
  ELSIF v_ticket.context_version = v_receipt.expected_context_after THEN
    IF v_receipt.action_type = 'send_reply' THEN
      SELECT EXISTS (
        SELECT 1 FROM public.ticket_messages message
        WHERE message.id = v_receipt.id
          AND message.ticket_id = v_receipt.ticket_id
          AND message.sender_type = 'agent'
          AND NOT COALESCE(message.is_internal_note, false)
          AND message.metadata->>'plan_id' = v_receipt.plan_id::text
          AND message.metadata->>'action_id' = v_receipt.action_id::text
          AND message.metadata->>'action_execution_id' = v_receipt.id::text
      ) INTO v_local_effect_verified;
    ELSE
      -- The receipt-linked audit marker plus the locked target state proves
      -- that this action caused the single expected context tick. A crash
      -- between the mutation and marker is a safe false negative: the plan is
      -- terminalized instead of risking later stale actions.
      SELECT EXISTS (
        SELECT 1 FROM public.ticket_events event
        WHERE event.ticket_id = v_receipt.ticket_id
          AND event.created_at >= v_receipt.started_at
          AND event.metadata->>'plan_id' = v_receipt.plan_id::text
          AND event.metadata->>'action_id' = v_receipt.action_id::text
          AND event.metadata->>'action_execution_id' = v_receipt.id::text
      ) INTO v_local_effect_verified;
      v_local_effect_verified := v_local_effect_verified AND CASE v_receipt.action_type
        WHEN 'close_not_support' THEN v_ticket.status = 'closed'
        WHEN 'resolve' THEN v_ticket.status = 'resolved'
        WHEN 'set_priority' THEN v_ticket.priority::text = v_action->'params'->>'priority'
        WHEN 'add_tags' THEN COALESCE(v_action->'params'->'tags', '[]'::jsonb) <@ to_jsonb(COALESCE(v_ticket.tags, '{}'::text[]))
        WHEN 'escalate_human' THEN 'needs-human' = ANY(COALESCE(v_ticket.tags, '{}'::text[]))
        ELSE false
      END;
    END IF;
  END IF;

  IF v_local_effect_verified THEN
    v_verified_context_after := v_ticket.context_version;
  ELSIF p_outcome = 'failed' AND v_ticket.context_version = v_receipt.context_before THEN
    -- The action failed before its optional local ticket mutation committed.
    v_verified_context_after := v_receipt.context_before;
  ELSE
    v_verified_context_after := NULL;
  END IF;
  v_projection := COALESCE(v_ticket.metadata, '{}'::jsonb)->'autopilot';
  v_resume_safe := v_verified_context_after IS NOT NULL
    AND v_plan.status = 'executing'
    AND v_projection IS NOT NULL
    AND v_projection->>'status' = 'executing'
    AND public.is_canonical_uuid(v_projection->>'id')
    AND (v_projection->>'id')::uuid = v_receipt.plan_id
    AND public.is_canonical_uuid(v_projection->>'execution_attempt_id')
    AND (v_projection->>'execution_attempt_id')::uuid = v_receipt.execution_attempt_id;

  UPDATE public.autopilot_action_executions receipt
  SET status = p_outcome,
      context_after = v_verified_context_after,
      result = CASE WHEN p_outcome = 'executed' THEN left(COALESCE(NULLIF(p_note, ''), 'Provider outcome reconciled'), 1200) ELSE receipt.result END,
      error = CASE WHEN p_outcome = 'failed' THEN left(COALESCE(NULLIF(p_note, ''), 'Provider confirmed failure'), 600) ELSE NULL END,
      provider_reference = left(COALESCE(NULLIF(p_provider_reference, ''), receipt.provider_reference), 300),
      provider_checked_at = p_provider_checked_at,
      completed_at = now(), updated_at = now()
  WHERE receipt.id = p_receipt_id
  RETURNING receipt.* INTO v_receipt;

  SELECT action INTO v_action FROM jsonb_array_elements(v_plan.actions) action
  WHERE action->>'id' = v_receipt.action_id::text;
  v_confidence := LEAST(1, GREATEST(0, COALESCE(
    NULLIF(v_action->>'model_confidence', '')::real,
    NULLIF(v_action->>'confidence', '')::real,
    0.5
  )));
  v_event := jsonb_build_object(
    'id', gen_random_uuid(), 'brand_id', p_brand_id, 'ticket_id', v_receipt.ticket_id,
    'plan_id', v_receipt.plan_id, 'plan_revision', v_plan.revision,
    'event_type', 'execution',
    'signal_type', CASE WHEN p_outcome = 'executed' THEN 'delayed_outcome' ELSE 'execution_failure' END,
    'actor_type', 'admin', 'actor_id', p_actor_id,
    'scope', jsonb_build_object('action_types', jsonb_build_array(v_receipt.action_type)),
    'trust_score', 0.98,
    'outcome_score', CASE WHEN p_outcome = 'executed' THEN 1 ELSE 0 END,
    'payload', jsonb_build_object(
      'source', 'autopilot_action_reconciliation',
      'execution_only', true,
      'calibration_channel', 'technical_execution',
      'reconciled', true,
      'provider_checked_at', p_provider_checked_at,
      'resume_safe', v_resume_safe,
      'expected_context_after', v_receipt.expected_context_after,
      'verified_context_after', v_verified_context_after,
      'ticket_context_version', v_ticket.context_version,
      'execution_attempt_id', v_receipt.execution_attempt_id,
      'provider_reference', left(p_provider_reference, 300),
      'actions', jsonb_build_array(jsonb_build_object(
        'action_id', v_receipt.action_id,
        'action_type', v_receipt.action_type,
        'model_confidence', v_confidence,
        'model_outcome', CASE WHEN p_outcome = 'executed' THEN 1 ELSE 0 END,
        'execution_status', p_outcome
      ))
    ),
    'idempotency_key', 'execution-action-reconciliation:' || p_receipt_id::text,
    'occurred_at', now()
  );
  v_learning := public.insert_autopilot_learning_event_json(
    v_event, p_brand_id, v_receipt.ticket_id, v_receipt.plan_id, v_plan.revision, 'execution'
  );
  INSERT INTO public.ticket_events(ticket_id, event_type, actor, actor_id, new_value, metadata)
  VALUES (
    v_receipt.ticket_id, 'autopilot_action_reconciled', 'agent', p_actor_id, p_outcome,
    jsonb_build_object(
      'plan_id', v_receipt.plan_id, 'action_id', v_receipt.action_id,
      'receipt_id', p_receipt_id, 'provider_checked_at', p_provider_checked_at,
      'resume_safe', v_resume_safe, 'expected_context_after', v_receipt.expected_context_after,
      'verified_context_after', v_verified_context_after,
      'ticket_context_version', v_ticket.context_version
    )
  );

  IF NOT v_resume_safe THEN
    -- Build the only safe terminal projection from immutable ledger actions
    -- and durable receipts. Unattempted actions become skipped. Delegating to
    -- the canonical finalizer keeps ledger/projection/audit/learning updates
    -- atomic with this reconciliation transaction.
    SELECT
      COALESCE(jsonb_agg(
        CASE
          WHEN receipt.status IN ('executed','failed') THEN action_item.action || jsonb_build_object(
            'status', receipt.status,
            'result', COALESCE(
              CASE WHEN receipt.status = 'failed' THEN receipt.error ELSE receipt.result END,
              CASE WHEN receipt.status = 'failed' THEN 'Execution failed' ELSE 'Executed' END
            )
          )
          WHEN action_item.action->>'status' = 'skipped' THEN action_item.action
          ELSE action_item.action || jsonb_build_object(
            'status', 'skipped',
            'result', 'Skipped because reconciled execution context could not be proven safe to resume'
          )
        END
        ORDER BY action_item.ordinality
      ), '[]'::jsonb),
      count(*) FILTER (WHERE COALESCE(action_item.action->>'status', 'approved') <> 'skipped'),
      count(receipt.id) FILTER (WHERE receipt.status IN ('executed','failed')),
      count(receipt.id) FILTER (WHERE receipt.status = 'executed'),
      count(receipt.id) FILTER (WHERE receipt.status = 'failed')
    INTO v_terminal_actions, v_expected_actions, v_terminal_receipts,
      v_executed_receipts, v_failed_receipts
    FROM jsonb_array_elements(v_plan.actions) WITH ORDINALITY
      AS action_item(action, ordinality)
    LEFT JOIN public.autopilot_action_executions receipt
      ON receipt.plan_id = v_receipt.plan_id
      AND receipt.execution_attempt_id = v_receipt.execution_attempt_id
      AND receipt.action_id = (action_item.action->>'id')::uuid;

    v_terminal_status := CASE
      WHEN v_expected_actions > 0
        AND v_terminal_receipts = v_expected_actions
        AND v_failed_receipts = 0
        AND v_executed_receipts > 0 THEN 'executed'
      WHEN v_executed_receipts > 0 THEN 'partially_executed'
      ELSE 'failed'
    END;
    IF v_projection IS NOT NULL
       AND public.is_canonical_uuid(v_projection->>'id')
       AND (v_projection->>'id')::uuid = v_receipt.plan_id THEN
      v_final_plan := v_projection;
    ELSE
      v_final_plan := jsonb_build_object(
        'version', 2, 'id', v_receipt.plan_id,
        'revision', v_plan.revision, 'analysis', v_plan.analysis
      );
    END IF;
    v_final_plan := v_final_plan || jsonb_build_object(
      'id', v_receipt.plan_id,
      'revision', v_plan.revision,
      'analysis', v_plan.analysis,
      'actions', v_terminal_actions,
      'status', v_terminal_status,
      'execution_attempt_id', v_receipt.execution_attempt_id,
      'execution_interrupted', true,
      'execution_interruption_reason',
        'Reconciled provider outcome could not be linked to an unchanged ticket context; remaining actions were not run.',
      'executed_at', now()
    );
    EXECUTE 'SELECT public.finalize_autopilot_plan_execution($1,$2,$3,$4,$5,$6)'
      INTO v_finalization
      USING v_receipt.ticket_id, p_brand_id, v_receipt.plan_id,
        v_receipt.expected_context_after, v_final_plan, p_actor_id;
  END IF;

  RETURN jsonb_build_object(
    'reconciled', true, 'replayed', false,
    'resume_safe', v_resume_safe,
    'terminalized', NOT v_resume_safe,
    'verified_context_after', v_verified_context_after,
    'ticket_context_version', v_ticket.context_version,
    'receipt', to_jsonb(v_receipt), 'learning', v_learning,
    'finalization', v_finalization
  );
END $$;
REVOKE ALL ON FUNCTION public.reconcile_autopilot_action_execution(uuid, uuid, text, text, text, uuid, boolean, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reconcile_autopilot_action_execution(uuid, uuid, text, text, text, uuid, boolean, timestamptz) TO service_role;

-- Insert the outbound message while holding the ticket lock. The message
-- trigger advances context_version before this function returns, closing the
-- gap in which a concurrent customer reply could be missed before DB commit.
CREATE OR REPLACE FUNCTION public.prepare_autopilot_reply(
  p_ticket_id uuid,
  p_brand_id uuid,
  p_plan_id uuid,
  p_expected_context_version bigint,
  p_message jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ticket public.tickets%ROWTYPE;
  v_plan jsonb;
  v_message_id uuid;
  v_message public.ticket_messages%ROWTYPE;
  v_existing public.ticket_messages%ROWTYPE;
  v_new_context_version bigint;
  v_metadata jsonb;
BEGIN
  IF jsonb_typeof(p_message) <> 'object' THEN RAISE EXCEPTION 'message must be an object'; END IF;
  IF NOT public.is_canonical_uuid(p_message->>'id') THEN RAISE EXCEPTION 'message id must be a canonical UUID'; END IF;
  v_message_id := (p_message->>'id')::uuid;
  IF COALESCE(p_message->>'sender_type', 'agent') <> 'agent'
     OR COALESCE((p_message->>'is_internal_note')::boolean, false)
     OR length(trim(COALESCE(p_message->>'content', ''))) = 0 THEN
    RAISE EXCEPTION 'Autopilot reply must be a non-internal agent message with content';
  END IF;
  IF jsonb_typeof(COALESCE(p_message->'metadata', '{}'::jsonb)) <> 'object'
     OR jsonb_typeof(COALESCE(p_message->'attachments', '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'message metadata/attachments have invalid shapes';
  END IF;

  SELECT * INTO v_ticket FROM public.tickets
  WHERE id = p_ticket_id AND brand_id = p_brand_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ticket not found'; END IF;

  SELECT * INTO v_existing FROM public.ticket_messages WHERE id = v_message_id;
  IF FOUND THEN
    IF v_existing.ticket_id <> p_ticket_id OR v_existing.sender_type <> 'agent'
       OR v_existing.content IS DISTINCT FROM trim(p_message->>'content')
       OR v_existing.is_internal_note
       OR v_existing.metadata->>'plan_id' IS DISTINCT FROM p_plan_id::text THEN
      RAISE EXCEPTION 'message id was reused with different content';
    END IF;
    RETURN jsonb_build_object(
      'replayed', true, 'message', to_jsonb(v_existing),
      'context_version', v_ticket.context_version
    );
  END IF;

  v_plan := COALESCE(v_ticket.metadata, '{}'::jsonb)->'autopilot';
  IF v_ticket.context_version IS DISTINCT FROM p_expected_context_version
     OR v_plan IS NULL OR v_plan->>'status' <> 'executing'
     OR NOT public.is_canonical_uuid(v_plan->>'id') OR (v_plan->>'id')::uuid <> p_plan_id THEN
    RAISE EXCEPTION 'Autopilot execution context changed' USING ERRCODE = '40001';
  END IF;

  INSERT INTO public.ticket_messages (
    id, ticket_id, sender_type, sender_name, sender_email, content, content_html,
    is_internal_note, attachments, email_message_id, ai_generated, metadata, created_at
  ) VALUES (
    v_message_id, p_ticket_id, 'agent', NULLIF(p_message->>'sender_name', ''),
    NULLIF(p_message->>'sender_email', ''), trim(p_message->>'content'),
    NULLIF(p_message->>'content_html', ''), false,
    COALESCE(p_message->'attachments', '[]'::jsonb), NULLIF(p_message->>'email_message_id', ''),
    true, COALESCE(p_message->'metadata', '{}'::jsonb) || jsonb_build_object('plan_id', p_plan_id, 'via', 'autopilot'),
    COALESCE(NULLIF(p_message->>'created_at', '')::timestamptz, now())
  ) RETURNING * INTO v_message;

  SELECT context_version, COALESCE(metadata, '{}'::jsonb)
  INTO v_new_context_version, v_metadata
  FROM public.tickets WHERE id = p_ticket_id;
  v_plan := jsonb_set(v_plan, '{execution_context_version}', to_jsonb(v_new_context_version), true);
  v_metadata := jsonb_set(v_metadata, '{autopilot}', v_plan, true);
  UPDATE public.tickets SET metadata = v_metadata, updated_at = now() WHERE id = p_ticket_id;
  UPDATE public.ticket_action_plans
  SET execution_context_version = v_new_context_version, updated_at = now()
  WHERE id = p_plan_id AND ticket_id = p_ticket_id AND brand_id = p_brand_id AND status = 'executing';

  INSERT INTO public.ticket_events(ticket_id, event_type, actor, new_value, metadata)
  VALUES (p_ticket_id, 'message_added', 'ai', 'agent', jsonb_build_object('via', 'autopilot', 'plan_id', p_plan_id, 'message_id', v_message_id));

  RETURN jsonb_build_object(
    'replayed', false, 'message', to_jsonb(v_message),
    'context_version', v_new_context_version
  );
END $$;
REVOKE ALL ON FUNCTION public.prepare_autopilot_reply(uuid, uuid, uuid, bigint, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.prepare_autopilot_reply(uuid, uuid, uuid, bigint, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.assert_autopilot_plan_context(
  p_ticket_id uuid,
  p_brand_id uuid,
  p_plan_id uuid,
  p_expected_context_version bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ticket public.tickets%ROWTYPE;
  v_plan jsonb;
BEGIN
  SELECT * INTO v_ticket FROM public.tickets
  WHERE id = p_ticket_id AND brand_id = p_brand_id
  FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ticket not found'; END IF;
  v_plan := COALESCE(v_ticket.metadata, '{}'::jsonb)->'autopilot';
  IF v_ticket.context_version IS DISTINCT FROM p_expected_context_version
     OR v_plan IS NULL OR v_plan->>'status' <> 'executing'
     OR NOT public.is_canonical_uuid(v_plan->>'id') OR (v_plan->>'id')::uuid <> p_plan_id
     OR NOT EXISTS (
       SELECT 1 FROM public.ticket_action_plans
       WHERE id = p_plan_id AND ticket_id = p_ticket_id AND brand_id = p_brand_id
         AND status = 'executing'
         AND COALESCE(execution_context_version, decision_context_version, context_version) = p_expected_context_version
     ) THEN
    RAISE EXCEPTION 'Autopilot execution context changed' USING ERRCODE = '40001';
  END IF;
  RETURN jsonb_build_object('valid', true, 'context_version', v_ticket.context_version);
END $$;
REVOKE ALL ON FUNCTION public.assert_autopilot_plan_context(uuid, uuid, uuid, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assert_autopilot_plan_context(uuid, uuid, uuid, bigint) TO service_role;

CREATE OR REPLACE FUNCTION public.finalize_autopilot_plan_execution(
  p_ticket_id uuid,
  p_brand_id uuid,
  p_plan_id uuid,
  p_expected_context_version bigint,
  p_final_plan jsonb,
  p_actor_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ticket public.tickets%ROWTYPE;
  v_current jsonb;
  v_metadata jsonb;
  v_status text;
  v_superseded boolean;
  v_context_changed boolean;
  v_projection_replaced boolean;
  v_ledger_status text;
  v_ledger_actions jsonb;
  v_attempt_id text;
  v_attempted integer;
  v_executed integer;
  v_failed integer;
  v_signal text;
  v_learning jsonb;
  v_learning_event jsonb;
  v_execution_actions jsonb;
BEGIN
  IF jsonb_typeof(p_final_plan) <> 'object'
     OR NOT public.is_canonical_uuid(p_final_plan->>'id')
     OR (p_final_plan->>'id')::uuid <> p_plan_id THEN
    RAISE EXCEPTION 'final plan id mismatch';
  END IF;
  IF NOT public.is_valid_autopilot_actions(p_final_plan->'actions') THEN
    RAISE EXCEPTION 'final plan actions are invalid';
  END IF;
  v_status := p_final_plan->>'status';
  IF v_status NOT IN ('executed', 'partially_executed', 'failed') THEN RAISE EXCEPTION 'plan is not terminal'; END IF;
  v_attempt_id := COALESCE(NULLIF(p_final_plan->>'execution_attempt_id', ''), 'legacy');
  IF v_attempt_id <> 'legacy' AND NOT public.is_canonical_uuid(v_attempt_id) THEN
    RAISE EXCEPTION 'execution attempt id must be a canonical UUID';
  END IF;

  SELECT * INTO v_ticket FROM public.tickets
  WHERE id = p_ticket_id AND brand_id = p_brand_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ticket not found'; END IF;
  SELECT status, actions INTO v_ledger_status, v_ledger_actions FROM public.ticket_action_plans
  WHERE id = p_plan_id AND ticket_id = p_ticket_id AND brand_id = p_brand_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'plan ledger not found'; END IF;
  v_metadata := COALESCE(v_ticket.metadata, '{}'::jsonb);
  v_current := v_metadata->'autopilot';
  v_context_changed := v_ticket.context_version IS DISTINCT FROM p_expected_context_version;
  v_projection_replaced := v_current IS NULL OR NOT public.is_canonical_uuid(v_current->>'id')
    OR (v_current->>'id')::uuid <> p_plan_id OR v_current->>'status' <> 'executing';
  v_superseded := v_context_changed OR v_projection_replaced;

  SELECT
    count(*) FILTER (WHERE action->>'status' <> 'skipped'),
    count(*) FILTER (WHERE action->>'status' = 'executed'),
    count(*) FILTER (WHERE action->>'status' = 'failed'),
    COALESCE(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'action_id', action->>'id', 'action_type', action->>'type',
      'execution_status', action->>'status',
      'execution_result', CASE WHEN action->>'status' = 'failed' THEN left(
        regexp_replace(
          regexp_replace(COALESCE(action->>'result', ''),
            '[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}', '[email]', 'gi'),
          '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', '[id]', 'gi'
        ), 300
      ) ELSE NULL END
    ))), '[]'::jsonb)
  INTO v_attempted, v_executed, v_failed, v_execution_actions
  FROM jsonb_array_elements(COALESCE(p_final_plan->'actions', '[]'::jsonb)) action;
  IF jsonb_array_length(v_ledger_actions) <> jsonb_array_length(p_final_plan->'actions')
     OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(v_ledger_actions) action
       WHERE NOT EXISTS (
         SELECT 1 FROM jsonb_array_elements(p_final_plan->'actions') final_action
         WHERE final_action->>'id' = action->>'id' AND final_action->>'type' = action->>'type'
       )
  ) THEN
    RAISE EXCEPTION 'final actions do not match the claimed plan';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_final_plan->'actions') action
    WHERE COALESCE(action->>'status', '') NOT IN ('executed','failed','skipped')
  ) THEN
    RAISE EXCEPTION 'all final actions must be terminal';
  END IF;
  IF v_attempt_id <> 'legacy' THEN
    IF EXISTS (
      SELECT 1 FROM public.autopilot_action_executions receipt
      WHERE receipt.plan_id = p_plan_id
        AND receipt.execution_attempt_id = v_attempt_id::uuid
        AND receipt.status IN ('reserved','uncertain')
    ) THEN
      RAISE EXCEPTION 'action execution still requires reconciliation';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_final_plan->'actions') action
      WHERE action->>'status' IN ('executed','failed')
        AND NOT EXISTS (
          SELECT 1 FROM public.autopilot_action_executions receipt
          WHERE receipt.plan_id = p_plan_id
            AND receipt.execution_attempt_id = v_attempt_id::uuid
            AND receipt.action_id = (action->>'id')::uuid
            AND (
              (action->>'status' = 'executed' AND receipt.status = 'executed')
              OR (action->>'status' = 'failed' AND receipt.status IN ('failed','uncertain'))
            )
        )
    ) THEN
      RAISE EXCEPTION 'final action outcomes do not match durable execution receipts';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.autopilot_action_executions receipt
      WHERE receipt.plan_id = p_plan_id
        AND receipt.execution_attempt_id = v_attempt_id::uuid
        AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(p_final_plan->'actions') action
          WHERE action->>'id' = receipt.action_id::text
            AND action->>'status' IN ('executed','failed')
        )
    ) THEN
      RAISE EXCEPTION 'durable receipt refers to a skipped or unknown action';
    END IF;
  END IF;
  IF (v_status = 'executed' AND (v_failed > 0 OR v_executed = 0))
     OR (v_status = 'failed' AND v_executed > 0)
     OR (v_status = 'partially_executed' AND (
       v_executed = 0
       OR (v_failed = 0 AND NOT COALESCE((p_final_plan->>'execution_interrupted')::boolean, false))
     )) THEN
    RAISE EXCEPTION 'terminal plan status does not match action outcomes';
  END IF;
  v_signal := CASE WHEN v_failed > 0 OR v_status <> 'executed' THEN 'execution_failure' ELSE 'delayed_outcome' END;
  v_learning_event := jsonb_build_object(
    'id', gen_random_uuid(), 'brand_id', p_brand_id, 'ticket_id', p_ticket_id,
    'plan_id', p_plan_id, 'plan_revision', COALESCE((p_final_plan->>'revision')::integer, 0),
    'event_type', 'execution', 'signal_type', v_signal, 'actor_type', 'agent',
    'actor_id', p_actor_id, 'scope', jsonb_build_object(
      'action_types', COALESCE((SELECT jsonb_agg(DISTINCT action->>'type') FROM jsonb_array_elements(COALESCE(p_final_plan->'actions', '[]'::jsonb)) action), '[]'::jsonb)
    ),
    'trust_score', CASE WHEN v_signal = 'execution_failure' THEN 0.90 ELSE 0.84 END,
    'outcome_score', CASE WHEN v_attempted > 0 THEN v_executed::real / v_attempted ELSE 0 END,
    'payload', jsonb_build_object(
      'source', 'autopilot_execution', 'execution_only', true,
      'plan_status', v_status, 'execution_attempt_id', v_attempt_id,
      'actions', v_execution_actions
    ),
    'idempotency_key', 'execution:' || p_plan_id::text || ':' || v_attempt_id,
    'occurred_at', COALESCE(NULLIF(p_final_plan->>'executed_at', '')::timestamptz, now())
  );
  v_learning := public.insert_autopilot_learning_event_json(
    v_learning_event, p_brand_id, p_ticket_id, p_plan_id,
    COALESCE((p_final_plan->>'revision')::integer, 0), 'execution'
  );

  IF v_ledger_status IN ('executed', 'partially_executed', 'failed') THEN
    RETURN jsonb_build_object(
      'finalized', true, 'replayed', true, 'superseded', v_superseded,
      'status', v_ledger_status, 'learning', v_learning
    );
  END IF;
  IF v_ledger_status NOT IN ('executing', 'superseded') THEN RAISE EXCEPTION 'plan is not executing'; END IF;

  UPDATE public.ticket_action_plans
  SET status = v_status,
      actions = COALESCE(p_final_plan->'actions', '[]'::jsonb),
      analysis = COALESCE(p_final_plan->'analysis', '{}'::jsonb),
      executed_at = COALESCE(NULLIF(p_final_plan->>'executed_at', '')::timestamptz, now()),
      execution_context_version = p_expected_context_version,
      updated_at = now()
  WHERE id = p_plan_id;

  -- A context bump alone must not strand metadata.autopilot='executing'. Keep a
  -- newer replacement projection untouched, but terminalize the still-owned
  -- projection and mark why it was superseded.
  IF NOT v_projection_replaced THEN
    v_metadata := jsonb_set(
      v_metadata,
      '{autopilot}',
      p_final_plan || jsonb_build_object(
        'superseded_during_execution', v_context_changed,
        'execution_context_changed', v_context_changed
      ),
      true
    );
    UPDATE public.tickets SET metadata = v_metadata, updated_at = now()
    WHERE id = p_ticket_id AND brand_id = p_brand_id;
  END IF;

  INSERT INTO public.ticket_events(ticket_id, event_type, actor, actor_id, new_value, metadata)
  VALUES (
    p_ticket_id, 'autopilot_executed', 'agent', p_actor_id, v_status,
    jsonb_build_object(
      'plan_id', p_plan_id, 'executed', v_executed, 'failed', v_failed,
      'superseded_during_execution', v_superseded,
      'expected_context_version', p_expected_context_version,
      'current_context_version', v_ticket.context_version
    )
  );

  RETURN jsonb_build_object(
    'finalized', true, 'replayed', false, 'superseded', v_superseded,
    'status', v_status, 'learning_captured', COALESCE((v_learning->>'captured')::boolean, false),
    'learning', v_learning
  );
END $$;
REVOKE ALL ON FUNCTION public.finalize_autopilot_plan_execution(uuid, uuid, uuid, bigint, jsonb, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_autopilot_plan_execution(uuid, uuid, uuid, bigint, jsonb, uuid) TO service_role;

-- Manual composer send preparation is one transaction: consume the optional AI
-- generation, append its review event, supersede a proposed plan, insert the
-- explicit-id message, apply safe ticket fields, and write audit events.
CREATE OR REPLACE FUNCTION public.prepare_manual_ticket_message(
  p_ticket_id uuid,
  p_brand_id uuid,
  p_expected_context_version bigint,
  p_message jsonb,
  p_ticket_updates jsonb,
  p_generation_id uuid,
  p_learning_event jsonb,
  p_actor_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ticket public.tickets%ROWTYPE;
  v_updated_ticket public.tickets%ROWTYPE;
  v_message public.ticket_messages%ROWTYPE;
  v_existing public.ticket_messages%ROWTYPE;
  v_generation public.autopilot_draft_generations%ROWTYPE;
  v_metadata jsonb;
  v_plan jsonb;
  v_history jsonb;
  v_plan_id uuid;
  v_message_id uuid;
  v_learning jsonb := jsonb_build_object('captured', false);
  v_invalid_key text;
BEGIN
  IF jsonb_typeof(p_message) <> 'object' THEN RAISE EXCEPTION 'message must be an object'; END IF;
  IF jsonb_typeof(COALESCE(p_ticket_updates, '{}'::jsonb)) <> 'object' THEN RAISE EXCEPTION 'ticket updates must be an object'; END IF;
  IF NOT public.is_canonical_uuid(p_message->>'id') THEN RAISE EXCEPTION 'message id must be a canonical UUID'; END IF;
  v_message_id := (p_message->>'id')::uuid;
  IF COALESCE(p_message->>'sender_type', 'agent') <> 'agent'
     OR length(trim(COALESCE(p_message->>'content', ''))) = 0 THEN
    RAISE EXCEPTION 'manual message must be an agent message with content';
  END IF;
  IF jsonb_typeof(COALESCE(p_message->'metadata', '{}'::jsonb)) <> 'object'
     OR jsonb_typeof(COALESCE(p_message->'attachments', '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'message metadata/attachments have invalid shapes';
  END IF;
  SELECT key INTO v_invalid_key
  FROM jsonb_object_keys(COALESCE(p_ticket_updates, '{}'::jsonb)) key
  WHERE key NOT IN ('status', 'first_response_at', 'resolved_at', 'closed_at', 'updated_at')
  LIMIT 1;
  IF v_invalid_key IS NOT NULL THEN RAISE EXCEPTION 'ticket update field % is not allowed', v_invalid_key; END IF;
  IF p_ticket_updates ? 'status' AND p_ticket_updates->>'status' NOT IN ('open', 'pending', 'resolved', 'closed') THEN
    RAISE EXCEPTION 'invalid ticket status';
  END IF;

  SELECT * INTO v_ticket FROM public.tickets
  WHERE id = p_ticket_id AND brand_id = p_brand_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ticket not found'; END IF;

  SELECT * INTO v_existing FROM public.ticket_messages WHERE id = v_message_id;
  IF FOUND THEN
    IF v_existing.ticket_id <> p_ticket_id
       OR v_existing.sender_type <> 'agent'
       OR v_existing.content IS DISTINCT FROM trim(p_message->>'content')
       OR v_existing.is_internal_note IS DISTINCT FROM COALESCE((p_message->>'is_internal_note')::boolean, false)
       OR v_existing.metadata->>'request_hash' IS DISTINCT FROM p_message->'metadata'->>'request_hash'
       OR (p_generation_id IS NOT NULL AND v_existing.metadata->>'generation_id' IS DISTINCT FROM p_generation_id::text) THEN
      RAISE EXCEPTION 'manual message id was reused with different payload';
    END IF;
    RETURN jsonb_build_object(
      'replayed', true, 'message', to_jsonb(v_existing), 'ticket', to_jsonb(v_ticket),
      'superseded_plan_id', NULL,
      'learning_captured', p_generation_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.autopilot_learning_events
        WHERE brand_id = p_brand_id AND ticket_id = p_ticket_id
          AND event_type = 'manual_draft' AND payload->>'generation_id' = p_generation_id::text
      )
    );
  END IF;

  v_metadata := COALESCE(v_ticket.metadata, '{}'::jsonb);
  v_plan := v_metadata->'autopilot';
  IF v_plan->>'status' = 'executing'
     AND NOT COALESCE((p_message->>'is_internal_note')::boolean, false) THEN
    RAISE EXCEPTION 'cannot send manually while Autopilot is executing';
  END IF;
  IF v_ticket.context_version IS DISTINCT FROM p_expected_context_version THEN
    RAISE EXCEPTION 'ticket context changed before manual reply' USING ERRCODE = '40001';
  END IF;

  IF p_generation_id IS NOT NULL THEN
    SELECT * INTO v_generation
    FROM public.autopilot_draft_generations
    WHERE id = p_generation_id AND brand_id = p_brand_id AND ticket_id = p_ticket_id
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'draft generation not found'; END IF;
    IF v_generation.used_at IS NOT NULL THEN RAISE EXCEPTION 'draft generation was already consumed'; END IF;
    IF v_generation.context_version IS NULL
       OR v_generation.context_version IS DISTINCT FROM p_expected_context_version THEN
      RAISE EXCEPTION 'draft generation context is stale' USING ERRCODE = '40001';
    END IF;
    IF v_generation.created_at < now() - interval '4 hours' THEN
      RAISE EXCEPTION 'draft generation expired' USING ERRCODE = '40001';
    END IF;
    IF jsonb_typeof(p_learning_event) <> 'object' THEN RAISE EXCEPTION 'draft learning event is required'; END IF;
    IF p_learning_event->'payload'->>'generation_id' IS DISTINCT FROM p_generation_id::text THEN
      RAISE EXCEPTION 'draft learning event generation mismatch';
    END IF;
  ELSIF p_learning_event IS NOT NULL AND jsonb_typeof(p_learning_event) IS DISTINCT FROM 'null' THEN
    RAISE EXCEPTION 'a learning event requires a draft generation';
  END IF;

  IF v_plan IS NOT NULL AND v_plan->>'status' = 'proposed'
     AND NOT COALESCE((p_message->>'is_internal_note')::boolean, false) THEN
    v_history := COALESCE(v_metadata->'autopilot_history', '[]'::jsonb)
      || jsonb_build_array(v_plan || jsonb_build_object(
        'status', 'superseded', 'superseded_reason', 'manual_agent_reply', 'superseded_at', now()
      ));
    IF jsonb_array_length(v_history) > 20 THEN
      SELECT jsonb_agg(item ORDER BY ord) INTO v_history
      FROM jsonb_array_elements(v_history) WITH ORDINALITY expanded(item, ord)
      WHERE ord > jsonb_array_length(v_history) - 20;
    END IF;
    v_metadata := jsonb_set(v_metadata - 'autopilot', '{autopilot_history}', v_history, true);
    IF public.is_canonical_uuid(v_plan->>'id') THEN
      v_plan_id := (v_plan->>'id')::uuid;
      UPDATE public.ticket_action_plans
      SET status = 'superseded', updated_at = now()
      WHERE id = v_plan_id AND ticket_id = p_ticket_id AND brand_id = p_brand_id AND status = 'proposed';
    END IF;
  END IF;

  INSERT INTO public.ticket_messages (
    id, ticket_id, sender_type, sender_name, sender_email, content, content_html,
    is_internal_note, attachments, email_message_id, ai_generated, metadata, created_at
  ) VALUES (
    v_message_id, p_ticket_id, 'agent', NULLIF(p_message->>'sender_name', ''),
    NULLIF(p_message->>'sender_email', ''), trim(p_message->>'content'),
    NULLIF(p_message->>'content_html', ''), COALESCE((p_message->>'is_internal_note')::boolean, false),
    COALESCE(p_message->'attachments', '[]'::jsonb), NULLIF(p_message->>'email_message_id', ''),
    p_generation_id IS NOT NULL,
    COALESCE(p_message->'metadata', '{}'::jsonb)
      || CASE WHEN p_generation_id IS NULL THEN '{}'::jsonb
              ELSE jsonb_build_object('generation_id', p_generation_id, 'via', 'ticket_composer_ai') END,
    COALESCE(NULLIF(p_message->>'created_at', '')::timestamptz, now())
  ) RETURNING * INTO v_message;

  UPDATE public.tickets ticket
  SET metadata = v_metadata,
      status = CASE WHEN p_ticket_updates ? 'status' THEN p_ticket_updates->>'status' ELSE ticket.status END,
      first_response_at = CASE WHEN p_ticket_updates ? 'first_response_at'
        THEN NULLIF(p_ticket_updates->>'first_response_at', '')::timestamptz ELSE ticket.first_response_at END,
      resolved_at = CASE WHEN p_ticket_updates ? 'resolved_at'
        THEN NULLIF(p_ticket_updates->>'resolved_at', '')::timestamptz ELSE ticket.resolved_at END,
      closed_at = CASE WHEN p_ticket_updates ? 'closed_at'
        THEN NULLIF(p_ticket_updates->>'closed_at', '')::timestamptz ELSE ticket.closed_at END,
      updated_at = now()
  WHERE ticket.id = p_ticket_id AND ticket.brand_id = p_brand_id
  RETURNING ticket.* INTO v_updated_ticket;

  IF p_generation_id IS NOT NULL THEN
    UPDATE public.autopilot_draft_generations
    SET used_at = now(), final_message_id = v_message_id
    WHERE id = p_generation_id AND used_at IS NULL;
    v_learning := public.insert_autopilot_learning_event_json(
      p_learning_event, p_brand_id, p_ticket_id, NULL, 0, 'manual_draft'
    );
  END IF;

  INSERT INTO public.ticket_events(ticket_id, event_type, actor, actor_id, new_value, metadata)
  VALUES (
    p_ticket_id,
    CASE WHEN v_message.is_internal_note THEN 'internal_note_added' ELSE 'message_added' END,
    'agent', p_actor_id, 'agent',
    jsonb_strip_nulls(jsonb_build_object(
      'message_id', v_message_id, 'generation_id', p_generation_id,
      'superseded_plan_id', v_plan_id
    ))
  );
  IF v_plan_id IS NOT NULL THEN
    INSERT INTO public.ticket_events(ticket_id, event_type, actor, actor_id, new_value, metadata)
    VALUES (
      p_ticket_id, 'autopilot_superseded', 'agent', p_actor_id, 'manual_agent_reply',
      jsonb_build_object('plan_id', v_plan_id, 'message_id', v_message_id)
    );
  END IF;

  RETURN jsonb_build_object(
    'replayed', false, 'message', to_jsonb(v_message), 'ticket', to_jsonb(v_updated_ticket),
    'superseded_plan_id', v_plan_id,
    'learning_captured', COALESCE((v_learning->>'captured')::boolean, false),
    'learning', v_learning
  );
END $$;
REVOKE ALL ON FUNCTION public.prepare_manual_ticket_message(uuid, uuid, bigint, jsonb, jsonb, uuid, jsonb, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.prepare_manual_ticket_message(uuid, uuid, bigint, jsonb, jsonb, uuid, jsonb, uuid) TO service_role;

-- Complete the provider-backed portion of a manual reply. The outbound
-- message is durable before the provider call, but first-response/status/CSAT
-- semantics are not committed until delivery is confirmed. A concurrent
-- customer change keeps the reply delivered while refusing a stale workflow
-- transition such as "resolved".
CREATE OR REPLACE FUNCTION public.finalize_manual_ticket_message_delivery(
  p_ticket_id uuid,
  p_brand_id uuid,
  p_message_id uuid,
  p_requested_status text,
  p_provider_message_id text,
  p_actor_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ticket public.tickets%ROWTYPE;
  v_message public.ticket_messages%ROWTYPE;
  v_expected_context bigint;
  v_old_status text;
  v_status_applied boolean := false;
  v_context_conflict boolean := false;
  v_metadata jsonb;
BEGIN
  IF p_requested_status IS NOT NULL
     AND p_requested_status NOT IN ('open', 'pending', 'resolved', 'closed') THEN
    RAISE EXCEPTION 'invalid requested ticket status';
  END IF;

  SELECT * INTO v_ticket FROM public.tickets
  WHERE id = p_ticket_id AND brand_id = p_brand_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ticket not found'; END IF;

  SELECT * INTO v_message FROM public.ticket_messages
  WHERE id = p_message_id AND ticket_id = p_ticket_id
  FOR UPDATE;
  IF NOT FOUND OR v_message.sender_type <> 'agent' OR v_message.is_internal_note THEN
    RAISE EXCEPTION 'customer-facing agent message not found';
  END IF;
  v_metadata := COALESCE(v_message.metadata, '{}'::jsonb);
  IF v_metadata->>'requested_status' IS DISTINCT FROM p_requested_status THEN
    RAISE EXCEPTION 'requested status does not match the prepared message';
  END IF;
  IF COALESCE(v_metadata->>'request_context_version', '') !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'prepared message has no valid context lineage';
  END IF;
  v_expected_context := (v_metadata->>'request_context_version')::bigint + 1;

  IF COALESCE((v_metadata->>'delivery_finalized')::boolean, false) THEN
    IF p_provider_message_id IS NOT NULL AND v_message.email_message_id IS NOT NULL
       AND p_provider_message_id IS DISTINCT FROM v_message.email_message_id THEN
      RAISE EXCEPTION 'provider message id changed for finalized delivery';
    END IF;
    RETURN jsonb_build_object(
      'finalized', true, 'replayed', true,
      'status_applied', COALESCE((v_metadata->>'delivery_status_applied')::boolean, false),
      'context_conflict', COALESCE((v_metadata->>'delivery_context_conflict')::boolean, false),
      'message', to_jsonb(v_message), 'ticket', to_jsonb(v_ticket)
    );
  END IF;

  v_old_status := v_ticket.status;
  IF p_requested_status IS NOT NULL THEN
    IF v_ticket.context_version = v_expected_context THEN
      v_status_applied := true;
    ELSE
      v_context_conflict := true;
    END IF;
  END IF;

  UPDATE public.tickets ticket
  SET first_response_at = COALESCE(ticket.first_response_at, now()),
      status = CASE WHEN v_status_applied THEN p_requested_status ELSE ticket.status END,
      resolved_at = CASE
        WHEN v_status_applied AND p_requested_status = 'resolved' THEN COALESCE(ticket.resolved_at, now())
        ELSE ticket.resolved_at
      END,
      closed_at = CASE
        WHEN v_status_applied AND p_requested_status = 'closed' THEN COALESCE(ticket.closed_at, now())
        ELSE ticket.closed_at
      END,
      updated_at = now()
  WHERE ticket.id = p_ticket_id AND ticket.brand_id = p_brand_id
  RETURNING ticket.* INTO v_ticket;

  v_metadata := v_metadata || jsonb_build_object(
    'email_status', 'sent',
    'email_sending_at', NULL,
    'email_error', NULL,
    'delivery_finalized', true,
    'delivery_finalized_at', now(),
    'delivery_status_applied', v_status_applied,
    'delivery_context_conflict', v_context_conflict
  );
  UPDATE public.ticket_messages message
  SET email_message_id = COALESCE(p_provider_message_id, message.email_message_id),
      metadata = v_metadata
  WHERE message.id = p_message_id
  RETURNING message.* INTO v_message;

  IF v_status_applied AND v_old_status IS DISTINCT FROM p_requested_status THEN
    INSERT INTO public.ticket_events(ticket_id, event_type, actor, actor_id, old_value, new_value, metadata)
    VALUES (
      p_ticket_id, 'status_changed', 'agent', p_actor_id,
      v_old_status, p_requested_status,
      jsonb_build_object('via', 'manual_reply_delivery', 'message_id', p_message_id)
    );
  END IF;

  RETURN jsonb_build_object(
    'finalized', true, 'replayed', false,
    'status_applied', v_status_applied,
    'context_conflict', v_context_conflict,
    'message', to_jsonb(v_message), 'ticket', to_jsonb(v_ticket)
  );
END $$;
REVOKE ALL ON FUNCTION public.finalize_manual_ticket_message_delivery(uuid, uuid, uuid, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_manual_ticket_message_delivery(uuid, uuid, uuid, text, text, uuid) TO service_role;

-- Smaller compatibility primitive for callers that already inserted the final
-- message. It still makes generation consumption + learning append atomic.
CREATE OR REPLACE FUNCTION public.consume_autopilot_draft_generation(
  p_generation_id uuid,
  p_brand_id uuid,
  p_ticket_id uuid,
  p_message_id uuid,
  p_learning_event jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_generation public.autopilot_draft_generations%ROWTYPE;
  v_learning jsonb;
BEGIN
  SELECT * INTO v_generation FROM public.autopilot_draft_generations
  WHERE id = p_generation_id AND brand_id = p_brand_id AND ticket_id = p_ticket_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'draft generation not found'; END IF;
  IF v_generation.used_at IS NOT NULL THEN
    IF v_generation.final_message_id = p_message_id THEN
      RETURN jsonb_build_object('consumed', true, 'replayed', true, 'message_id', p_message_id);
    END IF;
    RAISE EXCEPTION 'draft generation was already consumed by another message';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ticket_messages WHERE id = p_message_id AND ticket_id = p_ticket_id) THEN
    RAISE EXCEPTION 'final message not found';
  END IF;
  IF p_learning_event->'payload'->>'generation_id' IS DISTINCT FROM p_generation_id::text THEN
    RAISE EXCEPTION 'draft learning event generation mismatch';
  END IF;
  v_learning := public.insert_autopilot_learning_event_json(
    p_learning_event, p_brand_id, p_ticket_id, NULL, 0, 'manual_draft'
  );
  UPDATE public.autopilot_draft_generations
  SET used_at = now(), final_message_id = p_message_id
  WHERE id = p_generation_id AND used_at IS NULL;
  RETURN jsonb_build_object('consumed', true, 'replayed', false, 'message_id', p_message_id, 'learning', v_learning);
END $$;
REVOKE ALL ON FUNCTION public.consume_autopilot_draft_generation(uuid, uuid, uuid, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_autopilot_draft_generation(uuid, uuid, uuid, uuid, jsonb) TO service_role;

-- ── Idempotent memory/evidence merge ────────────────────────────────────────

DROP FUNCTION IF EXISTS public.merge_autopilot_learning_memory(
  uuid, text, text, text, jsonb, boolean, integer, uuid, text, real, real, text
);

CREATE OR REPLACE FUNCTION public.merge_autopilot_learning_memory(
  p_brand_id uuid,
  p_memory_key text,
  p_kind text,
  p_statement text,
  p_scope jsonb,
  p_time_sensitive boolean,
  p_valid_for_days integer,
  p_event_id uuid,
  p_stance text,
  p_source_trust real,
  p_extraction_confidence real,
  p_learner_version text,
  p_worker_id text,
  p_claim_token uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_memory_id uuid;
  v_event_brand uuid;
  v_event_occurred_at timestamptz;
  v_event_signal text;
  v_inserted integer;
  v_positive real;
  v_negative real;
  v_evidence_count integer;
  v_positive_count integer;
  v_contradiction_count integer;
  v_revision_count integer;
  v_avg_trust real;
  v_confidence real;
  v_valid_until timestamptz;
  v_status text;
  v_scope_hash text;
  v_event_memory_id uuid;
  v_event_memory_stance text;
BEGIN
  IF p_kind NOT IN ('style','procedure','fact','anti_pattern') THEN
    RAISE EXCEPTION 'invalid memory kind';
  END IF;
  IF length(trim(COALESCE(p_memory_key, ''))) = 0 OR length(p_memory_key) > 160
     OR length(trim(COALESCE(p_statement, ''))) = 0 THEN
    RAISE EXCEPTION 'memory key and statement are required';
  END IF;
  IF p_stance NOT IN ('support','contradict') THEN
    RAISE EXCEPTION 'invalid evidence stance';
  END IF;
  IF p_source_trust < 0 OR p_source_trust > 1 OR p_extraction_confidence < 0 OR p_extraction_confidence > 1 THEN
    RAISE EXCEPTION 'confidence/trust out of range';
  END IF;
  IF jsonb_typeof(COALESCE(p_scope, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'scope must be a JSON object';
  END IF;
  IF p_claim_token IS NULL OR length(trim(COALESCE(p_worker_id, ''))) = 0 THEN
    RAISE EXCEPTION 'worker and claim token are required';
  END IF;

  SELECT brand_id, occurred_at, signal_type INTO v_event_brand, v_event_occurred_at, v_event_signal
  FROM public.autopilot_learning_events
  WHERE id = p_event_id
    AND processor_id = p_worker_id
    AND claim_token = p_claim_token
    AND lease_until > now()
    AND processed_at IS NULL
    AND dead_lettered_at IS NULL
  FOR UPDATE;
  IF v_event_brand IS NULL OR v_event_brand <> p_brand_id THEN
    RAISE EXCEPTION 'event is not owned by this live worker claim';
  END IF;

  v_valid_until := CASE
    WHEN p_time_sensitive THEN v_event_occurred_at + make_interval(days => LEAST(GREATEST(COALESCE(p_valid_for_days, 30), 1), 365))
    ELSE NULL
  END;
  v_scope_hash := public.autopilot_scope_hash(COALESCE(p_scope, '{}'::jsonb));
  -- One immutable source event may select only one version of a semantic key.
  -- If a nondeterministic learner retry rephrases it, retain the first
  -- canonical extraction instead of activating two competing statements.
  SELECT memory.id, evidence.stance INTO v_event_memory_id, v_event_memory_stance
  FROM public.autopilot_learning_memories memory
  JOIN public.autopilot_learning_evidence evidence ON evidence.memory_id = memory.id
  WHERE evidence.event_id = p_event_id
    AND memory.brand_id = p_brand_id
    AND memory.memory_key = p_memory_key
    AND memory.scope_hash = v_scope_hash
    AND memory.kind = p_kind
  ORDER BY CASE evidence.stance WHEN 'support' THEN 0 ELSE 1 END,
           evidence.created_at ASC, memory.id ASC
  LIMIT 1;
  IF v_event_memory_id IS NOT NULL THEN
    IF v_event_memory_stance IS DISTINCT FROM p_stance THEN
      RAISE EXCEPTION 'immutable memory evidence stance conflict';
    END IF;
    RETURN v_event_memory_id;
  END IF;

  INSERT INTO public.autopilot_learning_memories (
    brand_id, memory_key, kind, statement, scope, scope_hash, time_sensitive,
    valid_from, valid_until, last_supported_at, learner_version
  ) VALUES (
    p_brand_id, p_memory_key, p_kind, left(p_statement, 1200), COALESCE(p_scope, '{}'::jsonb), v_scope_hash,
    p_time_sensitive, v_event_occurred_at, v_valid_until,
    CASE WHEN p_stance = 'support' THEN v_event_occurred_at ELSE NULL END,
    p_learner_version
  )
  ON CONFLICT (brand_id, memory_key, scope_hash, kind, statement_hash) DO UPDATE SET
    memory_key = public.autopilot_learning_memories.memory_key
  RETURNING id INTO v_memory_id;

  INSERT INTO public.autopilot_learning_evidence (
    memory_id, event_id, stance, source_trust, extraction_confidence, evidence_weight
  ) VALUES (
    v_memory_id, p_event_id, p_stance, p_source_trust, p_extraction_confidence,
    p_source_trust * p_extraction_confidence
  )
  ON CONFLICT (memory_id, event_id) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  IF v_inserted = 0 AND EXISTS (
    SELECT 1 FROM public.autopilot_learning_evidence evidence
    WHERE evidence.memory_id = v_memory_id AND evidence.event_id = p_event_id
      AND evidence.stance IS DISTINCT FROM p_stance
  ) THEN
    RAISE EXCEPTION 'immutable memory evidence replay conflict';
  END IF;

  -- A high-trust human correction must not leave an older semantic sibling
  -- active beside the corrected wording. Keep both versions for audit, attach
  -- contradiction provenance to the stale sibling, and dispute it so prompt
  -- retrieval cannot present mutually exclusive guidance.
  IF v_inserted > 0 AND p_stance = 'support'
     AND v_event_signal IN ('human_revision','human_edit')
     AND p_source_trust >= 0.90 THEN
    WITH inserted_contradictions AS (
      INSERT INTO public.autopilot_learning_evidence (
        memory_id, event_id, stance, source_trust, extraction_confidence, evidence_weight
      )
      SELECT sibling.id, p_event_id, 'contradict', p_source_trust,
             p_extraction_confidence, p_source_trust * p_extraction_confidence
      FROM public.autopilot_learning_memories sibling
      WHERE sibling.brand_id = p_brand_id
        AND sibling.memory_key = p_memory_key
        AND sibling.scope_hash = v_scope_hash
        AND sibling.kind = p_kind
        AND sibling.id <> v_memory_id
        AND sibling.status IN ('active','candidate')
      ON CONFLICT (memory_id, event_id) DO NOTHING
      RETURNING memory_id, evidence_weight
    ), contradiction_mass AS (
      SELECT memory_id, count(*)::integer AS added_count,
             sum(evidence_weight)::real AS added_mass
      FROM inserted_contradictions GROUP BY memory_id
    )
    UPDATE public.autopilot_learning_memories sibling
    SET negative_mass = sibling.negative_mass + mass.added_mass,
        evidence_count = sibling.evidence_count + mass.added_count,
        contradiction_count = sibling.contradiction_count + mass.added_count,
        confidence_score = (0.25 + sibling.positive_mass)
          / (0.5 + sibling.positive_mass + sibling.negative_mass + mass.added_mass),
        status = 'disputed',
        updated_at = now()
    FROM contradiction_mass mass
    WHERE sibling.id = mass.memory_id;
  END IF;

  IF v_inserted > 0 THEN
    IF p_stance = 'support' THEN
      UPDATE public.autopilot_learning_memories memory
      SET time_sensitive = memory.time_sensitive OR p_time_sensitive,
          valid_from = LEAST(memory.valid_from, v_event_occurred_at),
          last_supported_at = GREATEST(
            COALESCE(memory.last_supported_at, v_event_occurred_at),
            v_event_occurred_at
          ),
          valid_until = CASE
            WHEN memory.valid_until IS NULL THEN v_valid_until
            WHEN v_valid_until IS NULL THEN memory.valid_until
            ELSE GREATEST(memory.valid_until, v_valid_until)
          END,
          learner_version = p_learner_version,
          updated_at = now()
      WHERE memory.id = v_memory_id;
    END IF;

    SELECT valid_until INTO v_valid_until
    FROM public.autopilot_learning_memories
    WHERE id = v_memory_id;

    SELECT
      COALESCE(sum(CASE WHEN evidence.stance = 'support' THEN evidence.evidence_weight ELSE 0 END), 0),
      COALESCE(sum(CASE WHEN evidence.stance = 'contradict' THEN evidence.evidence_weight ELSE 0 END), 0),
      count(*)::integer,
      count(*) FILTER (WHERE evidence.stance = 'support')::integer,
      count(*) FILTER (WHERE evidence.stance = 'contradict')::integer,
      count(*) FILTER (
        WHERE evidence.stance = 'support' AND event.signal_type IN ('human_revision','human_edit')
      )::integer,
      COALESCE(avg(evidence.source_trust), 0.5)
    INTO v_positive, v_negative, v_evidence_count, v_positive_count,
         v_contradiction_count, v_revision_count, v_avg_trust
    FROM public.autopilot_learning_evidence evidence
    JOIN public.autopilot_learning_events event ON event.id = evidence.event_id
    WHERE evidence.memory_id = v_memory_id;

    -- Weak Beta(0.25, 0.25) prior: one high-trust human correction can become
    -- active, while a clean approval alone remains only a candidate.
    v_confidence := (0.25 + v_positive) / (0.5 + v_positive + v_negative);
    v_status := CASE
      WHEN v_valid_until IS NOT NULL AND v_valid_until <= now() THEN 'expired'
      WHEN v_negative >= GREATEST(0.35, v_positive * 0.75) THEN 'disputed'
      WHEN (v_revision_count > 0 OR v_positive_count >= 2) AND v_confidence >= 0.60 THEN 'active'
      ELSE 'candidate'
    END;

    UPDATE public.autopilot_learning_memories
    SET confidence_score = v_confidence,
        trust_score = v_avg_trust,
        evidence_count = v_evidence_count,
        positive_evidence_count = v_positive_count,
        contradiction_count = v_contradiction_count,
        human_revision_count = v_revision_count,
        positive_mass = v_positive,
        negative_mass = v_negative,
        status = v_status,
        updated_at = now()
    WHERE id = v_memory_id;
  END IF;

  RETURN v_memory_id;
END $$;

REVOKE ALL ON FUNCTION public.merge_autopilot_learning_memory(
  uuid, text, text, text, jsonb, boolean, integer, uuid, text, real, real, text, text, uuid
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.merge_autopilot_learning_memory(
  uuid, text, text, text, jsonb, boolean, integer, uuid, text, real, real, text, text, uuid
) TO service_role;

-- The legacy global blob has no scope/provenance and must not remain in the
-- prompt once scoped memory is enabled. Keep the row for audit/rollback.
UPDATE public.support_facts
SET enabled = false, updated_at = now()
WHERE key = 'autopilot_learned_lessons';

COMMIT;
