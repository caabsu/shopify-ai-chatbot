export interface Conversation {
  id: string;
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
