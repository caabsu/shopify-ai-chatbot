CREATE TABLE IF NOT EXISTS agent_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id),
  name text NOT NULL,
  email text NOT NULL,
  password_hash text,
  role text NOT NULL DEFAULT 'agent' CHECK (role IN ('admin', 'agent')),
  is_active boolean DEFAULT true,
  avatar_url text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(brand_id, email)
);

ALTER TABLE agent_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all" ON agent_users FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_agent_users_brand_email ON agent_users(brand_id, email);
