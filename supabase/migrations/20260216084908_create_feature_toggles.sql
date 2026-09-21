
-- Create feature_toggles table
CREATE TABLE feature_toggles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id),
  feature_key text NOT NULL,
  enabled boolean DEFAULT true,
  metadata jsonb DEFAULT '{}'::jsonb,
  updated_at timestamptz DEFAULT now(),
  UNIQUE(brand_id, feature_key)
);

ALTER TABLE feature_toggles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON feature_toggles
  FOR ALL USING (true) WITH CHECK (true);

-- Seed with all 11 tools enabled for Outlight
INSERT INTO feature_toggles (brand_id, feature_key, enabled) VALUES
  ('883e4a28-9f2e-4850-a527-29f297d8b6f8', 'search_products', true),
  ('883e4a28-9f2e-4850-a527-29f297d8b6f8', 'get_product_details', true),
  ('883e4a28-9f2e-4850-a527-29f297d8b6f8', 'answer_store_policy', true),
  ('883e4a28-9f2e-4850-a527-29f297d8b6f8', 'lookup_order', true),
  ('883e4a28-9f2e-4850-a527-29f297d8b6f8', 'check_return_eligibility', true),
  ('883e4a28-9f2e-4850-a527-29f297d8b6f8', 'initiate_return', true),
  ('883e4a28-9f2e-4850-a527-29f297d8b6f8', 'search_knowledge_base', true),
  ('883e4a28-9f2e-4850-a527-29f297d8b6f8', 'manage_cart', true),
  ('883e4a28-9f2e-4850-a527-29f297d8b6f8', 'get_cart', true),
  ('883e4a28-9f2e-4850-a527-29f297d8b6f8', 'navigate_customer', true),
  ('883e4a28-9f2e-4850-a527-29f297d8b6f8', 'escalate_to_human', true);
;
