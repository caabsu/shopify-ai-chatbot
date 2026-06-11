-- 011 — Autopilot: promote action plans from tickets.metadata.autopilot to a table
--
-- OPTIONAL. Autopilot works fully on tickets.metadata today. Apply when plan
-- volume grows and you want indexed queries, history, and analytics
-- (approval rate, confidence calibration, per-action success rate).

CREATE TABLE IF NOT EXISTS ticket_action_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES brands(id),
  status text NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed','approved','executing','executed','partially_executed','failed','dismissed')),
  trigger text NOT NULL CHECK (trigger IN ('new_ticket','customer_reply','sweep')),
  analysis jsonb NOT NULL DEFAULT '{}',
  actions jsonb NOT NULL DEFAULT '[]',
  overall_confidence real,
  proposed_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  decided_by text,
  executed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ticket_action_plans_brand_status_idx
  ON ticket_action_plans (brand_id, status, proposed_at DESC);
CREATE INDEX IF NOT EXISTS ticket_action_plans_ticket_idx
  ON ticket_action_plans (ticket_id);

-- Backfill from metadata once the table exists:
-- INSERT INTO ticket_action_plans (ticket_id, brand_id, status, trigger, analysis, actions, overall_confidence, proposed_at, decided_at, decided_by, executed_at)
-- SELECT id, brand_id,
--        metadata->'autopilot'->>'status',
--        metadata->'autopilot'->>'trigger',
--        metadata->'autopilot'->'analysis',
--        metadata->'autopilot'->'actions',
--        (metadata->'autopilot'->'analysis'->>'overall_confidence')::real,
--        (metadata->'autopilot'->>'proposed_at')::timestamptz,
--        (metadata->'autopilot'->>'decided_at')::timestamptz,
--        metadata->'autopilot'->>'decided_by',
--        (metadata->'autopilot'->>'executed_at')::timestamptz
-- FROM tickets WHERE metadata ? 'autopilot';
