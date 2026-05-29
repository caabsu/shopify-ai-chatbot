-- Migration 008: Ticket inbox email routing hardening
-- Ensures each brand has an explicit support inbox and fixes any inherited
-- Warm by Design contact-form email on non-Warm brands.

BEGIN;

UPDATE brands
SET
  settings = COALESCE(settings, '{}'::jsonb) || '{
    "support_email": "support@outlight.us",
    "inbound_email": "support@outlight.us",
    "email_from_address": "Outlight Support <support@outlight.us>",
    "support_from_address": "Outlight Support <support@outlight.us>"
  }'::jsonb,
  updated_at = now()
WHERE slug = 'outlight';

UPDATE brands
SET
  settings = COALESCE(settings, '{}'::jsonb) || '{
    "support_email": "support@warmbydesign.com",
    "inbound_email": "support@warmbydesign.com",
    "email_from_address": "Warm by Design <support@warmbydesign.com>",
    "support_from_address": "Warm by Design <support@warmbydesign.com>"
  }'::jsonb,
  updated_at = now()
WHERE slug = 'warm-by-design';

UPDATE contact_form_settings cfs
SET
  widget_design = COALESCE(cfs.widget_design, '{}'::jsonb)
    || jsonb_build_object('emailAddress', COALESCE(b.settings->>'support_email', 'support@outlight.us')),
  updated_at = now()
FROM brands b
WHERE cfs.brand_id = b.id
  AND b.slug <> 'warm-by-design'
  AND (
    cfs.widget_design->>'emailAddress' IS NULL
    OR lower(cfs.widget_design->>'emailAddress') = 'support@warmbydesign.com'
  );

ALTER TABLE ticket_messages
  ADD COLUMN IF NOT EXISTS email_message_id text;

CREATE UNIQUE INDEX IF NOT EXISTS ticket_messages_email_message_id_key
  ON ticket_messages (email_message_id)
  WHERE email_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ticket_messages_metadata_email_message_id_idx
  ON ticket_messages ((metadata->>'email_message_id'))
  WHERE metadata ? 'email_message_id';

COMMIT;
