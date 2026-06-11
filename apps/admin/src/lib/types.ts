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
  ticket_id: string | null;
  order_id: string;
  order_number: string;
  customer_email: string;
  customer_name: string | null;
  status: string;
  shopify_return_id: string | null;
  ai_recommendation: { decision: string; confidence: number; reasoning: string; suggested_resolution?: string } | null;
  resolution_type: string | null;
  refund_amount: number | null;
  admin_notes: string | null;
  denial_reason: string | null;
  approved_no_return: boolean;
  decided_by: string | null;
  decided_at: string | null;
  return_label_url: string | null;
  return_tracking_number: string | null;
  return_carrier: string | null;
  return_shipping_cost: number | null;
  package_dimensions: { length: number; width: number; height: number; weight: number } | null;
  estimated_shipping_cost: number | null;
  estimated_return_warehouse: string | null;
  shipping_rates: Array<{ carrier: string; service: string; amount: number; warehouse: string; estimatedDays: number | null }> | null;
  created_at: string;
  updated_at: string;
  metadata: Record<string, unknown> | null;
  items?: ReturnItem[];
}

export interface ReturnItem {
  id: string;
  return_request_id: string;
  line_item_id: string;
  fulfillment_line_item_id: string;
  product_title: string;
  variant_title: string | null;
  product_image_url: string | null;
  quantity: number;
  price: number;
  original_unit_price?: number | null;
  original_total?: number | null;
  discounted_total?: number | null;
  reason: string;
  reason_details: string | null;
  photo_urls: string[] | null;
  item_status: string;
  denial_reason: string | null;
  created_at: string;
}

export interface ReturnRule {
  id: string;
  brand_id: string;
  name: string;
  enabled: boolean;
  priority: number;
  conditions: Record<string, unknown>;
  action: string;
  resolution_type: string | null;
  created_at: string;
  updated_at: string;
}

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
  classification: string | null;
  classification_confidence: number | null;
  sla_breached: boolean;
  created_at: string;
  updated_at: string;
}

/** AI triage result stored at tickets.metadata.ai_triage (written by the backend on intake). */
export interface TicketTriage {
  intent?: string;
  sentiment?: 'angry' | 'frustrated' | 'neutral' | 'positive';
  language?: string;
  summary?: string;
  suggested_priority?: string;
  suggested_tags?: string[];
  triaged_at?: string;
}

/** CSAT rating stored at tickets.metadata.csat (written by the backend rating endpoint). */
export interface TicketCsat {
  score: number;
  comment?: string;
  at?: string;
}

export function ticketTriage(t: Ticket): TicketTriage | null {
  const v = t.metadata?.ai_triage;
  return v && typeof v === 'object' ? (v as TicketTriage) : null;
}

export function ticketCsat(t: Ticket): TicketCsat | null {
  const v = t.metadata?.csat;
  return v && typeof v === 'object' && typeof (v as TicketCsat).score === 'number' ? (v as TicketCsat) : null;
}

export function ticketSnoozedUntil(t: Ticket): string | null {
  const v = t.metadata?.snoozed_until;
  if (typeof v !== 'string' || !v) return null;
  return new Date(v).getTime() > Date.now() ? v : null;
}

// ── Autopilot (AI action-recommendation inbox) ──────────────────────────────
// Plans are written by the backend planner (apps/backend autopilot.service)
// onto tickets.metadata.autopilot; approval + execution happen in the admin.

export type AutopilotActionType =
  | 'close_not_support'
  | 'send_reply'
  | 'resolve'
  | 'set_priority'
  | 'add_tags'
  | 'cancel_order'
  | 'refund_order'
  | 'update_shipping_address'
  | 'escalate_human';

export interface AutopilotAction {
  id: string;
  type: AutopilotActionType;
  title: string;
  detail: string;
  params: Record<string, unknown>;
  confidence: number;
  status: 'proposed' | 'approved' | 'skipped' | 'executed' | 'failed';
  result?: string | null;
}

export interface AutopilotPlan {
  version: 1;
  status: 'proposed' | 'approved' | 'executing' | 'executed' | 'partially_executed' | 'failed' | 'dismissed';
  trigger: 'new_ticket' | 'customer_reply' | 'sweep';
  proposed_at: string;
  decided_at?: string;
  decided_by?: string;
  executed_at?: string;
  analysis: { summary: string; reasoning: string; overall_confidence: number };
  actions: AutopilotAction[];
}

export function ticketAutopilot(t: Ticket): AutopilotPlan | null {
  const v = t.metadata?.autopilot;
  return v && typeof v === 'object' && Array.isArray((v as AutopilotPlan).actions) ? (v as AutopilotPlan) : null;
}

export interface AgentRosterEntry {
  id: string;
  name: string;
  role: 'admin' | 'agent';
  agent_id?: string | null;
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

export interface AgentUser {
  id: string;
  brand_id: string;
  name: string;
  email: string;
  agent_id?: string;
  role: 'admin' | 'agent';
  is_active: boolean;
  avatar_url: string | null;
  created_at: string;
}

export interface CannedResponse {
  id: string;
  name: string;
  category: string;
  content: string;
  variables: string[];
  usage_count: number;
  created_at: string;
}

export interface SlaRule {
  id: string;
  priority: string;
  first_response_minutes: number;
  resolution_target_minutes: number;
  business_hours_only: boolean;
}

export interface ReturnSettings {
  id: string;
  brand_id: string;
  return_window_days: number;
  require_photos: boolean;
  ai_confidence_threshold: number;
  available_reasons: string[];
  reason_labels: Record<string, string>;
  available_resolutions: string[];
  auto_close_days: number;
  portal_title: string;
  portal_description: string;
  created_at: string;
  updated_at: string;
}

export interface ReturnEmailTemplate {
  id: string;
  brand_id: string;
  template_type: 'confirmation' | 'approved' | 'approved_no_label' | 'approved_no_return' | 'denied' | 'refunded';
  enabled: boolean;
  subject: string;
  body_html: string;
  body_text: string;
  created_at: string;
  updated_at: string;
}

export interface ReturnPortalDesign {
  primaryColor: string;
  backgroundColor: string;
  borderRadius: string;
  fontSize: string;
  fontFamily?: string;
  headingFontFamily?: string;
  buttonTextLookup: string;
  buttonTextContinue: string;
  buttonTextSubmit: string;
  stepLabels: string[];
  successTitle: string;
  successMessage: string;
  successButtonText: string;
}
