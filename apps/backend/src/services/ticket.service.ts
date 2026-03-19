import { supabase } from '../config/supabase.js';
import type { Ticket, TicketMessage, TicketEvent } from '../types/index.js';
import { calculateSlaDeadline } from './sla.service.js';
import { sendTicketConfirmation } from './email.service.js';

// ── Create Ticket ──────────────────────────────────────────────────────────
export async function createTicket(data: {
  source: Ticket['source'];
  subject: string;
  customer_email: string;
  customer_name?: string;
  customer_phone?: string;
  shopify_customer_id?: string;
  priority?: Ticket['priority'];
  category?: string;
  conversation_id?: string;
  order_id?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  brand_id?: string;
  classification?: string;
  classification_confidence?: number;
}): Promise<Ticket> {
  const priority = data.priority ?? 'medium';

  let slaDeadline: string | null = null;
  try {
    slaDeadline = await calculateSlaDeadline(priority, data.brand_id);
  } catch (err) {
    console.warn('[ticket.service] Could not calculate SLA deadline:', err instanceof Error ? err.message : err);
  }

  const insertPayload: Record<string, unknown> = {
    source: data.source,
    subject: data.subject,
    customer_email: data.customer_email,
    customer_name: data.customer_name ?? null,
    customer_phone: data.customer_phone ?? null,
    shopify_customer_id: data.shopify_customer_id ?? null,
    priority,
    category: data.category ?? null,
    conversation_id: data.conversation_id ?? null,
    order_id: data.order_id ?? null,
    tags: data.tags ?? [],
    metadata: data.metadata ?? null,
    sla_deadline: slaDeadline,
    classification: data.classification ?? null,
    classification_confidence: data.classification_confidence ?? null,
  };
  if (data.brand_id) insertPayload.brand_id = data.brand_id;

  // Check if customer is a trade member — auto-upgrade priority
  if (data.customer_email) {
    try {
      const { getMemberByEmail, getTradeSettings } = await import('./trade.service.js');
      const brandId = data.brand_id || '';
      const member = await getMemberByEmail(data.customer_email, brandId);
      if (member) {
        const settings = await getTradeSettings(member.brand_id);
        // Upgrade priority if trade member and current priority is lower
        const priorityRank: Record<string, number> = { low: 0, medium: 1, high: 2, urgent: 3 };
        const currentRank = priorityRank[data.priority || 'medium'] || 1;
        const tradeRank = priorityRank[settings.ticket_priority_level] || 2;
        if (tradeRank > currentRank) {
          data.priority = settings.ticket_priority_level as any;
          insertPayload.priority = data.priority;
        }
        // Add trade tags
        const existingTags = (insertPayload.tags as string[]) || [];
        insertPayload.tags = [...existingTags, 'trade-member'];
        // Merge trade metadata
        const existingMeta = (insertPayload.metadata as Record<string, unknown>) || {};
        insertPayload.metadata = { ...existingMeta, trade_member_id: member.id, trade_company: member.company_name };
      }
    } catch (err) {
      console.error('[ticket.service] trade member check failed:', err);
      // Non-fatal — continue with original priority
    }
  }

  const { data: row, error } = await supabase
    .from('tickets')
    .insert(insertPayload)
    .select()
    .single();

  if (error) {
    console.error('[ticket.service] createTicket error:', error.message);
    throw new Error('Failed to create ticket');
  }

  const ticket = row as Ticket;

  // Log created event
  await logEvent(ticket.id, 'created', 'system', null, null, `Ticket #${ticket.ticket_number} created via ${data.source}`);

  console.log(`[ticket.service] Created ticket #${ticket.ticket_number} (${ticket.id}) via ${data.source}`);
  return ticket;
}

// ── Get Single Ticket ──────────────────────────────────────────────────────
export async function getTicket(id: string): Promise<Ticket | null> {
  const { data: row, error } = await supabase
    .from('tickets')
    .select()
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    console.error('[ticket.service] getTicket error:', error.message);
    throw new Error('Failed to get ticket');
  }

  return row as Ticket;
}

// ── List Tickets with Filters ──────────────────────────────────────────────
export async function listTickets(filters: {
  brand_id?: string;
  status?: string;
  priority?: string;
  source?: string;
  assigned_to?: string;
  category?: string;
  search?: string;
  tags?: string[];
  classification?: string;
  exclude_classification?: string[];
  sla_breached?: boolean;
  page?: number;
  perPage?: number;
  order_by?: string;
  order?: 'asc' | 'desc';
}): Promise<{ tickets: Ticket[]; total: number; page: number; totalPages: number }> {
  const page = filters.page ?? 1;
  const perPage = filters.perPage ?? 20;
  const orderBy = filters.order_by ?? 'created_at';
  const order = filters.order ?? 'desc';
  const offset = (page - 1) * perPage;

  let query = supabase.from('tickets').select('*', { count: 'exact' });

  if (filters.brand_id) {
    query = query.eq('brand_id', filters.brand_id);
  }
  if (filters.status) {
    query = query.eq('status', filters.status);
  }
  if (filters.priority) {
    query = query.eq('priority', filters.priority);
  }
  if (filters.source) {
    query = query.eq('source', filters.source);
  }
  if (filters.assigned_to) {
    query = query.eq('assigned_to', filters.assigned_to);
  }
  if (filters.category) {
    query = query.eq('category', filters.category);
  }
  if (filters.classification) {
    query = query.eq('classification', filters.classification);
  }
  if (filters.exclude_classification && filters.exclude_classification.length > 0) {
    for (const cls of filters.exclude_classification) {
      query = query.neq('classification', cls);
    }
  }
  if (filters.sla_breached !== undefined) {
    query = query.eq('sla_breached', filters.sla_breached);
  }
  if (filters.search) {
    query = query.or(`subject.ilike.%${filters.search}%,customer_email.ilike.%${filters.search}%`);
  }
  if (filters.tags && filters.tags.length > 0) {
    query = query.overlaps('tags', filters.tags);
  }

  const { data: rows, error, count } = await query
    .order(orderBy, { ascending: order === 'asc' })
    .range(offset, offset + perPage - 1);

  if (error) {
    console.error('[ticket.service] listTickets error:', error.message);
    throw new Error('Failed to list tickets');
  }

  const total = count ?? 0;
  return {
    tickets: (rows ?? []) as Ticket[],
    total,
    page,
    totalPages: Math.ceil(total / perPage),
  };
}

// ── Update Ticket ──────────────────────────────────────────────────────────
export async function updateTicket(
  id: string,
  updates: Partial<Pick<Ticket, 'status' | 'priority' | 'category' | 'assigned_to' | 'tags' | 'subject' | 'metadata'>>,
  actorId?: string
): Promise<Ticket> {
  // Load current ticket for event diffing
  const current = await getTicket(id);
  if (!current) {
    throw new Error('Ticket not found');
  }

  const now = new Date().toISOString();
  const updatePayload: Record<string, unknown> = { ...updates, updated_at: now };

  // Set timestamp fields based on status changes
  if (updates.status === 'resolved' && current.status !== 'resolved') {
    updatePayload.resolved_at = now;
  }
  if (updates.status === 'closed' && current.status !== 'closed') {
    updatePayload.closed_at = now;
  }

  const { data: row, error } = await supabase
    .from('tickets')
    .update(updatePayload)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('[ticket.service] updateTicket error:', error.message);
    throw new Error('Failed to update ticket');
  }

  const updated = row as Ticket;
  const actor: TicketEvent['actor'] = actorId ? 'agent' : 'system';

  // Log events for each changed field
  if (updates.status && updates.status !== current.status) {
    await logEvent(id, 'status_changed', actor, actorId ?? null, current.status, updates.status);
  }
  if (updates.priority && updates.priority !== current.priority) {
    await logEvent(id, 'priority_changed', actor, actorId ?? null, current.priority, updates.priority);
  }
  if (updates.assigned_to !== undefined && updates.assigned_to !== current.assigned_to) {
    await logEvent(id, 'assigned', actor, actorId ?? null, current.assigned_to, updates.assigned_to ?? null);
  }
  if (updates.tags && JSON.stringify(updates.tags) !== JSON.stringify(current.tags)) {
    await logEvent(id, 'tagged', actor, actorId ?? null, current.tags.join(','), updates.tags.join(','));
  }
  if (updates.category && updates.category !== current.category) {
    await logEvent(id, 'category_changed', actor, actorId ?? null, current.category, updates.category);
  }

  return updated;
}

// ── Add Ticket Message ─────────────────────────────────────────────────────
export async function addTicketMessage(
  ticketId: string,
  data: {
    sender_type: TicketMessage['sender_type'];
    sender_name?: string;
    sender_email?: string;
    content: string;
    content_html?: string;
    is_internal_note?: boolean;
    attachments?: unknown[];
    ai_generated?: boolean;
    metadata?: Record<string, unknown>;
  }
): Promise<TicketMessage> {
  const { data: row, error } = await supabase
    .from('ticket_messages')
    .insert({
      ticket_id: ticketId,
      sender_type: data.sender_type,
      sender_name: data.sender_name ?? null,
      sender_email: data.sender_email ?? null,
      content: data.content,
      content_html: data.content_html ?? null,
      is_internal_note: data.is_internal_note ?? false,
      attachments: data.attachments ?? [],
      ai_generated: data.ai_generated ?? false,
      metadata: data.metadata ?? null,
    })
    .select()
    .single();

  if (error) {
    console.error('[ticket.service] addTicketMessage error:', error.message);
    throw new Error('Failed to add ticket message');
  }

  const message = row as TicketMessage;

  // If agent reply (not internal note), set first_response_at if not already set
  if (data.sender_type === 'agent' && !data.is_internal_note) {
    const ticket = await getTicket(ticketId);
    if (ticket && !ticket.first_response_at) {
      await supabase
        .from('tickets')
        .update({ first_response_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', ticketId);
    }
  }

  // Log event
  const eventType = data.is_internal_note ? 'internal_note_added' : 'message_added';
  await logEvent(ticketId, eventType, data.sender_type === 'agent' ? 'agent' : data.sender_type === 'customer' ? 'customer' : 'system', null, null, data.sender_type);

  return message;
}

// ── Get Ticket Messages ────────────────────────────────────────────────────
export async function getTicketMessages(ticketId: string): Promise<TicketMessage[]> {
  const { data: rows, error } = await supabase
    .from('ticket_messages')
    .select()
    .eq('ticket_id', ticketId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[ticket.service] getTicketMessages error:', error.message);
    throw new Error('Failed to get ticket messages');
  }

  return (rows ?? []) as TicketMessage[];
}

// ── Get Ticket Events (Audit Log) ─────────────────────────────────────────
export async function getTicketEvents(ticketId: string): Promise<TicketEvent[]> {
  const { data: rows, error } = await supabase
    .from('ticket_events')
    .select()
    .eq('ticket_id', ticketId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[ticket.service] getTicketEvents error:', error.message);
    throw new Error('Failed to get ticket events');
  }

  return (rows ?? []) as TicketEvent[];
}

// ── Create Ticket from AI Escalation ───────────────────────────────────────
export async function createTicketFromEscalation(
  conversationId: string,
  data: {
    customer_email: string;
    customer_name?: string;
    reason: string;
    priority?: Ticket['priority'];
    summary?: string;
    recommendedActions?: string[];
    brandId?: string;
  }
): Promise<Ticket> {
  const ticket = await createTicket({
    source: 'ai_escalation',
    subject: `AI Escalation: ${data.reason}`,
    customer_email: data.customer_email,
    customer_name: data.customer_name,
    priority: data.priority ?? 'medium',
    category: 'ai_escalation',
    conversation_id: conversationId,
    brand_id: data.brandId,
    metadata: {
      escalation_reason: data.reason,
      recommended_actions: data.recommendedActions ?? [],
    },
  });

  // Create first system message with AI context
  const summaryText = data.summary ?? data.reason;
  const actionsText = data.recommendedActions?.length
    ? `\n\nRecommended actions:\n${data.recommendedActions.map((a) => `- ${a}`).join('\n')}`
    : '';

  await addTicketMessage(ticket.id, {
    sender_type: 'system',
    content: `This ticket was automatically created from an AI chat escalation.\n\nReason: ${data.reason}\n\nAI Summary: ${summaryText}${actionsText}`,
    is_internal_note: true,
    ai_generated: true,
  });

  // Link conversation to ticket
  await supabase
    .from('conversations')
    .update({ escalated_ticket_id: ticket.id, updated_at: new Date().toISOString() })
    .eq('id', conversationId);

  // Send confirmation email
  sendTicketConfirmation({
    to: data.customer_email,
    customerName: data.customer_name,
    ticketNumber: ticket.ticket_number,
    subject: ticket.subject,
    brandId: data.brandId,
  }).catch((err) => console.error('[ticket.service] Escalation confirmation email failed:', err));

  console.log(`[ticket.service] Created escalation ticket #${ticket.ticket_number} from conversation ${conversationId}`);
  return ticket;
}

// ── Bulk Update Tickets ───────────────────────────────────────────────────
export async function bulkUpdateTickets(
  ids: string[],
  updates: Partial<Pick<Ticket, 'status' | 'priority' | 'category' | 'classification'>>,
  brandId?: string,
  actorId?: string
): Promise<{ updated: number; errors: string[] }> {
  const errors: string[] = [];
  let updated = 0;

  const now = new Date().toISOString();
  const updatePayload: Record<string, unknown> = { ...updates, updated_at: now };
  if (updates.status === 'resolved') updatePayload.resolved_at = now;
  if (updates.status === 'closed') updatePayload.closed_at = now;

  let query = supabase
    .from('tickets')
    .update(updatePayload)
    .in('id', ids);

  if (brandId) {
    query = query.eq('brand_id', brandId);
  }

  const { data, error } = await query.select('id');

  if (error) {
    console.error('[ticket.service] bulkUpdateTickets error:', error.message);
    errors.push(error.message);
  } else {
    updated = data?.length ?? 0;

    // Log events for each ticket
    if (updates.status) {
      const actor: TicketEvent['actor'] = actorId ? 'agent' : 'system';
      for (const row of data ?? []) {
        await logEvent(row.id, 'status_changed', actor, actorId ?? null, null, updates.status);
      }
    }
  }

  return { updated, errors };
}

// ── Classify Unclassified Tickets ─────────────────────────────────────────
export async function getUnclassifiedTickets(brandId: string, limit = 50): Promise<Ticket[]> {
  const { data, error } = await supabase
    .from('tickets')
    .select('*')
    .eq('brand_id', brandId)
    .is('classification', null)
    .in('status', ['open', 'pending'])
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('[ticket.service] getUnclassifiedTickets error:', error.message);
    return [];
  }

  return (data ?? []) as Ticket[];
}

// ── Get Non-Support Tickets ───────────────────────────────────────────────
export async function getNonSupportTickets(brandId: string): Promise<Ticket[]> {
  const { data, error } = await supabase
    .from('tickets')
    .select('*')
    .eq('brand_id', brandId)
    .in('status', ['open', 'pending'])
    .not('classification', 'is', null)
    .neq('classification', 'customer_support')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[ticket.service] getNonSupportTickets error:', error.message);
    return [];
  }

  return (data ?? []) as Ticket[];
}

// ── Internal: Log Event ────────────────────────────────────────────────────
async function logEvent(
  ticketId: string,
  eventType: string,
  actor: TicketEvent['actor'],
  actorId: string | null,
  oldValue: string | null,
  newValue: string | null,
  metadata?: Record<string, unknown>
): Promise<void> {
  const { error } = await supabase
    .from('ticket_events')
    .insert({
      ticket_id: ticketId,
      event_type: eventType,
      actor,
      actor_id: actorId,
      old_value: oldValue,
      new_value: newValue,
      metadata: metadata ?? null,
    });

  if (error) {
    console.error(`[ticket.service] logEvent error (${eventType}):`, error.message);
  }
}
