/**
 * Input rules for the public `POST /api/tickets/escalate` route.
 *
 * Every accepted request creates a ticket and emails `customerEmail` from the
 * brand's sender with `reason` in the subject line, and the route has no
 * login. Each field is therefore checked and bounded before anything is
 * written or sent.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// One address only: no separators that could turn it into a list.
const EMAIL_PATTERN = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;
const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;

const MAX_EMAIL_LENGTH = 254;
const MAX_NAME_LENGTH = 200;
// The reason becomes the ticket subject and the email subject line.
const MAX_REASON_LENGTH = 300;
const MAX_SUMMARY_LENGTH = 5000;
const MAX_RECOMMENDED_ACTIONS = 10;
const MAX_RECOMMENDED_ACTION_LENGTH = 500;

export interface EscalationRequest {
  conversationId: string;
  customerEmail: string;
  customerName?: string;
  reason: string;
  priority?: (typeof PRIORITIES)[number];
  summary?: string;
  recommendedActions?: string[];
}

export type EscalationRequestResult =
  | { ok: true; value: EscalationRequest }
  | { ok: false; error: string };

function invalid(error: string): EscalationRequestResult {
  return { ok: false, error };
}

export function parseEscalationRequest(body: unknown): EscalationRequestResult {
  const input = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const { conversationId, customerEmail, customerName, reason, priority, summary, recommendedActions } = input;

  if (!conversationId || !customerEmail || !reason) {
    return invalid('conversationId, customerEmail, and reason are required');
  }

  if (typeof conversationId !== 'string' || !UUID_PATTERN.test(conversationId)) {
    return invalid('Invalid conversationId');
  }

  const email = typeof customerEmail === 'string' ? customerEmail.trim() : '';
  if (!email || email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email)) {
    return invalid('Invalid email address');
  }

  const reasonText = typeof reason === 'string' ? reason.trim() : '';
  if (!reasonText || reasonText.length > MAX_REASON_LENGTH || CONTROL_CHARACTER.test(reasonText)) {
    return invalid(`reason must be a single line of at most ${MAX_REASON_LENGTH} characters`);
  }

  if (customerName !== undefined && customerName !== null
      && (typeof customerName !== 'string'
        || customerName.length > MAX_NAME_LENGTH
        || CONTROL_CHARACTER.test(customerName))) {
    return invalid(`customerName must be a single line of at most ${MAX_NAME_LENGTH} characters`);
  }

  if (priority !== undefined && priority !== null
      && !PRIORITIES.includes(priority as (typeof PRIORITIES)[number])) {
    return invalid(`priority must be one of: ${PRIORITIES.join(', ')}`);
  }

  if (summary !== undefined && summary !== null
      && (typeof summary !== 'string' || summary.length > MAX_SUMMARY_LENGTH)) {
    return invalid(`summary must be text of at most ${MAX_SUMMARY_LENGTH} characters`);
  }

  if (recommendedActions !== undefined && recommendedActions !== null
      && (!Array.isArray(recommendedActions)
        || recommendedActions.length > MAX_RECOMMENDED_ACTIONS
        || recommendedActions.some((action) => (
          typeof action !== 'string' || action.length > MAX_RECOMMENDED_ACTION_LENGTH
        )))) {
    return invalid(`recommendedActions must be at most ${MAX_RECOMMENDED_ACTIONS} short text items`);
  }

  return {
    ok: true,
    value: {
      conversationId,
      customerEmail: email,
      customerName: typeof customerName === 'string' && customerName.trim() ? customerName.trim() : undefined,
      reason: reasonText,
      priority: (priority ?? undefined) as EscalationRequest['priority'],
      summary: typeof summary === 'string' ? summary : undefined,
      recommendedActions: Array.isArray(recommendedActions) ? (recommendedActions as string[]) : undefined,
    },
  };
}
