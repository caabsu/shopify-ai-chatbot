-- Migration 004: Warm by Design Shopify shop slug

UPDATE brands
SET
  shopify_shop = '1u8ryb-ym',
  updated_at = now()
WHERE slug = 'warm-by-design';
