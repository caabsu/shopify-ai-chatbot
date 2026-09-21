
CREATE TABLE ai_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ai_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on ai_config"
  ON ai_config
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
;
