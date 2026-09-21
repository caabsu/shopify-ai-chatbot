-- Preserve the server-recorded offer in the canonical, hashed customer history.
-- Without it, retentionDecision cannot recognize a later keep/cancel choice.
-- Patch only the message projection; preserve the deployed function's tenant
-- filtering, permissions, locking, and any other production fixes.
DO $migration$
DECLARE
  definition text;
  needle text := $old$'email_status', message.metadata->>'email_status',$old$;
  replacement text := $new$'metadata', jsonb_build_object(
            'support_retention_offer', message.metadata->'support_retention_offer'
          ),
          'email_status', message.metadata->>'email_status',$new$;
BEGIN
  SELECT pg_get_functiondef('public.get_customer_support_context(uuid,uuid)'::regprocedure)
  INTO definition;
  IF position($check$'support_retention_offer', message.metadata->'support_retention_offer'$check$ IN definition) > 0 THEN
    RETURN;
  END IF;
  IF position(needle IN definition) = 0
     OR (length(definition) - length(replace(definition, needle, ''))) / length(needle) <> 1 THEN
    RAISE EXCEPTION 'Customer-history message projection differs from the expected function; inspect before migrating';
  END IF;
  EXECUTE replace(definition, needle, replacement);
END
$migration$;
