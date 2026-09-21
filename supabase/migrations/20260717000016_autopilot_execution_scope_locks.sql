-- 016 — Database-enforced Autopilot execution-scope leases
--
-- Per-action receipts fence one action identity. These leases add a second,
-- cross-plan fence so two admins/workers cannot concurrently act on the same
-- customer, Shopify order, primary ticket, or related ticket.

BEGIN;

CREATE TABLE IF NOT EXISTS public.autopilot_execution_scope_locks (
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  scope_key text NOT NULL,
  receipt_id uuid NOT NULL REFERENCES public.autopilot_action_executions(id) ON DELETE CASCADE,
  worker_token uuid NOT NULL,
  lease_expires_at timestamptz NOT NULL,
  heartbeat_at timestamptz NOT NULL DEFAULT now(),
  acquired_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (brand_id, scope_key),
  CONSTRAINT autopilot_execution_scope_locks_scope_key_check CHECK (
    scope_key ~ (
      '^(customer-email|shopify-customer|order):sha256:[0-9a-f]{64}$'
      || '|^ticket:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    )
  )
);

CREATE INDEX IF NOT EXISTS autopilot_execution_scope_locks_receipt_idx
  ON public.autopilot_execution_scope_locks (receipt_id);
CREATE INDEX IF NOT EXISTS autopilot_execution_scope_locks_expiry_idx
  ON public.autopilot_execution_scope_locks (lease_expires_at);

ALTER TABLE public.autopilot_execution_scope_locks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role reads Autopilot execution scope locks"
  ON public.autopilot_execution_scope_locks;
CREATE POLICY "Service role reads Autopilot execution scope locks"
  ON public.autopilot_execution_scope_locks
  FOR SELECT TO service_role USING (true);
REVOKE ALL ON public.autopilot_execution_scope_locks FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.autopilot_execution_scope_locks TO service_role;

CREATE OR REPLACE FUNCTION public.acquire_autopilot_execution_scopes(
  p_receipt_id uuid,
  p_brand_id uuid,
  p_worker_token uuid,
  p_scope_keys text[],
  p_lease_seconds integer DEFAULT 120
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_receipt public.autopilot_action_executions%ROWTYPE;
  v_lock public.autopilot_execution_scope_locks%ROWTYPE;
  v_owner_status text;
  v_keys text[];
  v_key text;
  v_now timestamptz := clock_timestamp();
  v_deadline timestamptz;
  v_inserted integer;
  v_conflict_key text;
  v_conflict_receipt_id uuid;
  v_conflict_status text;
  v_conflict_lease_expires_at timestamptz;
BEGIN
  IF p_receipt_id IS NULL OR p_brand_id IS NULL OR p_worker_token IS NULL
     OR p_scope_keys IS NULL OR cardinality(p_scope_keys) NOT BETWEEN 1 AND 50
     OR p_lease_seconds NOT BETWEEN 30 AND 300 THEN
    RAISE EXCEPTION 'invalid execution scope acquisition identity';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM unnest(p_scope_keys) AS input(scope_key)
    WHERE input.scope_key IS NULL
       OR length(input.scope_key) NOT BETWEEN 1 AND 180
       OR input.scope_key !~ (
         '^(customer-email|shopify-customer|order):sha256:[0-9a-f]{64}$'
         || '|^ticket:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       )
  ) THEN
    RAISE EXCEPTION 'invalid execution scope key';
  END IF;

  SELECT array_agg(DISTINCT input.scope_key ORDER BY input.scope_key)
  INTO v_keys
  FROM unnest(p_scope_keys) AS input(scope_key);
  IF cardinality(v_keys) IS DISTINCT FROM cardinality(p_scope_keys) THEN
    RAISE EXCEPTION 'execution scope keys must be unique';
  END IF;

  SELECT *
  INTO v_receipt
  FROM public.autopilot_action_executions
  WHERE id = p_receipt_id AND brand_id = p_brand_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'action receipt not found'; END IF;
  IF v_receipt.worker_token IS DISTINCT FROM p_worker_token THEN
    RAISE EXCEPTION 'execution scopes are fenced to another worker' USING ERRCODE = '40001';
  END IF;
  IF v_receipt.status <> 'reserved' THEN
    RETURN jsonb_build_object(
      'acquired', false,
      'code', 'RECEIPT_TERMINAL',
      'receipt_status', v_receipt.status
    );
  END IF;
  IF v_receipt.lease_expires_at <= v_now THEN
    RETURN jsonb_build_object(
      'acquired', false,
      'code', 'RECEIPT_LEASE_EXPIRED',
      'lease_expires_at', v_receipt.lease_expires_at
    );
  END IF;

  v_deadline := v_now + make_interval(secs => p_lease_seconds);

  -- This nested block is a savepoint. A conflict rolls back every lock row
  -- inserted or renewed earlier in the sorted loop, preserving all-or-nothing
  -- acquisition across overlapping multi-key scopes.
  BEGIN
    FOREACH v_key IN ARRAY v_keys
    LOOP
      SELECT *
      INTO v_lock
      FROM public.autopilot_execution_scope_locks
      WHERE brand_id = p_brand_id AND scope_key = v_key
      FOR UPDATE;

      IF NOT FOUND THEN
        INSERT INTO public.autopilot_execution_scope_locks (
          brand_id, scope_key, receipt_id, worker_token,
          lease_expires_at, heartbeat_at, acquired_at, updated_at
        ) VALUES (
          p_brand_id, v_key, p_receipt_id, p_worker_token,
          v_deadline, v_now, v_now, v_now
        )
        ON CONFLICT (brand_id, scope_key) DO NOTHING;
        GET DIAGNOSTICS v_inserted = ROW_COUNT;
        SELECT *
        INTO v_lock
        FROM public.autopilot_execution_scope_locks
        WHERE brand_id = p_brand_id AND scope_key = v_key
        FOR UPDATE;
        IF v_inserted = 1 THEN CONTINUE; END IF;
      END IF;

      IF v_lock.receipt_id = p_receipt_id THEN
        IF v_lock.worker_token IS DISTINCT FROM p_worker_token THEN
          -- A receipt-level recovery may install a new worker token after the
          -- old scope lease has expired. The receipt row above is locked,
          -- reserved, unexpired, and already fenced to p_worker_token, so only
          -- this narrow same-receipt takeover is safe. A live old scope token
          -- remains a hard conflict.
          IF v_lock.lease_expires_at > v_now THEN
            RAISE EXCEPTION 'execution scope receipt is fenced to another live worker'
              USING ERRCODE = '40001';
          END IF;
          UPDATE public.autopilot_execution_scope_locks
          SET worker_token = p_worker_token,
              lease_expires_at = v_deadline,
              heartbeat_at = v_now,
              acquired_at = v_now,
              updated_at = v_now
          WHERE brand_id = p_brand_id AND scope_key = v_key;
          CONTINUE;
        END IF;
        UPDATE public.autopilot_execution_scope_locks
        SET lease_expires_at = v_deadline,
            heartbeat_at = v_now,
            updated_at = v_now
        WHERE brand_id = p_brand_id AND scope_key = v_key;
        CONTINUE;
      END IF;

      SELECT status
      INTO v_owner_status
      FROM public.autopilot_action_executions
      WHERE id = v_lock.receipt_id;

      -- A terminal receipt proves the old provider/local outcome. Its orphaned
      -- lock is safe to replace even before the stale lease timestamp passes.
      IF v_owner_status IN ('executed', 'failed') THEN
        UPDATE public.autopilot_execution_scope_locks
        SET receipt_id = p_receipt_id,
            worker_token = p_worker_token,
            lease_expires_at = v_deadline,
            heartbeat_at = v_now,
            acquired_at = v_now,
            updated_at = v_now
        WHERE brand_id = p_brand_id AND scope_key = v_key;
        CONTINUE;
      END IF;

      -- Live, expired-reserved, and uncertain owners all fail closed. In
      -- particular, an expired timestamp never grants permission to repeat a
      -- provider mutation whose receipt has not been reconciled.
      v_conflict_key := v_key;
      v_conflict_receipt_id := v_lock.receipt_id;
      v_conflict_status := COALESCE(v_owner_status, 'missing');
      v_conflict_lease_expires_at := v_lock.lease_expires_at;
      RAISE SQLSTATE '55P03' USING MESSAGE = 'Autopilot execution scope is busy';
    END LOOP;
  EXCEPTION
    WHEN lock_not_available THEN
      RETURN jsonb_build_object(
        'acquired', false,
        'code', CASE
          WHEN v_conflict_status = 'uncertain' THEN 'SCOPE_UNCERTAIN'
          WHEN v_conflict_lease_expires_at <= v_now THEN 'SCOPE_EXPIRED_UNRECONCILED'
          ELSE 'SCOPE_BUSY'
        END,
        'conflict_scope_key', v_conflict_key,
        'conflict_receipt_id', v_conflict_receipt_id,
        'conflict_receipt_status', v_conflict_status,
        'lease_expires_at', v_conflict_lease_expires_at
      );
  END;

  RETURN jsonb_build_object(
    'acquired', true,
    'scope_count', cardinality(v_keys),
    'lease_expires_at', v_deadline
  );
END $$;

REVOKE ALL ON FUNCTION public.acquire_autopilot_execution_scopes(uuid, uuid, uuid, text[], integer)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.acquire_autopilot_execution_scopes(uuid, uuid, uuid, text[], integer)
  TO service_role;

CREATE OR REPLACE FUNCTION public.heartbeat_autopilot_execution_scopes(
  p_receipt_id uuid,
  p_brand_id uuid,
  p_worker_token uuid,
  p_scope_keys text[],
  p_lease_seconds integer DEFAULT 120
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_receipt public.autopilot_action_executions%ROWTYPE;
  v_lock public.autopilot_execution_scope_locks%ROWTYPE;
  v_keys text[];
  v_key text;
  v_owned_count integer;
  v_now timestamptz := clock_timestamp();
  v_deadline timestamptz;
BEGIN
  IF p_receipt_id IS NULL OR p_brand_id IS NULL OR p_worker_token IS NULL
     OR p_scope_keys IS NULL OR cardinality(p_scope_keys) NOT BETWEEN 1 AND 50
     OR p_lease_seconds NOT BETWEEN 30 AND 300 THEN
    RAISE EXCEPTION 'invalid execution scope heartbeat identity';
  END IF;
  SELECT array_agg(DISTINCT input.scope_key ORDER BY input.scope_key)
  INTO v_keys
  FROM unnest(p_scope_keys) AS input(scope_key);
  IF cardinality(v_keys) IS DISTINCT FROM cardinality(p_scope_keys) THEN
    RAISE EXCEPTION 'execution scope heartbeat keys must be unique';
  END IF;

  SELECT *
  INTO v_receipt
  FROM public.autopilot_action_executions
  WHERE id = p_receipt_id AND brand_id = p_brand_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'action receipt not found'; END IF;
  IF v_receipt.worker_token IS DISTINCT FROM p_worker_token THEN
    RAISE EXCEPTION 'execution scope heartbeat is fenced to another worker'
      USING ERRCODE = '40001';
  END IF;
  IF v_receipt.status <> 'reserved' THEN
    RETURN jsonb_build_object(
      'renewed', false, 'terminal', true, 'receipt_status', v_receipt.status
    );
  END IF;
  IF v_receipt.lease_expires_at <= v_now THEN
    RETURN jsonb_build_object(
      'renewed', false, 'lease_expired', true, 'code', 'RECEIPT_LEASE_EXPIRED'
    );
  END IF;

  SELECT count(*)::integer
  INTO v_owned_count
  FROM public.autopilot_execution_scope_locks
  WHERE brand_id = p_brand_id AND receipt_id = p_receipt_id;
  IF v_owned_count IS DISTINCT FROM cardinality(v_keys) THEN
    RETURN jsonb_build_object(
      'renewed', false, 'lease_lost', true, 'code', 'SCOPE_SET_CHANGED'
    );
  END IF;

  -- Validate and row-lock the exact complete set before renewing any row.
  FOREACH v_key IN ARRAY v_keys
  LOOP
    SELECT *
    INTO v_lock
    FROM public.autopilot_execution_scope_locks
    WHERE brand_id = p_brand_id AND scope_key = v_key
    FOR UPDATE;
    IF NOT FOUND
       OR v_lock.receipt_id IS DISTINCT FROM p_receipt_id
       OR v_lock.worker_token IS DISTINCT FROM p_worker_token THEN
      RETURN jsonb_build_object(
        'renewed', false, 'lease_lost', true, 'code', 'SCOPE_OWNERSHIP_CHANGED',
        'scope_key', v_key
      );
    END IF;
    IF v_lock.lease_expires_at <= v_now THEN
      RETURN jsonb_build_object(
        'renewed', false, 'lease_expired', true, 'code', 'SCOPE_LEASE_EXPIRED',
        'scope_key', v_key, 'lease_expires_at', v_lock.lease_expires_at
      );
    END IF;
  END LOOP;

  v_deadline := v_now + make_interval(secs => p_lease_seconds);
  UPDATE public.autopilot_execution_scope_locks
  SET lease_expires_at = v_deadline,
      heartbeat_at = v_now,
      updated_at = v_now
  WHERE brand_id = p_brand_id
    AND receipt_id = p_receipt_id
    AND scope_key = ANY(v_keys);

  RETURN jsonb_build_object(
    'renewed', true,
    'scope_count', cardinality(v_keys),
    'lease_expires_at', v_deadline
  );
END $$;

REVOKE ALL ON FUNCTION public.heartbeat_autopilot_execution_scopes(uuid, uuid, uuid, text[], integer)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.heartbeat_autopilot_execution_scopes(uuid, uuid, uuid, text[], integer)
  TO service_role;

CREATE OR REPLACE FUNCTION public.release_autopilot_execution_scopes(
  p_receipt_id uuid,
  p_brand_id uuid,
  p_worker_token uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_receipt public.autopilot_action_executions%ROWTYPE;
  v_released integer;
BEGIN
  IF p_receipt_id IS NULL OR p_brand_id IS NULL OR p_worker_token IS NULL THEN
    RAISE EXCEPTION 'invalid execution scope release identity';
  END IF;
  SELECT *
  INTO v_receipt
  FROM public.autopilot_action_executions
  WHERE id = p_receipt_id AND brand_id = p_brand_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'action receipt not found'; END IF;

  -- Uncertain receipts intentionally retain their scope fence. Expiry alone
  -- never permits another action until reconciliation makes the outcome
  -- executed or failed.
  IF v_receipt.status NOT IN ('executed', 'failed') THEN
    RETURN jsonb_build_object(
      'released', false,
      'code', CASE WHEN v_receipt.status = 'uncertain'
        THEN 'RECONCILIATION_REQUIRED' ELSE 'RECEIPT_NOT_TERMINAL' END,
      'receipt_status', v_receipt.status
    );
  END IF;

  DELETE FROM public.autopilot_execution_scope_locks
  WHERE brand_id = p_brand_id AND receipt_id = p_receipt_id;
  GET DIAGNOSTICS v_released = ROW_COUNT;
  RETURN jsonb_build_object(
    'released', true,
    'released_count', v_released,
    'replayed', v_released = 0
  );
END $$;

REVOKE ALL ON FUNCTION public.release_autopilot_execution_scopes(uuid, uuid, uuid)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.release_autopilot_execution_scopes(uuid, uuid, uuid)
  TO service_role;

COMMENT ON TABLE public.autopilot_execution_scope_locks IS
  'Service-role-only cross-plan leases for customer, order, and ticket scopes. Uncertain owners are never auto-stolen.';

COMMIT;
