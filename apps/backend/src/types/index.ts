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
  brand_id: string;
  ticket_id: string | null;
  order_id: string;
  order_number: string;
  customer_email: string;
  customer_name: string | null;
  customer_phone: string | null;
  status: 'pending_review' | 'approved' | 'partially_approved' | 'denied' | 'shipped' | 'received' | 'refunded' | 'closed' | 'cancelled';
  shopify_return_id: string | null;
  ai_recommendation: { decision: string; confidence: number; reasoning: string; suggested_resolution?: string } | null;
  resolution_type: 'refund' | 'exchange' | 'store_credit' | null;
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
  reason: 'defective' | 'wrong_item' | 'changed_mind' | 'doesnt_fit' | 'not_as_described' | 'other';
  reason_details: string | null;
  photo_urls: string[] | null;
  item_status: 'pending' | 'approved' | 'denied';
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
  action: 'auto_approve' | 'auto_deny' | 'flag_review' | 'ai_review';
  resolution_type: 'refund' | 'exchange' | 'store_credit' | null;
  created_at: string;
  updated_at: string;
}

export interface PresetAction {
  id: string;
  label: string;
  icon: string;
  prompt: string;
  description?: string;
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
  classification: string | null;
  classification_confidence: number | null;
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

export interface ReturnSettings {
  id: string;
  brand_id: string;
  return_window_days: number;
  require_photos: boolean;
  require_photos_for_reasons: string[];
  ai_confidence_threshold: number;
  available_reasons: string[];
  reason_labels: Record<string, string>;
  available_resolutions: string[];
  auto_close_days: number;
  portal_title: string;
  portal_description: string;
  restocking_fee_percent: number;
  restocking_fee_exempt_reasons: string[];
  collect_dimensions_for_reasons: string[];
  provide_prepaid_label_for_reasons: string[];
  dimension_collection_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface ReturnEmailTemplate {
  id: string;
  brand_id: string;
  template_type: 'confirmation' | 'approved' | 'approved_no_return' | 'denied' | 'refunded';
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

// Trade Program Types

export interface TradeApplication {
  id: string;
  brand_id: string;
  status: 'pending' | 'approved' | 'rejected' | 'archived';
  full_name: string;
  email: string;
  phone: string;
  company_name: string;
  business_type: 'interior_designer' | 'architect' | 'contractor' | 'hospitality' | 'developer' | 'other';
  website_url: string;
  project_description: string | null;
  referral_source: string | null;
  shopify_customer_id: string | null;
  shopify_company_id: string | null;
  auto_approved: boolean;
  reviewed_by: string | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface TradeMember {
  id: string;
  brand_id: string;
  application_id: string;
  status: 'active' | 'suspended' | 'revoked';
  shopify_customer_id: string;
  shopify_company_id: string;
  company_name: string;
  contact_name: string;
  email: string;
  phone: string;
  business_type: string;
  website_url: string;
  payment_terms: 'DUE_ON_FULFILLMENT' | 'NET_30' | 'NET_60';
  discount_code: string | null;
  total_orders: number;
  total_spent: number;
  notes: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface TradeSettings {
  id: string;
  brand_id: string;
  auto_approve_enabled: boolean;
  auto_approve_rules: {
    rules: Array<{
      id: string;
      field: string;
      condition: string;
      value?: string;
      enabled: boolean;
    }>;
    logic: 'all' | 'any';
  };
  default_discount_percent: number;
  default_payment_terms: string;
  welcome_email_template: string | null;
  rejection_email_template: string | null;
  discount_code: string;
  concierge_email: string | null;
  ticket_priority_level: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface TradeActivityLog {
  id: string;
  brand_id: string;
  member_id: string | null;
  application_id: string | null;
  event_type: string;
  actor: 'system' | 'agent' | 'customer';
  actor_id: string | null;
  details: Record<string, unknown>;
  created_at: string;
}

// ── Reviews ──────────────────────────────────────

export interface Product {
  id: string;
  shopify_product_id: string;
  title: string;
  handle: string;
  product_type: string | null;
  vendor: string | null;
  status: string;
  featured_image_url: string | null;
  variants: ProductVariant[];
  tags: string[];
  synced_at: string;
  brand_id: string;
  created_at: string;
  updated_at: string;
  review_count?: number;
  average_rating?: number;
}

export interface ProductVariant {
  id: string;
  title: string;
  price: string;
  sku: string | null;
}

export interface Review {
  id: string;
  product_id: string;
  shopify_product_id: string | null;
  shopify_order_id: string | null;
  customer_email: string;
  customer_name: string;
  customer_nickname: string | null;
  rating: number;
  title: string | null;
  body: string;
  status: 'pending' | 'published' | 'rejected' | 'archived';
  verified_purchase: boolean;
  incentivized: boolean;
  variant_title: string | null;
  source: 'import' | 'email_request' | 'organic' | 'manual';
  import_source_id: string | null;
  featured: boolean;
  helpful_count: number;
  report_count: number;
  published_at: string | null;
  submitted_at: string;
  brand_id: string;
  created_at: string;
  updated_at: string;
  media?: ReviewMedia[];
  reply?: ReviewReply | null;
  product?: Product;
}

export interface ReviewMedia {
  id: string;
  review_id: string;
  storage_path: string;
  url: string;
  media_type: 'image' | 'video';
  sort_order: number;
  file_size: number | null;
  width: number | null;
  height: number | null;
  created_at: string;
}

export interface ReviewReply {
  id: string;
  review_id: string;
  author_name: string;
  author_email: string | null;
  body: string;
  published: boolean;
  created_at: string;
  updated_at: string;
}

export interface ReviewRequest {
  id: string;
  shopify_order_id: string;
  shopify_customer_id: string | null;
  customer_email: string;
  customer_name: string | null;
  product_ids: string[];
  status: 'scheduled' | 'sent' | 'reminded' | 'completed' | 'cancelled' | 'bounced' | 'expired';
  scheduled_for: string;
  sent_at: string | null;
  reminder_scheduled_for: string | null;
  reminder_sent_at: string | null;
  completed_at: string | null;
  token: string;
  brand_id: string;
  created_at: string;
}

export interface ReviewSettings {
  id: string;
  brand_id: string;
  auto_publish: boolean;
  auto_publish_min_rating: number;
  auto_publish_verified_only: boolean;
  profanity_filter: boolean;
  request_enabled: boolean;
  request_delay_days: number;
  reminder_enabled: boolean;
  reminder_delay_days: number;
  incentive_enabled: boolean;
  incentive_type: string | null;
  incentive_value: string | null;
  sender_name: string | null;
  sender_email: string | null;
  review_form_fields: Record<string, unknown>;
  widget_design: ReviewWidgetDesign;
  reviews_per_page: number;
  default_sort: string;
  show_verified_badge: boolean;
  show_incentivized_disclosure: boolean;
  incentivized_disclosure_text: string;
  created_at: string;
  updated_at: string;
}

export interface ReviewWidgetDesign {
  starColor: string;
  starStyle: 'filled' | 'outlined';
  backgroundColor: string;
  textColor: string;
  headingColor: string;
  headingFontFamily: string;
  bodyFontFamily: string;
  fontSize: 'small' | 'medium' | 'large';
  borderRadius: 'sharp' | 'rounded' | 'pill';
  cardStyle: 'bordered' | 'shadow' | 'minimal';
  buttonStyle: 'outlined' | 'filled' | 'minimal';
  buttonText: string;
  headerText: string;
  reviewsPerPage: number;
  defaultSort: 'newest' | 'oldest' | 'highest' | 'lowest' | 'most_helpful';
  showVerifiedBadge: boolean;
  showVariant: boolean;
  showDate: boolean;
  showPhotos: boolean;
  layout: 'grid' | 'list';
}

export interface ReviewEmailTemplate {
  id: string;
  brand_id: string;
  template_type: 'request' | 'reminder' | 'thank_you';
  subject: string;
  body_html: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface ReviewSummary {
  average_rating: number;
  total_count: number;
  verified_count: number;
  distribution: { stars: number; count: number }[];
}

export interface ReviewImportResult {
  imported: number;
  skipped: number;
  failed: number;
  errors: string[];
}

export interface ModerationResult {
  action: 'publish' | 'pending' | 'reject';
  reasons: string[];
}

// ── Tracking ──
export interface TrackingEvent {
  status: string;
  description: string;
  location: string;
  timestamp: string;
}

export interface TrackingResult {
  trackingNumber: string;
  carrier: string;
  carrierDisplay: string;
  status: 'not_found' | 'info_received' | 'in_transit' | 'out_for_delivery' | 'delivered' | 'exception' | 'expired';
  statusMessage: string;
  statusDetail: string;
  estimatedDelivery: string | null;
  signedBy: string | null;
  deliveredAt: string | null;
  events: TrackingEvent[];
  order: TrackingOrderInfo | null;
}

export interface TrackingOrderInfo {
  orderNumber: string;
  lineItems: Array<{
    title: string;
    variant: string | null;
    quantity: number;
    price: string;
    imageUrl: string | null;
  }>;
  destination: string | null;
  transitDays: number | null;
  total: string | null;
}

export interface TrackingWidgetDesign {
  accentColor: string;
  backgroundColor: string;
  textColor: string;
  headingColor: string;
  headingFontFamily: string;
  bodyFontFamily: string;
  statusFontFamily: string;
  buttonColor: string;
  buttonTextColor: string;
  headerText: string;
  headerSubtext: string;
  buttonText: string;
  tabOrderLabel: string;
  tabTrackingLabel: string;
  timelineSectionLabel: string;
  orderDetailsSectionLabel: string;
  deliveredIcon: string;
  inTransitIcon: string;
  exceptionIcon: string;
}

export interface TrackingSettings {
  id: string;
  brand_id: string;
  widget_design: TrackingWidgetDesign;
  custom_status_messages: Record<string, string>;
  carrier_display_names: Record<string, string>;
  cache_ttl_minutes: number;
  seventeen_track_api_key: string | null;
  created_at: string;
  updated_at: string;
}
