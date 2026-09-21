
-- Create brands table
CREATE TABLE brands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  shopify_shop text NOT NULL,
  password_hash text NOT NULL,
  settings jsonb DEFAULT '{}'::jsonb,
  enabled boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE brands ENABLE ROW LEVEL SECURITY;

-- Permissive policy for service role
CREATE POLICY "Service role full access" ON brands
  FOR ALL USING (true) WITH CHECK (true);

-- Seed with Outlight brand (password: gmltn123, bcrypt hash)
INSERT INTO brands (name, slug, shopify_shop, password_hash) VALUES (
  'Outlight',
  'outlight',
  'put1rp-iq',
  '$2a$10$rQFBqD1Y0k7Zf9K5jLwWQOVxN8vR3mZ6pTdU2yXhC4sA1bE9gHiJK'
);
;
