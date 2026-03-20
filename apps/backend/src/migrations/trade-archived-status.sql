-- Add 'archived' to the trade_applications status check constraint
ALTER TABLE trade_applications DROP CONSTRAINT IF EXISTS trade_applications_status_check;
ALTER TABLE trade_applications ADD CONSTRAINT trade_applications_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'archived'));

-- The unique index already only covers pending/approved, so archived emails can reapply
-- No changes needed to idx_trade_applications_active_email
