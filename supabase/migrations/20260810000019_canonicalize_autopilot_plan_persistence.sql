-- The ticket plan is the canonical proposal. The normalized ledger is a
-- durable projection of that exact plan, not a second independently trusted
-- payload. Canonicalize the duplicated fields before invoking the strict v18
-- transaction so JSON serialization differences cannot discard a safe
-- deterministic fallback during provider outages.

ALTER FUNCTION public.persist_autopilot_plan(
  uuid, uuid, timestamptz, bigint, uuid, timestamptz, jsonb, jsonb, jsonb
) RENAME TO persist_autopilot_plan_v18;

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
  v_ledger jsonb;
BEGIN
  IF jsonb_typeof(p_plan) <> 'object' OR jsonb_typeof(p_ledger) <> 'object' THEN
    RAISE EXCEPTION 'plan and ledger must be objects';
  END IF;

  v_ledger := p_ledger || jsonb_build_object(
    'actions', COALESCE(p_plan->'actions', '[]'::jsonb),
    'analysis', COALESCE(p_plan->'analysis', '{}'::jsonb)
      || CASE WHEN p_plan ? 'generation'
           THEN jsonb_build_object('generation', p_plan->'generation')
           ELSE '{}'::jsonb
         END,
    'evidence', COALESCE(p_plan->'evidence', '{}'::jsonb),
    'trigger', p_plan->'trigger',
    'context_fingerprint', p_plan->'context_fingerprint'
  );

  RETURN public.persist_autopilot_plan_v18(
    p_ticket_id,
    p_brand_id,
    p_expected_updated_at,
    p_expected_context_version,
    p_expected_previous_plan_id,
    p_expected_previous_proposed_at,
    p_plan,
    v_ledger,
    p_attributions
  );
END $$;

REVOKE ALL ON FUNCTION public.persist_autopilot_plan_v18(
  uuid, uuid, timestamptz, bigint, uuid, timestamptz, jsonb, jsonb, jsonb
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.persist_autopilot_plan(
  uuid, uuid, timestamptz, bigint, uuid, timestamptz, jsonb, jsonb, jsonb
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.persist_autopilot_plan(
  uuid, uuid, timestamptz, bigint, uuid, timestamptz, jsonb, jsonb, jsonb
) TO service_role;
