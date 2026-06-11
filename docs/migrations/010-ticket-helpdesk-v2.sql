-- 010 — Ticket helpdesk v2: snooze / merge / CSAT / AI triage + performance indexes
--
-- CONTEXT: The v2 helpdesk features (snooze, merge, CSAT, AI triage) currently
-- store their state in tickets.metadata (jsonb) because schema DDL could not be
-- applied at ship time. Everything works without this migration. Applying it
-- promotes the hot fields to real columns (faster filters, real constraints)
-- — but code keeps reading metadata as a fallback, so apply whenever convenient.
--
-- Apply via the Supabase SQL editor (Dashboard → SQL) or psql.

-- ── 1. Promote metadata fields to columns ────────────────────────────────────
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS snoozed_until timestamptz;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS merged_into_ticket_id uuid REFERENCES tickets(id) ON DELETE SET NULL;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS csat_score integer CHECK (csat_score BETWEEN 1 AND 5);
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS csat_responded_at timestamptz;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS csat_sent_at timestamptz;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS sentiment text CHECK (sentiment IN ('angry','frustrated','neutral','positive'));

-- Backfill from metadata (idempotent)
UPDATE tickets SET snoozed_until = (metadata->>'snoozed_until')::timestamptz
  WHERE snoozed_until IS NULL AND metadata->>'snoozed_until' IS NOT NULL;
UPDATE tickets SET merged_into_ticket_id = (metadata->>'merged_into_ticket_id')::uuid
  WHERE merged_into_ticket_id IS NULL AND metadata->>'merged_into_ticket_id' IS NOT NULL;
UPDATE tickets SET csat_score = (metadata->'csat'->>'score')::integer,
                   csat_responded_at = (metadata->'csat'->>'at')::timestamptz
  WHERE csat_score IS NULL AND metadata->'csat'->>'score' IS NOT NULL;
UPDATE tickets SET csat_sent_at = (metadata->>'csat_sent_at')::timestamptz
  WHERE csat_sent_at IS NULL AND metadata->>'csat_sent_at' IS NOT NULL;
UPDATE tickets SET sentiment = metadata->'ai_triage'->>'sentiment'
  WHERE sentiment IS NULL AND metadata->'ai_triage'->>'sentiment' IN ('angry','frustrated','neutral','positive');

-- ── 2. Assignment integrity ──────────────────────────────────────────────────
-- tickets.assigned_to stores agent_users.id (set by the admin console).
-- Add the FK only after confirming no orphaned values:
--   SELECT count(*) FROM tickets t LEFT JOIN agent_users a ON a.id = t.assigned_to
--   WHERE t.assigned_to IS NOT NULL AND a.id IS NULL;
-- If 0:
-- ALTER TABLE tickets ADD CONSTRAINT tickets_assigned_to_fkey
--   FOREIGN KEY (assigned_to) REFERENCES agent_users(id) ON DELETE SET NULL;

-- ── 3. Performance indexes (the list views' hot paths) ───────────────────────
CREATE INDEX IF NOT EXISTS tickets_brand_status_created_idx
  ON tickets (brand_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS tickets_brand_sla_idx
  ON tickets (brand_id, sla_deadline)
  WHERE sla_breached = false AND status IN ('open','pending');
CREATE INDEX IF NOT EXISTS tickets_brand_assigned_idx
  ON tickets (brand_id, assigned_to)
  WHERE assigned_to IS NOT NULL;
CREATE INDEX IF NOT EXISTS tickets_metadata_gin_idx
  ON tickets USING gin (metadata);
CREATE INDEX IF NOT EXISTS ticket_messages_ticket_created_idx
  ON ticket_messages (ticket_id, created_at);
CREATE INDEX IF NOT EXISTS ticket_events_ticket_created_idx
  ON ticket_events (ticket_id, created_at DESC);

-- ── 4. Data-quality guards ───────────────────────────────────────────────────
-- Classification values are validated in code; enforce at the DB once clean:
--   SELECT DISTINCT classification FROM tickets WHERE classification IS NOT NULL;
-- ALTER TABLE tickets ADD CONSTRAINT tickets_classification_check
--   CHECK (classification IN ('customer_support','promotional','transactional','automated','spam','internal'));
