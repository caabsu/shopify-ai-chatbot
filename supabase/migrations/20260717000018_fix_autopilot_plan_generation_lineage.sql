-- Fix atomic Autopilot persistence after model generation lineage was added.
--
-- The ticket projection intentionally stores generation at p_plan.generation,
-- while the normalized ticket_action_plans ledger embeds the same immutable
-- lineage at analysis.generation because that table predates model columns.
-- Migration 012 compared the two analysis objects byte-for-byte, so every
-- generated V3 plan failed with "plan and ledger content mismatch".
--
-- Keep the validation strict: the ledger analysis must equal plan.analysis
-- plus exactly the plan's own generation value. Unexpected additions or
-- altered lineage still fail atomically.

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
     OR COALESCE(p_ledger->'analysis', '{}'::jsonb) IS DISTINCT FROM (
       COALESCE(p_plan->'analysis', '{}'::jsonb)
       || CASE WHEN p_plan ? 'generation'
            THEN jsonb_build_object('generation', p_plan->'generation')
            ELSE '{}'::jsonb
          END
     )
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

REVOKE ALL ON FUNCTION public.persist_autopilot_plan(
  uuid, uuid, timestamptz, bigint, uuid, timestamptz, jsonb, jsonb, jsonb
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.persist_autopilot_plan(
  uuid, uuid, timestamptz, bigint, uuid, timestamptz, jsonb, jsonb, jsonb
) TO service_role;
