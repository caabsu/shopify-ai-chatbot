-- Warm by Design — Brand Seed Data
-- Run this against the Supabase project (wwblkodkycjwmzlflncg)

-- 1. Insert brand
INSERT INTO brands (id, slug, name, shopify_shop, enabled, settings)
VALUES (
  'b2f7e4a1-8c3d-4e5f-9a1b-2c3d4e5f6a7b',
  'warm-by-design',
  'Warm by Design',
  'warm-by-design',  -- Update when Shopify store is created
  true,
  '{
    "domain": null,
    "fonts": {
      "heading": "Bricolage Grotesque",
      "body": "Outfit",
      "label": "Syne"
    },
    "colors": {
      "surface": "#131313",
      "cream": "#F0EDE8",
      "amber": "#f5bc70",
      "onPrimary": "#462b00"
    },
    "theme": "dark"
  }'::jsonb
)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  settings = EXCLUDED.settings,
  enabled = EXCLUDED.enabled;

-- 2. Insert ai_config entries for this brand
INSERT INTO ai_config (key, value, brand_id)
VALUES
  (
    'system_prompt',
    'You are a lighting expert for Warm by Design, a premium DTC ambient lighting brand. Every product is tuned to exactly 2700K — the color temperature of golden hour. You help customers find the right light for their space, track orders, process returns, and answer questions. You speak with intention and warmth. You are knowledgeable but never condescending — you assume the customer appreciates good design. Keep responses concise and helpful. Never push sales; guide with expertise. When recommending products, explain how they''ll feel in the space, not just specs.',
    'b2f7e4a1-8c3d-4e5f-9a1b-2c3d4e5f6a7b'
  ),
  (
    'brand_voice',
    'Intentional, warm, restrained, considered, concise. Speak like an expert who assumes you get it — not an educator. Specific, not vague. Premium without performing premium. Never use words like affordable, budget, discount, sale, bright, or LED specs.',
    'b2f7e4a1-8c3d-4e5f-9a1b-2c3d4e5f6a7b'
  ),
  (
    'greeting',
    'Welcome. I can help you find the right light, check on an order, or answer any questions about our collection. What can I do for you?',
    'b2f7e4a1-8c3d-4e5f-9a1b-2c3d4e5f6a7b'
  ),
  (
    'preset_actions',
    '[{"id":"track_order","label":"Track my order","icon":"truck","prompt":"I want to track my order","description":"Check shipping status and delivery estimates"},{"id":"start_return","label":"Start a return","icon":"return","prompt":"I want to start a return","description":"Return or exchange within 30 days"},{"id":"find_lamp","label":"Find a lamp","icon":"search","prompt":"Help me find the right lamp for my space","description":"Get a personalized recommendation"},{"id":"shipping_info","label":"Shipping info","icon":"help","prompt":"What are your shipping options?","description":"Delivery times, costs, and coverage"},{"id":"talk_to_human","label":"Talk to a human","icon":"contact","prompt":"I want to talk to a real person","description":"Connect with our lighting team"}]',
    'b2f7e4a1-8c3d-4e5f-9a1b-2c3d4e5f6a7b'
  )
ON CONFLICT (key, brand_id) DO UPDATE SET
  value = EXCLUDED.value;
