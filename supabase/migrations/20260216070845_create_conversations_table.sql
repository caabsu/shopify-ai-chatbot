
CREATE TABLE conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shopify_customer_id text,
  customer_email text,
  customer_name text,
  customer_phone text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed', 'escalated')),
  page_url text,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  last_message_at timestamptz,
  message_count integer NOT NULL DEFAULT 0,
  satisfaction_score integer CHECK (satisfaction_score BETWEEN 1 AND 5),
  resolved boolean NOT NULL DEFAULT false,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_conversations_status ON conversations (status);
CREATE INDEX idx_conversations_started_at ON conversations (started_at);
CREATE INDEX idx_conversations_customer_email ON conversations (customer_email);

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on conversations"
  ON conversations
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
;
