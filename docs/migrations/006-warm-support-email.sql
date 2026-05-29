-- Migration 006: Warm by Design support email wiring

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
