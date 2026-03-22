-- Reviews System Database Schema
-- Run this migration against your Supabase database

-- 1. Products table (synced from Shopify)
CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shopify_product_id text UNIQUE NOT NULL,
  title text NOT NULL,
  handle text NOT NULL,
  product_type text,
  vendor text,
  status text DEFAULT 'active',
  featured_image_url text,
  variants jsonb DEFAULT '[]',
  tags text[] DEFAULT '{}',
  synced_at timestamptz DEFAULT now(),
  brand_id uuid NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_products_brand_handle ON products(brand_id, handle);

ALTER TABLE products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all for service role" ON products;
CREATE POLICY "Allow all for service role" ON products FOR ALL USING (true) WITH CHECK (true);

-- 2. Reviews table
CREATE TABLE IF NOT EXISTS reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid REFERENCES products(id),
  shopify_product_id text,
  shopify_order_id text,
  customer_email text NOT NULL,
  customer_name text NOT NULL,
  customer_nickname text,
  rating integer NOT NULL CHECK (rating >= 1 AND rating <= 5),
  title text,
  body text NOT NULL,
  status text DEFAULT 'pending' CHECK (status IN ('pending','published','rejected','archived')),
  verified_purchase boolean DEFAULT false,
  incentivized boolean DEFAULT false,
  variant_title text,
  source text DEFAULT 'organic' CHECK (source IN ('import','email_request','organic','manual')),
  import_source_id text,
  featured boolean DEFAULT false,
  helpful_count integer DEFAULT 0,
  report_count integer DEFAULT 0,
  published_at timestamptz,
  submitted_at timestamptz DEFAULT now(),
  brand_id uuid NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reviews_product_status ON reviews(product_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reviews_brand_status ON reviews(brand_id, status);
CREATE INDEX IF NOT EXISTS idx_reviews_customer_email ON reviews(customer_email);
CREATE INDEX IF NOT EXISTS idx_reviews_shopify_order ON reviews(shopify_order_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_reviews_import_source ON reviews(import_source_id) WHERE import_source_id IS NOT NULL;

ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all for service role" ON reviews;
CREATE POLICY "Allow all for service role" ON reviews FOR ALL USING (true) WITH CHECK (true);

-- 3. Review media table
CREATE TABLE IF NOT EXISTS review_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id uuid NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  url text NOT NULL,
  media_type text DEFAULT 'image' CHECK (media_type IN ('image','video')),
  sort_order integer DEFAULT 0,
  file_size integer,
  width integer,
  height integer,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_review_media_review ON review_media(review_id, sort_order);

ALTER TABLE review_media ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all for service role" ON review_media;
CREATE POLICY "Allow all for service role" ON review_media FOR ALL USING (true) WITH CHECK (true);

-- 4. Review replies table
CREATE TABLE IF NOT EXISTS review_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id uuid NOT NULL UNIQUE REFERENCES reviews(id) ON DELETE CASCADE,
  author_name text NOT NULL,
  author_email text,
  body text NOT NULL,
  published boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE review_replies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all for service role" ON review_replies;
CREATE POLICY "Allow all for service role" ON review_replies FOR ALL USING (true) WITH CHECK (true);

-- 5. Review requests table (email collection tracking)
CREATE TABLE IF NOT EXISTS review_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shopify_order_id text NOT NULL,
  shopify_customer_id text,
  customer_email text NOT NULL,
  customer_name text,
  product_ids jsonb NOT NULL DEFAULT '[]',
  status text DEFAULT 'scheduled' CHECK (status IN ('scheduled','sent','reminded','completed','cancelled','bounced','expired')),
  scheduled_for timestamptz NOT NULL,
  sent_at timestamptz,
  reminder_scheduled_for timestamptz,
  reminder_sent_at timestamptz,
  completed_at timestamptz,
  token text UNIQUE NOT NULL,
  brand_id uuid NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_review_requests_status_scheduled ON review_requests(status, scheduled_for);
CREATE INDEX IF NOT EXISTS idx_review_requests_order ON review_requests(shopify_order_id);

ALTER TABLE review_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all for service role" ON review_requests;
CREATE POLICY "Allow all for service role" ON review_requests FOR ALL USING (true) WITH CHECK (true);

-- 6. Review settings table
CREATE TABLE IF NOT EXISTS review_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid UNIQUE NOT NULL,
  auto_publish boolean DEFAULT true,
  auto_publish_min_rating integer DEFAULT 1,
  auto_publish_verified_only boolean DEFAULT false,
  profanity_filter boolean DEFAULT true,
  request_enabled boolean DEFAULT true,
  request_delay_days integer DEFAULT 14,
  reminder_enabled boolean DEFAULT true,
  reminder_delay_days integer DEFAULT 7,
  incentive_enabled boolean DEFAULT false,
  incentive_type text,
  incentive_value text,
  sender_name text,
  sender_email text,
  review_form_fields jsonb DEFAULT '{}',
  widget_design jsonb DEFAULT '{}',
  reviews_per_page integer DEFAULT 10,
  default_sort text DEFAULT 'newest',
  show_verified_badge boolean DEFAULT true,
  show_incentivized_disclosure boolean DEFAULT true,
  incentivized_disclosure_text text DEFAULT 'This reviewer received an incentive for their honest review.',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE review_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all for service role" ON review_settings;
CREATE POLICY "Allow all for service role" ON review_settings FOR ALL USING (true) WITH CHECK (true);

-- 7. Review analytics cache
CREATE TABLE IF NOT EXISTS review_analytics_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL,
  product_id uuid,
  analysis_type text NOT NULL CHECK (analysis_type IN ('sentiment','themes','trends','actions','summary')),
  data jsonb NOT NULL,
  review_count integer NOT NULL,
  analyzed_at timestamptz DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_review_analytics_lookup ON review_analytics_cache(brand_id, product_id, analysis_type);

ALTER TABLE review_analytics_cache ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all for service role" ON review_analytics_cache;
CREATE POLICY "Allow all for service role" ON review_analytics_cache FOR ALL USING (true) WITH CHECK (true);

-- 8. Review email templates
CREATE TABLE IF NOT EXISTS review_email_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL,
  template_type text NOT NULL CHECK (template_type IN ('request','reminder','thank_you')),
  subject text NOT NULL,
  body_html text NOT NULL,
  enabled boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(brand_id, template_type)
);

ALTER TABLE review_email_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all for service role" ON review_email_templates;
CREATE POLICY "Allow all for service role" ON review_email_templates FOR ALL USING (true) WITH CHECK (true);

-- 9. Storage bucket for review media
INSERT INTO storage.buckets (id, name, public)
VALUES ('review-media', 'review-media', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Public read review media" ON storage.objects FOR SELECT USING (bucket_id = 'review-media');
CREATE POLICY "Service role upload review media" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'review-media');
CREATE POLICY "Service role delete review media" ON storage.objects FOR DELETE USING (bucket_id = 'review-media');

-- 10. Seed default email templates
INSERT INTO review_email_templates (brand_id, template_type, subject, body_html) VALUES
('00000000-0000-0000-0000-000000000000', 'request',
 'How are you enjoying your {{product_title}}?',
 '<div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
  <h2 style="color: #333; margin-bottom: 8px;">Hi {{customer_name}},</h2>
  <p style="color: #666; line-height: 1.6;">We hope you''re loving your <strong>{{product_title}}</strong>! Your feedback helps other customers and helps us improve.</p>
  <div style="text-align: center; margin: 32px 0;">
    <a href="{{review_link}}" style="display: inline-block; padding: 14px 32px; background: #18181b; color: #fff; text-decoration: none; border-radius: 8px; font-weight: 500; letter-spacing: 0.5px;">WRITE A REVIEW</a>
  </div>
  <p style="color: #999; font-size: 13px;">Thank you for your purchase!</p>
</div>'),
('00000000-0000-0000-0000-000000000000', 'reminder',
 'Still thinking about your {{product_title}}?',
 '<div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
  <h2 style="color: #333; margin-bottom: 8px;">Hi {{customer_name}},</h2>
  <p style="color: #666; line-height: 1.6;">We''d love to hear your thoughts on your <strong>{{product_title}}</strong>. It only takes a minute!</p>
  <div style="text-align: center; margin: 32px 0;">
    <a href="{{review_link}}" style="display: inline-block; padding: 14px 32px; background: #18181b; color: #fff; text-decoration: none; border-radius: 8px; font-weight: 500; letter-spacing: 0.5px;">SHARE YOUR EXPERIENCE</a>
  </div>
  <p style="color: #999; font-size: 13px;">Thank you!</p>
</div>'),
('00000000-0000-0000-0000-000000000000', 'thank_you',
 'Thank you for your review!',
 '<div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
  <h2 style="color: #333; margin-bottom: 8px;">Thank you, {{customer_name}}!</h2>
  <p style="color: #666; line-height: 1.6;">We appreciate you taking the time to review your <strong>{{product_title}}</strong>. Your feedback helps our community!</p>
  <p style="color: #999; font-size: 13px;">— The {{brand_name}} Team</p>
</div>')
ON CONFLICT (brand_id, template_type) DO NOTHING;
