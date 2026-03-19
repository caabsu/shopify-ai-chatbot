-- Trade Program Tables
-- Run against Supabase SQL editor

-- 1. Trade Applications
CREATE TABLE IF NOT EXISTS trade_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  full_name text NOT NULL,
  email text NOT NULL,
  phone text NOT NULL,
  company_name text NOT NULL,
  business_type text NOT NULL CHECK (business_type IN ('interior_designer', 'architect', 'contractor', 'hospitality', 'developer', 'other')),
  website_url text NOT NULL,
  project_description text,
  referral_source text,
  shopify_customer_id text,
  shopify_company_id text,
  auto_approved boolean NOT NULL DEFAULT false,
  reviewed_by uuid REFERENCES agents(id),
  reviewed_at timestamptz,
  rejection_reason text,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_trade_applications_active_email
  ON trade_applications (email, brand_id)
  WHERE status IN ('pending', 'approved');

-- 2. Trade Members
CREATE TABLE IF NOT EXISTS trade_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id),
  application_id uuid NOT NULL REFERENCES trade_applications(id),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'revoked')),
  shopify_customer_id text NOT NULL,
  shopify_company_id text NOT NULL,
  company_name text NOT NULL,
  contact_name text NOT NULL,
  email text NOT NULL,
  phone text NOT NULL,
  business_type text NOT NULL,
  website_url text NOT NULL,
  payment_terms text NOT NULL DEFAULT 'DUE_ON_FULFILLMENT' CHECK (payment_terms IN ('DUE_ON_FULFILLMENT', 'NET_30', 'NET_60')),
  discount_code text,
  total_orders integer NOT NULL DEFAULT 0,
  total_spent numeric NOT NULL DEFAULT 0,
  notes text,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_trade_members_active_email
  ON trade_members (email, brand_id)
  WHERE status = 'active';

-- 3. Trade Settings
CREATE TABLE IF NOT EXISTS trade_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id) UNIQUE,
  auto_approve_enabled boolean NOT NULL DEFAULT true,
  auto_approve_rules jsonb NOT NULL DEFAULT '{"rules":[{"id":"website_required","field":"website_url","condition":"is_not_empty","enabled":true}],"logic":"all"}',
  default_discount_percent integer NOT NULL DEFAULT 30,
  default_payment_terms text NOT NULL DEFAULT 'DUE_ON_FULFILLMENT',
  welcome_email_template text,
  rejection_email_template text,
  discount_code text NOT NULL DEFAULT 'TRADE30',
  concierge_email text,
  ticket_priority_level text NOT NULL DEFAULT 'high',
  metadata jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 4. Trade Activity Log
CREATE TABLE IF NOT EXISTS trade_activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id),
  member_id uuid REFERENCES trade_members(id),
  application_id uuid REFERENCES trade_applications(id),
  event_type text NOT NULL,
  actor text NOT NULL CHECK (actor IN ('system', 'agent', 'customer')),
  actor_id text,
  details jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes for common queries
CREATE INDEX idx_trade_applications_brand_status ON trade_applications (brand_id, status);
CREATE INDEX idx_trade_applications_email ON trade_applications (email);
CREATE INDEX idx_trade_members_brand_status ON trade_members (brand_id, status);
CREATE INDEX idx_trade_members_email ON trade_members (email);
CREATE INDEX idx_trade_activity_log_brand ON trade_activity_log (brand_id, created_at DESC);
CREATE INDEX idx_trade_activity_log_member ON trade_activity_log (member_id, created_at DESC);
CREATE INDEX idx_trade_activity_log_application ON trade_activity_log (application_id, created_at DESC);

-- Insert default settings for Outlight brand
INSERT INTO trade_settings (brand_id)
VALUES ('883e4a28-9f2e-4850-a527-29f297d8b6f8')
ON CONFLICT (brand_id) DO NOTHING;
