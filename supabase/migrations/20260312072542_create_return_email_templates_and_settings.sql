
-- Return email templates table
CREATE TABLE return_email_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id text NOT NULL,
  template_type text NOT NULL CHECK (template_type IN ('confirmation','approved','denied','refunded')),
  enabled boolean NOT NULL DEFAULT true,
  subject text NOT NULL,
  body_html text NOT NULL,
  body_text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(brand_id, template_type)
);
ALTER TABLE return_email_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON return_email_templates FOR ALL USING (true);

-- Return settings table
CREATE TABLE return_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id text NOT NULL UNIQUE,
  return_window_days integer NOT NULL DEFAULT 30,
  require_photos boolean NOT NULL DEFAULT false,
  ai_confidence_threshold numeric(3,2) NOT NULL DEFAULT 0.85,
  available_reasons jsonb NOT NULL DEFAULT '["defective","wrong_item","not_as_described","changed_mind","too_small","too_large","arrived_late","other"]',
  reason_labels jsonb NOT NULL DEFAULT '{"defective":"Defective / Damaged","wrong_item":"Wrong Item Received","not_as_described":"Not as Described","changed_mind":"Changed My Mind","too_small":"Too Small","too_large":"Too Large","arrived_late":"Arrived Late","other":"Other"}',
  available_resolutions jsonb NOT NULL DEFAULT '["refund","store_credit","exchange"]',
  auto_close_days integer NOT NULL DEFAULT 30,
  portal_title text NOT NULL DEFAULT 'Returns & Exchanges',
  portal_description text NOT NULL DEFAULT 'Start a return or exchange in just a few steps.',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE return_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON return_settings FOR ALL USING (true);
;
