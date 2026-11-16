import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import type { Request, Response } from 'express';
import { agentAuthMiddleware } from '../middleware/agent-auth.middleware.js';
import { parseEscalationRequest } from './ticket-escalation-policy.js';

const CONVERSATION_ID = '0b9f3f0e-3c1d-4c55-9a39-6a1f2a7d9e11';

const valid = {
  conversationId: CONVERSATION_ID,
  customerEmail: 'jane@example.com',
  reason: 'Customer requesting refund for damaged item',
};

function errorOf(body: unknown): string | null {
  const result = parseEscalationRequest(body);
  return result.ok ? null : result.error;
}

test('an escalation the chat would send is accepted as it is', () => {
  assert.deepEqual(parseEscalationRequest(valid), {
    ok: true,
    value: {
      conversationId: CONVERSATION_ID,
      customerEmail: 'jane@example.com',
      customerName: undefined,
      reason: 'Customer requesting refund for damaged item',
      priority: undefined,
      summary: undefined,
      recommendedActions: undefined,
    },
  });

  const full = parseEscalationRequest({
    ...valid,
    customerEmail: ' jane@example.com ',
    customerName: ' Jane Doe ',
    priority: 'high',
    summary: 'Order #1042 arrived damaged.\nCustomer wants a refund.',
    recommendedActions: ['Check order #1042', 'Issue refund'],
  });
  assert.equal(full.ok, true);
  if (!full.ok) return;
  assert.equal(full.value.customerEmail, 'jane@example.com');
  assert.equal(full.value.customerName, 'Jane Doe');
  assert.equal(full.value.priority, 'high');
  assert.equal(full.value.summary, 'Order #1042 arrived damaged.\nCustomer wants a refund.');
  assert.deepEqual(full.value.recommendedActions, ['Check order #1042', 'Issue refund']);

  // Fields a caller sends as null keep their defaults.
  assert.equal(errorOf({ ...valid, customerName: null, priority: null, summary: null, recommendedActions: null }), null);
});

test('missing required fields keep the existing error', () => {
  const required = 'conversationId, customerEmail, and reason are required';
  assert.equal(errorOf(undefined), required);
  assert.equal(errorOf('text'), required);
  assert.equal(errorOf({}), required);
  assert.equal(errorOf({ ...valid, conversationId: '' }), required);
  assert.equal(errorOf({ ...valid, customerEmail: undefined }), required);
  assert.equal(errorOf({ ...valid, reason: null }), required);
});

test('the conversation id must be a uuid and the email an email address', () => {
  assert.equal(errorOf({ ...valid, conversationId: 'abc' }), 'Invalid conversationId');
  assert.equal(errorOf({ ...valid, conversationId: { id: CONVERSATION_ID } }), 'Invalid conversationId');

  for (const customerEmail of ['not-an-email', 'a@b', 'a b@example.com', ['jane@example.com'], `${'a'.repeat(250)}@example.com`]) {
    assert.equal(errorOf({ ...valid, customerEmail }), 'Invalid email address', String(customerEmail));
  }
  // One request cannot name several recipients.
  assert.equal(errorOf({ ...valid, customerEmail: 'jane@example.com, bob@example.com' }), 'Invalid email address');
  assert.equal(errorOf({ ...valid, customerEmail: 'jane@example.com,bob' }), 'Invalid email address');
});

test('the reason, which becomes the email subject, is one bounded line', () => {
  assert.equal(errorOf({ ...valid, reason: 'x'.repeat(300) }), null);
  assert.match(errorOf({ ...valid, reason: 'x'.repeat(301) }) ?? '', /^reason must be/);
  assert.match(errorOf({ ...valid, reason: 'Refund\r\nBcc: someone@example.com' }) ?? '', /^reason must be/);
  assert.match(errorOf({ ...valid, reason: { text: 'refund' } }) ?? '', /^reason must be/);
  assert.match(errorOf({ ...valid, reason: '   ' }) ?? '', /^reason must be/);
});

test('optional fields are typed and bounded', () => {
  assert.match(errorOf({ ...valid, customerName: 'x'.repeat(201) }) ?? '', /^customerName must be/);
  assert.match(errorOf({ ...valid, customerName: 42 }) ?? '', /^customerName must be/);

  for (const priority of ['low', 'medium', 'high', 'urgent']) {
    assert.equal(errorOf({ ...valid, priority }), null, priority);
  }
  assert.match(errorOf({ ...valid, priority: 'critical' }) ?? '', /^priority must be one of/);

  assert.equal(errorOf({ ...valid, summary: 'x'.repeat(5000) }), null);
  assert.match(errorOf({ ...valid, summary: 'x'.repeat(5001) }) ?? '', /^summary must be/);
  assert.match(errorOf({ ...valid, summary: ['x'] }) ?? '', /^summary must be/);

  assert.match(errorOf({ ...valid, recommendedActions: 'Issue refund' }) ?? '', /^recommendedActions must be/);
  assert.match(errorOf({ ...valid, recommendedActions: Array(11).fill('x') }) ?? '', /^recommendedActions must be/);
  assert.match(errorOf({ ...valid, recommendedActions: ['x'.repeat(501)] }) ?? '', /^recommendedActions must be/);
  assert.match(errorOf({ ...valid, recommendedActions: [{ action: 'x' }] }) ?? '', /^recommendedActions must be/);
});

// The routes are registered in index.ts, which starts the server when loaded,
// so their guards are checked in the source.
const indexSource = readFileSync(path.resolve(__dirname, '../index.ts'), 'utf8');

test('POST /api/tickets/escalate is rate limited and validates its body before anything else', () => {
  assert.match(indexSource, /const escalateRateLimit = rateLimit\(\{ windowMs: 10 \* 60 \* 1000, max: 10, name: 'ticket-escalate' \}\);/);
  const route = indexSource.slice(indexSource.indexOf("app.post('/api/tickets/escalate',"));
  assert.match(route, /^app\.post\('\/api\/tickets\/escalate', escalateRateLimit, async \(req, res\) => \{/);
  const validated = route.indexOf('parseEscalationRequest(req.body)');
  assert.ok(validated > 0);
  assert.ok(validated < route.indexOf('resolveBrandId(req)'));
  assert.ok(validated < route.indexOf('createTicketFromEscalation('));
});

test('POST /api/returns/test-email requires an agent login', async () => {
  assert.match(indexSource, /app\.post\('\/api\/returns\/test-email', agentAuthMiddleware, async \(req, res\) => \{/);

  // The same middleware the other returns admin routes use rejects a caller with no token.
  const state: { status?: number; body?: unknown } = {};
  const res = {
    status(code: number) { state.status = code; return res; },
    json(body: unknown) { state.body = body; return res; },
  } as unknown as Response;
  let passed = false;
  await agentAuthMiddleware({ headers: {} } as unknown as Request, res, () => { passed = true; });
  assert.equal(passed, false);
  assert.equal(state.status, 401);
  assert.deepEqual(state.body, { error: 'Authentication required' });
});
