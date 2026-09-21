import assert from 'node:assert/strict';
import test from 'node:test';
import type { CustomerTicketThread } from './customer-support-context.service.js';
import { selectSameIssueTicketCandidate } from './inbound-ticket-routing-policy.js';

function candidate(input: {
  id: string;
  subject: string;
  body: string;
  orderId?: string | null;
  status?: string;
}): CustomerTicketThread {
  return {
    id: input.id,
    ticket_number: Number(input.id.replace(/\D/g, '')) || 1,
    subject: input.subject,
    status: input.status ?? 'open',
    source: 'email',
    order_id: input.orderId ?? null,
    conversation_id: null,
    context_version: 1,
    created_at: '2026-07-17T10:00:00.000Z',
    updated_at: '2026-07-17T10:00:00.000Z',
    first_response_at: null,
    metadata: null,
    messages: [{
      id: `message-${input.id}`,
      ticket_id: input.id,
      sender_type: 'customer',
      sender_name: null,
      content: input.body,
      created_at: '2026-07-17T10:00:00.000Z',
      email_message_id: null,
      metadata: null,
    }],
    response_state: 'awaiting_us',
  };
}

test('routes an unthreaded repeat contact to the active same-order issue', () => {
  const match = selectSameIssueTicketCandidate({
    subject: 'Please answer about order #1040',
    body: 'Cancel order #1040 and refund it.',
    receivedAt: '2026-07-18T10:00:00.000Z',
  }, [
    candidate({
      id: 'ticket-3137',
      subject: 'Questions at checkout?',
      body: 'I need to cancel order #1040 because it never shipped.',
      orderId: '#1040',
    }),
  ]);
  assert.equal(match?.id, 'ticket-3137');
});

test('does not merge separate issues just because the customer is the same', () => {
  const match = selectSameIssueTicketCandidate({
    subject: 'Wholesale account',
    body: 'Can I open a trade account?',
    receivedAt: '2026-07-18T10:00:00.000Z',
  }, [
    candidate({
      id: 'ticket-3137',
      subject: 'Where is order #1040?',
      body: 'Order #1040 is late and I need tracking.',
      orderId: '#1040',
    }),
  ]);
  assert.equal(match, null);
});

test('does not route into a closed ticket', () => {
  const match = selectSameIssueTicketCandidate({
    subject: 'Order #1040 cancellation',
    body: 'Please cancel order #1040.',
    receivedAt: '2026-07-18T10:00:00.000Z',
  }, [
    candidate({
      id: 'ticket-3137',
      subject: 'Order #1040 cancellation',
      body: 'Please cancel order #1040.',
      orderId: '#1040',
      status: 'closed',
    }),
  ]);
  assert.equal(match, null);
});
