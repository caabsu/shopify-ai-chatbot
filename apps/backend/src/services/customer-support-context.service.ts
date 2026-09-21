import { createHash } from 'node:crypto';
import { supabase } from '../config/supabase.js';

export const CUSTOMER_HISTORY_PROJECTION = 'customer-support-context-v1';

export type SupportResponseState =
  | 'unanswered'
  | 'awaiting_us'
  | 'awaiting_customer'
  | 'resolved'
  | 'closed'
  | 'no_customer_message';

export interface CustomerTicketMessage {
  id: string;
  ticket_id: string;
  sender_type: 'customer' | 'agent';
  sender_name: string | null;
  content: string;
  created_at: string;
  email_message_id: string | null;
  metadata: Record<string, unknown> | null;
}

export interface CustomerTicketThread {
  id: string;
  ticket_number: number;
  subject: string;
  status: string;
  source: string;
  order_id: string | null;
  conversation_id: string | null;
  context_version: number;
  created_at: string;
  updated_at: string;
  first_response_at: string | null;
  merged_into_ticket_id?: string | null;
  metadata: Record<string, unknown> | null;
  messages: CustomerTicketMessage[];
  response_state: SupportResponseState;
  relatedness?: TicketRelatedness;
}

export interface CustomerChatMessage {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'human_agent';
  content: string;
  created_at: string;
}

export interface CustomerChatThread {
  id: string;
  status: string;
  resolved: boolean;
  started_at: string;
  ended_at: string | null;
  last_message_at: string | null;
  metadata: Record<string, unknown> | null;
  messages: CustomerChatMessage[];
  response_state: SupportResponseState;
}

export interface TicketRelatedness {
  score: number;
  basis: string[];
  deterministic: boolean;
}

export interface CustomerSupportContextBundle {
  projection_version: typeof CUSTOMER_HISTORY_PROJECTION;
  brand_id: string;
  normalized_email: string;
  current_ticket_id: string;
  loaded_at: string;
  tickets: CustomerTicketThread[];
  conversations: CustomerChatThread[];
  coverage: {
    ticket_count: number;
    conversation_count: number;
    ticket_message_count: number;
    conversation_message_count: number;
    complete: boolean;
    source: 'rpc' | 'direct';
  };
  hash: string;
}

export interface FormattedCustomerSupportContext {
  text: string;
  max_chars: number;
  rendered_chars: number;
  rendered_message_count: number;
  omitted_message_count: number;
  overflow: boolean;
}

type TicketRow = Omit<CustomerTicketThread, 'messages' | 'response_state' | 'relatedness'>;
type ConversationRow = Omit<CustomerChatThread, 'messages' | 'response_state'>;

export function normalizeCustomerEmail(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function messageTime(value: string): number {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

export function isDeliveredAgentMessage(message: Pick<CustomerTicketMessage, 'sender_type' | 'metadata'>): boolean {
  if (message.sender_type !== 'agent') return false;
  const status = typeof message.metadata?.email_status === 'string'
    ? message.metadata.email_status.toLowerCase()
    : null;
  // Null is a legacy row written before delivery-state tracking. New rows must
  // positively reach a delivered state; `sending`/unknown are not a response.
  return status === null || status === 'sent' || status === 'delivered';
}

export function deriveTicketResponseState(
  status: string,
  messages: Array<Pick<CustomerTicketMessage, 'sender_type' | 'created_at' | 'metadata'>>,
): SupportResponseState {
  if (status === 'resolved') return 'resolved';
  if (status === 'closed') return 'closed';
  const customers = messages.filter((message) => message.sender_type === 'customer');
  if (customers.length === 0) return 'no_customer_message';
  const agents = messages.filter(isDeliveredAgentMessage);
  if (agents.length === 0) return 'unanswered';
  const lastCustomer = Math.max(...customers.map((message) => messageTime(message.created_at)));
  const lastAgent = Math.max(...agents.map((message) => messageTime(message.created_at)));
  return lastCustomer > lastAgent ? 'awaiting_us' : 'awaiting_customer';
}

export function deriveChatResponseState(
  status: string,
  resolved: boolean,
  messages: Array<Pick<CustomerChatMessage, 'role' | 'created_at'>>,
): SupportResponseState {
  if (resolved) return 'resolved';
  if (status === 'closed') return 'closed';
  const customers = messages.filter((message) => message.role === 'user');
  if (customers.length === 0) return 'no_customer_message';
  const responders = messages.filter((message) => message.role === 'assistant' || message.role === 'human_agent');
  if (responders.length === 0) return 'unanswered';
  const lastCustomer = Math.max(...customers.map((message) => messageTime(message.created_at)));
  const lastResponse = Math.max(...responders.map((message) => messageTime(message.created_at)));
  return lastCustomer > lastResponse ? 'awaiting_us' : 'awaiting_customer';
}

/**
 * Returns only the customer's newly-authored text, excluding the quoted email
 * chain that most providers append below a reply.
 */
export function newestUnquotedCustomerText(content: string): string {
  const normalized = content.replace(/\r\n/g, '\n');
  const quoteStart = [
    /^\s*On .{0,240}\bwrote:\s*$/im,
    /^\s*-{2,}\s*Original Message\s*-{2,}\s*$/im,
    /^\s*-{2,}\s*Forwarded message\s*-{2,}\s*$/im,
    /^\s*From:\s+.+$/im,
    /^\s*>/m,
  ]
    .map((pattern) => pattern.exec(normalized)?.index)
    .filter((index): index is number => Number.isInteger(index));
  const authored = quoteStart.length > 0
    ? normalized.slice(0, Math.min(...quoteStart))
    : normalized;
  return authored
    .replace(/^\s*--\s*$[\s\S]*$/m, '')
    .trim();
}

/**
 * A short thank-you/acknowledgement after our delivered reply is a terminal
 * customer turn, not a new support request. This intentionally requires a
 * positive acknowledgement and rejects questions, requests, or unresolved
 * operational language.
 */
export function isCustomerAcknowledgementOnly(content: string): boolean {
  const authored = newestUnquotedCustomerText(content);
  if (!authored || authored.length > 1_000) return false;
  // Some mail clients send a final signature-only line as a separate reply.
  // After our delivered answer this is terminal acknowledgement, not a new
  // request that should reopen the mutation or trigger another email.
  const signatureOnly = /^[a-z][a-z'.-]{0,30}(?:\s+[a-z][a-z'.-]{0,30}){1,5}$/i.test(authored)
    && !/\b(?:order|refund|cancel|status|tracking|help|update|question|issue)\b/i.test(authored);
  if (signatureOnly) return true;
  const hasAcknowledgement = [
    /\bthank(?:s| you)\b/i,
    /\bappreciat(?:e|ed|ing)\b/i,
    /\b(?:got it|understood|sounds good|that works|perfect|great)\b/i,
  ].some((pattern) => pattern.test(authored));
  if (!hasAcknowledgement) return false;
  const hasNewAsk = [
    /\?/,
    /\b(?:please|can you|could you|would you|will you|need you|want you|let me know)\b/i,
    /\b(?:refund|cancel|exchange|replace|return|address|tracking|status|eta|when|where|missing|damaged|broken)\b/i,
    /\b(?:but|however|still|again|not yet|haven't|hasn't|have not|has not)\b/i,
  ].some((pattern) => pattern.test(authored));
  return !hasNewAsk;
}

function triageIntent(ticket: Pick<CustomerTicketThread, 'subject' | 'metadata' | 'messages'>): string | null {
  // Triage metadata is optional and older email tickets often have none. Use
  // a deliberately small deterministic vocabulary so same-customer follow-ups
  // about the same order are still recognized and answered only once.
  const text = `${ticket.subject}\n${ticket.messages
    .filter((message) => message.sender_type === 'customer')
    .slice(-3)
    .map((message) => message.content)
    .join('\n')}`;
  if (/\b(?:cancel|cancellation|refund)\b/i.test(text)) return 'cancel_or_refund';
  if (/\b(?:wrong|change|update|new)\b[^.!?\n]{0,45}\baddress\b|\baddress\b[^.!?\n]{0,45}\b(?:wrong|change|update|new)\b/i.test(text)) return 'address_change';
  if (
    /\b(?:order\s+(?:status|update)|shipping|shipped|tracking|delivery|where\s+is\s+my\s+order)\b/i.test(text)
    || /\b(?:any|get|give|provide|need|want)\b[^.!?\n]{0,35}\bupdate\b/i.test(text)
  ) return 'order_status';
  const triage = ticket.metadata?.ai_triage;
  if (triage && typeof triage === 'object') {
    const intent = (triage as Record<string, unknown>).intent;
    if (typeof intent === 'string' && intent.trim()) return intent.trim().toLowerCase();
  }
  return null;
}

function orderReferences(ticket: Pick<CustomerTicketThread, 'order_id' | 'subject' | 'messages'>): Set<string> {
  const values = new Set<string>();
  if (ticket.order_id) values.add(ticket.order_id.trim().toLowerCase());
  const text = `${ticket.subject}\n${ticket.messages.filter((message) => message.sender_type === 'customer').map((message) => message.content).join('\n')}`;
  for (const match of text.matchAll(/(?:order\s*)?#\s*([a-z0-9-]{3,})/gi)) values.add(match[1].toLowerCase());
  return values;
}

function normalizedSubject(value: string): string {
  return value
    .toLowerCase()
    .replace(/^(?:(?:re|fw|fwd):\s*)+/g, '')
    .replace(/\[ticket\s*#\d+\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const TOPIC_SIGNAL_ALIASES: Record<string, string> = {
  tracked: 'tracking',
  tracker: 'tracking',
  track: 'tracking',
  delayed: 'delay',
  late: 'delay',
  cancelled: 'cancel',
  cancellation: 'cancel',
  canceling: 'cancel',
  cancelling: 'cancel',
  refunded: 'refund',
  refunds: 'refund',
  returned: 'return',
  returns: 'return',
  damaged: 'damage',
  broken: 'damage',
  delivered: 'delivery',
  shipping: 'delivery',
  shipped: 'delivery',
  address: 'address',
  discount: 'discount',
  wholesale: 'wholesale',
  trade: 'wholesale',
};
const TOPIC_SIGNALS = new Set([
  'tracking',
  'delay',
  'cancel',
  'refund',
  'return',
  'damage',
  'delivery',
  'address',
  'discount',
  'wholesale',
]);

function topicSignals(
  ticket: Pick<CustomerTicketThread, 'subject' | 'metadata' | 'messages'>,
): Set<string> {
  const triage = ticket.metadata?.ai_triage;
  const triageRecord = triage && typeof triage === 'object'
    ? triage as Record<string, unknown>
    : {};
  const suggestedTags = Array.isArray(triageRecord.suggested_tags)
    ? triageRecord.suggested_tags.filter((value): value is string => typeof value === 'string')
    : [];
  const customerText = ticket.messages
    .filter((message) => message.sender_type === 'customer')
    .slice(-3)
    .map((message) => message.content)
    .join(' ')
    .slice(-5_000);
  const text = [
    ticket.subject,
    typeof triageRecord.summary === 'string' ? triageRecord.summary : '',
    suggestedTags.join(' '),
    customerText,
  ].join(' ').toLowerCase();
  const result = new Set<string>();
  for (const token of text.match(/[a-z]+/g) ?? []) {
    const signal = TOPIC_SIGNAL_ALIASES[token] ?? token;
    if (TOPIC_SIGNALS.has(signal)) result.add(signal);
  }
  return result;
}

/** Same customer is a prerequisite supplied by the caller, never proof of relatedness. */
export function assessTicketRelatedness(
  current: Pick<CustomerTicketThread, 'id' | 'subject' | 'order_id' | 'conversation_id' | 'created_at' | 'metadata' | 'messages'>,
  candidate: Pick<CustomerTicketThread, 'id' | 'subject' | 'order_id' | 'conversation_id' | 'created_at' | 'metadata' | 'messages'>,
): TicketRelatedness {
  if (current.id === candidate.id) return { score: 1, basis: ['current_ticket'], deterministic: true };
  if (current.conversation_id && current.conversation_id === candidate.conversation_id) {
    return { score: 1, basis: ['same_chat_escalation'], deterministic: true };
  }
  const basis: string[] = [];
  let score = 0;
  const currentOrders = orderReferences(current);
  const candidateOrders = orderReferences(candidate);
  const hasSameOrder = [...currentOrders].some((value) => candidateOrders.has(value));
  const hasConflictingOrders = currentOrders.size > 0
    && candidateOrders.size > 0
    && !hasSameOrder;
  if (hasSameOrder) {
    score += 0.72;
    basis.push('same_order_reference');
  } else if (hasConflictingOrders) {
    basis.push('different_order_reference');
  }
  const leftSubject = normalizedSubject(current.subject);
  const rightSubject = normalizedSubject(candidate.subject);
  if (leftSubject && leftSubject === rightSubject) {
    score += 0.48;
    basis.push('same_subject');
  }
  const leftIntent = triageIntent(current);
  const rightIntent = triageIntent(candidate);
  if (leftIntent && leftIntent === rightIntent) {
    score += 0.2;
    basis.push('same_intent');
  }
  const currentTopics = topicSignals(current);
  const candidateTopics = topicSignals(candidate);
  if (!hasConflictingOrders && [...currentTopics].some((value) => candidateTopics.has(value))) {
    score += 0.45;
    basis.push('same_topic_signal');
  }
  const separation = Math.abs(messageTime(current.created_at) - messageTime(candidate.created_at));
  if (separation <= 14 * 24 * 60 * 60 * 1000) {
    score += 0.08;
    basis.push('within_14_days');
  }
  return { score: Math.min(0.99, Number(score.toFixed(2))), basis, deterministic: false };
}

function canonicalHistory(bundle: Omit<CustomerSupportContextBundle, 'hash'>) {
  return {
    projection_version: bundle.projection_version,
    brand_id: bundle.brand_id,
    normalized_email: bundle.normalized_email,
    current_ticket_id: bundle.current_ticket_id,
    tickets: [...bundle.tickets]
      .map((ticket) => ({
        id: ticket.id,
        ticket_number: ticket.ticket_number,
        subject: ticket.subject,
        status: ticket.status,
        source: ticket.source,
        order_id: ticket.order_id,
        conversation_id: ticket.conversation_id,
        context_version: ticket.context_version,
        created_at: ticket.created_at,
        first_response_at: ticket.first_response_at,
        response_state: ticket.response_state,
        messages: [...ticket.messages]
          .map((message) => ({
            id: message.id,
            sender_type: message.sender_type,
            content: message.content,
            created_at: message.created_at,
            email_message_id: message.email_message_id,
            email_status: typeof message.metadata?.email_status === 'string' ? message.metadata.email_status : null,
          }))
          .sort((left, right) => left.id.localeCompare(right.id)),
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    conversations: [...bundle.conversations]
      .map((conversation) => ({
        id: conversation.id,
        status: conversation.status,
        resolved: conversation.resolved,
        started_at: conversation.started_at,
        ended_at: conversation.ended_at,
        last_message_at: conversation.last_message_at,
        response_state: conversation.response_state,
        messages: [...conversation.messages]
          .map((message) => ({ id: message.id, role: message.role, content: message.content, created_at: message.created_at }))
          .sort((left, right) => left.id.localeCompare(right.id)),
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  };
}

export function customerHistoryHash(bundle: Omit<CustomerSupportContextBundle, 'hash'>): string {
  return createHash('sha256').update(JSON.stringify(canonicalHistory(bundle))).digest('hex');
}

function asTicketRows(value: unknown): Array<TicketRow & { messages?: CustomerTicketMessage[] }> | null {
  if (!Array.isArray(value)) return null;
  return value.every((row) => row && typeof row === 'object' && typeof (row as { id?: unknown }).id === 'string')
    ? value as Array<TicketRow & { messages?: CustomerTicketMessage[] }>
    : null;
}

function asConversationRows(value: unknown): Array<ConversationRow & { messages?: CustomerChatMessage[] }> | null {
  if (!Array.isArray(value)) return null;
  return value.every((row) => row && typeof row === 'object' && typeof (row as { id?: unknown }).id === 'string')
    ? value as Array<ConversationRow & { messages?: CustomerChatMessage[] }>
    : null;
}

let rpcAvailability: 'unknown' | 'available' | 'missing' = 'unknown';

async function loadViaRpc(brandId: string, ticketId: string): Promise<{
  tickets: Array<TicketRow & { messages?: CustomerTicketMessage[] }>;
  conversations: Array<ConversationRow & { messages?: CustomerChatMessage[] }>;
  contextHash: string;
} | null> {
  if (rpcAvailability === 'missing') return null;
  const { data, error } = await supabase.rpc('get_customer_support_context', {
    p_ticket_id: ticketId,
    p_brand_id: brandId,
  });
  if (error) {
    if (error.code === 'PGRST202' || /function .*get_customer_support_context.*does not exist/i.test(error.message)) {
      rpcAvailability = 'missing';
      return null;
    }
    console.warn('[customer-support-context] RPC unavailable; using direct read:', error.message);
    return null;
  }
  const object = Array.isArray(data) && data.length === 1 ? data[0] : data;
  if (!object || typeof object !== 'object') return null;
  const record = object as Record<string, unknown>;
  const tickets = asTicketRows(record.tickets);
  const conversations = asConversationRows(record.chat_conversations);
  const contextHash = typeof record.context_hash === 'string' ? record.context_hash : null;
  if (!tickets || !conversations || tickets.some((ticket) => !Array.isArray(ticket.messages))
      || conversations.some((conversation) => !Array.isArray(conversation.messages)) || !contextHash) return null;
  for (const ticket of tickets) {
    const rpcTicket = ticket as TicketRow & { triage_intent?: unknown };
    ticket.source = ticket.source ?? 'email';
    ticket.conversation_id = ticket.conversation_id ?? null;
    ticket.order_id = ticket.order_id ?? null;
    ticket.first_response_at = ticket.first_response_at ?? null;
    const triageIntent = typeof rpcTicket.triage_intent === 'string' ? rpcTicket.triage_intent : null;
    ticket.metadata = triageIntent
      ? { ...(ticket.metadata ?? {}), ai_triage: { intent: triageIntent } }
      : ticket.metadata ?? null;
    for (const message of ticket.messages ?? []) {
      const rpcMessage = message as CustomerTicketMessage & { email_status?: unknown; delivery_confirmed?: unknown };
      message.ticket_id = ticket.id;
      const emailStatus = typeof rpcMessage.email_status === 'string'
        ? rpcMessage.email_status
        : rpcMessage.delivery_confirmed === false ? 'failed' : undefined;
      message.metadata = emailStatus ? { ...(message.metadata ?? {}), email_status: emailStatus } : message.metadata ?? null;
    }
    ticket.updated_at = ticket.updated_at
      ?? (ticket.messages ?? []).at(-1)?.created_at
      ?? ticket.created_at;
  }
  for (const conversation of conversations) {
    conversation.metadata = conversation.metadata ?? null;
    for (const message of conversation.messages ?? []) message.conversation_id = conversation.id;
  }
  rpcAvailability = 'available';
  return { tickets, conversations, contextHash };
}

const PAGE_SIZE = 500;

async function loadTicketRows(brandId: string, normalizedEmail: string): Promise<TicketRow[]> {
  const rows: TicketRow[] = [];
  const pattern = normalizedEmail.replace(/[\\%_]/g, '\\$&');
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('tickets')
      .select('id, ticket_number, subject, status, source, order_id, conversation_id, context_version, created_at, updated_at, first_response_at, merged_into_ticket_id, metadata')
      .eq('brand_id', brandId)
      .ilike('customer_email', pattern)
      .order('created_at', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(`Failed to load customer ticket history: ${error.message}`);
    rows.push(...((data ?? []) as TicketRow[]));
    if ((data?.length ?? 0) < PAGE_SIZE) return rows;
  }
}

async function loadTicketMessages(ticketIds: string[]): Promise<CustomerTicketMessage[]> {
  const output: CustomerTicketMessage[] = [];
  for (let index = 0; index < ticketIds.length; index += 80) {
    const ids = ticketIds.slice(index, index + 80);
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error } = await supabase
        .from('ticket_messages')
        .select('id, ticket_id, sender_type, sender_name, content, created_at, email_message_id, metadata')
        .in('ticket_id', ids)
        .eq('is_internal_note', false)
        .in('sender_type', ['customer', 'agent'])
        .order('created_at', { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) throw new Error(`Failed to load customer ticket messages: ${error.message}`);
      output.push(...((data ?? []) as CustomerTicketMessage[]));
      if ((data?.length ?? 0) < PAGE_SIZE) break;
    }
  }
  return output;
}

async function loadConversationRows(brandId: string, normalizedEmail: string): Promise<ConversationRow[]> {
  const rows: ConversationRow[] = [];
  const pattern = normalizedEmail.replace(/[\\%_]/g, '\\$&');
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('conversations')
      .select('id, status, resolved, started_at, ended_at, last_message_at, metadata')
      .eq('brand_id', brandId)
      .ilike('customer_email', pattern)
      .order('started_at', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(`Failed to load customer chat history: ${error.message}`);
    rows.push(...((data ?? []) as ConversationRow[]));
    if ((data?.length ?? 0) < PAGE_SIZE) return rows;
  }
}

async function loadConversationMessages(conversationIds: string[]): Promise<CustomerChatMessage[]> {
  const output: CustomerChatMessage[] = [];
  for (let index = 0; index < conversationIds.length; index += 80) {
    const ids = conversationIds.slice(index, index + 80);
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error } = await supabase
        .from('messages')
        .select('id, conversation_id, role, content, created_at')
        .in('conversation_id', ids)
        .in('role', ['user', 'assistant', 'human_agent'])
        .order('created_at', { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) throw new Error(`Failed to load customer chat messages: ${error.message}`);
      output.push(...((data ?? []) as CustomerChatMessage[]));
      if ((data?.length ?? 0) < PAGE_SIZE) break;
    }
  }
  return output;
}

function assembleBundle(input: {
  brandId: string;
  normalizedEmail: string;
  currentTicketId: string;
  source: 'rpc' | 'direct';
  tickets: Array<TicketRow & { messages?: CustomerTicketMessage[] }>;
  conversations: Array<ConversationRow & { messages?: CustomerChatMessage[] }>;
  ticketMessages?: CustomerTicketMessage[];
  conversationMessages?: CustomerChatMessage[];
  contextHash?: string;
}): CustomerSupportContextBundle {
  const ticketMessages = input.ticketMessages ?? input.tickets.flatMap((ticket) => ticket.messages ?? []);
  const chatMessages = input.conversationMessages ?? input.conversations.flatMap((conversation) => conversation.messages ?? []);
  const ticketMap = new Map<string, CustomerTicketMessage[]>();
  for (const message of ticketMessages) ticketMap.set(message.ticket_id, [...(ticketMap.get(message.ticket_id) ?? []), message]);
  const conversationMap = new Map<string, CustomerChatMessage[]>();
  for (const message of chatMessages) conversationMap.set(message.conversation_id, [...(conversationMap.get(message.conversation_id) ?? []), message]);
  const tickets: CustomerTicketThread[] = input.tickets.map((row) => {
    const messages = (ticketMap.get(row.id) ?? []).sort((left, right) => messageTime(left.created_at) - messageTime(right.created_at));
    return { ...row, messages, response_state: deriveTicketResponseState(row.status, messages) };
  });
  const current = tickets.find((ticket) => ticket.id === input.currentTicketId);
  if (current) {
    for (const ticket of tickets) ticket.relatedness = assessTicketRelatedness(current, ticket);
  }
  const conversations: CustomerChatThread[] = input.conversations.map((row) => {
    const messages = (conversationMap.get(row.id) ?? []).sort((left, right) => messageTime(left.created_at) - messageTime(right.created_at));
    return { ...row, messages, response_state: deriveChatResponseState(row.status, row.resolved, messages) };
  });
  const base: Omit<CustomerSupportContextBundle, 'hash'> = {
    projection_version: CUSTOMER_HISTORY_PROJECTION,
    brand_id: input.brandId,
    normalized_email: input.normalizedEmail,
    current_ticket_id: input.currentTicketId,
    loaded_at: new Date().toISOString(),
    tickets,
    conversations,
    coverage: {
      ticket_count: tickets.length,
      conversation_count: conversations.length,
      ticket_message_count: ticketMessages.length,
      conversation_message_count: chatMessages.length,
      complete: true,
      source: input.source,
    },
  };
  return { ...base, hash: input.contextHash ?? customerHistoryHash(base) };
}

export async function loadCustomerSupportContext(input: {
  brandId: string;
  customerEmail: string;
  currentTicketId: string;
}): Promise<CustomerSupportContextBundle> {
  const normalizedEmail = normalizeCustomerEmail(input.customerEmail);
  if (!normalizedEmail) throw new Error('Customer email is required for customer-wide support context');
  const rpc = await loadViaRpc(input.brandId, input.currentTicketId);
  if (rpc) return assembleBundle({ ...input, normalizedEmail, source: 'rpc', ...rpc });
  const [tickets, conversations] = await Promise.all([
    loadTicketRows(input.brandId, normalizedEmail),
    loadConversationRows(input.brandId, normalizedEmail),
  ]);
  const [ticketMessages, conversationMessages] = await Promise.all([
    loadTicketMessages(tickets.map((ticket) => ticket.id)),
    loadConversationMessages(conversations.map((conversation) => conversation.id)),
  ]);
  return assembleBundle({
    ...input,
    normalizedEmail,
    source: 'direct',
    tickets,
    conversations,
    ticketMessages,
    conversationMessages,
  });
}

function threadRecency(thread: CustomerTicketThread): number {
  return Math.max(messageTime(thread.updated_at), ...thread.messages.map((message) => messageTime(message.created_at)));
}

function ticketMessagePrefix(message: CustomerTicketMessage): string {
  const delivered = message.sender_type === 'agent' && !isDeliveredAgentMessage(message) ? ' [NOT DELIVERED]' : '';
  return `[${message.created_at}] ${message.sender_type === 'customer' ? 'Customer' : 'Agent'}${delivered}: `;
}

function truncateMessageContent(content: string, maxChars: number): { text: string; truncated: boolean } {
  if (content.length <= maxChars) return { text: content, truncated: false };
  const minimumMarker = '[MESSAGE TRUNCATED]';
  if (maxChars <= minimumMarker.length + 8) {
    return { text: minimumMarker.slice(0, Math.max(0, maxChars)), truncated: true };
  }

  // Preserve both ends: requests and signatures/order references commonly sit
  // at opposite ends of forwarded email bodies.
  let marker = '';
  let keepChars = Math.max(0, maxChars - 72);
  for (let index = 0; index < 2; index += 1) {
    const omittedChars = Math.max(1, content.length - keepChars);
    marker = `\n[... MESSAGE TRUNCATED: ${omittedChars} characters omitted ...]\n`;
    keepChars = Math.max(0, maxChars - marker.length);
  }
  const headChars = Math.ceil(keepChars / 2);
  const tailChars = Math.floor(keepChars / 2);
  return {
    text: `${content.slice(0, headChars)}${marker}${tailChars > 0 ? content.slice(-tailChars) : ''}`,
    truncated: true,
  };
}

function renderTicketMessageWithin(
  message: CustomerTicketMessage,
  maxChars: number,
): { text: string; truncated: boolean } {
  if (maxChars <= 0) return { text: '', truncated: true };
  let prefix = ticketMessagePrefix(message);
  if (prefix.length + message.content.length <= maxChars) {
    return { text: `${prefix}${message.content}`, truncated: false };
  }
  if (prefix.length + '[MESSAGE TRUNCATED]'.length > maxChars) {
    prefix = `${message.sender_type === 'customer' ? 'Customer' : 'Agent'}: `;
  }
  if (prefix.length >= maxChars) return { text: prefix.slice(0, maxChars), truncated: true };
  const content = truncateMessageContent(message.content, Math.max(0, maxChars - prefix.length));
  return { text: `${prefix}${content.text}`.slice(0, maxChars), truncated: true };
}

function lastMessageIndex(
  messages: CustomerTicketMessage[],
  senderType: CustomerTicketMessage['sender_type'],
): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.sender_type === senderType) return index;
  }
  return -1;
}

/**
 * Render the current ticket inside a hard budget. The most recent customer and
 * agent turns are protected independently so a giant forwarded email cannot
 * evict the actual request (or the store's latest response) from the prompt.
 */
function renderCurrentTicketWithin(
  ticket: CustomerTicketThread,
  budget: number,
): { text: string; renderedMessageCount: number; omittedMessageCount: number } {
  const subject = ticket.subject.replace(/\s+/g, ' ').slice(0, 300);
  const heading = [
    `\n### Ticket #${ticket.ticket_number} [CURRENT] — ${subject}`,
    `State: ${ticket.status}; response=${ticket.response_state}; opened=${ticket.created_at}; updated=${ticket.updated_at}`,
  ].join('\n');
  if (ticket.messages.length === 0) return { text: heading.slice(0, budget), renderedMessageCount: 0, omittedMessageCount: 0 };

  const summaryReserve = 190;
  let remaining = Math.max(0, budget - heading.length - summaryReserve);
  const latestCustomer = lastMessageIndex(ticket.messages, 'customer');
  const latestAgent = lastMessageIndex(ticket.messages, 'agent');
  const latestOverall = ticket.messages.length - 1;
  const priority = [...new Set([latestOverall, latestCustomer, latestAgent].filter((index) => index >= 0))];
  const rendered = new Map<number, { text: string; truncated: boolean }>();

  for (let position = 0; position < priority.length; position += 1) {
    const messageIndex = priority[position]!;
    const requiredAfter = priority.length - position;
    const allocation = Math.max(0, Math.floor(remaining / requiredAfter));
    const result = renderTicketMessageWithin(ticket.messages[messageIndex]!, allocation);
    rendered.set(messageIndex, result);
    remaining = Math.max(0, remaining - result.text.length - 1);
  }

  // Spend any surplus on the newest intervening turns. A partial final turn is
  // useful context, but it is still counted as truncated in the coverage footer.
  const supplemental = ticket.messages
    .map((_message, index) => index)
    .filter((index) => !rendered.has(index))
    .reverse();
  for (const messageIndex of supplemental) {
    if (remaining < 120) break;
    const message = ticket.messages[messageIndex]!;
    const fullLength = ticketMessagePrefix(message).length + message.content.length;
    const result = renderTicketMessageWithin(message, Math.min(remaining, fullLength));
    rendered.set(messageIndex, result);
    remaining = Math.max(0, remaining - result.text.length - 1);
    if (result.truncated) break;
  }

  const ordered = [...rendered.entries()].sort(([left], [right]) => left - right);
  const truncatedCount = ordered.filter(([, value]) => value.truncated).length;
  const fullyRenderedCount = ordered.length - truncatedCount;
  const whollyOmittedCount = ticket.messages.length - ordered.length;
  const omittedMessageCount = whollyOmittedCount + truncatedCount;
  const details = ordered.map(([, value]) => value.text).join('\n');
  const summary = omittedMessageCount > 0
    ? `\n[CURRENT TICKET HISTORY TRUNCATED: ${truncatedCount} partially shown; ${whollyOmittedCount} wholly omitted. Latest customer and agent turns were prioritized.]`
    : '';
  return {
    text: `${heading}${details ? `\n${details}` : ''}${summary}`.slice(0, budget),
    renderedMessageCount: fullyRenderedCount,
    omittedMessageCount,
  };
}

export function formatCustomerSupportContext(
  bundle: CustomerSupportContextBundle,
  maxChars = 90_000,
): FormattedCustomerSupportContext {
  const safeMax = Math.max(2_000, maxChars);
  const current = bundle.tickets.find((ticket) => ticket.id === bundle.current_ticket_id);
  const orderedTickets = [...bundle.tickets].sort((left, right) => {
    if (left.id === bundle.current_ticket_id) return -1;
    if (right.id === bundle.current_ticket_id) return 1;
    const activeDelta = Number(['open', 'pending'].includes(right.status)) - Number(['open', 'pending'].includes(left.status));
    if (activeDelta) return activeDelta;
    const relatedDelta = (right.relatedness?.score ?? 0) - (left.relatedness?.score ?? 0);
    return relatedDelta || threadRecency(right) - threadRecency(left);
  });
  let header = [
    `CUSTOMER HISTORY COVERAGE — projection ${bundle.projection_version}`,
    `Loaded every matching thread for normalized email ${bundle.normalized_email}: ${bundle.coverage.ticket_count} ticket(s), ${bundle.coverage.conversation_count} chat(s), ${bundle.coverage.ticket_message_count + bundle.coverage.conversation_message_count} public message(s).`,
    `Evidence hash: ${bundle.hash}`,
    '',
    'THREAD MANIFEST (every thread is listed even if message text overflows the prompt budget):',
    ...orderedTickets.map((ticket) => `- Ticket #${ticket.ticket_number}${ticket.id === bundle.current_ticket_id ? ' [CURRENT]' : ''}: ${ticket.status}; response=${ticket.response_state}; ${ticket.messages.length} public message(s); subject="${ticket.subject.replace(/\s+/g, ' ').slice(0, 180)}"${ticket.relatedness && ticket.id !== bundle.current_ticket_id ? `; relation=${ticket.relatedness.score.toFixed(2)}${ticket.relatedness.basis.length ? ` (${ticket.relatedness.basis.join(', ')})` : ''}` : ''}`),
    ...bundle.conversations.map((conversation) => `- Chat ${conversation.id}: ${conversation.status}; resolved=${conversation.resolved}; response=${conversation.response_state}; ${conversation.messages.length} public message(s)`),
    '',
    'MESSAGE HISTORY:',
  ].join('\n');
  const detailBlocks: Array<{ text: string; messageCount: number }> = [];
  for (const ticket of orderedTickets) {
    if (ticket.id === bundle.current_ticket_id) continue;
    const lines = [`\n### Ticket #${ticket.ticket_number}${ticket.id === bundle.current_ticket_id ? ' [CURRENT]' : ''} — ${ticket.subject}`, `State: ${ticket.status}; response=${ticket.response_state}; opened=${ticket.created_at}; updated=${ticket.updated_at}`];
    for (const message of ticket.messages) {
      const delivered = message.sender_type === 'agent' && !isDeliveredAgentMessage(message) ? ' [NOT DELIVERED]' : '';
      lines.push(`[${message.created_at}] ${message.sender_type === 'customer' ? 'Customer' : 'Agent'}${delivered}: ${message.content}`);
    }
    detailBlocks.push({ text: lines.join('\n'), messageCount: ticket.messages.length });
  }
  for (const conversation of bundle.conversations) {
    const lines = [`\n### Chat ${conversation.id}`, `State: ${conversation.status}; resolved=${conversation.resolved}; response=${conversation.response_state}; started=${conversation.started_at}`];
    for (const message of conversation.messages) {
      const label = message.role === 'user' ? 'Customer' : message.role === 'human_agent' ? 'Human agent' : 'Store chatbot';
      lines.push(`[${message.created_at}] ${label}: ${message.content}`);
    }
    detailBlocks.push({ text: lines.join('\n'), messageCount: conversation.messages.length });
  }

  // Protect enough space for the active request even if a pathological number
  // of manifest entries would otherwise consume the whole prompt.
  const footerReserve = 360;
  const minimumCurrentBudget = current ? Math.min(12_000, Math.max(700, Math.floor(safeMax * 0.15))) : 0;
  const maximumHeader = Math.max(500, safeMax - minimumCurrentBudget - footerReserve);
  if (header.length > maximumHeader) {
    const marker = '\n[MANIFEST OVERFLOW: additional thread entries did not fit; the evidence hash and coverage counts still cover every thread.]\nMESSAGE HISTORY:';
    header = `${header.slice(0, Math.max(0, maximumHeader - marker.length))}${marker}`;
  }
  let text = header;
  let renderedMessageCount = 0;
  let omittedMessageCount = 0;

  if (current) {
    const available = Math.max(0, safeMax - text.length - footerReserve);
    const hasOtherThreads = detailBlocks.length > 0;
    const currentBudget = hasOtherThreads
      ? Math.max(minimumCurrentBudget, Math.min(45_000, Math.floor(available * 0.6)))
      : available;
    const renderedCurrent = renderCurrentTicketWithin(current, Math.min(available, currentBudget));
    text += renderedCurrent.text;
    renderedMessageCount += renderedCurrent.renderedMessageCount;
    omittedMessageCount += renderedCurrent.omittedMessageCount;
  }

  for (const block of detailBlocks) {
    if (text.length + block.text.length + footerReserve <= safeMax) {
      text += block.text;
      renderedMessageCount += block.messageCount;
    } else {
      omittedMessageCount += block.messageCount;
    }
  }
  const totalMessages = bundle.coverage.ticket_message_count + bundle.coverage.conversation_message_count;
  if (omittedMessageCount > 0) {
    text += `\n\n[EXPLICIT HISTORY OVERFLOW: ${omittedMessageCount} of ${totalMessages} public message(s) were omitted or truncated in the ${safeMax}-character prompt budget. The manifest/coverage and evidence hash cover the complete unabridged history. Do not claim an omitted exchange said something specific.]`;
  } else {
    text += '\n\n[COMPLETE HISTORY: all public message text is included above.]';
  }
  if (text.length > safeMax) {
    const marker = '\n[FORMAT OVERFLOW: evidence hash still covers full history.]';
    text = `${text.slice(0, safeMax - marker.length)}${marker}`;
  }
  return {
    text,
    max_chars: safeMax,
    rendered_chars: text.length,
    rendered_message_count: renderedMessageCount,
    omitted_message_count: Math.max(omittedMessageCount, totalMessages - renderedMessageCount),
    overflow: renderedMessageCount < totalMessages,
  };
}
