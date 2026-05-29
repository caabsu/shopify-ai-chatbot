-- Migration 009: Warm by Design support facts and product support data
-- Adds durable AI-facing support facts plus a compact product support table
-- seeded directly from Shopify Admin product data and product metafields.

BEGIN;

CREATE TABLE IF NOT EXISTS public.support_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  fact_type text NOT NULL,
  key text NOT NULL,
  title text NOT NULL,
  content text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  priority integer NOT NULL DEFAULT 0,
  locked boolean NOT NULL DEFAULT false,
  source text,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT support_facts_brand_key_key UNIQUE (brand_id, key)
);

CREATE INDEX IF NOT EXISTS support_facts_brand_type_enabled_idx
  ON public.support_facts (brand_id, fact_type, enabled, priority DESC);

CREATE INDEX IF NOT EXISTS support_facts_search_idx
  ON public.support_facts
  USING gin (to_tsvector('english', coalesce(title, '') || ' ' || coalesce(content, '')));

ALTER TABLE public.support_facts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all for service role" ON public.support_facts;
CREATE POLICY "Allow all for service role" ON public.support_facts
  FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.product_support_data (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  slug text NOT NULL,
  handle text,
  shopify_product_id text,
  shopify_variant_id text,
  title text NOT NULL,
  product_type text,
  collection text,
  price numeric(10, 2),
  status text NOT NULL DEFAULT 'active',
  support_summary text NOT NULL DEFAULT '',
  metafields jsonb NOT NULL DEFAULT '{}'::jsonb,
  product_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  variants jsonb NOT NULL DEFAULT '[]'::jsonb,
  search_text text NOT NULL DEFAULT '',
  source_path text,
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_support_data_brand_slug_key UNIQUE (brand_id, slug)
);

CREATE INDEX IF NOT EXISTS product_support_data_brand_handle_idx
  ON public.product_support_data (brand_id, handle);

CREATE INDEX IF NOT EXISTS product_support_data_brand_shopify_product_idx
  ON public.product_support_data (brand_id, shopify_product_id);

CREATE INDEX IF NOT EXISTS product_support_data_metafields_idx
  ON public.product_support_data USING gin (metafields);

CREATE INDEX IF NOT EXISTS product_support_data_product_data_idx
  ON public.product_support_data USING gin (product_data);

CREATE INDEX IF NOT EXISTS product_support_data_search_idx
  ON public.product_support_data
  USING gin (to_tsvector('english', coalesce(search_text, '')));

ALTER TABLE public.product_support_data ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all for service role" ON public.product_support_data;
CREATE POLICY "Allow all for service role" ON public.product_support_data
  FOR ALL USING (true) WITH CHECK (true);

WITH wbd AS (
  SELECT id FROM public.brands WHERE slug = 'warm-by-design'
)
INSERT INTO public.support_facts
  (brand_id, fact_type, key, title, content, data, priority, locked, source, enabled)
SELECT
  wbd.id,
  fact_type,
  key,
  title,
  content,
  data,
  priority,
  locked,
  source,
  true
FROM wbd
CROSS JOIN (
  VALUES
    (
      'brand',
      'wbd_brand_identity_voice',
      'Warm by Design brand identity and voice',
      $fact$Warm by Design sells warm ambient lighting. Support replies must speak only as Warm by Design, use support@warmbydesign.com, and never mention Outlight in customer-facing WBD replies. Voice is calm, specific, and helpful; no medical claims and no claims about cortisol, melatonin, or health outcomes. Every WBD product should be treated as warm 2700K unless a verified product record says otherwise.$fact$,
      '{"support_email":"support@warmbydesign.com","domain":"warmbydesign.com","color_temperature_rule":"2700K"}'::jsonb,
      120,
      true,
      'Warm by Design support configuration'
    ),
    (
      'shipping',
      'wbd_locked_outbound_shipping',
      'Warm by Design locked outbound shipping rule',
      $fact$Outbound shipping is locked: one lamp ships by standard shipping for $12.95. Orders with two or more lamps receive free standard shipping. Do not use stale copy that says every order ships free. If exact fulfillment or tracking exists in Shopify order data, use Shopify as the order-status source of truth.$fact$,
      '{"one_lamp_standard_shipping_fee":12.95,"free_standard_shipping_min_lamps":2,"applies_to":"outbound lamp shipments"}'::jsonb,
      115,
      true,
      'User locked rule, 2026-05-24'
    ),
    (
      'delivery',
      'wbd_delivery_expectations',
      'Warm by Design delivery expectations',
      $fact$Warm by Design policy copy says orders are prepared for shipment and customers are notified with tracking after shipment. Use Shopify fulfillment and tracking data when available. If no tracking is available, do not invent a tracking link or carrier. For general delivery expectations, use 3 to 4 weeks only when no more specific Shopify order data is available.$fact$,
      '{"fallback_delivery_window":"3-4 weeks","tracking_rule":"only use Shopify-provided tracking"}'::jsonb,
      105,
      true,
      'Warm by Design support configuration'
    ),
    (
      'offer',
      'wbd_locked_two_lamp_offer',
      'Warm by Design locked two-lamp offer',
      $fact$Current offer is locked: buying two or more lamps gets a free Pocket mini lamp and one extra 2700K bulb. Do not mention stale Launch Kit, $228 extras, $500 threshold, or 3+ lamp tier language unless a current internal instruction explicitly reactivates it. If a customer asks how to redeem it and no code is provided in Shopify/order context, say the team can confirm it on the order rather than inventing a code.$fact$,
      '{"qualifying_min_lamps":2,"free_items":["Pocket mini lamp","extra 2700K bulb"],"deprecated_offer_copy":["Launch Kit","$228 extras","$500 threshold","3+ lamp tier"]}'::jsonb,
      115,
      true,
      'User locked rule, 2026-05-24'
    ),
    (
      'returns',
      'wbd_return_policy_basics',
      'Warm by Design return policy basics',
      $fact$Warm by Design returns are generally available within 30 days from delivery for unused items in original packaging. For change-of-mind, fit, or style returns, the customer pays return shipping. Warm by Design covers the return path or replacement handling for damaged, defective, or wrong items. Damage-on-arrival claims should be reported within 7 days with the order number and photos. Refund timing is generally 5 to 10 business days after inspection/approval.$fact$,
      '{"return_window_days":30,"customer_pays_reasons":["changed_mind","fit","style"],"brand_covers_reasons":["damaged","defective","wrong_item"],"damage_report_window_days":7,"refund_timing":"5-10 business days after inspection/approval"}'::jsonb,
      110,
      true,
      'Warm by Design support configuration'
    )
) AS facts(fact_type, key, title, content, data, priority, locked, source)
ON CONFLICT (brand_id, key) DO UPDATE SET
  fact_type = EXCLUDED.fact_type,
  title = EXCLUDED.title,
  content = EXCLUDED.content,
  data = EXCLUDED.data,
  priority = EXCLUDED.priority,
  locked = EXCLUDED.locked,
  source = EXCLUDED.source,
  enabled = true,
  updated_at = now();

WITH wbd AS (
  SELECT id FROM public.brands WHERE slug = 'warm-by-design'
)
DELETE FROM public.knowledge_documents kd
USING wbd
WHERE kd.brand_id = wbd.id
  AND kd.title IN (
    'Warm by Design support rules',
    'Warm by Design Shopify data rules',
    'Warm by Design product basics',
    'Warm by Design shipping and returns basics',
    'Warm by Design locked shipping and offer rules',
    'Warm by Design return policy basics'
  );

WITH wbd AS (
  SELECT id FROM public.brands WHERE slug = 'warm-by-design'
)
INSERT INTO public.knowledge_documents (brand_id, title, category, priority, enabled, content)
SELECT wbd.id, title, category, priority, true, content
FROM wbd
CROSS JOIN (
  VALUES
    (
      'Warm by Design support rules',
      'support',
      120,
      $doc$Answer as Warm by Design only. Never mention Outlight in Warm by Design replies. Use support@warmbydesign.com as the support contact. Keep replies calm, concise, specific, and helpful. Do not invent specifications, policies, links, tracking URLs, internal escalations, manuals, or manufacturer contacts.$doc$
    ),
    (
      'Warm by Design locked shipping and offer rules',
      'policies',
      115,
      $doc$Shipping is locked: one lamp has $12.95 standard shipping; two or more lamps get free standard shipping. Current offer: buying two or more lamps gets a free Pocket mini lamp and one extra 2700K bulb. Do not use stale free-shipping-on-every-order copy, Launch Kit copy, $228 extras, $500 threshold, or 3+ lamp tier language.$doc$
    ),
    (
      'Warm by Design return policy basics',
      'return_policy',
      110,
      $doc$Returns are generally available within 30 days from delivery for unused items in original packaging. Customer pays return shipping for change-of-mind, fit, or style returns. Warm by Design covers damaged, defective, or wrong-item cases. Damage-on-arrival issues should be reported within 7 days with photos and the order number. Refunds generally take 5 to 10 business days after inspection/approval.$doc$
    ),
    (
      'Warm by Design product data rules',
      'products',
      100,
      $doc$Use product_support_data and Shopify product/order context for exact WBD product specifications, including metafields such as color temperature, bulb base, voltage, materials, dimensions, placement notes, care instructions, and FAQ. Every product should be treated as 2700K unless a verified product record says otherwise. If an exact product value is missing, say it is not listed in the available product data and offer to confirm.$doc$
    )
) AS docs(title, category, priority, content);

UPDATE public.brands
SET
  settings = COALESCE(settings, '{}'::jsonb)
    || '{
      "domain": "warmbydesign.com",
      "support_email": "support@warmbydesign.com",
      "inbound_email": "support@warmbydesign.com",
      "email_from_address": "Warm by Design <support@warmbydesign.com>",
      "support_from_address": "Warm by Design <support@warmbydesign.com>",
      "shipping_rules": {
        "one_lamp_standard_shipping_fee": 12.95,
        "free_standard_shipping_min_lamps": 2
      },
      "offer_rules": {
        "qualifying_min_lamps": 2,
        "free_items": ["Pocket mini lamp", "extra 2700K bulb"]
      },
      "return_policy": {
        "return_window_days": 30,
        "customer_pays_return_shipping_reasons": ["changed_mind", "fit", "style"],
        "brand_covers_return_shipping_reasons": ["damaged", "defective", "wrong_item"]
      }
    }'::jsonb,
  updated_at = now()
WHERE slug = 'warm-by-design';

DO $$
DECLARE
  wbd_id uuid;
BEGIN
  SELECT id INTO wbd_id FROM public.brands WHERE slug = 'warm-by-design';

  IF wbd_id IS NOT NULL AND to_regclass('public.return_settings') IS NOT NULL THEN
    UPDATE public.return_settings
    SET
      return_window_days = 30,
      portal_title = 'Start a return.',
      portal_description = '30 days from delivery. We will review your request and email the next steps.',
      restocking_fee_percent = 0,
      dimension_collection_enabled = true,
      updated_at = now()
    WHERE brand_id::text = wbd_id::text;
  END IF;
END $$;

-- Clean previously ingested WBD customer replies that included quoted Shopify
-- notification trails as plain text. Future inbound mail is cleaned in code.
WITH wbd AS (
  SELECT id FROM public.brands WHERE slug = 'warm-by-design'
),
dirty AS (
  SELECT tm.id, tm.content
  FROM public.ticket_messages tm
  JOIN public.tickets t ON t.id = tm.ticket_id
  JOIN wbd ON wbd.id = t.brand_id
  WHERE tm.sender_type = 'customer'
    AND position(E'\nOn ' in tm.content) > 0
    AND tm.content ILIKE '%wrote:%'
    AND (
      tm.content ILIKE '%warmbydesign.com/_t/c/%'
      OR tm.content ILIKE '%&lt;https://%'
      OR tm.content ILIKE '%[image:%'
    )
)
UPDATE public.ticket_messages tm
SET
  metadata = COALESCE(tm.metadata, '{}'::jsonb)
    || jsonb_build_object(
      'raw_body_preview', left(dirty.content, 2000),
      'cleaned_by', '009-warm-support-data'
    ),
  content = btrim(left(dirty.content, position(E'\nOn ' in dirty.content) - 1))
FROM dirty
WHERE tm.id = dirty.id;

COMMIT;
