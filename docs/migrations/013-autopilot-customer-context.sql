-- 013 — Customer-wide support context + atomic related-ticket consolidation
-- Requires 012-autopilot-learning-loop.sql.
--
-- This migration gives the planner a lossless, canonical view of every support
-- thread for one brand/customer identity, and gives the admin executor one
-- atomic operation for closing duplicate/continuation tickets. Source messages
-- remain on their original tickets; merged_into_ticket_id is a routing link,
-- not a destructive message move.

BEGIN;

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS merged_into_ticket_id uuid REFERENCES public.tickets(id) ON DELETE SET NULL;
ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS customer_email_normalized text
  GENERATED ALWAYS AS (NULLIF(lower(btrim(customer_email)), '')) STORED;
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS customer_email_normalized text
  GENERATED ALWAYS AS (NULLIF(lower(btrim(customer_email)), '')) STORED;

CREATE INDEX IF NOT EXISTS tickets_brand_customer_email_normalized_idx
  ON public.tickets (brand_id, customer_email_normalized, created_at, id)
  WHERE customer_email_normalized IS NOT NULL;
CREATE INDEX IF NOT EXISTS conversations_brand_customer_email_normalized_idx
  ON public.conversations (brand_id, customer_email_normalized, created_at, id)
  WHERE customer_email_normalized IS NOT NULL;
CREATE INDEX IF NOT EXISTS tickets_merged_into_ticket_idx
  ON public.tickets (merged_into_ticket_id)
  WHERE merged_into_ticket_id IS NOT NULL;

-- A consolidation note is internal, but it changes the evidence a future plan
-- must see. Only explicitly context-relevant system notes advance the clock;
-- ordinary internal notes retain the migration-012 behavior.
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
    v_old_relevant := (
      COALESCE(OLD.is_internal_note, false) = false
      AND OLD.sender_type IN ('customer', 'agent')
    ) OR (
      COALESCE(OLD.is_internal_note, false) = true
      AND OLD.sender_type = 'system'
      AND COALESCE(OLD.metadata->>'context_relevant', 'false') = 'true'
    );
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    v_new_relevant := (
      COALESCE(NEW.is_internal_note, false) = false
      AND NEW.sender_type IN ('customer', 'agent')
    ) OR (
      COALESCE(NEW.is_internal_note, false) = true
      AND NEW.sender_type = 'system'
      AND COALESCE(NEW.metadata->>'context_relevant', 'false') = 'true'
    );
  END IF;

  IF TG_OP = 'INSERT' AND v_new_relevant THEN
    UPDATE public.tickets SET context_version = context_version + 1 WHERE id = NEW.ticket_id;
  ELSIF TG_OP = 'DELETE' AND v_old_relevant THEN
    UPDATE public.tickets SET context_version = context_version + 1 WHERE id = OLD.ticket_id;
  ELSIF TG_OP = 'UPDATE' THEN
    v_message_changed := ROW(
      NEW.ticket_id, NEW.sender_type, NEW.content, NEW.content_html,
      NEW.is_internal_note, NEW.attachments, NEW.metadata->>'context_relevant'
    ) IS DISTINCT FROM ROW(
      OLD.ticket_id, OLD.sender_type, OLD.content, OLD.content_html,
      OLD.is_internal_note, OLD.attachments, OLD.metadata->>'context_relevant'
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

-- Lossless customer context. Arrays are deterministically ordered and the hash
-- covers exactly the semantic projection returned to callers (not fetched_at),
-- so approval can re-read and compare it without frontend/backend hash drift.
CREATE OR REPLACE FUNCTION public.get_customer_support_context(
  p_ticket_id uuid,
  p_brand_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_primary public.tickets%ROWTYPE;
  v_tickets jsonb := '[]'::jsonb;
  v_conversations jsonb := '[]'::jsonb;
  v_projection jsonb;
  v_hash text;
  v_ticket_message_count integer := 0;
  v_chat_message_count integer := 0;
BEGIN
  SELECT * INTO v_primary
  FROM public.tickets
  WHERE id = p_ticket_id AND brand_id = p_brand_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'ticket not found'; END IF;

  SELECT COALESCE(jsonb_agg(item.payload ORDER BY item.created_at, item.id), '[]'::jsonb)
  INTO v_tickets
  FROM (
    SELECT
      ticket.id,
      ticket.created_at,
      jsonb_build_object(
        'id', ticket.id,
        'ticket_number', ticket.ticket_number,
        'source', ticket.source,
        'subject', ticket.subject,
        'status', ticket.status,
        'priority', ticket.priority,
        'category', ticket.category,
        'tags', COALESCE(to_jsonb(ticket.tags), '[]'::jsonb),
        'order_id', ticket.order_id,
        'conversation_id', ticket.conversation_id,
        'triage_intent', ticket.metadata->'ai_triage'->>'intent',
        'context_version', ticket.context_version,
        'created_at', ticket.created_at,
        'first_response_at', ticket.first_response_at,
        'resolved_at', ticket.resolved_at,
        'closed_at', ticket.closed_at,
        'merged_into_ticket_id', ticket.merged_into_ticket_id,
        'has_agent_response', COALESCE(message_rollup.agent_count, 0) > 0,
        'last_customer_at', message_rollup.last_customer_at,
        'last_agent_at', message_rollup.last_agent_at,
        'response_state', CASE
          WHEN ticket.status = 'resolved' THEN 'resolved'
          WHEN ticket.status = 'closed' THEN 'closed'
          WHEN COALESCE(message_rollup.customer_count, 0) = 0 THEN 'no_customer_message'
          WHEN COALESCE(message_rollup.agent_count, 0) = 0 THEN 'unanswered'
          WHEN message_rollup.last_public_sender = 'customer' THEN 'awaiting_us'
          ELSE 'awaiting_customer'
        END,
        'messages', COALESCE(message_rollup.messages, '[]'::jsonb)
      ) AS payload
    FROM public.tickets ticket
    LEFT JOIN LATERAL (
      SELECT
        count(*) FILTER (WHERE message.sender_type = 'customer') AS customer_count,
        count(*) FILTER (
          WHERE message.sender_type = 'agent'
            AND (message.metadata->>'email_status' IS NULL OR message.metadata->>'email_status' IN ('sent', 'delivered'))
        ) AS agent_count,
        max(message.created_at) FILTER (WHERE message.sender_type = 'customer') AS last_customer_at,
        max(message.created_at) FILTER (
          WHERE message.sender_type = 'agent'
            AND (message.metadata->>'email_status' IS NULL OR message.metadata->>'email_status' IN ('sent', 'delivered'))
        ) AS last_agent_at,
        (array_agg(message.sender_type ORDER BY message.created_at DESC, message.id DESC) FILTER (
          WHERE message.sender_type = 'customer'
             OR (
               message.sender_type = 'agent'
               AND (message.metadata->>'email_status' IS NULL OR message.metadata->>'email_status' IN ('sent', 'delivered'))
             )
        ))[1] AS last_public_sender,
        jsonb_agg(jsonb_build_object(
          'id', message.id,
          'sender_type', message.sender_type,
          'sender_name', message.sender_name,
          'content', message.content,
          'created_at', message.created_at,
          'email_message_id', message.email_message_id,
          'ai_generated', message.ai_generated,
          'email_status', message.metadata->>'email_status',
          'delivery_confirmed', message.sender_type <> 'agent'
            OR message.metadata->>'email_status' IS NULL
            OR message.metadata->>'email_status' IN ('sent', 'delivered')
        ) ORDER BY message.created_at, message.id) AS messages
      FROM public.ticket_messages message
      WHERE message.ticket_id = ticket.id
        AND COALESCE(message.is_internal_note, false) = false
        AND message.sender_type IN ('customer', 'agent')
    ) message_rollup ON true
    WHERE ticket.brand_id = p_brand_id
      AND (
        ticket.id = p_ticket_id
        OR (
          v_primary.customer_email_normalized IS NOT NULL
          AND ticket.customer_email_normalized = v_primary.customer_email_normalized
        )
      )
  ) item;

  SELECT COALESCE(jsonb_agg(item.payload ORDER BY item.created_at, item.id), '[]'::jsonb)
  INTO v_conversations
  FROM (
    SELECT
      conversation.id,
      conversation.created_at,
      jsonb_build_object(
        'id', conversation.id,
        'status', conversation.status,
        'resolved', conversation.resolved,
        'page_url', conversation.page_url,
        'started_at', conversation.started_at,
        'ended_at', conversation.ended_at,
        'last_message_at', conversation.last_message_at,
        'messages', COALESCE(message_rollup.messages, '[]'::jsonb)
      ) AS payload
    FROM public.conversations conversation
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(jsonb_build_object(
        'id', message.id,
        'role', message.role,
        'content', message.content,
        'created_at', message.created_at
      ) ORDER BY message.created_at, message.id) AS messages
      FROM public.messages message
      WHERE message.conversation_id = conversation.id
        AND message.role IN ('user', 'assistant', 'human_agent')
    ) message_rollup ON true
    WHERE v_primary.customer_email_normalized IS NOT NULL
      AND conversation.brand_id = p_brand_id
      AND conversation.customer_email_normalized = v_primary.customer_email_normalized
  ) item;

  SELECT count(*) INTO v_ticket_message_count
  FROM public.ticket_messages message
  JOIN public.tickets ticket ON ticket.id = message.ticket_id
  WHERE ticket.brand_id = p_brand_id
    AND (ticket.id = p_ticket_id OR (
      v_primary.customer_email_normalized IS NOT NULL
      AND ticket.customer_email_normalized = v_primary.customer_email_normalized
    ))
    AND COALESCE(message.is_internal_note, false) = false
    AND message.sender_type IN ('customer', 'agent');

  SELECT count(*) INTO v_chat_message_count
  FROM public.messages message
  JOIN public.conversations conversation ON conversation.id = message.conversation_id
  WHERE v_primary.customer_email_normalized IS NOT NULL
    AND conversation.brand_id = p_brand_id
    AND conversation.customer_email_normalized = v_primary.customer_email_normalized
    AND message.role IN ('user', 'assistant', 'human_agent');

  v_projection := jsonb_build_object(
    'projection_version', 'customer-support-context-v1',
    'tickets', v_tickets,
    'chat_conversations', v_conversations
  );
  v_hash := encode(digest(v_projection::text, 'sha256'), 'hex');

  RETURN v_projection || jsonb_build_object(
    'context_hash', v_hash,
    'fetched_at', now(),
    'valid_until', now() + interval '15 minutes',
    'ticket_count', jsonb_array_length(v_tickets),
    'ticket_message_count', v_ticket_message_count,
    'conversation_count', jsonb_array_length(v_conversations),
    'chat_message_count', v_chat_message_count
  );
END $$;

REVOKE ALL ON FUNCTION public.get_customer_support_context(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_customer_support_context(uuid, uuid) TO service_role;

-- The receipt is completed inside this transaction. A lost HTTP response is
-- therefore a harmless replay: the caller observes the executed receipt and
-- never repeats the multi-ticket mutation.
CREATE OR REPLACE FUNCTION public.execute_autopilot_ticket_consolidation(
  p_receipt_id uuid,
  p_brand_id uuid,
  p_worker_token uuid,
  p_actor_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_receipt public.autopilot_action_executions%ROWTYPE;
  v_plan public.ticket_action_plans%ROWTYPE;
  v_primary public.tickets%ROWTYPE;
  v_target public.tickets%ROWTYPE;
  v_action jsonb;
  v_targets jsonb;
  v_snapshot jsonb;
  v_target_ids uuid[];
  v_all_ticket_ids uuid[];
  v_target_count integer;
  v_rows integer;
  v_metadata jsonb;
  v_source_plan jsonb;
  v_history jsonb;
  v_ticket_numbers text;
  v_summary text;
  v_context_after bigint;
  v_live_response_state text;
  v_expected_plan_id uuid;
  v_expected_ticket_id uuid;
  v_expected_plan_actions jsonb;
  v_lock_customer_email text;
BEGIN
  IF p_receipt_id IS NULL OR p_worker_token IS NULL THEN
    RAISE EXCEPTION 'receipt and worker token are required';
  END IF;

  SELECT * INTO v_receipt
  FROM public.autopilot_action_executions
  WHERE id = p_receipt_id AND brand_id = p_brand_id;
  IF NOT FOUND OR v_receipt.action_type <> 'consolidate_related_tickets' THEN
    RAISE EXCEPTION 'consolidation receipt not found';
  END IF;
  IF v_receipt.status = 'executed' THEN
    RETURN jsonb_build_object(
      'executed', true, 'replayed', true,
      'summary', COALESCE(v_receipt.result, 'Related tickets already consolidated'),
      'context_after', v_receipt.context_after
    );
  END IF;

  SELECT * INTO v_plan
  FROM public.ticket_action_plans
  WHERE id = v_receipt.plan_id
    AND ticket_id = v_receipt.ticket_id
    AND brand_id = p_brand_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'plan ledger not found'; END IF;
  v_expected_plan_id := v_plan.id;
  v_expected_ticket_id := v_receipt.ticket_id;
  v_expected_plan_actions := v_plan.actions;

  SELECT action INTO v_action
  FROM jsonb_array_elements(v_plan.actions) action
  WHERE action->>'id' = v_receipt.action_id::text
    AND action->>'type' = 'consolidate_related_tickets';
  IF v_action IS NULL OR v_action->>'status' IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'consolidation action is not approved';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.autopilot_action_executions reply_receipt
    WHERE reply_receipt.plan_id = v_receipt.plan_id
      AND reply_receipt.ticket_id = v_receipt.ticket_id
      AND reply_receipt.brand_id = p_brand_id
      AND reply_receipt.execution_attempt_id = v_receipt.execution_attempt_id
      AND reply_receipt.action_type = 'send_reply'
      AND reply_receipt.status = 'executed'
  ) THEN
    RAISE EXCEPTION 'consolidation requires an executed primary reply receipt';
  END IF;
  v_targets := v_action->'params'->'related_tickets';
  IF jsonb_typeof(v_targets) <> 'array'
     OR jsonb_array_length(v_targets) < 1
     OR jsonb_array_length(v_targets) > 25 THEN
    RAISE EXCEPTION 'related_tickets must contain between 1 and 25 snapshots';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_targets) snapshot
    WHERE jsonb_typeof(snapshot) <> 'object'
      OR NOT public.is_canonical_uuid(snapshot->>'ticket_id')
      OR COALESCE(snapshot->>'context_version', '') !~ '^[0-9]+$'
      OR COALESCE(snapshot->>'ticket_number', '') !~ '^[0-9]+$'
      OR COALESCE(snapshot->>'status', '') NOT IN ('open', 'pending')
      OR COALESCE(snapshot->>'response_state', '') NOT IN ('unanswered', 'awaiting_us', 'awaiting_customer', 'no_customer_message')
      OR length(trim(COALESCE(snapshot->>'subject', ''))) = 0
      OR length(trim(COALESCE(snapshot->>'relation_reason', ''))) NOT BETWEEN 1 AND 500
      OR jsonb_typeof(snapshot->'relation_confidence') IS DISTINCT FROM 'number'
      OR (snapshot->>'relation_confidence')::numeric NOT BETWEEN 0 AND 1
  ) THEN
    RAISE EXCEPTION 'related ticket snapshot is invalid';
  END IF;

  SELECT array_agg((snapshot->>'ticket_id')::uuid ORDER BY snapshot->>'ticket_id'), count(*)
  INTO v_target_ids, v_target_count
  FROM jsonb_array_elements(v_targets) snapshot;
  IF cardinality(v_target_ids) <> (
    SELECT count(DISTINCT snapshot->>'ticket_id') FROM jsonb_array_elements(v_targets) snapshot
  ) OR v_receipt.ticket_id = ANY(v_target_ids) THEN
    RAISE EXCEPTION 'related ticket ids must be unique and exclude the primary ticket';
  END IF;
  v_all_ticket_ids := array_append(v_target_ids, v_receipt.ticket_id);

  -- Inbound email append and manual linking take this same customer-scoped
  -- transaction lock before any ticket row locks. It serializes the only
  -- operations that can redirect a customer's active ticket graph, avoiding
  -- opposite source->primary and UUID-order lock acquisition.
  SELECT * INTO v_primary
  FROM public.tickets
  WHERE id = v_receipt.ticket_id AND brand_id = p_brand_id;
  IF NOT FOUND OR v_primary.customer_email_normalized IS NULL THEN
    RAISE EXCEPTION 'primary ticket has no normalized customer identity';
  END IF;
  v_lock_customer_email := v_primary.customer_email_normalized;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_brand_id::text || ':' || v_lock_customer_email, 0)
  );

  -- One deterministic lock order prevents two overlapping consolidations from
  -- deadlocking or splitting the same source ticket between primaries.
  PERFORM 1
  FROM public.tickets ticket
  WHERE ticket.id = ANY(v_all_ticket_ids)
  ORDER BY ticket.id
  FOR UPDATE;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> cardinality(v_all_ticket_ids) THEN RAISE EXCEPTION 'one or more tickets no longer exist'; END IF;

  -- Global executor lock order is tickets -> plan -> receipt. All completion
  -- paths use this order so overlapping work cannot form a lock cycle.
  SELECT * INTO v_plan
  FROM public.ticket_action_plans
  WHERE id = v_expected_plan_id
    AND ticket_id = v_expected_ticket_id
    AND brand_id = p_brand_id
  FOR UPDATE;
  IF NOT FOUND OR v_plan.actions IS DISTINCT FROM v_expected_plan_actions THEN
    RAISE EXCEPTION 'plan changed while consolidation was being reserved' USING ERRCODE = '40001';
  END IF;

  SELECT * INTO v_receipt
  FROM public.autopilot_action_executions
  WHERE id = p_receipt_id AND brand_id = p_brand_id
  FOR UPDATE;
  IF v_receipt.plan_id IS DISTINCT FROM v_plan.id
     OR v_receipt.ticket_id IS DISTINCT FROM v_expected_ticket_id THEN
    RAISE EXCEPTION 'consolidation receipt identity changed' USING ERRCODE = '40001';
  END IF;
  IF v_receipt.status = 'executed' THEN
    RETURN jsonb_build_object(
      'executed', true, 'replayed', true,
      'summary', COALESCE(v_receipt.result, 'Related tickets already consolidated'),
      'context_after', v_receipt.context_after
    );
  END IF;
  IF v_receipt.status <> 'reserved'
     OR v_receipt.worker_token IS DISTINCT FROM p_worker_token
     OR v_receipt.lease_expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'consolidation receipt is no longer owned by this worker';
  END IF;
  IF v_receipt.expected_context_after <> v_receipt.context_before + 1 THEN
    RAISE EXCEPTION 'consolidation must reserve exactly one primary context transition';
  END IF;

  SELECT * INTO v_primary
  FROM public.tickets
  WHERE id = v_receipt.ticket_id AND brand_id = p_brand_id;
  IF NOT FOUND OR v_primary.customer_email_normalized IS NULL THEN
    RAISE EXCEPTION 'primary ticket has no normalized customer identity';
  END IF;
  IF v_primary.customer_email_normalized IS DISTINCT FROM v_lock_customer_email THEN
    RAISE EXCEPTION 'primary ticket customer identity changed while consolidation waited' USING ERRCODE = '40001';
  END IF;
  IF v_plan.status <> 'executing'
     OR v_primary.context_version <> v_receipt.context_before
     OR v_primary.metadata->'autopilot'->>'id' <> v_plan.id::text
     OR v_primary.metadata->'autopilot'->>'status' <> 'executing'
     OR v_primary.metadata->'autopilot'->>'execution_attempt_id' <> v_receipt.execution_attempt_id::text THEN
    RAISE EXCEPTION 'primary ticket execution context changed' USING ERRCODE = '40001';
  END IF;

  FOR v_snapshot IN SELECT value FROM jsonb_array_elements(v_targets)
  LOOP
    SELECT * INTO v_target
    FROM public.tickets
    WHERE id = (v_snapshot->>'ticket_id')::uuid;
    SELECT CASE
      WHEN v_target.status = 'resolved' THEN 'resolved'
      WHEN v_target.status = 'closed' THEN 'closed'
      WHEN NOT EXISTS (
        SELECT 1 FROM public.ticket_messages message
        WHERE message.ticket_id = v_target.id
          AND COALESCE(message.is_internal_note, false) = false
          AND message.sender_type = 'customer'
      ) THEN 'no_customer_message'
      WHEN NOT EXISTS (
        SELECT 1 FROM public.ticket_messages message
        WHERE message.ticket_id = v_target.id
          AND COALESCE(message.is_internal_note, false) = false
          AND message.sender_type = 'agent'
          AND (message.metadata->>'email_status' IS NULL OR message.metadata->>'email_status' IN ('sent', 'delivered'))
      ) THEN 'unanswered'
      WHEN (
        SELECT message.sender_type
        FROM public.ticket_messages message
        WHERE message.ticket_id = v_target.id
          AND COALESCE(message.is_internal_note, false) = false
          AND (
            message.sender_type = 'customer'
            OR (
              message.sender_type = 'agent'
              AND (message.metadata->>'email_status' IS NULL OR message.metadata->>'email_status' IN ('sent', 'delivered'))
            )
          )
        ORDER BY message.created_at DESC, message.id DESC
        LIMIT 1
      ) = 'customer' THEN 'awaiting_us'
      ELSE 'awaiting_customer'
    END
    INTO v_live_response_state;
    IF v_target.id IS NULL
       OR v_target.brand_id <> p_brand_id
       OR v_target.customer_email_normalized IS DISTINCT FROM v_primary.customer_email_normalized
       OR v_target.ticket_number IS DISTINCT FROM (v_snapshot->>'ticket_number')::integer
       OR v_target.subject IS DISTINCT FROM v_snapshot->>'subject'
       OR v_target.status IS DISTINCT FROM v_snapshot->>'status'
       OR v_target.status NOT IN ('open', 'pending')
       OR v_target.context_version IS DISTINCT FROM (v_snapshot->>'context_version')::bigint
       OR v_live_response_state IS DISTINCT FROM v_snapshot->>'response_state'
       OR v_target.merged_into_ticket_id IS NOT NULL THEN
      RAISE EXCEPTION 'related ticket % changed or is not eligible', v_snapshot->>'ticket_id' USING ERRCODE = '40001';
    END IF;
    IF v_target.metadata->'autopilot'->>'status' = 'executing'
       OR EXISTS (
         SELECT 1 FROM public.ticket_action_plans source_plan
         WHERE source_plan.ticket_id = v_target.id AND source_plan.status = 'executing'
       )
       OR EXISTS (
         SELECT 1 FROM public.autopilot_action_executions source_receipt
         WHERE source_receipt.ticket_id = v_target.id
           AND source_receipt.status IN ('reserved', 'uncertain')
       ) THEN
      RAISE EXCEPTION 'related ticket % has an active or uncertain Autopilot run', v_target.id USING ERRCODE = '40001';
    END IF;
  END LOOP;

  FOR v_snapshot IN SELECT value FROM jsonb_array_elements(v_targets)
  LOOP
    SELECT * INTO v_target FROM public.tickets WHERE id = (v_snapshot->>'ticket_id')::uuid;
    v_metadata := COALESCE(v_target.metadata, '{}'::jsonb);
    v_source_plan := v_metadata->'autopilot';
    IF v_source_plan IS NOT NULL THEN
      v_history := COALESCE(v_metadata->'autopilot_history', '[]'::jsonb)
        || jsonb_build_array(v_source_plan || jsonb_build_object(
          'projection_archived_reason', 'consolidated_into_related_ticket',
          'projection_archived_by_plan_id', v_plan.id,
          'projection_archived_at', now()
        ));
      v_metadata := jsonb_set(v_metadata - 'autopilot', '{autopilot_history}', v_history, true);
    END IF;
    v_metadata := jsonb_set(v_metadata, '{merged_into_ticket_id}', to_jsonb(v_primary.id), true);
    v_metadata := jsonb_set(v_metadata, '{merged_by_autopilot_plan_id}', to_jsonb(v_plan.id), true);

    UPDATE public.tickets ticket
    SET status = 'closed',
        closed_at = now(),
        merged_into_ticket_id = v_primary.id,
        metadata = v_metadata,
        updated_at = now()
    WHERE ticket.id = v_target.id
      AND ticket.brand_id = p_brand_id
      AND ticket.context_version = (v_snapshot->>'context_version')::bigint;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN RAISE EXCEPTION 'related ticket changed during consolidation' USING ERRCODE = '40001'; END IF;

    UPDATE public.ticket_action_plans
    SET status = 'superseded', updated_at = now()
    WHERE ticket_id = v_target.id AND brand_id = p_brand_id AND status = 'proposed';

    INSERT INTO public.ticket_events(ticket_id, event_type, actor, actor_id, old_value, new_value, metadata)
    VALUES
      (v_target.id, 'status_changed', 'ai', p_actor_id, v_target.status, 'closed',
       jsonb_build_object('via', 'autopilot', 'plan_id', v_plan.id, 'action_id', v_receipt.action_id,
                          'action_execution_id', v_receipt.id, 'reason', 'consolidated')),
      (v_target.id, 'merged_away', 'ai', p_actor_id, '#' || v_target.ticket_number::text,
       '#' || v_primary.ticket_number::text,
       jsonb_build_object('via', 'autopilot', 'target_ticket_id', v_primary.id,
                          'plan_id', v_plan.id, 'action_execution_id', v_receipt.id));
  END LOOP;

  SELECT string_agg('#' || ticket.ticket_number::text, ', ' ORDER BY ticket.ticket_number)
  INTO v_ticket_numbers
  FROM public.tickets ticket
  WHERE ticket.id = ANY(v_target_ids);
  v_summary := format(
    'Consolidated and closed %s related ticket%s (%s); source histories were preserved.',
    v_target_count,
    CASE WHEN v_target_count = 1 THEN '' ELSE 's' END,
    v_ticket_numbers
  );

  INSERT INTO public.ticket_messages(
    ticket_id, sender_type, sender_name, content, is_internal_note,
    attachments, ai_generated, metadata
  ) VALUES (
    v_primary.id, 'system', 'supportOS', v_summary, true,
    '[]'::jsonb, true,
    jsonb_build_object(
      'via', 'autopilot', 'context_relevant', true,
      'plan_id', v_plan.id, 'action_id', v_receipt.action_id,
      'action_execution_id', v_receipt.id, 'related_ticket_ids', to_jsonb(v_target_ids)
    )
  );

  INSERT INTO public.ticket_events(ticket_id, event_type, actor, actor_id, new_value, metadata)
  VALUES (
    v_primary.id, 'merged_in', 'ai', p_actor_id, v_ticket_numbers,
    jsonb_build_object('via', 'autopilot', 'source_ticket_ids', to_jsonb(v_target_ids),
                       'plan_id', v_plan.id, 'action_id', v_receipt.action_id,
                       'action_execution_id', v_receipt.id)
  );

  SELECT context_version INTO v_context_after
  FROM public.tickets WHERE id = v_primary.id;
  IF v_context_after <> v_receipt.expected_context_after THEN
    RAISE EXCEPTION 'primary context did not advance exactly once' USING ERRCODE = '40001';
  END IF;

  PERFORM public.complete_autopilot_action_execution(
    v_receipt.ticket_id, p_brand_id, v_receipt.plan_id,
    v_receipt.execution_attempt_id, v_receipt.action_id,
    v_receipt.operation_key, 'executed', v_context_after,
    v_summary, NULL, 'ticket-group:' || v_primary.id::text, p_worker_token
  );

  RETURN jsonb_build_object(
    'executed', true, 'replayed', false,
    'summary', v_summary, 'context_after', v_context_after,
    'related_ticket_ids', to_jsonb(v_target_ids)
  );
END $$;

REVOKE ALL ON FUNCTION public.execute_autopilot_ticket_consolidation(uuid, uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.execute_autopilot_ticket_consolidation(uuid, uuid, uuid, uuid) TO service_role;

COMMIT;
