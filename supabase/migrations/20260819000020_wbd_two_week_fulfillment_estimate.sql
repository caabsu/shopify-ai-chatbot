-- Replace the stale month/four-week fulfillment estimate with the current
-- reviewer-supplied Warm by Design estimate. The fact is deliberately marked
-- time-sensitive so it can be superseded without contaminating durable policy.

WITH wbd AS (
  SELECT id FROM public.brands WHERE slug = 'warm-by-design'
)
UPDATE public.knowledge_documents AS document
SET
  title = 'Fulfillment delay playbook (August 2026)',
  content = replace(
    replace(
      replace(document.content, 'about another month', 'about two weeks'),
      'about another four weeks', 'about two weeks'
    ),
    '3 to 4 weeks', 'about two weeks'
  ),
  updated_at = now()
FROM wbd
WHERE document.brand_id = wbd.id
  AND document.enabled = true
  AND document.category = 'shipping'
  AND (
    document.content ILIKE '%another month%'
    OR document.content ILIKE '%another four weeks%'
    OR document.content ILIKE '%3 to 4 weeks%'
  );

WITH wbd AS (
  SELECT id FROM public.brands WHERE slug = 'warm-by-design'
)
UPDATE public.support_facts AS fact
SET
  content = 'Warm by Design policy copy says orders are prepared for shipment and customers are notified with tracking after shipment. Use Shopify fulfillment and tracking data when available. If no tracking is available, do not invent a tracking link or carrier. For the current fulfillment backlog, use about two weeks unless more specific verified Shopify order data is available.',
  data = COALESCE(fact.data, '{}'::jsonb)
    || '{"fallback_delivery_window":"about 2 weeks","tracking_rule":"only use Shopify-provided tracking"}'::jsonb,
  updated_at = now()
FROM wbd
WHERE fact.brand_id = wbd.id
  AND fact.key = 'wbd_delivery_expectations';

WITH wbd AS (
  SELECT id FROM public.brands WHERE slug = 'warm-by-design'
)
UPDATE public.autopilot_learning_memories AS memory
SET
  status = 'superseded',
  valid_until = GREATEST(now(), memory.valid_from + interval '1 second'),
  updated_at = now()
FROM wbd
WHERE memory.brand_id = wbd.id
  AND memory.status IN ('candidate', 'active')
  AND memory.time_sensitive = true
  AND (
    memory.statement ILIKE '%another month%'
    OR memory.statement ILIKE '%~1 month%'
    OR memory.statement ILIKE '%one month%'
    OR memory.statement ILIKE '%another four weeks%'
    OR memory.statement ILIKE '%3 to 4 weeks%'
  );

WITH wbd AS (
  SELECT id FROM public.brands WHERE slug = 'warm-by-design'
)
INSERT INTO public.autopilot_learning_memories (
  brand_id,
  memory_key,
  kind,
  statement,
  scope,
  status,
  confidence_score,
  trust_score,
  evidence_count,
  positive_evidence_count,
  human_revision_count,
  positive_mass,
  time_sensitive,
  valid_from,
  valid_until,
  last_supported_at,
  learner_version
)
SELECT
  wbd.id,
  'delayed_fulfillment_two_week_timeline',
  'fact',
  'For current Warm by Design fulfillment-delay status inquiries, state that shipment is expected in about two weeks unless more specific verified Shopify evidence exists. Do not use the stale one-month or four-week estimate, and do not offer cancellation or a refund unless the customer asks.',
  '{"intent":"order_status","topics":["shipping-delay","fulfillment-delay"],"language":"en","action_types":["send_reply"]}'::jsonb,
  'active',
  0.99,
  1.0,
  1,
  1,
  1,
  1.0,
  true,
  now(),
  now() + interval '90 days',
  now(),
  'manual_policy_update_v1'
FROM wbd
ON CONFLICT (brand_id, memory_key, scope_hash, kind, statement_hash)
DO UPDATE SET
  status = 'active',
  confidence_score = 0.99,
  trust_score = 1.0,
  human_revision_count = public.autopilot_learning_memories.human_revision_count + 1,
  valid_from = now(),
  valid_until = now() + interval '90 days',
  last_supported_at = now(),
  updated_at = now();
