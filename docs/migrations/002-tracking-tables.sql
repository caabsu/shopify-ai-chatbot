-- ── Migration 002: Order Tracking Tables ──────────────────────────────────────

-- tracking_settings: per-brand widget design and configuration
CREATE TABLE IF NOT EXISTS tracking_settings (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id              text        NOT NULL UNIQUE,
  widget_design         jsonb       NOT NULL DEFAULT '{}',
  custom_status_messages jsonb      NOT NULL DEFAULT '{}',
  carrier_display_names jsonb       NOT NULL DEFAULT '{}',
  cache_ttl_minutes     integer     NOT NULL DEFAULT 30,
  seventeen_track_api_key text      NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE tracking_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all" ON tracking_settings
  FOR ALL USING (true) WITH CHECK (true);

-- tracking_cache: cached 17track API responses
CREATE TABLE IF NOT EXISTS tracking_cache (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tracking_number text        NOT NULL UNIQUE,
  brand_id        text        NULL,
  status          text        NOT NULL,
  "statusDetail"  text        NOT NULL DEFAULT '',
  events          jsonb       NOT NULL DEFAULT '[]',
  carrier         text        NOT NULL DEFAULT 'unknown',
  "signedBy"      text        NULL,
  "deliveredAt"   text        NULL,
  "cachedAt"      timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tracking_cache_number_idx ON tracking_cache (tracking_number);
CREATE INDEX IF NOT EXISTS tracking_cache_cached_at_idx ON tracking_cache ("cachedAt");

ALTER TABLE tracking_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all" ON tracking_cache
  FOR ALL USING (true) WITH CHECK (true);
