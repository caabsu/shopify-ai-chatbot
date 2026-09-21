import { NextRequest, NextResponse } from 'next/server';
import { holdAutomationForManualReply } from '@/lib/support-manual-control';
import { createHash } from 'node:crypto';
import { getSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { sendTicketReplyEmail } from '@/lib/email';
import { maybeSendCsatRequest } from '@/lib/csat';
import { getCustomerByEmail, getCustomerOrders } from '@/lib/shopify';
import {
  SHOPIFY_SUPPORT_EVIDENCE_PROJECTION,
  shopifySupportEvidenceHash,
} from '@/lib/autopilot-evidence';
import { buildManualDraftReviewEvent, recordManualDraftExecutionOutcome } from '@/lib/autopilot-learning';
import type { Ticket } from '@/lib/types';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await req.json();

  // Verify ticket belongs to brand — fetch full ticket for email context
  const { data: ticket } = await supabase
    .from('tickets')
    .select('id, brand_id, status, first_response_at, customer_email, customer_name, subject, ticket_number, metadata, updated_at, context_version')
    .eq('id', id)
    .eq('brand_id', session.brandId)
    .single();

  if (!ticket) {
    return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
  }

  if (typeof body.content !== 'string' || !body.content.trim()) {
    return NextResponse.json({ error: 'content is required' }, { status: 400 });
  }
  if (body.set_status !== undefined && !['open', 'pending', 'resolved', 'closed'].includes(body.set_status)) {
    return NextResponse.json({ error: 'Invalid ticket status' }, { status: 400 });
  }
  const requestIdempotencyKey = typeof body.idempotency_key === 'string' ? body.idempotency_key : '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestIdempotencyKey)) {
    return NextResponse.json({ error: 'A valid idempotency_key is required' }, { status: 400 });
  }
  const expectedContextVersion = Number(body.context_version);
  if (!Number.isInteger(expectedContextVersion)) {
    return NextResponse.json({ error: 'A valid ticket context_version is required.' }, { status: 400 });
  }
  const isInternalNote = body.is_internal_note === true;
  try {
    const control = await holdAutomationForManualReply(id, session.brandId);
    if (control.running) return NextResponse.json({ error: 'Automation is stopping. Inspect its action receipts before sending a manual reply.' }, { status: 409 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not take control of this ticket.' }, { status: 503 });
  }
  const isAgentReply = !isInternalNote;
  if (isAgentReply && !ticket.customer_email) {
    return NextResponse.json({ error: 'This ticket has no customer email. Add an internal note instead.' }, { status: 400 });
  }

  const generationId = typeof body.generation_id === 'string' ? body.generation_id : null;
  const messageId = requestIdempotencyKey;
  const requestHash = createHash('sha256').update(JSON.stringify({
    content: body.content.trim(),
    content_html: typeof body.content_html === 'string' ? body.content_html : null,
    is_internal_note: isInternalNote,
    generation_id: generationId,
    set_status: typeof body.set_status === 'string' ? body.set_status : null,
    attachments: Array.isArray(body.attachments) ? body.attachments : [],
  })).digest('hex');
  const { data: existingSend } = await supabase
    .from('ticket_messages')
    .select('id')
    .eq('id', messageId)
    .eq('ticket_id', id)
    .maybeSingle();
  if (generationId && isAgentReply && ticket.customer_email && !existingSend) {
    const { data: generationEvidence, error: generationEvidenceError } = await supabase
      .from('autopilot_draft_generations')
      .select('evidence')
      .eq('id', generationId)
      .eq('brand_id', session.brandId)
      .eq('ticket_id', id)
      .maybeSingle();
    if (generationEvidenceError) {
      return NextResponse.json({ error: 'Draft evidence could not be validated. Apply migration 012 and retry.' }, { status: 503 });
    }
    const evidence = ((generationEvidence?.evidence as Record<string, unknown> | null)?.shopify_orders ?? null) as Record<string, unknown> | null;
    if (!generationEvidence || !evidence || typeof evidence.hash !== 'string'
        || evidence.projection_version !== SHOPIFY_SUPPORT_EVIDENCE_PROJECTION) {
      return NextResponse.json({
        error: 'This draft predates complete Shopify evidence fencing. Generate a fresh AI draft before sending.',
      }, { status: 409 });
    }
    const validUntil = typeof evidence.valid_until === 'string'
      ? new Date(evidence.valid_until).getTime()
      : Number.NaN;
    if (!Number.isFinite(validUntil) || validUntil <= Date.now()) {
      return NextResponse.json({
        error: 'This AI draft has expired. Generate a fresh draft so Shopify, knowledge, and learning context are current.',
      }, { status: 409 });
    }
    try {
      const [currentCustomer, currentOrders] = await Promise.all([
        getCustomerByEmail(ticket.customer_email, session.brandSlug),
        getCustomerOrders(ticket.customer_email, 5, session.brandSlug),
      ]);
      if (shopifySupportEvidenceHash(currentCustomer, currentOrders) !== evidence.hash
          || currentOrders.length !== Number(evidence.order_count)
          || (currentCustomer !== null) !== (evidence.customer_present === true)) {
        return NextResponse.json({
          error: 'Shopify customer or order state changed after this draft was generated. Generate a fresh AI draft before sending.',
        }, { status: 409 });
      }
    } catch (error) {
      return NextResponse.json({
        error: `Live Shopify evidence could not be revalidated: ${error instanceof Error ? error.message : 'unknown error'}`,
      }, { status: 503 });
    }
  }
  const manualReviewEvent = generationId && isAgentReply
    ? await buildManualDraftReviewEvent({
        brandId: session.brandId,
        ticketId: id,
        generationId,
        messageId,
        finalText: body.content.trim(),
        expectedContextVersion,
        actor: { id: session.userId, name: session.name, role: session.role },
      })
    : null;
  if (generationId && isAgentReply && !manualReviewEvent) {
    return NextResponse.json({
      error: 'This AI draft lineage is stale or was already used. Regenerate the draft or edit the reply manually.',
    }, { status: 409 });
  }
  const verifiedGenerationId = manualReviewEvent ? generationId : null;

  const ticketUpdates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  // Customer-facing workflow state is committed only after the email provider
  // confirms delivery. Internal notes have no external side effect.
  if (body.set_status && isInternalNote) {
    ticketUpdates.status = body.set_status;
    if (body.set_status === 'resolved') ticketUpdates.resolved_at = new Date().toISOString();
    if (body.set_status === 'closed') ticketUpdates.closed_at = new Date().toISOString();
  }
  const messageInput = {
    id: messageId,
    ticket_id: id,
    sender_type: 'agent',
    sender_name: session.name,
    sender_email: session.email,
    content: body.content.trim(),
    content_html: typeof body.content_html === 'string' ? body.content_html : null,
    is_internal_note: isInternalNote,
    ai_generated: Boolean(verifiedGenerationId),
    attachments: Array.isArray(body.attachments) ? body.attachments : [],
    metadata: {
      request_id: requestIdempotencyKey,
      request_hash: requestHash,
      request_context_version: expectedContextVersion,
      requested_status: typeof body.set_status === 'string' ? body.set_status : null,
      ...(isAgentReply ? { email_status: 'sending', email_sending_at: new Date().toISOString() } : {}),
      ...(verifiedGenerationId ? { generation_id: verifiedGenerationId, via: 'ticket_composer_ai' } : {}),
    },
  };
  const prepared = await supabase.rpc('prepare_manual_ticket_message', {
    p_ticket_id: id,
    p_brand_id: session.brandId,
    p_expected_context_version: expectedContextVersion,
    p_message: messageInput,
    p_ticket_updates: ticketUpdates,
    p_generation_id: verifiedGenerationId,
    p_learning_event: manualReviewEvent,
    p_actor_id: session.userId ?? null,
  });
  if (prepared.error) {
    const migrationMissing = prepared.error.code === 'PGRST202'
      || prepared.error.message.includes('Could not find the function')
      || prepared.error.message.includes('does not exist');
    return NextResponse.json({
      error: migrationMissing
        ? 'Safe ticket sending requires database migration 012 before this version can run.'
        : prepared.error.message,
    }, { status: migrationMissing ? 503 : 409 });
  }
  const preparedPayload = (prepared.data ?? {}) as Record<string, unknown>;
  let message = preparedPayload.message as Record<string, unknown> | undefined;
  let updatedTicket = preparedPayload.ticket as Ticket | undefined;
  if (!message || !updatedTicket) {
    return NextResponse.json({ error: 'Atomic message preparation returned an invalid result' }, { status: 500 });
  }
  const supersededPlanId = typeof preparedPayload.superseded_plan_id === 'string'
    ? preparedPayload.superseded_plan_id
    : null;
  const replayed = preparedPayload.replayed === true;
  const reviewLearningCaptured = preparedPayload.learning_captured === true;

  // Send email to customer for agent replies (not internal notes)
  // Must await — Vercel terminates serverless functions after response is sent
  let emailError: string | null = null;
  let emailDelivered = false;
  let deliveryStatusApplied = false;
  let deliveryStatusWarning: string | null = null;
  let providerMessageId: string | null = typeof message.email_message_id === 'string'
    ? message.email_message_id
    : null;
  const existingMessageMetadata = (message.metadata ?? {}) as Record<string, unknown>;
  const emailSendingAt = typeof existingMessageMetadata.email_sending_at === 'string'
    ? new Date(existingMessageMetadata.email_sending_at).getTime()
    : 0;
  if (isAgentReply && replayed && existingMessageMetadata.email_status === 'sending'
      && emailSendingAt > Date.now() - 2 * 60 * 1000) {
    return NextResponse.json({
      message,
      ticket: updatedTicket,
      learning_captured: reviewLearningCaptured,
      replayed: true,
      delivery_pending: true,
    }, { status: 202 });
  }
  if (isAgentReply && replayed && existingMessageMetadata.email_status === 'sent') {
    emailDelivered = true;
  } else if (isAgentReply && ticket.customer_email) {
    try {
      // Get the first customer message for quoting and the latest email_message_id for threading
      const { data: customerMsgs } = await supabase
        .from('ticket_messages')
        .select('content, email_message_id, metadata')
        .eq('ticket_id', id)
        .eq('sender_type', 'customer')
        .order('created_at', { ascending: false })
        .limit(1);

      const latestCustomerMsg = customerMsgs?.[0];
      const inReplyToId = latestCustomerMsg?.email_message_id
        || (latestCustomerMsg?.metadata as Record<string, unknown>)?.email_message_id as string
        || undefined;

      const result = await sendTicketReplyEmail({
        to: ticket.customer_email,
        customerName: ticket.customer_name || undefined,
        ticketNumber: ticket.ticket_number,
        subject: ticket.subject,
        replyContent: body.content,
        agentName: session.name || undefined,
        brandName: session.brandName || undefined,
        brandSlug: session.brandSlug || undefined,
        inReplyToMessageId: inReplyToId,
        originalMessage: latestCustomerMsg?.content?.slice(0, 1000) || undefined,
        idempotencyKey: `ticket-message-${messageId}`,
      });
      providerMessageId = result.messageId ?? providerMessageId;
      if (result.error) {
        emailError = result.error;
        console.error('[ticket-reply] Email error:', result.error);
      } else {
        emailDelivered = true;
      }
    } catch (err) {
      emailError = err instanceof Error ? err.message : 'Email send failed';
      console.error('[ticket-reply] Email send failed:', err);
    }

    // A reply that never reached the customer must not look like a success —
    // flag the message row and tell the UI so the agent sees it immediately.
    if (emailError) {
      await supabase
        .from('ticket_messages')
        .update({
          metadata: {
            ...existingMessageMetadata,
            email_status: 'failed',
            email_sending_at: null,
            email_error: emailError,
            ...(verifiedGenerationId ? { generation_id: verifiedGenerationId, via: 'ticket_composer_ai' } : {}),
          },
        })
        .eq('id', messageId);
    }
  }

  // "Send & Resolve" resolves through this route — trigger the CSAT ask here too.
  if (isAgentReply && emailDelivered) {
    const finalized = await supabase.rpc('finalize_manual_ticket_message_delivery', {
      p_ticket_id: id,
      p_brand_id: session.brandId,
      p_message_id: messageId,
      p_requested_status: typeof body.set_status === 'string' ? body.set_status : null,
      p_provider_message_id: providerMessageId,
      p_actor_id: session.userId ?? null,
    });
    if (finalized.error) {
      deliveryStatusWarning = `The email was delivered, but ticket state finalization failed: ${finalized.error.message}`;
      console.error('[ticket-reply] Delivery finalization failed:', finalized.error.message);
    } else {
      const finalizedPayload = (finalized.data ?? {}) as Record<string, unknown>;
      if (finalizedPayload.message && typeof finalizedPayload.message === 'object') {
        message = finalizedPayload.message as Record<string, unknown>;
      }
      if (finalizedPayload.ticket && typeof finalizedPayload.ticket === 'object') {
        updatedTicket = finalizedPayload.ticket as Ticket;
      }
      deliveryStatusApplied = finalizedPayload.status_applied === true;
      if (finalizedPayload.context_conflict === true && body.set_status) {
        deliveryStatusWarning = 'The email was delivered, but the ticket changed before its requested status could be applied.';
      }
    }
  }

  const executionLearningCaptured = Boolean(verifiedGenerationId && isAgentReply && await recordManualDraftExecutionOutcome({
    brandId: session.brandId,
    ticketId: id,
    generationId: verifiedGenerationId,
    messageId,
    delivered: emailDelivered,
    error: emailError,
    actor: { id: session.userId, name: session.name, role: session.role },
  }));

  // Ask for CSAT only after delivery, resolution, and the immediate execution
  // episode are durable. The signed request binds any later rating to this
  // exact draft/message instead of whichever plan happens to be current then.
  if (body.set_status === 'resolved' && deliveryStatusApplied && updatedTicket) {
    const meta = await maybeSendCsatRequest(updatedTicket, session, {
      lineage: verifiedGenerationId
        ? { kind: 'manual_draft', generation_id: verifiedGenerationId, message_id: messageId }
        : { kind: 'manual_message', message_id: messageId },
    });
    if (meta) updatedTicket.metadata = meta;
  }

  return NextResponse.json(
    {
      message,
      ticket: updatedTicket,
      learning_captured: reviewLearningCaptured,
      execution_learning_captured: executionLearningCaptured,
      replayed,
      ...(supersededPlanId ? { superseded_plan_id: supersededPlanId } : {}),
      ...(emailError ? { email_error: emailError } : {}),
      ...(deliveryStatusWarning ? { status_warning: deliveryStatusWarning } : {}),
    },
    { status: replayed ? 200 : 201 }
  );
}
