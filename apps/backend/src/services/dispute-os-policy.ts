/**
 * Shared rules for the Dispute OS (Misu) integration.
 *
 * A hold ticket is an operator work item raised by Dispute OS, not a customer
 * contact. The hold webhook, the evidence read it serves, and Autopilot all
 * have to recognise one, so the marker is defined once here.
 */

const MISU_DEFAULT_BRAND_ID = 'bfef87c0-0838-451f-9b84-9ae04ad1c20a';

/** Canonical marker: every hold ticket is created with this tag. */
export const DISPUTE_OS_HOLD_TAG = 'dispute-os-hold';

/** Still written on new hold tickets. No other writer uses this value. */
export const DISPUTE_OS_HOLD_CLASSIFICATION = 'dispute_hold';

/**
 * `tickets.category` is CHECK-constrained to support topics, so a hold ticket
 * is stored as `other`. The first version of the integration wrote
 * `dispute_hold` there; that value stays recognised for any row stored with it.
 */
export const DISPUTE_OS_HOLD_CATEGORY = 'other';
export const LEGACY_DISPUTE_OS_HOLD_CATEGORY = 'dispute_hold';

export function getDisputeOsBrandId(): string {
  return (process.env.DISPUTE_OS_BRAND_ID || MISU_DEFAULT_BRAND_ID).trim();
}

export interface DisputeOsHoldMarkerFields {
  tags?: unknown;
  classification?: unknown;
  category?: unknown;
}

/**
 * True when a ticket row carries the hold marker. Callers must already have
 * scoped the row to the Dispute OS brand.
 */
export function hasDisputeOsHoldMarker(ticket: DisputeOsHoldMarkerFields | null | undefined): boolean {
  if (!ticket) return false;
  const tags: unknown[] = Array.isArray(ticket.tags) ? ticket.tags : [];
  return tags.includes(DISPUTE_OS_HOLD_TAG)
    || ticket.classification === DISPUTE_OS_HOLD_CLASSIFICATION
    || ticket.category === LEGACY_DISPUTE_OS_HOLD_CATEGORY;
}

/**
 * True only for a marked ticket of the Dispute OS brand. Every ticket of any
 * other brand is false whatever its tags say, so brand-agnostic callers such
 * as Autopilot stay unchanged for them.
 */
export function isDisputeOsHoldTicket(
  ticket: (DisputeOsHoldMarkerFields & { brand_id?: unknown }) | null | undefined,
): boolean {
  return Boolean(ticket) && ticket?.brand_id === getDisputeOsBrandId() && hasDisputeOsHoldMarker(ticket);
}

/** Escape LIKE wildcards so a caller-supplied value can only match itself. */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

/**
 * PostgREST also reads `*` as `%` in like/ilike and has no escape for it, so
 * rows returned by a case-insensitive email lookup are re-checked in code.
 */
export function isSameEmail(candidate: unknown, normalizedEmail: string): boolean {
  return typeof candidate === 'string' && candidate.trim().toLowerCase() === normalizedEmail;
}

export interface DisputeOsHoldTicketRef {
  id: string;
  status: string;
}

export interface DisputeOsHoldNoteRef {
  ticket_id: unknown;
  content: unknown;
}

export type DisputeOsHoldEventTarget<T> =
  | { action: 'ignore_repeat'; ticket: T }
  | { action: 'append'; ticket: T }
  | { action: 'create' };

/**
 * Decide what a hold event does to the hold tickets that already exist for
 * its order (any status, newest first).
 *
 * Dispute OS can send the same event again after a restart and supplies no
 * event id. The internal note recorded for an event is built only from the
 * event's own fields, so a note with identical content on any hold ticket of
 * the order means this exact event was already recorded. It is then ignored,
 * also when that ticket has since been resolved or closed, instead of opening
 * a second ticket. An event that differs in any field is new information and
 * takes the normal path: appended to the active ticket, or a new ticket when
 * none is active.
 */
export function resolveDisputeOsHoldEventTarget<T extends DisputeOsHoldTicketRef>(input: {
  holdTickets: T[];
  notes: DisputeOsHoldNoteRef[];
  noteContent: string;
}): DisputeOsHoldEventTarget<T> {
  const recordedOn = new Set(
    input.notes
      .filter((note) => note.content === input.noteContent)
      .map((note) => String(note.ticket_id)),
  );
  const active = input.holdTickets.find((ticket) => ticket.status === 'open' || ticket.status === 'pending');
  const repeatOf = active && recordedOn.has(active.id)
    ? active
    : input.holdTickets.find((ticket) => recordedOn.has(ticket.id));
  if (repeatOf) return { action: 'ignore_repeat', ticket: repeatOf };
  return active ? { action: 'append', ticket: active } : { action: 'create' };
}
