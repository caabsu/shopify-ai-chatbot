export interface Brand {
  id: string;
  name: string;
  slug: string;
  shopify_shop: string;
  password_hash: string;
  settings: Record<string, unknown>;
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
  brand_id: string;
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
  brand_id: string;
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
  brand_id: string;
  key: string;
  value: string;
  updated_at: string;
}

export interface FeatureToggle {
  id: string;
  brand_id: string;
  feature_key: string;
  enabled: boolean;
  metadata: Record<string, unknown>;
  updated_at: string;
}

export interface ReturnRequest {
  id: string;
  brand_id: string;
  order_id: string;
  line_item_ids: string[];
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'completed';
  conversation_id: string | null;
  created_at: string;
}
