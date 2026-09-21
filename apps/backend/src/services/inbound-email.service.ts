import { supabase } from '../config/supabase.js';
import type { Ticket } from '../types/index.js';
import {
  classifyEmail,
  EMAIL_CLASSIFIER_PROMPT_VERSION,
} from './email-classifier.service.js';
import { sendTicketConfirmation } from './email.service.js';
import { triageTicket } from './ticket-triage.service.js';
import { proposeForTicket, replanOnCustomerReply } from './autopilot.service.js';
import * as ticketService from './ticket.service.js';
import { normalizeCustomerEmail } from './customer-support-context.service.js';
import {
  selectSameIssueTicketCandidate,
} from './inbound-ticket-routing-policy.js';
import type {
  CustomerTicketMessage,
  CustomerTicketThread,
} from './customer-support-context.service.js';
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
  ticket: Pick<Ticket, 'id' | 'status' | 'ticket_number' | 'brand_id' | 'metadata' | 'customer_email'> & {
    merged_into_ticket_id?: string | null;
  };
  matchMethod: 'duplicate_message_id' | 'message_id' | 'ticket_number' | 'same_customer_same_issue';
}

export interface InboundEmailResult {
  statusCode: number;
  body: Record<string, unknown>;
}

interface InboundAppendResult {
  appended: boolean;
  duplicate: boolean;
  ticket_id: string;
  ticket_number: number;
  message_id: string;
  redirected: boolean;
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
    if (existing.matchMethod === 'duplicate_message_id') {
      console.log(`[webhook] Duplicate inbound Message-ID ignored for ticket #${existing.ticket.ticket_number}`);
      return {
        statusCode: 200,
        body: {
          success: true,
          action: 'duplicate_ignored',
          ticketNumber: existing.ticket.ticket_number,
          matchMethod: existing.matchMethod,
        },
      };
    }
    const appended = await appendCustomerEmail(existing.ticket, email, existing.matchMethod);
    if (appended.duplicate) {
      console.log(`[webhook] Duplicate inbound Message-ID ignored for ticket #${appended.ticket_number}`);
      return {
        statusCode: 200,
        body: {
          success: true,
          action: 'duplicate_ignored',
          ticketNumber: appended.ticket_number,
          matchMethod: 'duplicate_message_id_constraint',
        },
      };
    }
    console.log(`[webhook] Email reply added to ticket #${appended.ticket_number} from ${email.senderEmail} by ${existing.matchMethod}${appended.redirected ? ' (redirected from linked source)' : ''}`);
    return {
      statusCode: 200,
      body: { success: true, action: 'reply_added', ticketNumber: appended.ticket_number, matchMethod: existing.matchMethod, redirected: appended.redirected },
    };
  }

  const classification = await classifyEmail({
    from: email.senderEmail,
    subject: email.subject,
    body: email.body,
    brandId,
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
      ...(classification.generation ? {
        classification_generation: {
          ...classification.generation,
          prompt_version: EMAIL_CLASSIFIER_PROMPT_VERSION,
        },
      } : {}),
      inbound_email: {
        recipient_addresses: email.recipientAddresses,
        message_id: email.messageId,
        recipient_brand_id: recipientBrandId,
        explicit_brand_id: opts.explicitBrandId ?? null,
        routed_by: recipientBrandId ? 'recipient' : 'explicit_brand',
      },
    },
  });

  const canonicalDuplicateTicketId = await addInitialEmailMessages(ticket.id, email, ownAddresses, brandId);
  if (canonicalDuplicateTicketId && canonicalDuplicateTicketId !== ticket.id) {
    // Two webhook workers can both miss the preflight lookup and create a
    // ticket before the global Message-ID constraint chooses the winner. Keep
    // the losing ticket out of every active workflow and link it to the
    // canonical ticket; never confirm, triage, or plan the loser.
    const now = new Date().toISOString();
    const { error: closeDuplicateError } = await supabase
      .from('tickets')
      .update({
        status: 'closed',
        closed_at: now,
        merged_into_ticket_id: canonicalDuplicateTicketId,
        metadata: {
          ...(ticket.metadata ?? {}),
          duplicate_inbound_message_id: email.messageId,
          merged_into_ticket_id: canonicalDuplicateTicketId,
          merged_reason: 'concurrent_inbound_message_id',
        },
        updated_at: now,
      })
      .eq('id', ticket.id)
      .eq('status', 'open');
    if (closeDuplicateError) {
      console.error('[webhook] Failed to close concurrent duplicate ticket:', closeDuplicateError.message);
      throw new Error('Failed to reconcile concurrent inbound duplicate');
    }
    const canonical = await ticketService.getTicket(canonicalDuplicateTicketId, brandId);
    console.log(`[webhook] Concurrent duplicate ticket #${ticket.ticket_number} linked to #${canonical?.ticket_number ?? canonicalDuplicateTicketId}`);
    return {
      statusCode: 200,
      body: {
        success: true,
        action: 'duplicate_ignored',
        ticketNumber: canonical?.ticket_number ?? null,
        matchMethod: 'duplicate_message_id_constraint',
      },
    };
  }

  if (classification.classification === 'customer_support') {
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

  // Build the plan only after triage commits. Intent, language, sentiment, and
  // suggested priority are part of both retrieval scope and planner context.
  if (classification.classification === 'customer_support') {
    try {
      await triageTicket(ticket.id);
    } catch (err) {
      console.error('[webhook] triage failed; continuing with the complete inbound thread:', err);
    }
  }
  const initialPlan = await proposeForTicket(ticket.id, 'new_ticket');
  if (!initialPlan) {
    // The coverage sweep remains a durable recovery path, but webhook success
    // should mean the first synchronous planning attempt actually finished.
    // This prevents a short-lived worker from acknowledging intake and dropping
    // its fire-and-forget planner promise before a plan is stored.
    console.warn('[webhook] initial Autopilot plan was deferred to coverage recovery', {
      ticket_id: ticket.id,
      ticket_number: ticket.ticket_number,
    });
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
  if (email.messageId) {
    const duplicate = await findTicketByEmailMessageIds(expandMessageIds([email.messageId]), brandId);
    if (duplicate) return verifiedCustomerMatch(duplicate, email.senderEmail, brandId, 'duplicate_message_id');
  }
  const messageIds = expandMessageIds([email.inReplyTo, ...email.references]);
  if (messageIds.length > 0) {
    const match = await findTicketByEmailMessageIds(messageIds, brandId);
    if (match) return verifiedCustomerMatch(match, email.senderEmail, brandId, 'message_id');
  }

  const ticketNumber = parseTicketNumber(email.subject);
  if (ticketNumber) {
    const { data } = await supabase
      .from('tickets')
      .select('id, status, ticket_number, brand_id, metadata, customer_email, merged_into_ticket_id')
      .eq('ticket_number', ticketNumber)
      .eq('brand_id', brandId)
      .maybeSingle();

    if (data) return verifiedCustomerMatch(data as ExistingTicketMatch['ticket'], email.senderEmail, brandId, 'ticket_number');
  }

  const sameIssue = await findActiveSameCustomerIssue(email, brandId);
  return sameIssue
    ? verifiedCustomerMatch(sameIssue, email.senderEmail, brandId, 'same_customer_same_issue')
    : null;
}

async function findActiveSameCustomerIssue(
  email: NormalizedInboundEmail,
  brandId: string,
): Promise<ExistingTicketMatch['ticket'] | null> {
  const normalizedEmail = normalizeCustomerEmail(email.senderEmail);
  if (!normalizedEmail) return null;
  const escapedEmail = normalizedEmail.replace(/[\\%_]/g, '\\$&');
  const { data: ticketRows, error: ticketError } = await supabase
    .from('tickets')
    .select('id, status, ticket_number, brand_id, metadata, customer_email, merged_into_ticket_id, subject, source, order_id, conversation_id, context_version, created_at, updated_at, first_response_at')
    .eq('brand_id', brandId)
    .in('status', ['open', 'pending'])
    .ilike('customer_email', escapedEmail)
    .order('updated_at', { ascending: false })
    .limit(50);
  if (ticketError) {
    console.warn('[webhook] Same-customer issue lookup failed; continuing with a new ticket', {
      senderEmail: normalizedEmail,
      error: ticketError.message,
    });
    return null;
  }
  if (!ticketRows?.length) return null;

  const ticketIds = ticketRows.map((ticket) => String(ticket.id));
  const { data: messageRows, error: messageError } = await supabase
    .from('ticket_messages')
    .select('id, ticket_id, sender_type, sender_name, content, created_at, email_message_id, metadata')
    .in('ticket_id', ticketIds)
    .eq('is_internal_note', false)
    .in('sender_type', ['customer', 'agent'])
    .order('created_at', { ascending: true })
    .limit(1000);
  if (messageError) {
    console.warn('[webhook] Same-customer message lookup failed; continuing with a new ticket', {
      senderEmail: normalizedEmail,
      error: messageError.message,
    });
    return null;
  }

  const messagesByTicket = new Map<string, CustomerTicketMessage[]>();
  for (const raw of messageRows ?? []) {
    const message = raw as CustomerTicketMessage;
    messagesByTicket.set(message.ticket_id, [
      ...(messagesByTicket.get(message.ticket_id) ?? []),
      message,
    ]);
  }
  const candidates = ticketRows.map((raw) => {
    const row = raw as ExistingTicketMatch['ticket'] & {
      subject: string;
      source: string;
      order_id: string | null;
      conversation_id: string | null;
      context_version: number;
      created_at: string;
      updated_at: string;
      first_response_at: string | null;
    };
    const messages = messagesByTicket.get(row.id) ?? [];
    const lastCustomerAt = Math.max(
      0,
      ...messages
        .filter((message) => message.sender_type === 'customer')
        .map((message) => Date.parse(message.created_at)),
    );
    const lastAgentAt = Math.max(
      0,
      ...messages
        .filter((message) => message.sender_type === 'agent')
        .map((message) => Date.parse(message.created_at)),
    );
    return {
      ...row,
      messages,
      response_state: messages.every((message) => message.sender_type !== 'customer')
        ? 'no_customer_message'
        : lastAgentAt === 0
          ? 'unanswered'
          : lastCustomerAt > lastAgentAt
            ? 'awaiting_us'
            : 'awaiting_customer',
    } as CustomerTicketThread;
  });
  const selected = selectSameIssueTicketCandidate({
    subject: email.subject,
    body: email.body,
    receivedAt: new Date().toISOString(),
  }, candidates);
  if (!selected) return null;
  const match = ticketRows.find((ticket) => ticket.id === selected.id);
  if (match) {
    console.log('[webhook] Routed unthreaded contact into active same-customer issue', {
      senderEmail: normalizedEmail,
      ticketNumber: match.ticket_number,
      subject: email.subject,
    });
  }
  return match as ExistingTicketMatch['ticket'] | null;
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
    .select('id, status, ticket_number, brand_id, metadata, customer_email, merged_into_ticket_id')
    .eq('id', ticketId)
    .eq('brand_id', brandId)
    .maybeSingle();

  return data ? data as ExistingTicketMatch['ticket'] : null;
}

async function verifiedCustomerMatch(
  candidate: ExistingTicketMatch['ticket'],
  senderEmail: string,
  brandId: string,
  matchMethod: ExistingTicketMatch['matchMethod'],
): Promise<ExistingTicketMatch | null> {
  const sender = normalizeCustomerEmail(senderEmail);
  if (!sender || normalizeCustomerEmail(candidate.customer_email) !== sender) {
    console.warn('[webhook] Refused cross-customer email thread match; creating a new ticket', {
      matchMethod,
      candidateTicketNumber: candidate.ticket_number,
      senderEmail,
    });
    return null;
  }

  const canonical = await followMergedTicket(candidate, brandId);
  if (!canonical || normalizeCustomerEmail(canonical.customer_email) !== sender) {
    console.warn('[webhook] Refused invalid merged-ticket redirect; creating a new ticket', {
      matchMethod,
      candidateTicketNumber: candidate.ticket_number,
      senderEmail,
    });
    return null;
  }
  return { ticket: canonical, matchMethod };
}

async function followMergedTicket(
  initial: ExistingTicketMatch['ticket'],
  brandId: string,
): Promise<ExistingTicketMatch['ticket'] | null> {
  let ticket = initial;
  const visited = new Set<string>();
  for (let depth = 0; depth < 10; depth++) {
    if (visited.has(ticket.id)) return null;
    visited.add(ticket.id);
    const target = ticket.merged_into_ticket_id ?? ticket.metadata?.merged_into_ticket_id;
    if (typeof target !== 'string' || !target) return ticket;
    const next = await getTicketForBrand(target, brandId);
    if (!next) return null;
    ticket = next;
  }
  return null;
}

async function appendCustomerEmail(
  ticket: ExistingTicketMatch['ticket'],
  email: NormalizedInboundEmail,
  matchMethod: ExistingTicketMatch['matchMethod'],
): Promise<InboundAppendResult> {
  const { data, error } = await supabase.rpc('append_inbound_customer_message', {
    p_candidate_ticket_id: ticket.id,
    p_brand_id: ticket.brand_id,
    p_customer_email: email.senderEmail,
    p_message: {
      sender_name: email.senderName || null,
      content: email.body,
      content_html: email.html || null,
      email_message_id: email.messageId,
      metadata: {
        inbound_email: true,
        match_method: matchMethod,
        in_reply_to: email.inReplyTo,
        references: email.references,
        recipient_addresses: email.recipientAddresses,
        raw_body_preview: preview(email.rawBody),
        raw_html_preview: preview(email.rawHtml),
      },
    },
  });
  if (error) {
    const missingRpc = error.code === 'PGRST202' || /append_inbound_customer_message/i.test(error.message || '');
    throw new Error(missingRpc
      ? 'Atomic inbound routing is unavailable; apply migration 014 before processing replies'
      : `Atomic inbound append failed: ${error.message}`);
  }
  if (!data || typeof data !== 'object') throw new Error('Atomic inbound append returned no result');
  const result = data as Partial<InboundAppendResult>;
  if (typeof result.appended !== 'boolean'
      || typeof result.duplicate !== 'boolean'
      || typeof result.ticket_id !== 'string'
      || !Number.isInteger(result.ticket_number)
      || typeof result.message_id !== 'string'
      || typeof result.redirected !== 'boolean') {
    throw new Error('Atomic inbound append returned an invalid result');
  }

  // A reply changes the situation — rebuild the canonical ticket's plan.
  if (!result.duplicate) {
    try {
      await triageTicket(result.ticket_id);
    } catch (err) {
      console.error('[webhook] reply triage failed; continuing to replan:', err);
    }
    const replacement = await replanOnCustomerReply(result.ticket_id);
    if (!replacement) {
      console.error('[webhook] autopilot replan produced no durable plan:', {
        ticket_id: result.ticket_id,
        ticket_number: result.ticket_number,
      });
    }
  }
  return result as InboundAppendResult;
}

async function addInitialEmailMessages(
  ticketId: string,
  email: NormalizedInboundEmail,
  ownAddresses: Set<string>,
  brandId: string,
): Promise<string | null> {
  if (email.threadMessages.length > 0) {
    let sawCurrentMessage = false;
    for (const threadMessage of email.threadMessages) {
      const senderEmail = normalizeEmailAddress(threadMessage.from_email);
      const rawContent = threadMessage.text || threadMessage.body || stripHtml(threadMessage.html || '');
      const content = cleanInboundEmailText(rawContent);
      const cleanHtml = cleanInboundHtml(threadMessage.html || '');
      if (!content.trim()) continue;

      const threadMessageId = normalizeMessageId(threadMessage.message_id);
      if (threadMessageId && threadMessageId === email.messageId) sawCurrentMessage = true;
      const inserted = await ticketService.addTicketMessage(ticketId, {
        sender_type: senderEmail && ownAddresses.has(senderEmail) ? 'agent' : 'customer',
        sender_name: threadMessage.from_name || undefined,
        sender_email: senderEmail || undefined,
        content,
        content_html: cleanHtml || undefined,
        email_message_id: threadMessageId ?? undefined,
        metadata: {
          sent_at: threadMessage.date || undefined,
          is_thread_history: true,
          raw_body_preview: preview(rawContent),
          raw_html_preview: preview(threadMessage.html || ''),
        },
      }, brandId);
      if (threadMessageId && threadMessageId === email.messageId && inserted.ticket_id !== ticketId) {
        return inserted.ticket_id;
      }
    }
    // Some providers send only prior thread history in `thread_messages` and
    // keep the newly received message in the top-level fields. Persist it
    // explicitly so its global Message-ID remains the concurrency winner.
    if (email.messageId && !sawCurrentMessage) {
      const inserted = await ticketService.addTicketMessage(ticketId, {
        sender_type: 'customer',
        sender_name: email.senderName || undefined,
        sender_email: email.senderEmail,
        content: email.body,
        content_html: email.html || undefined,
        email_message_id: email.messageId,
        metadata: {
          inbound_email: true,
          recipient_addresses: email.recipientAddresses,
          raw_body_preview: preview(email.rawBody),
          raw_html_preview: preview(email.rawHtml),
        },
      }, brandId);
      if (inserted.ticket_id !== ticketId) return inserted.ticket_id;
    }
    return null;
  }

  const inserted = await ticketService.addTicketMessage(ticketId, {
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
  }, brandId);
  return inserted.ticket_id !== ticketId ? inserted.ticket_id : null;
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
