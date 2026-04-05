// ── In-Memory Activity Event Log ─────────────────────────────────────────────
// Stores recent system events (webhook arrivals, email sends, review submissions)
// in a ring buffer. Resets on deploy — fine for debugging webhook connectivity.

const MAX_EVENTS = 500;

export interface ActivityEvent {
  id: number;
  timestamp: string;
  type: string;       // 'webhook.products' | 'webhook.orders' | 'email.sent' | 'email.failed' | 'review.submitted' | 'review.scheduled' | etc.
  status: 'success' | 'error' | 'info';
  summary: string;    // Human-readable one-liner
  details?: Record<string, unknown>;
}

let nextId = 1;
const events: ActivityEvent[] = [];

export function logEvent(
  type: string,
  status: 'success' | 'error' | 'info',
  summary: string,
  details?: Record<string, unknown>,
): void {
  const event: ActivityEvent = {
    id: nextId++,
    timestamp: new Date().toISOString(),
    type,
    status,
    summary,
    details,
  };
  events.unshift(event); // newest first
  if (events.length > MAX_EVENTS) events.length = MAX_EVENTS;
  console.log(`[activity] ${status.toUpperCase()} ${type}: ${summary}`);
}

export function getRecentEvents(limit = 100, typeFilter?: string): ActivityEvent[] {
  let filtered = events;
  if (typeFilter && typeFilter !== 'all') {
    filtered = events.filter((e) => e.type.startsWith(typeFilter));
  }
  return filtered.slice(0, limit);
}

export function getEventCounts(): Record<string, number> {
  const counts: Record<string, number> = { total: events.length };
  for (const e of events) {
    const category = e.type.split('.')[0];
    counts[category] = (counts[category] || 0) + 1;
    counts[`${e.status}`] = (counts[`${e.status}`] || 0) + 1;
  }
  return counts;
}
