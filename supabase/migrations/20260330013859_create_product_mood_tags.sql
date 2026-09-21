
CREATE TABLE product_mood_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL,
  product_handle text NOT NULL,
  product_title text NOT NULL,
  product_image_url text,
  product_type text,
  mood_scores jsonb NOT NULL DEFAULT '{}',
  tagged_by text NOT NULL DEFAULT 'ai',
  ai_model text,
  ai_analysis jsonb,
  tagged_at timestamptz DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(brand_id, product_handle)
);

CREATE INDEX idx_product_mood_tags_brand ON product_mood_tags(brand_id);
CREATE INDEX idx_product_mood_tags_type ON product_mood_tags(brand_id, product_type);

ALTER TABLE product_mood_tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on product_mood_tags"
  ON product_mood_tags FOR ALL
  USING (true) WITH CHECK (true);

-- Add selection fields to quiz_sessions
ALTER TABLE quiz_sessions ADD COLUMN IF NOT EXISTS selection_mode text;
ALTER TABLE quiz_sessions ADD COLUMN IF NOT EXISTS selected_products jsonb;
;
