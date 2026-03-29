-- Migration: Quiz Funnel Tables
-- Supports A/B test quiz funnels with session tracking, event analytics,
-- product recommendation pools, and configuration management.

-- ── quiz_sessions: One row per quiz attempt ──
CREATE TABLE IF NOT EXISTS quiz_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  session_id text NOT NULL UNIQUE,
  concept text NOT NULL CHECK (concept IN ('reveal', 'style-profile')),
  status text NOT NULL DEFAULT 'started' CHECK (status IN ('started', 'in_progress', 'completed', 'abandoned')),
  current_step text,
  answers jsonb DEFAULT '{}',
  profile_key text,
  profile_name text,
  email text,
  photo_uploaded boolean DEFAULT false,
  photo_url text,
  render_url text,
  render_status text DEFAULT NULL CHECK (render_status IS NULL OR render_status IN ('pending', 'processing', 'completed', 'failed')),
  recommended_products jsonb,
  cart_created boolean DEFAULT false,
  converted boolean DEFAULT false,
  device_type text,
  referrer text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  started_at timestamptz DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quiz_sessions_brand_id ON quiz_sessions(brand_id);
CREATE INDEX IF NOT EXISTS idx_quiz_sessions_status ON quiz_sessions(status);
CREATE INDEX IF NOT EXISTS idx_quiz_sessions_concept ON quiz_sessions(concept);
CREATE INDEX IF NOT EXISTS idx_quiz_sessions_created_at ON quiz_sessions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quiz_sessions_email ON quiz_sessions(email) WHERE email IS NOT NULL;

-- ── quiz_events: Granular event tracking ──
CREATE TABLE IF NOT EXISTS quiz_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  session_id text NOT NULL,
  event_type text NOT NULL,
  step text,
  data jsonb,
  duration_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quiz_events_session_id ON quiz_events(session_id);
CREATE INDEX IF NOT EXISTS idx_quiz_events_brand_id ON quiz_events(brand_id);
CREATE INDEX IF NOT EXISTS idx_quiz_events_event_type ON quiz_events(event_type);
CREATE INDEX IF NOT EXISTS idx_quiz_events_created_at ON quiz_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quiz_events_step ON quiz_events(step) WHERE step IS NOT NULL;

-- ── quiz_product_pools: Dashboard-controlled product pools ──
CREATE TABLE IF NOT EXISTS quiz_product_pools (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  profile_keys text[] DEFAULT '{}',
  product_handles jsonb DEFAULT '[]',
  priority integer DEFAULT 0,
  enabled boolean DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quiz_product_pools_brand_id ON quiz_product_pools(brand_id);

-- ── quiz_config: Per-brand quiz configuration ──
CREATE TABLE IF NOT EXISTS quiz_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  key text NOT NULL,
  value jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(brand_id, key)
);

CREATE INDEX IF NOT EXISTS idx_quiz_config_brand_key ON quiz_config(brand_id, key);

-- ── Seed default config for Outlight brand ──
INSERT INTO quiz_config (brand_id, key, value) VALUES
  ('883e4a28-9f2e-4850-a527-29f297d8b6f8', 'active_concepts', '["reveal", "style-profile"]'::jsonb),
  ('883e4a28-9f2e-4850-a527-29f297d8b6f8', 'ab_split', '{"reveal": 50, "style-profile": 50}'::jsonb),
  ('883e4a28-9f2e-4850-a527-29f297d8b6f8', 'gemini_review_model', '"gemini-3.1-flash-lite-preview"'::jsonb),
  ('883e4a28-9f2e-4850-a527-29f297d8b6f8', 'gemini_image_model', '"nano-banana-pro-preview"'::jsonb),
  ('883e4a28-9f2e-4850-a527-29f297d8b6f8', 'email_capture_enabled', 'true'::jsonb),
  ('883e4a28-9f2e-4850-a527-29f297d8b6f8', 'photo_upload_enabled', 'true'::jsonb)
ON CONFLICT (brand_id, key) DO NOTHING;
