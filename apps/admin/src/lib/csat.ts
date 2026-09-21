import { randomUUID } from 'crypto';
import { supabase } from './supabase';
import {
  csatTokenExpiry,
  sendCsatRequestEmail,
  type CsatOutcomeLineage,
  type CsatRequestClaims,
} from './email';
import type { JWTPayload } from './auth';
import type { AutopilotPlan } from './types';

interface CsatTicket {
  id: string;
  brand_id: string;
  ticket_number: number;
  subject: string;
  source: string;
  customer_email: string | null;
  customer_name: string | null;
  metadata: Record<string, unknown> | null;
  resolved_at?: string | null;
}

type CsatLineageHint = Extract<
  CsatOutcomeLineage,
  { kind: 'manual_draft' | 'manual_message' }
>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function finiteConfidence(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 1 ? number : undefined;
}

function validStoredLineage(value: unknown): value is CsatOutcomeLineage {
  if (!value || typeof value !== 'object') return false;
  const lineage = value as Record<string, unknown>;
  switch (lineage.kind) {
    case 'autopilot_plan':
      return typeof lineage.plan_id === 'string' && UUID_PATTERN.test(lineage.plan_id)
        && Number.isInteger(lineage.plan_revision) && Number(lineage.plan_revision) >= 0
        && typeof lineage.execution_attempt_id === 'string' && UUID_PATTERN.test(lineage.execution_attempt_id)
        && typeof lineage.resolution_action_id === 'string' && UUID_PATTERN.test(lineage.resolution_action_id)
        && (lineage.reply_action_id === undefined
          || (typeof lineage.reply_action_id === 'string' && UUID_PATTERN.test(lineage.reply_action_id)));
    case 'manual_draft':
      return typeof lineage.generation_id === 'string' && UUID_PATTERN.test(lineage.generation_id)
        && typeof lineage.message_id === 'string' && UUID_PATTERN.test(lineage.message_id);
    case 'manual_message':
      return typeof lineage.message_id === 'string' && UUID_PATTERN.test(lineage.message_id);
    case 'manual_resolution':
      return true;
    default:
      return false;
  }
}

function storedCsatRequest(
  value: unknown,
  ticketId: string,
  brandId: string,
): CsatRequestClaims | null {
  if (!value || typeof value !== 'object') return null;
  const request = value as Partial<CsatRequestClaims>;
  if (request.version !== 2
      || typeof request.request_id !== 'string' || !UUID_PATTERN.test(request.request_id)
      || request.ticket_id !== ticketId
      || request.brand_id !== brandId
      || !Number.isFinite(request.issued_at)
      || !Number.isFinite(request.expires_at)
      || Number(request.expires_at) <= Number(request.issued_at)
      || Number(request.expires_at) - Number(request.issued_at) > 15 * 24 * 60 * 60 * 1000
      || !validStoredLineage(request.lineage)) return null;
  return request as CsatRequestClaims;
}

function autopilotLineage(ticket: CsatTicket): CsatOutcomeLineage | null {
  const plan = ticket.metadata?.autopilot as AutopilotPlan | undefined;
  if (!plan?.id || !plan.execution_attempt_id || !['executing', 'executed', 'partially_executed'].includes(plan.status)) {
    return null;
  }
  const resolution = plan.actions.find((action) => action.type === 'resolve'
    && action.status !== 'skipped' && action.status !== 'failed');
  if (!resolution) return null;

  // An old terminal plan left on the ticket must not receive credit for a later
  // manual resolution. During execution the resolve action is still "approved";
  // after execution require the terminal timestamps to describe the same run.
  if (plan.status !== 'executing') {
    if (resolution.status !== 'executed' || !plan.executed_at || !ticket.resolved_at) return null;
    const resolutionDistance = Math.abs(new Date(plan.executed_at).getTime() - new Date(ticket.resolved_at).getTime());
    if (!Number.isFinite(resolutionDistance) || resolutionDistance > 5 * 60 * 1000) return null;
  }

  const reply = plan.actions.find((action) => action.type === 'send_reply'
    && action.status !== 'skipped' && action.status !== 'failed');
  return {
    kind: 'autopilot_plan',
    plan_id: plan.id,
    plan_revision: plan.revision ?? plan.revision_count ?? 0,
    execution_attempt_id: plan.execution_attempt_id,
    resolution_action_id: resolution.id,
    ...(reply ? { reply_action_id: reply.id } : {}),
    model_overall_confidence: finiteConfidence(plan.analysis.model_confidence ?? plan.analysis.overall_confidence),
    resolution_model_confidence: finiteConfidence(resolution.model_confidence ?? resolution.confidence),
    ...(reply ? { reply_model_confidence: finiteConfidence(reply.model_confidence ?? reply.confidence) } : {}),
  };
}

async function resolveCsatLineage(
  ticket: CsatTicket,
  hint?: CsatLineageHint,
): Promise<CsatOutcomeLineage> {
  if (hint && !validStoredLineage(hint)) {
    console.warn('[csat] ignored malformed lineage hint');
    return { kind: 'manual_resolution' };
  }
  if (hint?.kind === 'manual_draft') {
    const { data: generation } = await supabase
      .from('autopilot_draft_generations')
      .select('id, final_message_id, raw_confidence')
      .eq('id', hint.generation_id)
      .eq('brand_id', ticket.brand_id)
      .eq('ticket_id', ticket.id)
      .eq('final_message_id', hint.message_id)
      .maybeSingle();
    if (!generation) {
      console.warn('[csat] rejected invalid manual draft lineage; recording the resolution without AI attribution');
      return { kind: 'manual_message', message_id: hint.message_id };
    }
    return {
      ...hint,
      model_confidence: finiteConfidence(generation.raw_confidence) ?? hint.model_confidence,
    };
  }
  if (hint?.kind === 'manual_message') {
    const { data: message } = await supabase
      .from('ticket_messages')
      .select('id')
      .eq('id', hint.message_id)
      .eq('ticket_id', ticket.id)
      .eq('sender_type', 'agent')
      .eq('is_internal_note', false)
      .maybeSingle();
    if (message) return hint;
    console.warn('[csat] rejected invalid manual message lineage');
    return { kind: 'manual_resolution' };
  }
  return autopilotLineage(ticket) ?? { kind: 'manual_resolution' };
}

async function claimCsatSend(
  ticket: CsatTicket,
  proposedRequest: CsatRequestClaims,
): Promise<CsatRequestClaims | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: current } = await supabase
      .from('tickets')
      .select('metadata, updated_at')
      .eq('id', ticket.id)
      .eq('brand_id', ticket.brand_id)
      .single();
    if (!current) return null;
    const metadata = { ...((current.metadata as Record<string, unknown> | null) || {}) };
    if (metadata.csat_sent_at) return null;
    const sendingAt = typeof metadata.csat_sending_at === 'string'
      ? new Date(metadata.csat_sending_at).getTime()
      : 0;
    if (sendingAt > Date.now() - 10 * 60 * 1000) return null;
    const existingRequest = storedCsatRequest(metadata.csat_request, ticket.id, ticket.brand_id);
    const request = existingRequest && existingRequest.expires_at > Date.now()
      ? existingRequest
      : proposedRequest;
    metadata.csat_request = request;
    metadata.csat_sending_at = new Date().toISOString();
    const { data: claimed } = await supabase
      .from('tickets')
      .update({ metadata, updated_at: new Date().toISOString() })
      .eq('id', ticket.id)
      .eq('brand_id', ticket.brand_id)
      .eq('updated_at', current.updated_at)
      .select('id')
      .maybeSingle();
    if (claimed) return request;
  }
  return null;
}

async function finishCsatSend(
  ticketId: string,
  brandId: string,
  requestId: string,
  sent: boolean,
  error?: string,
  messageId?: string,
): Promise<Record<string, unknown> | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: current } = await supabase
      .from('tickets')
      .select('metadata, updated_at')
      .eq('id', ticketId)
      .eq('brand_id', brandId)
      .single();
    if (!current) return null;
    const metadata = { ...((current.metadata as Record<string, unknown> | null) || {}) };
    const request = storedCsatRequest(metadata.csat_request, ticketId, brandId);
    if (!request || request.request_id !== requestId) return null;
    delete metadata.csat_sending_at;
    if (sent) {
      metadata.csat_sent_at = new Date().toISOString();
      metadata.csat_message_id = messageId ?? null;
      delete metadata.csat_last_error_at;
      delete metadata.csat_last_error;
    }
    else {
      metadata.csat_last_error_at = new Date().toISOString();
      metadata.csat_last_error = error?.slice(0, 300) || 'Email send failed';
    }
    const { data: updated } = await supabase
      .from('tickets')
      .update({ metadata, updated_at: new Date().toISOString() })
      .eq('id', ticketId)
      .eq('brand_id', brandId)
      .eq('updated_at', current.updated_at)
      .select('id')
      .maybeSingle();
    if (updated) return sent ? metadata : null;
  }
  return null;
}

/**
 * Send the confirmation-gated CSAT rating email for a freshly resolved ticket — once
 * per ticket, skippable per brand via brands.settings.csat_enabled = false.
 * Called from every resolve path (status PATCH and "Send & Resolve").
 * Returns the updated metadata when an email went out, null otherwise.
 */
export async function maybeSendCsatRequest(
  ticket: CsatTicket,
  session: JWTPayload,
  options?: { lineage?: CsatLineageHint; signal?: AbortSignal },
): Promise<Record<string, unknown> | null> {
  if (!ticket.customer_email) return null;
  if (ticket.metadata?.csat_sent_at) return null;
  if (ticket.brand_id !== session.brandId) {
    console.error('[csat] refused to send a survey across brand boundaries');
    return null;
  }
  if (ticket.source === 'ai_escalation') return null; // resolved inside chat — no email survey

  let claimedRequest: CsatRequestClaims | null = null;
  try {
    const { data: brand } = await supabase
      .from('brands')
      .select('settings')
      .eq('id', session.brandId)
      .single();
    if ((brand?.settings as Record<string, unknown> | null)?.csat_enabled === false) return null;
    const issuedAt = Date.now();
    const lineage = await resolveCsatLineage(ticket, options?.lineage);
    claimedRequest = await claimCsatSend(ticket, {
      version: 2,
      request_id: randomUUID(),
      ticket_id: ticket.id,
      brand_id: ticket.brand_id,
      issued_at: issuedAt,
      expires_at: csatTokenExpiry(issuedAt),
      lineage,
    });
    if (!claimedRequest) return null;

    const result = await sendCsatRequestEmail({
      to: ticket.customer_email,
      customerName: ticket.customer_name || undefined,
      ticketNumber: ticket.ticket_number,
      subject: ticket.subject,
      brandName: session.brandName,
      brandSlug: session.brandSlug,
      request: claimedRequest,
      signal: options?.signal,
    });
    if (result.error) {
      console.error('[csat] send failed:', result.error);
      await finishCsatSend(ticket.id, ticket.brand_id, claimedRequest.request_id, false, result.error);
      return null;
    }

    return await finishCsatSend(
      ticket.id,
      ticket.brand_id,
      claimedRequest.request_id,
      true,
      undefined,
      result.messageId,
    );
  } catch (err) {
    console.error('[csat] error:', err);
    if (claimedRequest) {
      await finishCsatSend(
        ticket.id,
        ticket.brand_id,
        claimedRequest.request_id,
        false,
        err instanceof Error ? err.message : String(err),
      ).catch(() => null);
    }
    return null;
  }
}
