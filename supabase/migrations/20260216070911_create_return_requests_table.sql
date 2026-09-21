
CREATE TABLE return_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id text NOT NULL,
  line_item_ids jsonb NOT NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'completed')),
  conversation_id uuid REFERENCES conversations(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE return_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on return_requests"
  ON return_requests
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
;
