-- Add product selection tracking columns to quiz_sessions
ALTER TABLE quiz_sessions
  ADD COLUMN IF NOT EXISTS selection_mode text CHECK (selection_mode IN ('ai', 'curated')),
  ADD COLUMN IF NOT EXISTS selected_products jsonb;;
