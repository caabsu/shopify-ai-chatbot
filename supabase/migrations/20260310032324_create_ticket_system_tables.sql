
-- Sequence for human-readable ticket numbers starting at 1001
CREATE SEQUENCE IF NOT EXISTS ticket_number_seq START WITH 1001;

-- Main tickets table
CREATE TABLE tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL DEFAULT '883e4a28-9f2e-4850-a527-29f297d8b6f8'::uuid REFERENCES brands(id),
  ticket_number integer NOT NULL UNIQUE DEFAULT nextval('ticket_number_seq'),
  source text NOT NULL CHECK (source IN ('email', 'form', 'ai_escalation')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'pending', 'resolved', 'closed')),
  priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  category text CHECK (category IN ('order_issue', 'return_refund', 'product_inquiry', 'shipping', 'billing', 'complaint', 'custom_request', 'partnership', 'other')),
  subject text NOT NULL,
  customer_email text NOT NULL,
  customer_name text,
  customer_phone text,
  shopify_customer_id text,
  assigned_to uuid,
  tags text[] DEFAULT '{}',
  conversation_id uuid REFERENCES conversations(id),
  order_id text,
  metadata jsonb,
  first_response_at timestamptz,
  resolved_at timestamptz,
  closed_at timestamptz,
  sla_deadline timestamptz,
  sla_breached boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Ticket messages (thread)
CREATE TABLE ticket_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  sender_type text NOT NULL CHECK (sender_type IN ('customer', 'agent', 'system', 'ai_draft')),
  sender_name text,
  sender_email text,
  content text NOT NULL,
  content_html text,
  is_internal_note boolean DEFAULT false,
  attachments jsonb DEFAULT '[]',
  email_message_id text UNIQUE,
  ai_generated boolean DEFAULT false,
  metadata jsonb,
  created_at timestamptz DEFAULT now()
);

-- Ticket events (audit log)
CREATE TABLE ticket_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  actor text NOT NULL CHECK (actor IN ('system', 'agent', 'customer', 'ai')),
  actor_id text,
  old_value text,
  new_value text,
  metadata jsonb,
  created_at timestamptz DEFAULT now()
);

-- Agents (VA accounts)
CREATE TABLE agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL DEFAULT '883e4a28-9f2e-4850-a527-29f297d8b6f8'::uuid REFERENCES brands(id),
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role text NOT NULL DEFAULT 'agent' CHECK (role IN ('admin', 'agent')),
  is_active boolean DEFAULT true,
  avatar_url text,
  notification_preferences jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Canned responses (templates)
CREATE TABLE canned_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL DEFAULT '883e4a28-9f2e-4850-a527-29f297d8b6f8'::uuid REFERENCES brands(id),
  name text NOT NULL,
  category text NOT NULL,
  content text NOT NULL,
  variables text[] DEFAULT '{}',
  usage_count integer DEFAULT 0,
  created_by uuid REFERENCES agents(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- SLA rules
CREATE TABLE sla_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL DEFAULT '883e4a28-9f2e-4850-a527-29f297d8b6f8'::uuid REFERENCES brands(id),
  priority text NOT NULL,
  first_response_minutes integer NOT NULL,
  resolution_target_minutes integer NOT NULL,
  business_hours_only boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(brand_id, priority)
);

-- Add assigned_to FK now that agents table exists
ALTER TABLE tickets ADD CONSTRAINT tickets_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES agents(id);

-- Update conversations: add escalated_ticket_id
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS escalated_ticket_id uuid REFERENCES tickets(id);

-- Update knowledge_documents: add visibility, usage_count, last_used_at
ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS visibility text DEFAULT 'all' CHECK (visibility IN ('all', 'internal', 'ai_only'));
ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS usage_count integer DEFAULT 0;
ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS last_used_at timestamptz;

-- Indexes for tickets
CREATE INDEX idx_tickets_status ON tickets(status);
CREATE INDEX idx_tickets_priority ON tickets(priority);
CREATE INDEX idx_tickets_assigned_to ON tickets(assigned_to);
CREATE INDEX idx_tickets_customer_email ON tickets(customer_email);
CREATE INDEX idx_tickets_sla_deadline ON tickets(sla_deadline);
CREATE INDEX idx_tickets_status_priority_sla ON tickets(status, priority, sla_deadline);
CREATE INDEX idx_tickets_conversation_id ON tickets(conversation_id);
CREATE INDEX idx_tickets_brand_id ON tickets(brand_id);
CREATE INDEX idx_tickets_source ON tickets(source);
CREATE INDEX idx_tickets_created_at ON tickets(created_at);

-- Indexes for ticket_messages
CREATE INDEX idx_ticket_messages_ticket_created ON ticket_messages(ticket_id, created_at);

-- Indexes for ticket_events
CREATE INDEX idx_ticket_events_ticket_created ON ticket_events(ticket_id, created_at);
CREATE INDEX idx_ticket_events_type ON ticket_events(event_type);

-- Indexes for agents
CREATE INDEX idx_agents_brand_id ON agents(brand_id);

-- Enable RLS on all new tables
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE canned_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE sla_rules ENABLE ROW LEVEL SECURITY;

-- Permissive policies for service role
CREATE POLICY "Service role full access" ON tickets FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON ticket_messages FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON ticket_events FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON agents FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON canned_responses FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON sla_rules FOR ALL USING (true) WITH CHECK (true);

-- Seed SLA rules
INSERT INTO sla_rules (brand_id, priority, first_response_minutes, resolution_target_minutes, business_hours_only) VALUES
  ('883e4a28-9f2e-4850-a527-29f297d8b6f8', 'urgent', 120, 240, false),
  ('883e4a28-9f2e-4850-a527-29f297d8b6f8', 'high', 240, 720, true),
  ('883e4a28-9f2e-4850-a527-29f297d8b6f8', 'medium', 480, 1440, true),
  ('883e4a28-9f2e-4850-a527-29f297d8b6f8', 'low', 1440, 2880, true);

-- Seed default canned responses
INSERT INTO canned_responses (brand_id, name, category, content, variables) VALUES
  ('883e4a28-9f2e-4850-a527-29f297d8b6f8', 'Greeting', 'opening', 'Hi {customer_name}, thanks for reaching out! I''d be happy to help.', '{customer_name}'),
  ('883e4a28-9f2e-4850-a527-29f297d8b6f8', 'Request Photos', 'returns', 'Could you send a few photos of the item showing the issue? This will help us process your request faster.', '{}'),
  ('883e4a28-9f2e-4850-a527-29f297d8b6f8', 'Refund Confirmation', 'returns', 'Great news — I''ve issued a refund of {amount} to your original payment method. Please allow 5-10 business days for it to appear on your statement.', '{amount}'),
  ('883e4a28-9f2e-4850-a527-29f297d8b6f8', 'Shipping Update', 'shipping', 'Your order #{order_number} is on its way! You can track it here: {tracking_url}. Standard delivery takes 5-7 business days.', '{order_number,tracking_url}'),
  ('883e4a28-9f2e-4850-a527-29f297d8b6f8', 'Discount Offer', 'recovery', 'I''m sorry for the inconvenience. As a gesture of goodwill, here''s a {discount_percent}% discount code for your next order: {discount_code}. It''s valid for 30 days.', '{discount_percent,discount_code}'),
  ('883e4a28-9f2e-4850-a527-29f297d8b6f8', 'Closing', 'closing', 'Is there anything else I can help you with? If not, I''ll go ahead and close this ticket. Thanks for being a valued customer!', '{}');
;
