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
  merged_into_ticket_id?: string | null;
  customer_email_normalized?: string | null;
  /** Monotonic concurrency token bumped by meaningful ticket/message changes. */
  context_version?: number;
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
  | 'consolidate_related_tickets'
  | 'escalate_human';

export interface AutopilotRelatedTicketSnapshot {
  ticket_id: string;
  ticket_number: number;
  subject: string;
  status: 'open' | 'pending';
  context_version: number;
  response_state: 'unanswered' | 'awaiting_us' | 'awaiting_customer' | 'no_customer_message';
  relation_reason: string;
  relation_confidence: number;
}

export interface AutopilotAction {
  id: string;
  type: AutopilotActionType;
  title: string;
  detail: string;
  params: Record<string, unknown>;
  model_confidence?: number;
  confidence: number;
  confidence_basis?: {
    method: 'bayesian_local_v1';
    sample_count: number;
    effective_sample_weight: number;
    delta: number;
  };
  depends_on?: string[];
  status: 'proposed' | 'approved' | 'skipped' | 'executed' | 'failed';
  result?: string | null;
}

export interface AutopilotGenerationProvenance {
  /** Actual inference provider when reported (for example, deepinfra). */
  provider: string;
  /** Access layer used for the generation (for example, vercel-ai-gateway). */
  access_provider?: string;
  /** Exact provider model identifier; aliases are not sufficient for calibration. */
  model: string;
  requested_model?: string;
  tier: 'flash' | 'pro';
  thinking: 'disabled' | 'high';
  /** Exact provider + model + prompt lineage used to select calibration samples. */
  calibration_key: string;
  route_reasons?: string[];
  router_version?: string;
  request_id?: string;
  response_id?: string;
  attempts?: Array<{
    provider: string;
    model: string;
    tier: 'flash' | 'pro';
    success: boolean;
    latency_ms?: number;
    error?: string;
    cost_usd?: number;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      reasoning_tokens?: number;
      cached_input_tokens?: number;
    };
  }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    reasoning_tokens?: number;
    cached_input_tokens?: number;
  };
  latency_ms?: number;
  cost_usd?: number;
  total_cost_usd?: number;
  legacy_fallback?: boolean;
}

export interface AutopilotPlan {
  version: 1 | 2;
  id?: string;
  revision?: number;
  parent_plan_id?: string;
  planner_version?: string;
  prompt_version?: string;
  generation?: AutopilotGenerationProvenance;
  context_fingerprint?: string;
  context_version?: number;
  status: 'proposed' | 'approved' | 'executing' | 'executed' | 'partially_executed' | 'failed' | 'dismissed';
  trigger: 'new_ticket' | 'customer_reply' | 'sweep' | 'revision' | 'stale_check';
  proposed_at: string;
  decided_at?: string;
  decided_by?: string;
  executed_at?: string;
  execution_attempt_id?: string;
  execution_interrupted?: boolean;
  execution_interruption_reason?: string;
  evidence?: {
    shopify_orders?: {
      hash: string;
      fetched_at: string;
      valid_until: string;
      order_count: number;
      /** Canonical customer-plus-orders prompt projection used for the hash. */
      projection_version?: string;
      customer_present?: boolean;
      /** Customer-provided address used when the order lives under an alternate checkout email. */
      customer_lookup_email?: string;
      /** Per-order projections let a resumed run ignore only orders it mutated. */
      order_hashes?: Record<string, string>;
      /** Source brand slug for exact orders read from a legacy sibling store. */
      order_brand_slugs?: Record<string, string>;
    };
    customer_history?: {
      hash: string;
      fetched_at: string;
      valid_until: string;
      ticket_count: number;
      ticket_message_count: number;
      conversation_count: number;
      chat_message_count: number;
      projection_version: 'customer-support-context-v1';
    };
  };
  execution_receipts?: Array<{
    id: string;
    action_id: string;
    action_type: string;
    status: 'reserved' | 'executed' | 'failed' | 'uncertain';
    result?: string | null;
    error?: string | null;
    provider_reference?: string | null;
    started_at?: string;
    lease_expires_at?: string | null;
    heartbeat_at?: string | null;
    provider_deadline_at?: string | null;
    failure_reconcile_after?: string | null;
    expected_context_after?: number;
    context_after?: number | null;
  }>;
  /** Operator feedback that produced this plan (revision flow). */
  operator_instruction?: string;
  revision_count?: number;
  analysis: {
    summary: string;
    reasoning: string;
    model_confidence?: number;
    overall_confidence: number;
    quality_assessment?: {
      version: 'support-quality-v1';
      passed: boolean;
      confidence: number;
      checks: Array<{ name: string; passed: boolean; detail: string }>;
      summary: string;
      model?: string;
      checked_at: string;
      cost_usd?: number;
    };
    /** Validator fallback card: must be revised before any execution. */
    review_only?: boolean;
    auto_run_allowed?: boolean;
    /** Direct review provenance, separate from model generation/calibration. */
    review_assessment?: {
      source: string;
      assessed_at: string;
      basis: string;
      previous_plan_id: string;
      previous_confidence?: number;
    };
    review_reason?: string;
    validation_error?: string;
    confidence_basis?: {
      method: 'bayesian_local_v1';
      sample_count: number;
      effective_sample_weight: number;
      delta: number;
    };
  };
  learning?: {
    policy_version: 'scoped-memory-v1';
    applied_at: string;
    memory_ids: string[];
    episode_ids: string[];
    memory_attributions: Array<{ id: string; score: number; confidence?: number; trust: number }>;
    memory_count: number;
    reviewed_run_count: number;
    calibration_samples: number;
  };
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
