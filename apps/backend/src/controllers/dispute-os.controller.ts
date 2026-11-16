import crypto from 'crypto';
import { Router, Request, Response } from 'express';
import { supabase } from '../config/supabase.js';
import * as ticketService from '../services/ticket.service.js';
import {
  DISPUTE_OS_HOLD_CATEGORY,
  DISPUTE_OS_HOLD_CLASSIFICATION,
  DISPUTE_OS_HOLD_TAG,
  escapeLikePattern,
  getDisputeOsBrandId,
  hasDisputeOsHoldMarker,
  isSameEmail,
  resolveDisputeOsHoldEventTarget,
} from '../services/dispute-os-policy.js';
import type { Ticket } from '../types/index.js';

export const disputeOsRouter = Router();

const MAX_LIMIT = 50;
const SIGNATURE_MAX_SKEW_MS = 5 * 60 * 1000;

function timingSafeStringEqual(a: string, b: string): boolean {
  const left = crypto.createHash('sha256').update(a).digest();
  const right = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(left, right);
}

function extractBearer(req: Request): string {
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    return auth.slice('Bearer '.length).trim();
  }
  return '';
}

function requireReadAuth(req: Request, res: Response): boolean {
  const expected = (process.env.DISPUTE_OS_READ_TOKEN || '').trim();
  if (!expected) {
    res.status(503).json({ ok: false, error: 'Dispute OS read integration is not configured' });
    return false;
  }
  const provided = extractBearer(req) || (typeof req.headers['x-dispute-os-token'] === 'string' ? req.headers['x-dispute-os-token'].trim() : '');
  if (!provided || !timingSafeStringEqual(provided, expected)) {
    res.status(401).json({ ok: false, error: 'Unauthorized' });
    return false;
  }
  return true;
}

function verifyHoldWebhookAuth(req: Request, res: Response): boolean {
  const expected = (process.env.DISPUTE_OS_HOLD_SECRET || '').trim();
  if (!expected) {
    res.status(503).json({ ok: false, error: 'Dispute OS hold webhook secret is not configured' });
    return false;
  }

  const bearer = extractBearer(req);
  if (bearer && timingSafeStringEqual(bearer, expected)) {
    return true;
  }

  const headerSecret = typeof req.headers['x-dispute-os-secret'] === 'string' ? req.headers['x-dispute-os-secret'].trim() : '';
  if (headerSecret && timingSafeStringEqual(headerSecret, expected)) {
    return true;
  }

  const sigHeader = typeof req.headers['x-dispute-os-signature'] === 'string' ? req.headers['x-dispute-os-signature'].trim() : '';
  const rawBody = (req as unknown as { rawBody?: string }).rawBody ?? JSON.stringify(req.body ?? {});
  if (sigHeader) {
    // Support either `t=<ms>,v1=<hex>` (signed `${t}.${rawBody}`) or bare hex HMAC of `rawBody`
    const parts = Object.fromEntries(
      sigHeader.split(',').map((p) => {
        const idx = p.indexOf('=');
        return idx === -1 ? [p.trim(), ''] : [p.slice(0, idx).trim(), p.slice(idx + 1).trim()];
      }),
    );
    if (parts.t && parts.v1) {
      const ts = Number(parts.t);
      const tsMs = ts < 1e12 ? ts * 1000 : ts;
      if (Number.isFinite(tsMs) && Math.abs(Date.now() - tsMs) <= SIGNATURE_MAX_SKEW_MS) {
        const digest = crypto.createHmac('sha256', expected).update(`${parts.t}.${rawBody}`).digest('hex');
        if (timingSafeStringEqual(parts.v1.toLowerCase(), digest.toLowerCase())) {
          return true;
        }
      }
    } else if (/^[a-f0-9]{64}$/i.test(sigHeader)) {
      const digest = crypto.createHmac('sha256', expected).update(rawBody).digest('hex');
      if (timingSafeStringEqual(sigHeader.toLowerCase(), digest.toLowerCase())) {
        return true;
      }
    }
  }

  res.status(401).json({ ok: false, error: 'Invalid Dispute OS hold webhook credentials' });
  return false;
}

function buildOrderVariants(orderName?: string, orderId?: string): string[] {
  const out = new Set<string>();
  for (const raw of [orderName, orderId]) {
    const val = (raw || '').trim();
    if (!val) continue;
    out.add(val);
    const noHash = val.replace(/^#/, '');
    if (noHash) {
      out.add(noHash);
      out.add(`#${noHash}`);
    }
    const gidMatch = val.match(/Order\/(\d+)$/);
    if (gidMatch?.[1]) {
      out.add(gidMatch[1]);
      out.add(`gid://shopify/Order/${gidMatch[1]}`);
    } else if (/^\d{8,}$/.test(noHash)) {
      out.add(`gid://shopify/Order/${noHash}`);
    }
  }
  return [...out];
}

// GET /api/integrations/dispute-os/context
disputeOsRouter.get('/context', async (req: Request, res: Response) => {
  if (!requireReadAuth(req, res)) return;

  const brandId = getDisputeOsBrandId();

  if (req.query.health === '1' || req.query.health === 'true') {
    const { error } = await supabase
      .from('tickets')
      .select('id')
      .eq('brand_id', brandId)
      .limit(1);

    if (error) {
      res.status(503).json({
        ok: false,
        brandId,
        service: 'dispute-os-integration',
        error: error.message,
      });
      return;
    }

    res.json({
      ok: true,
      brandId,
      service: 'dispute-os-integration',
      tables: ['tickets', 'ticket_messages', 'conversations', 'messages', 'tracking_lookups'],
      checkedAt: new Date().toISOString(),
    });
    return;
  }

  const rawEmail = typeof req.query.email === 'string' ? req.query.email.trim() : '';
  const emailNorm = rawEmail ? rawEmail.toLowerCase() : '';
  // `ilike` is used for a case-insensitive exact match, never as a pattern.
  const emailPattern = escapeLikePattern(emailNorm);
  const orderName = typeof req.query.orderName === 'string' ? req.query.orderName.trim() : '';
  const orderId = typeof req.query.orderId === 'string' ? req.query.orderId.trim() : '';
  const limitRaw = Number(req.query.limit ?? 25);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(MAX_LIMIT, Math.trunc(limitRaw))) : 25;

  if (!emailNorm && !orderName && !orderId) {
    res.status(400).json({ ok: false, error: 'At least one of email, orderName, or orderId is required' });
    return;
  }

  const orderVariants = buildOrderVariants(orderName, orderId);

  // 1. Brand-scoped tickets + non-internal, non-ai_draft messages
  const ticketMap = new Map<string, Record<string, unknown>>();
  let ticketsChecked = true;
  let ticketsError: string | null = null;

  try {
    if (emailNorm) {
      const [byNorm, byRaw] = await Promise.all([
        supabase
          .from('tickets')
          .select('id, ticket_number, source, status, priority, category, subject, customer_email, customer_name, shopify_customer_id, conversation_id, order_id, classification, tags, created_at, updated_at')
          .eq('brand_id', brandId)
          .eq('customer_email_normalized', emailNorm)
          .order('created_at', { ascending: false })
          .limit(limit),
        supabase
          .from('tickets')
          .select('id, ticket_number, source, status, priority, category, subject, customer_email, customer_name, shopify_customer_id, conversation_id, order_id, classification, tags, created_at, updated_at')
          .eq('brand_id', brandId)
          .ilike('customer_email', emailPattern)
          .order('created_at', { ascending: false })
          .limit(limit),
      ]);
      if (byNorm.error) throw new Error(byNorm.error.message);
      if (byRaw.error) throw new Error(byRaw.error.message);
      const byRawExact = (byRaw.data ?? []).filter((row) => isSameEmail(row.customer_email, emailNorm));
      for (const row of [...(byNorm.data ?? []), ...byRawExact]) {
        ticketMap.set(row.id, row);
      }
    }

    if (orderVariants.length > 0) {
      const byOrder = await supabase
        .from('tickets')
        .select('id, ticket_number, source, status, priority, category, subject, customer_email, customer_name, shopify_customer_id, conversation_id, order_id, classification, tags, created_at, updated_at')
        .eq('brand_id', brandId)
        .in('order_id', orderVariants)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (byOrder.error) throw new Error(byOrder.error.message);
      for (const row of byOrder.data ?? []) {
        ticketMap.set(row.id, row);
      }
    }
  } catch (err) {
    ticketsChecked = false;
    ticketsError = err instanceof Error ? err.message : String(err);
  }

  // Hold tickets are Dispute OS's own notifications, not customer history, so
  // they are never handed back to it as evidence.
  const ticketsList = [...ticketMap.values()]
    .filter((t) => !hasDisputeOsHoldMarker(t))
    .sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))
    .slice(0, limit);

  const ticketIds = ticketsList.map((t) => String(t.id));
  const messagesByTicket = new Map<string, Array<Record<string, unknown>>>();

  if (ticketIds.length > 0 && ticketsChecked) {
    const { data: msgRows, error: msgErr } = await supabase
      .from('ticket_messages')
      .select('id, ticket_id, sender_type, sender_name, content, is_internal_note, ai_generated, created_at')
      .in('ticket_id', ticketIds)
      .eq('is_internal_note', false)
      .neq('sender_type', 'ai_draft')
      .order('created_at', { ascending: true });

    if (msgErr) {
      ticketsChecked = false;
      ticketsError = msgErr.message;
    } else {
      for (const msg of msgRows ?? []) {
        if (msg.is_internal_note || msg.sender_type === 'ai_draft') continue;
        const tid = String(msg.ticket_id);
        const arr = messagesByTicket.get(tid) ?? [];
        arr.push({
          id: msg.id,
          senderType: msg.sender_type,
          senderName: msg.sender_name,
          content: msg.content,
          aiGenerated: Boolean(msg.ai_generated),
          createdAt: msg.created_at,
        });
        messagesByTicket.set(tid, arr);
      }
    }
  }

  // 2. Brand-scoped chat conversations + messages
  const convoMap = new Map<string, Record<string, unknown>>();
  let convosChecked = true;
  let convosError: string | null = null;

  try {
    if (emailNorm) {
      const [byNorm, byRaw] = await Promise.all([
        supabase
          .from('conversations')
          .select('id, shopify_customer_id, customer_email, customer_name, status, started_at, last_message_at, message_count, resolved, escalated_ticket_id')
          .eq('brand_id', brandId)
          .eq('customer_email_normalized', emailNorm)
          .order('last_message_at', { ascending: false })
          .limit(limit),
        supabase
          .from('conversations')
          .select('id, shopify_customer_id, customer_email, customer_name, status, started_at, last_message_at, message_count, resolved, escalated_ticket_id')
          .eq('brand_id', brandId)
          .ilike('customer_email', emailPattern)
          .order('last_message_at', { ascending: false })
          .limit(limit),
      ]);
      if (byNorm.error) throw new Error(byNorm.error.message);
      if (byRaw.error) throw new Error(byRaw.error.message);
      const byRawExact = (byRaw.data ?? []).filter((row) => isSameEmail(row.customer_email, emailNorm));
      for (const row of [...(byNorm.data ?? []), ...byRawExact]) {
        convoMap.set(row.id, row);
      }
    }

    const linkedConvoIds = ticketsList
      .map((t) => (typeof t.conversation_id === 'string' ? t.conversation_id : ''))
      .filter(Boolean);
    if (linkedConvoIds.length > 0) {
      const byIds = await supabase
        .from('conversations')
        .select('id, shopify_customer_id, customer_email, customer_name, status, started_at, last_message_at, message_count, resolved, escalated_ticket_id')
        .eq('brand_id', brandId)
        .in('id', [...new Set(linkedConvoIds)]);
      if (byIds.error) throw new Error(byIds.error.message);
      for (const row of byIds.data ?? []) {
        convoMap.set(row.id, row);
      }
    }
  } catch (err) {
    convosChecked = false;
    convosError = err instanceof Error ? err.message : String(err);
  }

  const convoList = [...convoMap.values()]
    .sort((a, b) => String(b.last_message_at ?? '').localeCompare(String(a.last_message_at ?? '')))
    .slice(0, limit);

  const convoIds = convoList.map((c) => String(c.id));
  const messagesByConvo = new Map<string, Array<Record<string, unknown>>>();

  if (convoIds.length > 0 && convosChecked) {
    const { data: cMsgRows, error: cMsgErr } = await supabase
      .from('messages')
      .select('id, conversation_id, role, content, tools_used, created_at')
      .in('conversation_id', convoIds)
      .order('created_at', { ascending: true });

    if (cMsgErr) {
      convosChecked = false;
      convosError = cMsgErr.message;
    } else {
      for (const msg of cMsgRows ?? []) {
        const cid = String(msg.conversation_id);
        const arr = messagesByConvo.get(cid) ?? [];
        arr.push({
          id: msg.id,
          role: msg.role,
          content: msg.content,
          toolsUsed: Array.isArray(msg.tools_used) ? msg.tools_used : [],
          createdAt: msg.created_at,
        });
        messagesByConvo.set(cid, arr);
      }
    }
  }

  // 3. Brand-scoped tracking portal lookups
  const trackingMap = new Map<string, Record<string, unknown>>();
  let trackingChecked = true;
  let trackingError: string | null = null;

  try {
    if (emailNorm) {
      const byEmail = await supabase
        .from('tracking_lookups')
        .select('id, email, order_number, tracking_number, lookup_type, status, carrier, created_at')
        .eq('brand_id', brandId)
        .ilike('email', emailPattern)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (byEmail.error) throw new Error(byEmail.error.message);
      for (const row of byEmail.data ?? []) {
        if (!isSameEmail(row.email, emailNorm)) continue;
        trackingMap.set(row.id, row);
      }
    }

    if (orderVariants.length > 0) {
      const byOrder = await supabase
        .from('tracking_lookups')
        .select('id, order_number, tracking_number, lookup_type, status, carrier, created_at')
        .eq('brand_id', brandId)
        .in('order_number', orderVariants)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (byOrder.error) throw new Error(byOrder.error.message);
      for (const row of byOrder.data ?? []) {
        trackingMap.set(row.id, row);
      }
    }
  } catch (err) {
    trackingChecked = false;
    trackingError = err instanceof Error ? err.message : String(err);
  }

  const trackingLookups = [...trackingMap.values()]
    .sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))
    .slice(0, limit)
    .map((t) => ({
      id: t.id,
      orderNumber: t.order_number,
      trackingNumber: t.tracking_number,
      lookupType: t.lookup_type,
      status: t.status,
      carrier: t.carrier,
      createdAt: t.created_at,
    }));

  res.json({
    ok: true,
    brandId,
    fetchedAt: new Date().toISOString(),
    coverage: {
      tickets: { checked: ticketsChecked, error: ticketsError, count: ticketsList.length },
      conversations: { checked: convosChecked, error: convosError, count: convoList.length },
      trackingLookups: { checked: trackingChecked, error: trackingError, count: trackingLookups.length },
    },
    tickets: ticketsList.map((t) => ({
      id: t.id,
      ticketNumber: t.ticket_number,
      source: t.source,
      status: t.status,
      priority: t.priority,
      category: t.category,
      subject: t.subject,
      orderId: t.order_id,
      classification: t.classification,
      tags: Array.isArray(t.tags) ? t.tags : [],
      createdAt: t.created_at,
      updatedAt: t.updated_at,
      messages: messagesByTicket.get(String(t.id)) ?? [],
    })),
    conversations: convoList.map((c) => ({
      id: c.id,
      status: c.status,
      startedAt: c.started_at,
      lastMessageAt: c.last_message_at,
      messageCount: c.message_count,
      resolved: c.resolved,
      escalatedTicketId: c.escalated_ticket_id,
      messages: messagesByConvo.get(String(c.id)) ?? [],
    })),
    trackingLookups,
  });
});

// POST /api/integrations/dispute-os/hold-webhook
disputeOsRouter.post('/hold-webhook', async (req: Request, res: Response) => {
  if (!verifyHoldWebhookAuth(req, res)) return;

  try {
    const brandId = getDisputeOsBrandId();
    const body = (req.body ?? {}) as Record<string, unknown>;
    const event = typeof body.event === 'string' && body.event.trim() ? body.event.trim() : 'dispute_os.order_held_for_verification';
    const orderId = typeof body.orderId === 'string' ? body.orderId.trim() : '';
    const orderName = typeof body.orderName === 'string' ? body.orderName.trim() : '';
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const riskLevel = typeof body.riskLevel === 'string' ? body.riskLevel.trim().toUpperCase() : 'MEDIUM';
    const holdReason = typeof body.holdReason === 'string' ? body.holdReason.trim() : '';
    const reasons = Array.isArray(body.reasons) ? body.reasons.map((r) => String(r)).filter(Boolean) : [];
    const callbackPath = typeof body.callbackPath === 'string' ? body.callbackPath.trim() : '/support/verify-release';
    const status = typeof body.status === 'string' ? body.status.trim() : '';
    const note = typeof body.note === 'string' ? body.note.trim() : '';
    const expiresAt = typeof body.expiresAt === 'string' ? body.expiresAt.trim() : '';

    if (!orderId && !orderName) {
      res.status(400).json({ ok: false, error: 'orderId or orderName is required' });
      return;
    }

    const orderKey = orderName || orderId;
    const orderVariants = buildOrderVariants(orderName, orderId);
    const isUrgent = riskLevel === 'HIGH' || event.includes('needs_operator') || status === 'needs_operator';
    const priority: Ticket['priority'] = isUrgent ? 'urgent' : 'high';
    const customerEmail = email || 'unknown@dailymisu.com';

    const lines = [
      `Dispute OS event: ${event}`,
      `Order: ${orderName || orderId} (${orderId || 'id n/a'})`,
      `Customer email: ${customerEmail}`,
      `Risk level: ${riskLevel}`,
      holdReason ? `Hold reason: ${holdReason}` : null,
      status ? `Workflow status: ${status}` : null,
      expiresAt ? `Expires at: ${expiresAt}` : null,
      reasons.length > 0 ? `Signals:\n- ${reasons.join('\n- ')}` : null,
      note ? `Note: ${note}` : null,
      `Operator callback path: ${callbackPath}`,
    ].filter(Boolean);
    const noteContent = lines.join('\n');

    // Hold tickets for this Misu order, in any status. An active one receives
    // updates instead of a duplicate; an event already recorded on any of them
    // is a repeat and changes nothing.
    const { data: existingRows, error: findErr } = await supabase
      .from('tickets')
      .select('*')
      .eq('brand_id', brandId)
      .in('order_id', orderVariants)
      .order('created_at', { ascending: false })
      .limit(50);

    if (findErr) {
      res.status(500).json({ ok: false, error: `Failed to check existing tickets: ${findErr.message}` });
      return;
    }

    const holdTickets = ((existingRows ?? []) as Ticket[]).filter((t) => hasDisputeOsHoldMarker(t));

    let recordedNotes: Array<{ ticket_id: unknown; content: unknown }> = [];
    if (holdTickets.length > 0) {
      const { data: noteRows, error: noteErr } = await supabase
        .from('ticket_messages')
        .select('ticket_id, content')
        .in('ticket_id', holdTickets.map((t) => t.id))
        .eq('sender_type', 'system')
        .eq('is_internal_note', true);
      if (noteErr) {
        // Fail open: an unreadable history must never drop a hold event.
        console.warn('[dispute-os] Could not check recorded hold events; treating the event as new:', noteErr.message);
      } else {
        recordedNotes = noteRows ?? [];
      }
    }

    const target = resolveDisputeOsHoldEventTarget({ holdTickets, notes: recordedNotes, noteContent });

    if (target.action === 'ignore_repeat') {
      res.status(200).json({
        ok: true,
        action: 'duplicate_ignored',
        ticketId: target.ticket.id,
        ticketNumber: target.ticket.ticket_number,
        brandId,
      });
      return;
    }

    const existingHold = target.action === 'append' ? target.ticket : undefined;

    if (existingHold) {
      await ticketService.addTicketMessage(existingHold.id, {
        sender_type: 'system',
        sender_name: 'Dispute OS',
        content: noteContent,
        is_internal_note: true,
        metadata: { disputeOsEvent: event, orderId, orderName, riskLevel, status },
      });

      if (isUrgent && existingHold.priority !== 'urgent') {
        await ticketService.updateTicket(existingHold.id, {
          priority: 'urgent',
          metadata: {
            ...(existingHold.metadata ?? {}),
            disputeOsEvent: event,
            lastUpdatedAt: new Date().toISOString(),
            status,
          },
        });
      }

      res.status(200).json({
        ok: true,
        action: 'ticket_updated',
        ticketId: existingHold.id,
        ticketNumber: existingHold.ticket_number,
        brandId,
      });
      return;
    }

    const ticket = await ticketService.createTicket({
      source: 'ai_escalation',
      brand_id: brandId,
      priority,
      // The hold marker is the tag: `tickets.category` only accepts support topics.
      category: DISPUTE_OS_HOLD_CATEGORY,
      subject: `[Dispute OS Hold] ${orderKey} (${isUrgent ? 'Needs Operator' : `${riskLevel} risk`})`,
      customer_email: customerEmail,
      order_id: orderKey,
      tags: ['dispute-os', DISPUTE_OS_HOLD_TAG, ...(isUrgent ? ['needs-operator'] : [])],
      classification: DISPUTE_OS_HOLD_CLASSIFICATION,
      metadata: {
        disputeOsEvent: event,
        orderId,
        orderName,
        riskLevel,
        holdReason,
        callbackPath,
        status,
        expiresAt,
      },
    });

    await ticketService.addTicketMessage(ticket.id, {
      sender_type: 'system',
      sender_name: 'Dispute OS',
      content: noteContent,
      is_internal_note: true,
      metadata: { disputeOsEvent: event, orderId, orderName, riskLevel, status },
    });

    res.status(201).json({
      ok: true,
      action: 'ticket_created',
      ticketId: ticket.id,
      ticketNumber: ticket.ticket_number,
      brandId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[dispute-os] POST /hold-webhook error:', message);
    res.status(500).json({ ok: false, error: 'Failed to process Dispute OS hold webhook' });
  }
});
