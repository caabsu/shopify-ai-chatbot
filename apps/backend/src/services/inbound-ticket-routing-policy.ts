import { passesRelatedTicketCandidateGate } from './autopilot-action-policy.js';
import {
  assessTicketRelatedness,
  type CustomerTicketThread,
} from './customer-support-context.service.js';

export interface InboundIssue {
  subject: string;
  body: string;
  receivedAt: string;
}

/**
 * Choose one existing active thread only when deterministic same-case signals
 * agree. Customer identity is supplied by the caller and is never enough on
 * its own. This prevents an unthreaded follow-up from creating a second ticket
 * and therefore a second customer reply.
 */
export function selectSameIssueTicketCandidate(
  inbound: InboundIssue,
  candidates: CustomerTicketThread[],
): CustomerTicketThread | null {
  const synthetic: CustomerTicketThread = {
    id: 'inbound-message',
    ticket_number: 0,
    subject: inbound.subject,
    status: 'open',
    source: 'email',
    order_id: null,
    conversation_id: null,
    context_version: 0,
    created_at: inbound.receivedAt,
    updated_at: inbound.receivedAt,
    first_response_at: null,
    metadata: null,
    messages: [{
      id: 'inbound-message',
      ticket_id: 'inbound-message',
      sender_type: 'customer',
      sender_name: null,
      content: inbound.body,
      created_at: inbound.receivedAt,
      email_message_id: null,
      metadata: null,
    }],
    response_state: 'unanswered',
  };

  return candidates
    .filter((candidate) => candidate.status === 'open' || candidate.status === 'pending')
    .map((candidate) => ({
      candidate,
      relatedness: assessTicketRelatedness(synthetic, candidate),
    }))
    .filter(({ relatedness }) => passesRelatedTicketCandidateGate(relatedness))
    .sort((left, right) => (
      right.relatedness.score - left.relatedness.score
      || Date.parse(right.candidate.updated_at) - Date.parse(left.candidate.updated_at)
      || left.candidate.id.localeCompare(right.candidate.id)
    ))[0]?.candidate ?? null;
}
