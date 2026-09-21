
CREATE TABLE messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'human_agent')),
  content text NOT NULL,
  model text,
  tokens_input integer,
  tokens_output integer,
  latency_ms integer,
  tools_used jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_messages_conversation_created ON messages (conversation_id, created_at);
CREATE INDEX idx_messages_created_at ON messages (created_at);

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on messages"
  ON messages
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
;
