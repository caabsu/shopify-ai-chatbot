export interface Brand {
  id: string;
  name: string;
  slug: string;
  shopify_shop: string;
  password_hash: string | null;
  settings: Record<string, unknown> | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface Conversation {
  id: string;
  brand_id: string;
  shopify_customer_id: string | null;
  customer_email: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  status: 'active' | 'closed' | 'escalated';
  page_url: string | null;
  started_at: string;
  ended_at: string | null;
  last_message_at: string | null;
  message_count: number;
  satisfaction_score: number | null;
  resolved: boolean;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system' | 'human_agent';
  content: string;
  model: string | null;
  tokens_input: number | null;
  tokens_output: number | null;
  latency_ms: number | null;
  tools_used: string[] | null;
  created_at: string;
}

export interface KnowledgeDocument {
  id: string;
  title: string;
  content: string;
  category: string;
  enabled: boolean;
  priority: number;
  created_at: string;
  updated_at: string;
}

export interface AiConfig {
  id: string;
  key: string;
  value: string;
  updated_at: string;
}

export interface ReturnRequest {
  id: string;
  order_id: string;
  line_item_ids: string[];
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'completed';
  conversation_id: string | null;
  created_at: string;
}

export interface PresetAction {
  id: string;
  label: string;
  icon: string;
  prompt: string;
}

export interface NavigationButton {
  url: string;
  label: string;
}

export interface ProductCard {
  id: string;
  title: string;
  description: string;
  price: string;
  currency: string;
  imageUrl: string;
  productUrl: string;
  available: boolean;
}

export interface CartData {
  cartId: string;
  checkoutUrl: string;
  totalAmount: string;
  currency: string;
  lineItems: Array<{
    id: string;
    title: string;
    quantity: number;
    price: string;
  }>;
}

export interface AiResponse {
  response: string;
  navigationButtons: NavigationButton[];
  productCards: ProductCard[];
  cartData: CartData | null;
  toolsUsed: string[];
  conversationStatus: string;
  metadata: {
    model: string;
    tokensInput: number;
    tokensOutput: number;
    latencyMs: number;
  };
}

// Ticket System Types
export interface Ticket {
  id: string;
  brand_id: string;
  ticket_number: number;
  source: 'email' | 'form' | 'ai_escalation';
  status: 'open' | 'pending' | 'resolved' | 'closed';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  category: string | null;
  subject: string;
  customer_email: string;
  customer_name: string | null;
  customer_phone: string | null;
  shopify_customer_id: string | null;
  assigned_to: string | null;
  tags: string[];
  conversation_id: string | null;
  order_id: string | null;
  metadata: Record<string, unknown> | null;
  first_response_at: string | null;
  resolved_at: string | null;
  closed_at: string | null;
  sla_deadline: string | null;
  sla_breached: boolean;
  created_at: string;
  updated_at: string;
}

export interface TicketMessage {
  id: string;
  ticket_id: string;
  sender_type: 'customer' | 'agent' | 'system' | 'ai_draft';
  sender_name: string | null;
  sender_email: string | null;
  content: string;
  content_html: string | null;
  is_internal_note: boolean;
  attachments: unknown[];
  email_message_id: string | null;
  ai_generated: boolean;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface TicketEvent {
  id: string;
  ticket_id: string;
  event_type: string;
  actor: 'system' | 'agent' | 'customer' | 'ai';
  actor_id: string | null;
  old_value: string | null;
  new_value: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface Agent {
  id: string;
  brand_id: string;
  name: string;
  email: string;
  password_hash: string;
  role: 'admin' | 'agent';
  is_active: boolean;
  avatar_url: string | null;
  notification_preferences: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface CannedResponse {
  id: string;
  brand_id: string;
  name: string;
  category: string;
  content: string;
  variables: string[];
  usage_count: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface SlaRule {
  id: string;
  brand_id: string;
  priority: string;
  first_response_minutes: number;
  resolution_target_minutes: number;
  business_hours_only: boolean;
  created_at: string;
  updated_at: string;
}
