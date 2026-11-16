import assert from 'node:assert/strict';
import test from 'node:test';
import type { Request, Response } from 'express';
import { createRateLimiter, rateLimit } from './rate-limit.middleware.js';

function request(ip: string, sessionId?: string): Request {
  return { ip, socket: { remoteAddress: ip }, body: { sessionId } } as unknown as Request;
}

function response() {
  const state: { status?: number; body?: unknown; headers: Record<string, string> } = { headers: {} };
  const res = {
    setHeader(name: string, value: string) { state.headers[name] = value; return res; },
    status(code: number) { state.status = code; return res; },
    json(body: unknown) { state.body = body; return res; },
  };
  return { res: res as unknown as Response, state };
}

test('the keyed limiter allows max hits per key, then blocks until the window ends', async () => {
  const hit = createRateLimiter({ windowMs: 250, max: 2, name: 'test-keyed' });

  assert.deepEqual(hit('order:1'), { allowed: true, retryAfter: 0 });
  assert.equal(hit('order:1').allowed, true);
  const blocked = hit('order:1');
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfter, 1);
  // Other keys have their own bucket.
  assert.equal(hit('order:2').allowed, true);

  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(hit('order:1').allowed, true);
});

test('the middleware still answers 429 with Retry-After once a client address passes the limit', () => {
  const limiter = rateLimit({ windowMs: 60_000, max: 2, name: 'test-middleware' });
  let passed = 0;

  for (let attempt = 1; attempt <= 2; attempt++) {
    const { res, state } = response();
    limiter(request('203.0.113.7'), res, () => { passed += 1; });
    assert.equal(state.status, undefined);
  }
  assert.equal(passed, 2);

  const { res, state } = response();
  limiter(request('203.0.113.7'), res, () => { passed += 1; });
  assert.equal(passed, 2);
  assert.equal(state.status, 429);
  assert.deepEqual(state.body, { error: 'Too many requests. Try again later.' });
  assert.equal(state.headers['Retry-After'], '60');

  // A different address is not affected.
  const other = response();
  limiter(request('198.51.100.20'), other.res, () => { passed += 1; });
  assert.equal(passed, 3);
});

test('the middleware keys on keyFn when one is given', () => {
  const limiter = rateLimit({
    windowMs: 60_000,
    max: 1,
    name: 'test-keyfn',
    keyFn: (req) => String((req.body as { sessionId?: string }).sessionId),
  });
  const statuses = ['a', 'a', 'b'].map((sessionId) => {
    const { res, state } = response();
    limiter(request('203.0.113.7', sessionId), res, () => undefined);
    return state.status;
  });
  assert.deepEqual(statuses, [undefined, 429, undefined]);
});
