import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  DISPUTE_OS_HOLD_CATEGORY,
  DISPUTE_OS_HOLD_CLASSIFICATION,
  DISPUTE_OS_HOLD_TAG,
  LEGACY_DISPUTE_OS_HOLD_CATEGORY,
  escapeLikePattern,
  getDisputeOsBrandId,
  hasDisputeOsHoldMarker,
  isDisputeOsHoldTicket,
  isSameEmail,
  resolveDisputeOsHoldEventTarget,
} from './dispute-os-policy.js';

const MISU = getDisputeOsBrandId();
const OTHER_BRAND = '883e4a28-9f2e-4850-a527-29f297d8b6f8';

// A hold ticket exactly as the webhook now creates it.
const holdTicket = {
  brand_id: MISU,
  category: DISPUTE_OS_HOLD_CATEGORY,
  classification: DISPUTE_OS_HOLD_CLASSIFICATION,
  tags: ['dispute-os', DISPUTE_OS_HOLD_TAG],
};

test('a hold ticket is stored with a category the tickets table accepts', () => {
  // The only migration that defines the tickets.category CHECK constraint.
  const relativeMigration = 'supabase/migrations/20260310032324_create_ticket_system_tables.sql';
  const migrationPath = [
    path.resolve(process.cwd(), relativeMigration),
    path.resolve(process.cwd(), '../..', relativeMigration),
  ].find(existsSync);
  assert.ok(migrationPath, 'ticket system migration must exist');
  const check = readFileSync(migrationPath, 'utf8').match(/category text CHECK \(category IN \(([^)]*)\)\)/);
  assert.ok(check, 'tickets.category CHECK must be defined');
  const allowed = [...check[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);

  assert.equal(allowed.includes(DISPUTE_OS_HOLD_CATEGORY), true);
  assert.equal(allowed.includes(LEGACY_DISPUTE_OS_HOLD_CATEGORY), false);
});

test('the hold marker is the tag, with the classification and the legacy category still recognised', () => {
  assert.equal(hasDisputeOsHoldMarker(holdTicket), true);
  assert.equal(hasDisputeOsHoldMarker({ tags: [DISPUTE_OS_HOLD_TAG], category: 'other', classification: null }), true);
  // An agent removed the tag: the classification still identifies the ticket.
  assert.equal(hasDisputeOsHoldMarker({ tags: [], category: 'other', classification: 'dispute_hold' }), true);
  // A row written by the first version of the integration.
  assert.equal(hasDisputeOsHoldMarker({ tags: null, category: 'dispute_hold', classification: null }), true);
});

test('ordinary tickets do not carry the hold marker', () => {
  assert.equal(hasDisputeOsHoldMarker({ tags: ['dispute-os'], category: 'other', classification: 'customer_support' }), false);
  assert.equal(hasDisputeOsHoldMarker({ tags: ['chargeback', 'needs-human'], category: 'billing', classification: 'customer_support' }), false);
  assert.equal(hasDisputeOsHoldMarker({ tags: null, category: null, classification: null }), false);
  assert.equal(hasDisputeOsHoldMarker({}), false);
  assert.equal(hasDisputeOsHoldMarker(null), false);
});

test('Autopilot skips a marked ticket of the Dispute OS brand and nothing else', () => {
  assert.equal(isDisputeOsHoldTicket(holdTicket), true);
  // The sweep row has no category column.
  assert.equal(isDisputeOsHoldTicket({ brand_id: MISU, classification: 'dispute_hold', tags: [] }), true);

  // Another brand is never affected, even when a public form supplied the tag.
  assert.equal(isDisputeOsHoldTicket({ ...holdTicket, brand_id: OTHER_BRAND }), false);
  assert.equal(isDisputeOsHoldTicket({ ...holdTicket, brand_id: undefined }), false);
  // An ordinary ticket of the Dispute OS brand is still planned.
  assert.equal(isDisputeOsHoldTicket({ brand_id: MISU, category: 'shipping', classification: 'customer_support', tags: ['vip'] }), false);
  assert.equal(isDisputeOsHoldTicket({ brand_id: MISU, category: null, classification: 'promotional', tags: [] }), false);
  assert.equal(isDisputeOsHoldTicket(null), false);
});

test('the Dispute OS brand follows DISPUTE_OS_BRAND_ID', () => {
  const previous = process.env.DISPUTE_OS_BRAND_ID;
  try {
    process.env.DISPUTE_OS_BRAND_ID = ` ${OTHER_BRAND} `;
    assert.equal(getDisputeOsBrandId(), OTHER_BRAND);
    assert.equal(isDisputeOsHoldTicket({ ...holdTicket, brand_id: OTHER_BRAND }), true);
    assert.equal(isDisputeOsHoldTicket(holdTicket), false);
  } finally {
    if (previous === undefined) delete process.env.DISPUTE_OS_BRAND_ID;
    else process.env.DISPUTE_OS_BRAND_ID = previous;
  }
});

test('LIKE wildcards in a caller-supplied email are escaped', () => {
  assert.equal(escapeLikePattern('jane@example.com'), 'jane@example.com');
  assert.equal(escapeLikePattern('a_b@example.com'), 'a\\_b@example.com');
  assert.equal(escapeLikePattern('%@example.com'), '\\%@example.com');
  assert.equal(escapeLikePattern('a\\b@example.com'), 'a\\\\b@example.com');
  assert.equal(escapeLikePattern('50%_off\\@example.com'), '50\\%\\_off\\\\@example.com');
});

test('an email lookup only keeps rows for exactly that address', () => {
  assert.equal(isSameEmail('Jane@Example.com', 'jane@example.com'), true);
  assert.equal(isSameEmail(' jane@example.com ', 'jane@example.com'), true);
  // What an unescaped `_`, `%` or PostgREST `*` would also have matched.
  assert.equal(isSameEmail('acb@example.com', 'a_b@example.com'), false);
  assert.equal(isSameEmail('someone@example.com', '%@example.com'), false);
  assert.equal(isSameEmail('someone@example.com', '*@example.com'), false);
  assert.equal(isSameEmail(null, 'jane@example.com'), false);
  assert.equal(isSameEmail(undefined, 'jane@example.com'), false);
});

const HELD = 'Dispute OS event: dispute_os.order_held_for_verification\nOrder: #1350 (gid://shopify/Order/1)\nRisk level: MEDIUM';
const HELD_HIGH = 'Dispute OS event: dispute_os.order_held_for_verification\nOrder: #1350 (gid://shopify/Order/1)\nRisk level: HIGH';
const NEEDS_OPERATOR = 'Dispute OS event: dispute_os.needs_operator\nOrder: #1350 (gid://shopify/Order/1)\nRisk level: MEDIUM';

test('the first hold event for an order creates a ticket', () => {
  assert.deepEqual(
    resolveDisputeOsHoldEventTarget({ holdTickets: [], notes: [], noteContent: HELD }),
    { action: 'create' },
  );
});

test('a repeated event on an open hold ticket changes nothing', () => {
  const open = { id: 't1', status: 'open' };
  assert.deepEqual(
    resolveDisputeOsHoldEventTarget({
      holdTickets: [open],
      notes: [{ ticket_id: 't1', content: HELD }],
      noteContent: HELD,
    }),
    { action: 'ignore_repeat', ticket: open },
  );
});

test('a repeated event does not open a second ticket after the first was resolved or closed', () => {
  for (const status of ['resolved', 'closed']) {
    const done = { id: 't1', status };
    assert.deepEqual(
      resolveDisputeOsHoldEventTarget({
        holdTickets: [done],
        notes: [{ ticket_id: 't1', content: HELD }],
        noteContent: HELD,
      }),
      { action: 'ignore_repeat', ticket: done },
    );
  }
});

test('a different event for the order is appended to the active hold ticket', () => {
  const open = { id: 't1', status: 'pending' };
  for (const noteContent of [NEEDS_OPERATOR, HELD_HIGH]) {
    assert.deepEqual(
      resolveDisputeOsHoldEventTarget({
        holdTickets: [open],
        notes: [{ ticket_id: 't1', content: HELD }],
        noteContent,
      }),
      { action: 'append', ticket: open },
    );
  }
});

test('a different event still opens a ticket when no hold ticket is active', () => {
  assert.deepEqual(
    resolveDisputeOsHoldEventTarget({
      holdTickets: [{ id: 't1', status: 'resolved' }],
      notes: [{ ticket_id: 't1', content: HELD }],
      noteContent: NEEDS_OPERATOR,
    }),
    { action: 'create' },
  );
});

test('an event recorded on an older ticket is a repeat even while a newer ticket is active', () => {
  const active = { id: 't2', status: 'open' };
  const resolved = { id: 't1', status: 'resolved' };
  assert.deepEqual(
    resolveDisputeOsHoldEventTarget({
      holdTickets: [active, resolved],
      notes: [
        { ticket_id: 't1', content: HELD },
        { ticket_id: 't2', content: NEEDS_OPERATOR },
      ],
      noteContent: HELD,
    }),
    { action: 'ignore_repeat', ticket: resolved },
  );
});

test('a hold ticket whose note was never written still receives the event', () => {
  const open = { id: 't1', status: 'open' };
  assert.deepEqual(
    resolveDisputeOsHoldEventTarget({ holdTickets: [open], notes: [], noteContent: HELD }),
    { action: 'append', ticket: open },
  );
  // Notes of unrelated tickets are not evidence of a repeat.
  assert.deepEqual(
    resolveDisputeOsHoldEventTarget({
      holdTickets: [open],
      notes: [{ ticket_id: 'other', content: HELD }],
      noteContent: HELD,
    }),
    { action: 'append', ticket: open },
  );
});
