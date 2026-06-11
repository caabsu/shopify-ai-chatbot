import { supabase } from '../config/supabase.js';
import type { Ticket } from '../types/index.js';
import { classifyEmail } from './email-classifier.service.js';
import { sendTicketConfirmation } from './email.service.js';
import { triageTicket } from './ticket-triage.service.js';
import * as ticketService from './ticket.service.js';
import {
  extractEmailAddress,
  getConfiguredSenderAddresses,
  resolveBrandIdByEmailRecipient,
} from './brand-email-config.service.js';

type InboundEmailPayload = Record<string, unknown>;

interface NormalizedInboundEmail {
  senderEmail: string;
  senderName: string;
  subject: string;
  body: string;
  html: string;
  rawBody: string;
  rawHtml: string;
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  recipientInputs: unknown[];
  recipientAddresses: string[];
  threadMessages: InboundThreadMessage[];
}

interface InboundThreadMessage {
  from_email?: string;
  from_name?: string;
  text?: string;
  body?: string;
  html?: string;
  message_id?: string;
  date?: string;
}

interface ExistingTicketMatch {
  ticket: Pick<Ticket, 'id' | 'status' | 'ticket_number' | 'brand_id' | 'metadata'>;
  matchMethod: 'message_id' | 'ticket_number' | 'subject';
}

export interface InboundEmailResult {
  statusCode: number;
  body: Record<string, unknown>;
}

export async function processInboundEmailWebhook(opts: {
  payload: InboundEmailPayload;
  explicitBrandId?: string | null;
}): Promise<InboundEmailResult> {
  const email = normalizeInboundEmail(opts.payload);

  if (!email.senderEmail || !email.body) {
    return {
      statusCode: 400,
      body: { error: 'from/from_email and text/body/html are required' },
    };
  }

  const ownAddresses = await getConfiguredSenderAddresses();
  if (isOwnOrAutomatedSender(email.senderEmail, ownAddresses)) {
    console.log(`[webhook] Ignoring email from own/automated address: ${email.senderEmail}`);
    return {
      statusCode: 200,
      body: { success: true, action: 'ignored', reason: 'Email from own or automated address' },
    };
  }

  if (isTicketConfirmationBounce(email.subject, email.body)) {
    console.log(`[webhook] Ignoring ticket confirmation bounce-back from ${email.senderEmail}`);
    return {
      statusCode: 200,
      body: { success: true, action: 'ignored', reason: 'Ticket confirmation bounce-back' },
    };
  }

  const recipientBrandId = await resolveBrandIdByEmailRecipient(...email.recipientInputs);
  const brandId = recipientBrandId ?? opts.explicitBrandId ?? null;

  if (!brandId) {
    console.error('[webhook] Could not route inbound email. No configured recipient or explicit brand.', {
      senderEmail: email.senderEmail,
      subject: email.subject,
      recipientAddresses: email.recipientAddresses,
    });
    return {
      statusCode: 422,
      body: {
        error: 'Could not resolve ticket inbox brand from inbound recipient',
        details: 'Configure support_email/inbound_email for the brand or include a valid ?brand= slug.',
      },
    };
  }

  if (recipientBrandId && opts.explicitBrandId && recipientBrandId !== opts.explicitBrandId) {
    console.warn('[webhook] Recipient brand and explicit brand mismatch. Recipient brand wins.', {
      recipientBrandId,
      explicitBrandId: opts.explicitBrandId,
      recipientAddresses: email.recipientAddresses,
    });
  }

  const existing = await findExistingTicket(email, brandId);
  if (existing) {
    await appendCustomerEmail(existing.ticket, email, existing.matchMethod);
    console.log(`[webhook] Email reply added to ticket #${existing.ticket.ticket_number} from ${email.senderEmail} by ${existing.matchMethod}`);
    return {
      statusCode: 200,
      body: { success: true, action: 'reply_added', ticketNumber: existing.ticket.ticket_number, matchMethod: existing.matchMethod },
    };
  }

  const classification = await classifyEmail({
    from: email.senderEmail,
    subject: email.subject,
    body: email.body,
  });

  console.log(`[webhook] Email from ${email.senderEmail} classified as: ${classification.classification} (confidence: ${classification.confidence.toFixed(2)})`);

  // Conservative intake filter: only drop unambiguous, very-high-confidence spam
  // at the door. Everything else becomes a ticket with its classification recorded,
  // so nothing real is silently lost — the dashboard's reviewable "auto-close
  // non-support" action handles promotional/automated cleanup downstream.
  if (classification.classification === 'spam' && classification.confidence >= 0.95) {
    console.log(`[webhook] Dropping high-confidence spam from ${email.senderEmail}: ${classification.reason}`);
    return {
      statusCode: 200,
      body: { success: true, action: 'discarded', classification: classification.classification, reason: classification.reason },
    };
  }

  const ticket = await ticketService.createTicket({
    source: 'email',
    subject: email.subject,
    customer_email: email.senderEmail,
    customer_name: email.senderName || undefined,
    priority: 'medium',
    brand_id: brandId,
    classification: classification.classification,
    classification_confidence: classification.confidence,
    metadata: {
      inbound_email: {
        recipient_addresses: email.recipientAddresses,
        message_id: email.messageId,
        recipient_brand_id: recipientBrandId,
        explicit_brand_id: opts.explicitBrandId ?? null,
        routed_by: recipientBrandId ? 'recipient' : 'explicit_brand',
      },
    },
  });

  await addInitialEmailMessages(ticket.id, email, ownAddresses);

  if (classification.classification === 'customer_support') {
    // AI auto-triage (fire-and-forget): intent, sentiment, priority suggestion.
    triageTicket(ticket.id).catch((err) => console.error('[webhook] triage failed:', err));

    // Don't confirm auto-responders (out-of-office etc.) — replying to a robot
    // risks a mail loop and never reaches a human anyway.
    if (!isAutoReplyEmail(email.subject)) {
      sendTicketConfirmation({
        to: email.senderEmail,
        customerName: email.senderName || undefined,
        ticketNumber: ticket.ticket_number,
        subject: email.subject,
        brandId,
      }).catch((err) => console.error('[webhook] Confirmation email failed:', err));
    }
  }

  console.log(`[webhook] Email ticket #${ticket.ticket_number} created from ${email.senderEmail}`);
  return {
    statusCode: 201,
    body: {
      success: true,
      action: 'ticket_created',
      ticketNumber: ticket.ticket_number,
      classification: classification.classification,
      routedBy: recipientBrandId ? 'recipient' : 'explicit_brand',
    },
  };
}

function normalizeInboundEmail(payload: InboundEmailPayload): NormalizedInboundEmail {
  const headers = objectValue(payload.headers);
  const senderRaw = firstString(payload.from_email, payload.from, payload.sender, headerValue(headers, 'from'));
  const senderEmail = senderRaw ? extractEmailAddress(senderRaw) ?? senderRaw.trim().toLowerCase() : '';
  const senderName = firstString(payload.from_name, payload.sender_name) ?? extractName(senderRaw);
  const subject = firstString(payload.subject) || '(No Subject)';
  const rawHtml = firstString(payload.html) || '';
  const rawBody = firstString(payload.text, payload.plain, payload.body) || stripHtml(rawHtml);
  const body = cleanInboundEmailText(rawBody);
  const html = cleanInboundHtml(rawHtml);

  const recipientInputs = [
    payload.to,
    payload.to_email,
    payload.recipient,
    payload.recipients,
    payload.delivered_to,
    headerValue(headers, 'to'),
    headerValue(headers, 'delivered-to'),
    objectValue(payload.envelope)?.to,
  ].filter((value) => value !== undefined && value !== null);

  const recipientAddresses = [...new Set(recipientInputs.flatMap(extractEmailAddressesFromUnknown))];

  const referencesRaw = firstString(payload.references, headerValue(headers, 'references'));
  const references = referencesRaw
    ? referencesRaw.split(/\s+/).map(normalizeMessageId).filter((id): id is string => !!id)
    : [];

  return {
    senderEmail,
    senderName,
    subject,
    body,
    html,
    rawBody,
    rawHtml,
    messageId: normalizeMessageId(firstString(payload.message_id, payload.email_message_id, headerValue(headers, 'message-id'))),
    inReplyTo: normalizeMessageId(firstString(payload.in_reply_to, payload.inReplyTo, headerValue(headers, 'in-reply-to'))),
    references,
    recipientInputs,
    recipientAddresses,
    threadMessages: Array.isArray(payload.thread_messages) ? payload.thread_messages as InboundThreadMessage[] : [],
  };
}

async function findExistingTicket(email: NormalizedInboundEmail, brandId: string): Promise<ExistingTicketMatch | null> {
  const messageIds = expandMessageIds([email.inReplyTo, ...email.references]);
  if (messageIds.length > 0) {
    const match = await findTicketByEmailMessageIds(messageIds, brandId);
    if (match) return { ticket: match, matchMethod: 'message_id' };
  }

  const ticketNumber = parseTicketNumber(email.subject);
  if (ticketNumber) {
    const { data } = await supabase
      .from('tickets')
      .select('id, status, ticket_number, brand_id, metadata')
      .eq('ticket_number', ticketNumber)
      .eq('brand_id', brandId)
      .maybeSingle();

    if (data) return { ticket: data as ExistingTicketMatch['ticket'], matchMethod: 'ticket_number' };
  }

  if (/^(re|fwd|fw):/i.test(email.subject)) {
    const cleanSubject = email.subject.replace(/^(Re:|RE:|Fwd:|FW:)\s*/i, '').trim();
    const { data } = await supabase
      .from('tickets')
      .select('id, status, ticket_number, brand_id, metadata')
      .eq('customer_email', email.senderEmail)
      .eq('brand_id', brandId)
      .in('status', ['open', 'pending'])
      .ilike('subject', `%${cleanSubject.slice(0, 80)}%`)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (data) return { ticket: data as ExistingTicketMatch['ticket'], matchMethod: 'subject' };
  }

  return null;
}

async function findTicketByEmailMessageIds(
  messageIds: string[],
  brandId: string,
): Promise<ExistingTicketMatch['ticket'] | null> {
  const { data: directMatches } = await supabase
    .from('ticket_messages')
    .select('ticket_id')
    .in('email_message_id', messageIds)
    .limit(1);

  const directTicketId = directMatches?.[0]?.ticket_id as string | undefined;
  if (directTicketId) {
    const ticket = await getTicketForBrand(directTicketId, brandId);
    if (ticket) return ticket;
  }

  for (const messageId of messageIds) {
    const { data: legacyMatches } = await supabase
      .from('ticket_messages')
      .select('ticket_id')
      .contains('metadata', { email_message_id: messageId })
      .limit(1);

    const legacyTicketId = legacyMatches?.[0]?.ticket_id as string | undefined;
    if (!legacyTicketId) continue;

    const ticket = await getTicketForBrand(legacyTicketId, brandId);
    if (ticket) return ticket;
  }

  return null;
}

async function getTicketForBrand(ticketId: string, brandId: string): Promise<ExistingTicketMatch['ticket'] | null> {
  const { data } = await supabase
    .from('tickets')
    .select('id, status, ticket_number, brand_id, metadata')
    .eq('id', ticketId)
    .eq('brand_id', brandId)
    .maybeSingle();

  return data ? data as ExistingTicketMatch['ticket'] : null;
}

async function appendCustomerEmail(
  ticket: ExistingTicketMatch['ticket'],
  email: NormalizedInboundEmail,
  matchMethod: ExistingTicketMatch['matchMethod'],
): Promise<void> {
  await ticketService.addTicketMessage(ticket.id, {
    sender_type: 'customer',
    sender_name: email.senderName || undefined,
    sender_email: email.senderEmail,
    content: email.body,
    content_html: email.html || undefined,
    email_message_id: email.messageId ?? undefined,
    metadata: {
      inbound_email: true,
      match_method: matchMethod,
      in_reply_to: email.inReplyTo,
      references: email.references,
      recipient_addresses: email.recipientAddresses,
      raw_body_preview: preview(email.rawBody),
      raw_html_preview: preview(email.rawHtml),
    },
  });

  const updatePayload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (ticket.status === 'resolved' || ticket.status === 'closed') {
    updatePayload.status = 'open';
  }

  // A customer reply wakes a snoozed ticket — the wait is over.
  const metadata = (ticket.metadata as Record<string, unknown> | null) ?? null;
  if (metadata && metadata.snoozed_until) {
    const cleared = { ...metadata };
    delete cleared.snoozed_until;
    updatePayload.metadata = cleared;
    if (!updatePayload.status && ticket.status === 'pending') updatePayload.status = 'open';

    await supabase.from('ticket_events').insert({
      ticket_id: ticket.id,
      event_type: 'snooze_woke',
      actor: 'customer',
      old_value: String(metadata.snoozed_until),
      new_value: 'customer_reply',
    });
  }

  await supabase.from('tickets').update(updatePayload).eq('id', ticket.id);
}

async function addInitialEmailMessages(
  ticketId: string,
  email: NormalizedInboundEmail,
  ownAddresses: Set<string>,
): Promise<void> {
  if (email.threadMessages.length > 0) {
    for (const threadMessage of email.threadMessages) {
      const senderEmail = normalizeEmailAddress(threadMessage.from_email);
      const rawContent = threadMessage.text || threadMessage.body || stripHtml(threadMessage.html || '');
      const content = cleanInboundEmailText(rawContent);
      const cleanHtml = cleanInboundHtml(threadMessage.html || '');
      if (!content.trim()) continue;

      await ticketService.addTicketMessage(ticketId, {
        sender_type: senderEmail && ownAddresses.has(senderEmail) ? 'agent' : 'customer',
        sender_name: threadMessage.from_name || undefined,
        sender_email: senderEmail || undefined,
        content,
        content_html: cleanHtml || undefined,
        email_message_id: normalizeMessageId(threadMessage.message_id) ?? undefined,
        metadata: {
          sent_at: threadMessage.date || undefined,
          is_thread_history: true,
          raw_body_preview: preview(rawContent),
          raw_html_preview: preview(threadMessage.html || ''),
        },
      });
    }
    return;
  }

  await ticketService.addTicketMessage(ticketId, {
    sender_type: 'customer',
    sender_name: email.senderName || undefined,
    sender_email: email.senderEmail,
    content: email.body,
    content_html: email.html || undefined,
    email_message_id: email.messageId ?? undefined,
    metadata: {
      inbound_email: true,
      recipient_addresses: email.recipientAddresses,
      raw_body_preview: preview(email.rawBody),
      raw_html_preview: preview(email.rawHtml),
    },
  });
}

function isOwnOrAutomatedSender(senderEmail: string, ownAddresses: Set<string>): boolean {
  return ownAddresses.has(senderEmail)
    || senderEmail.includes('noreply@')
    || senderEmail.includes('no-reply@');
}

function isAutoReplyEmail(subject: string): boolean {
  return /^(automatic reply|auto[- ]?reply|autoreply|out of office|ooo:|away from( the)? office|abwesenheit)/i.test(subject.trim());
}

function isTicketConfirmationBounce(subject: string, body: string): boolean {
  return /^\[Ticket #\d+\]/.test(subject) && body.includes("We've received your message and created ticket");
}

function parseTicketNumber(subject: string): number | null {
  const match = subject.match(/\[Ticket #(\d+)\]/);
  return match ? Number.parseInt(match[1], 10) : null;
}

function expandMessageIds(values: Array<string | null>): string[] {
  const ids = new Set<string>();
  for (const value of values) {
    const normalized = normalizeMessageId(value);
    if (!normalized) continue;
    ids.add(normalized);
    const withoutAngles = normalized.replace(/^<|>$/g, '');
    if (withoutAngles) {
      ids.add(withoutAngles);
      ids.add(`<${withoutAngles}>`);
    }
  }
  return [...ids];
}

function normalizeMessageId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeEmailAddress(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return extractEmailAddress(value);
}

function extractName(value: string | null | undefined): string {
  if (!value) return '';
  return value.replace(/<[^>]+>/g, '').replace(/"/g, '').trim();
}

function extractEmailAddressesFromUnknown(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(extractEmailAddressesFromUnknown);
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return [
      ...extractEmailAddressesFromUnknown(record.email),
      ...extractEmailAddressesFromUnknown(record.address),
      ...extractEmailAddressesFromUnknown(record.to),
      ...extractEmailAddressesFromUnknown(record.recipient),
    ];
  }
  if (typeof value !== 'string') return [];

  return value
    .split(',')
    .map((part) => extractEmailAddress(part))
    .filter((address): address is string => !!address);
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function headerValue(headers: Record<string, unknown> | null, name: string): unknown {
  if (!headers) return undefined;
  const direct = headers[name];
  if (direct !== undefined) return direct;
  const match = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return match?.[1];
}

function stripHtml(value: string): string {
  return value.replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function preview(value: string, maxLength = 2000): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength)}...` : trimmed;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#160;/g, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code) => {
      const parsed = Number.parseInt(code, 10);
      return Number.isFinite(parsed) ? String.fromCodePoint(parsed) : '';
    })
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => {
      const parsed = Number.parseInt(code, 16);
      return Number.isFinite(parsed) ? String.fromCodePoint(parsed) : '';
    });
}

function stripQuotedEmailText(value: string): string {
  let text = value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  const quotePatterns = [
    /\nOn [\s\S]{0,700}? wrote:\s*\n/i,
    /\n-{2,}\s*Original Message\s*-{2,}\s*\n/i,
    /\nFrom:\s.+\nSent:\s.+\nTo:\s.+/i,
    /\nBegin forwarded message:\s*\n/i,
  ];

  const cutIndex = quotePatterns
    .map((pattern) => {
      const match = pattern.exec(text);
      return match?.index ?? -1;
    })
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];

  if (cutIndex !== undefined) {
    text = text.slice(0, cutIndex);
  }

  const lines = text.split('\n');
  while (lines.length > 0 && /^>/.test(lines[lines.length - 1].trim())) {
    lines.pop();
  }

  return lines.join('\n');
}

function cleanInboundEmailText(value: string): string {
  const decoded = decodeHtmlEntities(value)
    .replace(/\u00a0|\u202f/g, ' ')
    .replace(/\[image:[^\]]+\]/gi, '');

  return stripQuotedEmailText(decoded)
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function cleanInboundHtml(value: string): string {
  if (!value.trim()) return '';

  return value
    .replace(/<div[^>]*class=["'][^"']*(gmail_quote|gmail_extra)[^"']*["'][\s\S]*$/i, '')
    .replace(/<blockquote[\s\S]*$/i, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .trim();
}
