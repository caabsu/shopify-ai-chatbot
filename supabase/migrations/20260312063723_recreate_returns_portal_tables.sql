
-- ============================================
-- Drop existing return_requests table (old schema)
-- ============================================
DROP TABLE IF EXISTS return_requests CASCADE;

-- ============================================
-- Table: return_requests
-- ============================================
CREATE TABLE return_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id),
  ticket_id uuid REFERENCES tickets(id),
  order_id text NOT NULL,
  order_number text NOT NULL,
  customer_email text NOT NULL,
  customer_name text,
  status text NOT NULL DEFAULT 'pending_review' CHECK (status IN ('pending_review', 'approved', 'partially_approved', 'denied', 'shipped', 'received', 'refunded', 'closed', 'cancelled')),
  shopify_return_id text,
  ai_recommendation jsonb,
  resolution_type text CHECK (resolution_type IN ('refund', 'exchange', 'store_credit')),
  refund_amount decimal,
  admin_notes text,
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  metadata jsonb
);

CREATE INDEX idx_return_requests_brand_status ON return_requests(brand_id, status);
CREATE INDEX idx_return_requests_customer_email ON return_requests(customer_email);
CREATE INDEX idx_return_requests_order_id ON return_requests(order_id);

-- ============================================
-- Table: return_items
-- ============================================
CREATE TABLE return_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_request_id uuid NOT NULL REFERENCES return_requests(id) ON DELETE CASCADE,
  line_item_id text NOT NULL,
  fulfillment_line_item_id text NOT NULL,
  product_title text NOT NULL,
  variant_title text,
  product_image_url text,
  quantity integer NOT NULL DEFAULT 1,
  price decimal NOT NULL,
  reason text NOT NULL CHECK (reason IN ('defective', 'wrong_item', 'changed_mind', 'doesnt_fit', 'not_as_described', 'other')),
  reason_details text,
  photo_urls text[],
  item_status text NOT NULL DEFAULT 'pending' CHECK (item_status IN ('pending', 'approved', 'denied')),
  denial_reason text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_return_items_return_request_id ON return_items(return_request_id);

-- ============================================
-- Table: return_rules
-- ============================================
CREATE TABLE return_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id),
  name text NOT NULL,
  enabled boolean DEFAULT true,
  priority integer DEFAULT 0,
  conditions jsonb NOT NULL,
  action text NOT NULL CHECK (action IN ('auto_approve', 'auto_deny', 'flag_review', 'ai_review')),
  resolution_type text CHECK (resolution_type IN ('refund', 'exchange', 'store_credit')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_return_rules_brand_enabled ON return_rules(brand_id, enabled);

-- ============================================
-- Enable RLS on all tables
-- ============================================
ALTER TABLE return_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE return_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE return_rules ENABLE ROW LEVEL SECURITY;

-- Permissive policies for service role
CREATE POLICY "Service role full access on return_requests"
  ON return_requests
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role full access on return_items"
  ON return_items
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role full access on return_rules"
  ON return_rules
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
;
