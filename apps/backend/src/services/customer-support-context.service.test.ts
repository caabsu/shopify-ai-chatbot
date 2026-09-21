import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CUSTOMER_HISTORY_PROJECTION,
  assessTicketRelatedness,
  customerHistoryHash,
  deriveChatResponseState,
  deriveTicketResponseState,
  formatCustomerSupportContext,
  isCustomerAcknowledgementOnly,
  newestUnquotedCustomerText,
  type CustomerSupportContextBundle,
  type CustomerTicketThread,
} from './customer-support-context.service.js';

const customerMessage = (id: string, at: string, content = 'Please cancel order #1025') => ({
  id, ticket_id: 'ticket-1', sender_type: 'customer' as const, sender_name: 'Sally', content,
  created_at: at, email_message_id: `<${id}@example.com>`, metadata: null,
});
const agentMessage = (id: string, at: string, status?: string) => ({
  id, ticket_id: 'ticket-1', sender_type: 'agent' as const, sender_name: 'Support', content: 'We are checking.',
  created_at: at, email_message_id: `<${id}@example.com>`, metadata: status ? { email_status: status } : null,
});

function ticket(overrides: Partial<CustomerTicketThread> = {}): CustomerTicketThread {
  return {
    id: 'ticket-1', ticket_number: 1001, subject: 'Cancel order #1025', status: 'open', source: 'email',
    order_id: null, conversation_id: null, context_version: 2, created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-02T00:00:00Z', first_response_at: null, metadata: { ai_triage: { intent: 'cancel_order' } },
    messages: [customerMessage('m1', '2026-07-01T00:00:00Z')], response_state: 'unanswered',
    ...overrides,
  };
}

function bundle(tickets: CustomerTicketThread[]): CustomerSupportContextBundle {
  const base: Omit<CustomerSupportContextBundle, 'hash'> = {
    projection_version: CUSTOMER_HISTORY_PROJECTION,
    brand_id: 'brand-1', normalized_email: 'sally@example.com', current_ticket_id: 'ticket-1',
    loaded_at: '2026-07-10T00:00:00Z', tickets, conversations: [],
    coverage: { ticket_count: tickets.length, conversation_count: 0, ticket_message_count: tickets.reduce((n, t) => n + t.messages.length, 0), conversation_message_count: 0, complete: true, source: 'direct' },
  };
  return { ...base, hash: customerHistoryHash(base) };
}

test('response state distinguishes never answered, awaiting us, awaiting customer, and failed sends', () => {
  const first = customerMessage('m1', '2026-07-01T00:00:00Z');
  const reply = agentMessage('m2', '2026-07-01T01:00:00Z');
  const followup = customerMessage('m3', '2026-07-01T02:00:00Z');
  assert.equal(deriveTicketResponseState('open', [first]), 'unanswered');
  assert.equal(deriveTicketResponseState('open', [first, reply]), 'awaiting_customer');
  assert.equal(deriveTicketResponseState('open', [first, reply, followup]), 'awaiting_us');
  assert.equal(deriveTicketResponseState('open', [first, agentMessage('m4', '2026-07-01T03:00:00Z', 'failed')]), 'unanswered');
  assert.equal(deriveTicketResponseState('open', [first, agentMessage('m5', '2026-07-01T03:00:00Z', 'sending')]), 'unanswered');
  assert.equal(deriveTicketResponseState('resolved', [first]), 'resolved');
  assert.equal(deriveChatResponseState('active', false, [{ role: 'user', created_at: '2026-07-01T00:00:00Z' }]), 'unanswered');
});

test('detects a quoted-email thank-you as acknowledgement-only', () => {
  const reply = [
    'I really appreciate the communication & email.',
    '',
    'Thank you.',
    'Chris',
    '',
    'On Sat, Jul 18, 2026 at 6:30 AM Support <support@example.com> wrote:',
    '> Please send photos of the damaged lamp and box.',
    '> Reply here if you still need a refund.',
  ].join('\n');
  assert.equal(
    newestUnquotedCustomerText(reply),
    'I really appreciate the communication & email.\n\nThank you.\nChris',
  );
  assert.equal(isCustomerAcknowledgementOnly(reply), true);
});

test('does not treat a thank-you containing a new request as acknowledgement-only', () => {
  assert.equal(
    isCustomerAcknowledgementOnly('Thank you for the update, but can you confirm my refund status?'),
    false,
  );
  assert.equal(
    isCustomerAcknowledgementOnly('Thanks. Please cancel order #1068.'),
    false,
  );
});

test('treats a signature-only follow-up as acknowledgement rather than a new request', () => {
  assert.equal(isCustomerAcknowledgementOnly('Orion Truver'), true);
  assert.equal(isCustomerAcknowledgementOnly('Order status'), false);
});

test('relatedness requires issue evidence; same-order tickets score highly while unrelated tickets do not', () => {
  const current = ticket();
  const sameOrder = ticket({ id: 'ticket-2', ticket_number: 1002, subject: 'Fwd: order #1025 shipping delay' });
  const unrelated = ticket({ id: 'ticket-3', ticket_number: 1003, subject: 'What bulb fits this lamp?', metadata: { ai_triage: { intent: 'product_question' } }, messages: [customerMessage('m9', '2026-07-03T00:00:00Z', 'What bulb should I buy?')] });
  assert.ok(assessTicketRelatedness(current, sameOrder).score >= 0.7);
  assert.ok(assessTicketRelatedness(current, unrelated).score < 0.2);
});

test('same-customer tracking follow-ups become reviewable candidates without merging distinct orders', () => {
  const original = ticket({
    subject: 'Re: #J7JTEVKQL',
    metadata: { ai_triage: { intent: 'order_status', summary: 'Second tracking update request.' } },
    messages: [customerMessage('m-track-1', '2026-07-17T17:04:52Z', 'Second attempt. Please provide a tracking update.')],
    created_at: '2026-07-17T17:04:52Z',
  });
  const followup = ticket({
    id: 'ticket-2',
    ticket_number: 1002,
    subject: 'Tracking',
    metadata: { ai_triage: { intent: 'order_status', summary: 'No confirmation or tracking received.' } },
    messages: [customerMessage('m-track-2', '2026-07-17T22:04:54Z', 'I have not received any tracking or response.')],
    created_at: '2026-07-17T22:04:54Z',
  });
  const related = assessTicketRelatedness(original, followup);
  assert.ok(related.score >= 0.7);
  assert.ok(related.basis.includes('same_topic_signal'));

  const differentOrder = ticket({
    id: 'ticket-3',
    ticket_number: 1003,
    subject: 'Tracking for order #DIFFERENT2',
    metadata: { ai_triage: { intent: 'order_status', summary: 'Tracking request.' } },
    messages: [customerMessage('m-track-3', '2026-07-17T22:04:54Z', 'Please track order #DIFFERENT2.')],
    created_at: '2026-07-17T22:04:54Z',
  });
  const conflicting = assessTicketRelatedness(original, differentOrder);
  assert.ok(conflicting.score < 0.7);
  assert.ok(conflicting.basis.includes('different_order_reference'));
});

test('infers order-status intent for duplicate follow-ups even when old triage metadata is absent', () => {
  const original = ticket({
    subject: 'Shipping an item soon?',
    messages: [customerMessage('m-status-1', '2026-08-17T19:19:52Z', 'When will the lamp I ordered be shipped?')],
    created_at: '2026-08-17T19:19:52Z',
  });
  const followup = ticket({
    id: 'ticket-2',
    ticket_number: 1002,
    subject: 'Order number 1025',
    messages: [customerMessage('m-status-2', '2026-08-17T19:25:09Z', 'Order #1025. Could you check when it will be shipped?')],
    created_at: '2026-08-17T19:25:09Z',
  });
  const related = assessTicketRelatedness(original, followup);
  assert.ok(related.score >= 0.7);
  assert.ok(related.basis.includes('same_intent'));
  assert.ok(related.basis.includes('same_topic_signal'));
});

test('history hash is stable across ordering and changes for secondary messages or status', () => {
  const second = ticket({ id: 'ticket-2', ticket_number: 1002, subject: 'Another note', messages: [customerMessage('m2', '2026-07-02T00:00:00Z', 'Following up')] });
  const original = bundle([ticket(), second]);
  const { hash: _ignored, ...reorderedBase } = { ...original, tickets: [...original.tickets].reverse() };
  assert.equal(customerHistoryHash(reorderedBase), original.hash);
  assert.notEqual(bundle([ticket(), { ...second, status: 'resolved' }]).hash, original.hash);
  assert.notEqual(bundle([ticket(), { ...second, messages: [...second.messages, customerMessage('m3', '2026-07-03T00:00:00Z', 'One more thing')] }]).hash, original.hash);
});

test('bounded formatting keeps every thread in the manifest and reports message overflow explicitly', () => {
  const many = Array.from({ length: 8 }, (_, index) => ticket({
    id: `ticket-${index + 1}`, ticket_number: 1001 + index, subject: `Issue ${index + 1}`,
    messages: [customerMessage(`m-${index}`, `2026-07-0${index + 1}T00:00:00Z`, 'x'.repeat(900))],
  }));
  const result = formatCustomerSupportContext(bundle(many), 2_500);
  assert.equal(result.overflow, true);
  assert.match(result.text, /EXPLICIT HISTORY OVERFLOW|FORMAT OVERFLOW/);
  for (const item of many) assert.match(result.text, new RegExp(`Ticket #${item.ticket_number}`));
});

test('oversized current ticket preserves its latest request and reply before rendering older threads', () => {
  const latestRequest = 'LATEST REQUEST: please cancel order #1025';
  const current = ticket({
    messages: [
      customerMessage('m-old', '2026-07-01T00:00:00Z', 'Earlier question'),
      agentMessage('m-agent', '2026-07-02T00:00:00Z', 'delivered'),
      customerMessage('m-huge', '2026-07-03T00:00:00Z', `Forwarded history\n${'x'.repeat(105_000)}\n${latestRequest}`),
    ],
  });
  const older = ticket({
    id: 'ticket-2',
    ticket_number: 1002,
    subject: 'Older exchange',
    messages: [customerMessage('m-older-thread', '2026-06-01T00:00:00Z', 'OLDER THREAD DETAIL')],
  });
  const context = bundle([current, older]);
  const hashBefore = context.hash;
  const coverageBefore = structuredClone(context.coverage);

  const result = formatCustomerSupportContext(context);

  assert.equal(result.text.length <= 90_000, true);
  assert.match(result.text, /Ticket #1001 \[CURRENT\]/);
  assert.match(result.text, /We are checking\./);
  assert.match(result.text, new RegExp(latestRequest));
  assert.match(result.text, /MESSAGE TRUNCATED/);
  assert.match(result.text, /CURRENT TICKET HISTORY TRUNCATED/);
  assert.match(result.text, /OLDER THREAD DETAIL/);
  assert.equal(result.overflow, true);
  assert.equal(context.hash, hashBefore);
  assert.deepEqual(context.coverage, coverageBefore);
});
