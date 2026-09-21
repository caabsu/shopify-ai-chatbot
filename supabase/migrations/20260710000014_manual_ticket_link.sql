-- 014 - Atomic manual ticket linking
-- Requires 012-autopilot-learning-loop.sql and
-- 013-autopilot-customer-context.sql.
--
-- Manual linking keeps every source message on its original ticket. The
-- source ticket is closed and points at the canonical primary ticket. All
-- validation, Autopilot cleanup, the context-relevant note, and audit events
-- commit together so a partially linked customer history is impossible.

BEGIN;

CREATE OR REPLACE FUNCTION public.execute_manual_ticket_link(
  p_primary_id uuid,
  p_source_id uuid,
  p_brand_id uuid,
  p_expected_primary_context bigint,
  p_expected_source_context bigint,
  p_actor_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_primary public.tickets%ROWTYPE;
  v_source public.tickets%ROWTYPE;
  v_ticket_ids uuid[];
  v_rows integer;
  v_source_metadata jsonb;
  v_source_plan jsonb;
  v_primary_metadata jsonb;
  v_primary_plan jsonb;
  v_history jsonb;
  v_primary_context_after bigint;
  v_source_context_after bigint;
  v_summary text;
  v_lock_customer_email text;
  v_ticket_pair record;
BEGIN
  IF p_primary_id IS NULL OR p_source_id IS NULL OR p_brand_id IS NULL THEN
    RAISE EXCEPTION 'primary, source, and brand ids are required';
  END IF;
  IF p_primary_id = p_source_id THEN
    RAISE EXCEPTION 'cannot link a ticket into itself';
  END IF;
  IF p_expected_primary_context IS NULL OR p_expected_primary_context < 0
     OR p_expected_source_context IS NULL OR p_expected_source_context < 0 THEN
    RAISE EXCEPTION 'non-negative primary and source context versions are required';
  END IF;

  -- Read both identities from one statement, then serialize every merge,
  -- consolidation, and inbound append for this brand/customer before taking
  -- ticket row locks. This removes the S->P versus UUID-order lock cycle while
  -- retaining the exact context/version fences below.
  SELECT primary_ticket AS primary_row, source_ticket AS source_row INTO v_ticket_pair
  FROM public.tickets primary_ticket
  CROSS JOIN public.tickets source_ticket
  WHERE primary_ticket.id = p_primary_id
    AND primary_ticket.brand_id = p_brand_id
    AND source_ticket.id = p_source_id
    AND source_ticket.brand_id = p_brand_id;
  IF FOUND THEN
    v_primary := v_ticket_pair.primary_row;
    v_source := v_ticket_pair.source_row;
    IF v_primary.customer_email_normalized IS NULL
       OR v_source.customer_email_normalized IS DISTINCT FROM v_primary.customer_email_normalized THEN
      RAISE EXCEPTION 'tickets must have the same verified customer email' USING ERRCODE = '40001';
    END IF;
    v_lock_customer_email := v_primary.customer_email_normalized;
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(p_brand_id::text || ':' || v_lock_customer_email, 0)
    );

    -- Refresh after a possible advisory-lock wait. Exact replay is read-only
    -- and may return before taking both ticket row locks, but canonical and
    -- legacy pointers must agree whenever both are present.
    SELECT primary_ticket AS primary_row, source_ticket AS source_row INTO v_ticket_pair
    FROM public.tickets primary_ticket
    CROSS JOIN public.tickets source_ticket
    WHERE primary_ticket.id = p_primary_id
      AND primary_ticket.brand_id = p_brand_id
      AND source_ticket.id = p_source_id
      AND source_ticket.brand_id = p_brand_id;
    IF FOUND THEN
      v_primary := v_ticket_pair.primary_row;
      v_source := v_ticket_pair.source_row;
      IF v_primary.customer_email_normalized = v_lock_customer_email
         AND v_source.customer_email_normalized = v_lock_customer_email
         AND v_primary.merged_into_ticket_id IS NULL
         AND NULLIF(v_primary.metadata->>'merged_into_ticket_id', '') IS NULL
         AND v_source.status = 'closed'
         AND (
           (
             v_source.merged_into_ticket_id = v_primary.id
             AND (
               NULLIF(v_source.metadata->>'merged_into_ticket_id', '') IS NULL
               OR v_source.metadata->>'merged_into_ticket_id' = v_primary.id::text
             )
           )
           OR (
             v_source.merged_into_ticket_id IS NULL
             AND v_source.metadata->>'merged_into_ticket_id' = v_primary.id::text
           )
         ) THEN
        RETURN jsonb_build_object(
          'executed', true,
          'replayed', true,
          'merged', v_source.ticket_number,
          'into', v_primary.ticket_number,
          'source_context_after', v_source.context_version,
          'primary_context_after', v_primary.context_version
        );
      END IF;
    END IF;
  END IF;

  SELECT array_agg(ticket_id ORDER BY ticket_id)
  INTO v_ticket_ids
  FROM unnest(ARRAY[p_primary_id, p_source_id]) AS requested(ticket_id);

  -- Every overlapping manual/Autopilot consolidation takes ticket locks in
  -- UUID order, preventing deadlocks and split ownership of a source ticket.
  PERFORM 1
  FROM public.tickets ticket
  WHERE ticket.id = ANY(v_ticket_ids)
    AND ticket.brand_id = p_brand_id
  ORDER BY ticket.id
  FOR UPDATE;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 2 THEN
    RAISE EXCEPTION 'one or more tickets were not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO STRICT v_primary
  FROM public.tickets
  WHERE id = p_primary_id AND brand_id = p_brand_id;
  SELECT * INTO STRICT v_source
  FROM public.tickets
  WHERE id = p_source_id AND brand_id = p_brand_id;

  -- A lost HTTP response is safe to retry. Accept only the exact same link;
  -- no notes, events, or plan history are duplicated on replay.
  IF v_primary.merged_into_ticket_id IS NULL
     AND NULLIF(v_primary.metadata->>'merged_into_ticket_id', '') IS NULL
     AND v_primary.customer_email_normalized = v_lock_customer_email
     AND v_source.customer_email_normalized = v_lock_customer_email
     AND v_source.status = 'closed'
     AND (
       (
         v_source.merged_into_ticket_id = v_primary.id
         AND (
           NULLIF(v_source.metadata->>'merged_into_ticket_id', '') IS NULL
           OR v_source.metadata->>'merged_into_ticket_id' = v_primary.id::text
         )
       )
       OR (
         v_source.merged_into_ticket_id IS NULL
         AND v_source.metadata->>'merged_into_ticket_id' = v_primary.id::text
       )
     ) THEN
    RETURN jsonb_build_object(
      'executed', true,
      'replayed', true,
      'merged', v_source.ticket_number,
      'into', v_primary.ticket_number,
      'source_context_after', v_source.context_version,
      'primary_context_after', v_primary.context_version
    );
  END IF;

  IF v_primary.context_version IS DISTINCT FROM p_expected_primary_context
     OR v_source.context_version IS DISTINCT FROM p_expected_source_context THEN
    RAISE EXCEPTION 'ticket context changed; refresh and try again' USING ERRCODE = '40001';
  END IF;
  IF v_primary.merged_into_ticket_id IS NOT NULL
     OR NULLIF(v_primary.metadata->>'merged_into_ticket_id', '') IS NOT NULL THEN
    RAISE EXCEPTION 'primary ticket is already linked into another ticket' USING ERRCODE = '40001';
  END IF;
  IF v_source.merged_into_ticket_id IS NOT NULL
     OR NULLIF(v_source.metadata->>'merged_into_ticket_id', '') IS NOT NULL THEN
    RAISE EXCEPTION 'source ticket is already linked into another ticket' USING ERRCODE = '40001';
  END IF;
  IF v_primary.customer_email_normalized IS NULL
     OR v_primary.customer_email_normalized IS DISTINCT FROM v_lock_customer_email
     OR v_source.customer_email_normalized IS DISTINCT FROM v_primary.customer_email_normalized THEN
    RAISE EXCEPTION 'tickets must have the same verified customer email' USING ERRCODE = '40001';
  END IF;
  IF v_primary.status NOT IN ('open', 'pending') THEN
    RAISE EXCEPTION 'primary ticket must be active' USING ERRCODE = '40001';
  END IF;
  IF v_source.status NOT IN ('open', 'pending') THEN
    RAISE EXCEPTION 'only active source tickets can be linked' USING ERRCODE = '40001';
  END IF;

  -- Never invalidate a provider operation whose result may still arrive. This
  -- checks both the plan ledger and the durable per-action receipts on both
  -- tickets while their rows are locked.
  IF v_primary.metadata->'autopilot'->>'status' = 'executing'
     OR v_source.metadata->'autopilot'->>'status' = 'executing'
     OR EXISTS (
       SELECT 1
       FROM public.ticket_action_plans plan
       WHERE plan.ticket_id = ANY(v_ticket_ids)
         AND plan.brand_id = p_brand_id
         AND plan.status = 'executing'
     )
     OR EXISTS (
       SELECT 1
       FROM public.autopilot_action_executions receipt
       WHERE receipt.ticket_id = ANY(v_ticket_ids)
         AND receipt.brand_id = p_brand_id
         AND receipt.status IN ('reserved', 'uncertain')
     ) THEN
    RAISE EXCEPTION 'a ticket has an active or uncertain Autopilot run' USING ERRCODE = '40001';
  END IF;

  v_source_metadata := COALESCE(v_source.metadata, '{}'::jsonb);
  v_source_plan := v_source_metadata->'autopilot';
  IF v_source_plan IS NOT NULL THEN
    v_history := CASE
      WHEN jsonb_typeof(v_source_metadata->'autopilot_history') = 'array'
        THEN v_source_metadata->'autopilot_history'
      ELSE '[]'::jsonb
    END;
    v_source_plan := v_source_plan || jsonb_build_object(
      'projection_archived_reason', 'manually_linked_into_related_ticket',
      'projection_archived_at', now(),
      'projection_archived_by', p_actor_id
    );
    IF v_source_plan->>'status' IN ('proposed', 'approved') THEN
      v_source_plan := v_source_plan || jsonb_build_object(
        'status', 'superseded',
        'superseded_reason', 'manually_linked_into_related_ticket',
        'superseded_at', now()
      );
    END IF;
    v_source_metadata := jsonb_set(
      v_source_metadata - 'autopilot',
      '{autopilot_history}',
      v_history || jsonb_build_array(v_source_plan),
      true
    );
  END IF;
  v_source_metadata := jsonb_set(
    v_source_metadata,
    '{merged_into_ticket_id}',
    to_jsonb(v_primary.id),
    true
  );
  v_source_metadata := jsonb_set(
    v_source_metadata,
    '{merge_type}',
    to_jsonb('linked_history'::text),
    true
  );
  IF p_actor_id IS NOT NULL THEN
    v_source_metadata := jsonb_set(
      v_source_metadata,
      '{merged_by_actor_id}',
      to_jsonb(p_actor_id),
      true
    );
  END IF;

  -- Linking adds customer history that the current ticket's draft did not
  -- see. Archive its compatibility projection now so the coverage sweep can
  -- immediately propose a fresh plan from the combined canonical history.
  v_primary_metadata := COALESCE(v_primary.metadata, '{}'::jsonb);
  v_primary_plan := v_primary_metadata->'autopilot';
  IF v_primary_plan IS NOT NULL THEN
    v_history := CASE
      WHEN jsonb_typeof(v_primary_metadata->'autopilot_history') = 'array'
        THEN v_primary_metadata->'autopilot_history'
      ELSE '[]'::jsonb
    END;
    v_primary_plan := v_primary_plan || jsonb_build_object(
      'projection_archived_reason', 'customer_history_changed_by_manual_link',
      'projection_archived_at', now(),
      'projection_archived_by', p_actor_id
    );
    IF v_primary_plan->>'status' IN ('proposed', 'approved') THEN
      v_primary_plan := v_primary_plan || jsonb_build_object(
        'status', 'superseded',
        'superseded_reason', 'customer_history_changed_by_manual_link',
        'superseded_at', now()
      );
    END IF;
    v_primary_metadata := jsonb_set(
      v_primary_metadata - 'autopilot',
      '{autopilot_history}',
      v_history || jsonb_build_array(v_primary_plan),
      true
    );
  END IF;

  -- A reviewed-but-not-started source plan cannot remain actionable after its
  -- ticket becomes historical. Executing plans were rejected above.
  UPDATE public.ticket_action_plans
  SET status = 'superseded', updated_at = now()
  WHERE ticket_id = ANY(v_ticket_ids)
    AND brand_id = p_brand_id
    AND status IN ('proposed', 'approved');

  UPDATE public.tickets
  SET metadata = v_primary_metadata,
      updated_at = now()
  WHERE id = v_primary.id
    AND brand_id = p_brand_id
    AND context_version = p_expected_primary_context;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'primary ticket changed during linking' USING ERRCODE = '40001';
  END IF;

  UPDATE public.tickets ticket
  SET status = 'closed',
      closed_at = now(),
      merged_into_ticket_id = v_primary.id,
      metadata = v_source_metadata,
      updated_at = now()
  WHERE ticket.id = v_source.id
    AND ticket.brand_id = p_brand_id
    AND ticket.context_version = p_expected_source_context;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'source ticket changed during linking' USING ERRCODE = '40001';
  END IF;

  v_summary := format(
    'Linked ticket #%s into this customer case. Its original message history remains on that ticket.',
    v_source.ticket_number
  );
  INSERT INTO public.ticket_messages(
    ticket_id, sender_type, sender_name, content, is_internal_note,
    attachments, ai_generated, metadata
  ) VALUES (
    v_primary.id, 'system', 'supportOS', v_summary, true,
    '[]'::jsonb, false,
    jsonb_build_object(
      'context_relevant', true,
      'source_ticket_id', v_source.id,
      'merge_type', 'linked_history',
      'actor_id', p_actor_id
    )
  );

  -- Exactly one primary event and one source event describe the atomic link.
  INSERT INTO public.ticket_events(
    ticket_id, event_type, actor, actor_id, old_value, new_value, metadata
  ) VALUES
    (
      v_primary.id, 'merged_in', 'agent', p_actor_id, NULL,
      '#' || v_source.ticket_number::text,
      jsonb_build_object('source_ticket_id', v_source.id, 'merge_type', 'linked_history')
    ),
    (
      v_source.id, 'merged_away', 'agent', p_actor_id,
      '#' || v_source.ticket_number::text,
      '#' || v_primary.ticket_number::text,
      jsonb_build_object(
        'target_ticket_id', v_primary.id,
        'previous_status', v_source.status,
        'merge_type', 'linked_history'
      )
    );

  SELECT context_version INTO v_primary_context_after
  FROM public.tickets WHERE id = v_primary.id;
  SELECT context_version INTO v_source_context_after
  FROM public.tickets WHERE id = v_source.id;
  IF v_primary_context_after <> p_expected_primary_context + 1
     OR v_source_context_after <> p_expected_source_context + 1 THEN
    RAISE EXCEPTION 'ticket context did not advance exactly once' USING ERRCODE = '40001';
  END IF;

  RETURN jsonb_build_object(
    'executed', true,
    'replayed', false,
    'merged', v_source.ticket_number,
    'into', v_primary.ticket_number,
    'source_context_after', v_source_context_after,
    'primary_context_after', v_primary_context_after
  );
END $$;

REVOKE ALL ON FUNCTION public.execute_manual_ticket_link(uuid, uuid, uuid, bigint, bigint, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.execute_manual_ticket_link(uuid, uuid, uuid, bigint, bigint, uuid) TO service_role;

-- Resolve a possibly-linked ticket and append an inbound customer message in
-- one transaction. Locking the originally matched ticket closes the race with
-- either manual or Autopilot consolidation: the append wins and invalidates a
-- stale merge fence, or the merge wins and the message is redirected to the
-- canonical target after the lock wait.
CREATE OR REPLACE FUNCTION public.append_inbound_customer_message(
  p_candidate_ticket_id uuid,
  p_brand_id uuid,
  p_customer_email text,
  p_message jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_ticket public.tickets%ROWTYPE;
  v_existing_ticket public.tickets%ROWTYPE;
  v_inserted public.ticket_messages%ROWTYPE;
  v_existing public.ticket_messages%ROWTYPE;
  v_current_id uuid := p_candidate_ticket_id;
  v_next_id uuid;
  v_seen uuid[] := '{}'::uuid[];
  v_depth integer;
  v_normalized_email text := NULLIF(lower(btrim(p_customer_email)), '');
  v_email_message_id text := NULLIF(btrim(p_message->>'email_message_id'), '');
  v_metadata jsonb;
  v_snoozed_until text;
  v_previous_status text;
BEGIN
  IF p_candidate_ticket_id IS NULL OR p_brand_id IS NULL OR v_normalized_email IS NULL THEN
    RAISE EXCEPTION 'candidate ticket, brand, and customer email are required';
  END IF;
  IF jsonb_typeof(p_message) IS DISTINCT FROM 'object'
     OR length(trim(COALESCE(p_message->>'content', ''))) = 0
     OR length(p_message->>'content') > 1000000
     OR (
       p_message ? 'metadata'
       AND p_message->'metadata' IS NOT NULL
       AND jsonb_typeof(p_message->'metadata') IS DISTINCT FROM 'object'
     ) THEN
    RAISE EXCEPTION 'inbound message payload is invalid';
  END IF;

  -- Manual linking and Autopilot consolidation use the same customer-scoped
  -- transaction lock before ticket locks. That keeps an inbound redirect from
  -- ever traversing the linked chain in the opposite lock order.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_brand_id::text || ':' || v_normalized_email, 0)
  );

  FOR v_depth IN 1..10 LOOP
    IF v_current_id = ANY(v_seen) THEN
      RAISE EXCEPTION 'linked-ticket cycle detected' USING ERRCODE = '40001';
    END IF;
    v_seen := array_append(v_seen, v_current_id);

    SELECT * INTO v_ticket
    FROM public.tickets
    WHERE id = v_current_id AND brand_id = p_brand_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'ticket redirect target was not found' USING ERRCODE = 'P0002';
    END IF;
    IF v_ticket.customer_email_normalized IS DISTINCT FROM v_normalized_email THEN
      RAISE EXCEPTION 'ticket customer identity changed' USING ERRCODE = '40001';
    END IF;

    v_next_id := v_ticket.merged_into_ticket_id;
    IF v_next_id IS NULL AND public.is_canonical_uuid(v_ticket.metadata->>'merged_into_ticket_id') THEN
      v_next_id := (v_ticket.metadata->>'merged_into_ticket_id')::uuid;
    END IF;
    EXIT WHEN v_next_id IS NULL;
    v_current_id := v_next_id;
  END LOOP;
  IF v_next_id IS NOT NULL THEN
    RAISE EXCEPTION 'ticket redirect chain is too deep' USING ERRCODE = '40001';
  END IF;

  INSERT INTO public.ticket_messages(
    ticket_id, sender_type, sender_name, sender_email, content, content_html,
    is_internal_note, attachments, email_message_id, ai_generated, metadata
  ) VALUES (
    v_ticket.id,
    'customer',
    NULLIF(p_message->>'sender_name', ''),
    p_customer_email,
    p_message->>'content',
    NULLIF(p_message->>'content_html', ''),
    false,
    '[]'::jsonb,
    v_email_message_id,
    false,
    COALESCE(p_message->'metadata', '{}'::jsonb)
  )
  ON CONFLICT (email_message_id) WHERE email_message_id IS NOT NULL DO NOTHING
  RETURNING * INTO v_inserted;

  IF v_inserted.id IS NULL THEN
    SELECT * INTO v_existing
    FROM public.ticket_messages
    WHERE email_message_id = v_email_message_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'message id conflict could not be resolved' USING ERRCODE = '40001';
    END IF;
    SELECT * INTO v_existing_ticket
    FROM public.tickets
    WHERE id = v_existing.ticket_id;
    IF NOT FOUND
       OR v_existing_ticket.brand_id IS DISTINCT FROM p_brand_id
       OR v_existing_ticket.customer_email_normalized IS DISTINCT FROM v_normalized_email THEN
      RAISE EXCEPTION 'message id belongs to another customer or brand' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object(
      'appended', false,
      'duplicate', true,
      'ticket_id', v_existing_ticket.id,
      'ticket_number', v_existing_ticket.ticket_number,
      'message_id', v_existing.id,
      'redirected', v_existing_ticket.id <> p_candidate_ticket_id
    );
  END IF;

  v_previous_status := v_ticket.status;
  v_metadata := COALESCE(v_ticket.metadata, '{}'::jsonb);
  v_snoozed_until := NULLIF(v_metadata->>'snoozed_until', '');
  IF v_snoozed_until IS NOT NULL THEN
    v_metadata := v_metadata - 'snoozed_until';
  END IF;

  UPDATE public.tickets
  SET status = CASE WHEN status IN ('resolved', 'closed', 'pending') THEN 'open' ELSE status END,
      metadata = v_metadata,
      updated_at = now()
  WHERE id = v_ticket.id;

  INSERT INTO public.ticket_events(
    ticket_id, event_type, actor, old_value, new_value, metadata
  ) VALUES (
    v_ticket.id, 'message_added', 'customer', NULL, 'customer',
    jsonb_build_object('message_id', v_inserted.id, 'via', 'inbound_email')
  );
  IF v_snoozed_until IS NOT NULL THEN
    INSERT INTO public.ticket_events(
      ticket_id, event_type, actor, old_value, new_value
    ) VALUES (
      v_ticket.id, 'snooze_woke', 'customer', v_snoozed_until, 'customer_reply'
    );
  END IF;

  SELECT * INTO v_ticket FROM public.tickets WHERE id = v_ticket.id;
  RETURN jsonb_build_object(
    'appended', true,
    'duplicate', false,
    'ticket_id', v_ticket.id,
    'ticket_number', v_ticket.ticket_number,
    'message_id', v_inserted.id,
    'redirected', v_ticket.id <> p_candidate_ticket_id,
    'previous_status', v_previous_status,
    'status', v_ticket.status,
    'context_version', v_ticket.context_version
  );
END $$;

REVOKE ALL ON FUNCTION public.append_inbound_customer_message(uuid, uuid, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.append_inbound_customer_message(uuid, uuid, text, jsonb) TO service_role;

COMMIT;
