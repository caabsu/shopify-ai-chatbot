-- Migration 003: Multi-brand isolation hardening
-- Run after 001-reviews-schema.sql and 002-tracking-tables.sql.

BEGIN;

-- Products must be unique per brand, not globally. Shopify product numeric IDs
-- are only meaningful inside a shop.
ALTER TABLE products
  DROP CONSTRAINT IF EXISTS products_shopify_product_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS products_brand_shopify_product_id_key
  ON products (brand_id, shopify_product_id);

-- Tracking cache must be isolated per brand. The same tracking number can appear
-- in separate shops, and brands can have different carrier settings/messages.
ALTER TABLE tracking_cache
  DROP CONSTRAINT IF EXISTS tracking_cache_tracking_number_key;

DELETE FROM tracking_cache
WHERE brand_id IS NULL;

ALTER TABLE tracking_cache
  ALTER COLUMN brand_id SET NOT NULL;

DROP INDEX IF EXISTS tracking_cache_number_idx;

CREATE UNIQUE INDEX IF NOT EXISTS tracking_cache_brand_tracking_number_key
  ON tracking_cache (brand_id, tracking_number);

CREATE INDEX IF NOT EXISTS tracking_cache_tracking_number_idx
  ON tracking_cache (tracking_number);

-- Ensure Warm by Design resolves to the Warm widget bundle from backend-driven
-- preview/config paths instead of the generic widget fallbacks.
UPDATE brands
SET settings = COALESCE(settings, '{}'::jsonb) || '{
  "widgetUrls": {
    "chatbot": "/widget/warm/chatbot.js",
    "returns": "/widget/warm/returns.js",
    "contact": "/widget/warm/contact.js",
    "contactForm": "/widget/warm/contact.js",
    "reviews": "/widget/review-widget.js",
    "tracking": "/widget/tracking-widget.js"
  }
}'::jsonb
WHERE slug = 'warm-by-design';

COMMIT;
