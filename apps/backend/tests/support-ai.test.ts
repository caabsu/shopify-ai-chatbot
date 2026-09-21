import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSupportAi, getJevConfig, validateAnswers, INTAKE_QUESTIONS, DRAFT_QUESTIONS,
  modelUsage, trackGeneration, orderPlanActions, dependencyFailure, ticketAiStore,
  orderEvidenceRevision, saveDraftResult,
  type AiRun, type AiStore, type Question, type Answer, type DraftContext, type IntakeState,
} from '../src/services/support-ai.js';

function memoryStore(): AiStore & { runs: AiRun[] } {
  const runs: AiRun[] = [];
  return { runs, async find(hash) { return runs.findLast(r => r.request_hash === hash && r.status !== 'running') ?? null; },
    async save(run) { const i = runs.findIndex(r => r.id === run.id); if (i < 0) runs.push(structuredClone(run)); else runs[i] = structuredClone(run); } };
}
function answersFor(questions: Record<string, Question>): Record<string, Answer> {
  return Object.fromEntries(Object.entries(questions).map(([key, q]) => {
    if (q.type === 'noul') return [key, { type: 'noul', noul: key === 'unanswered_request' ? 0.99 : 0.01 }];
    const keys = q.type === 'score' ? q.criteria.map((_, i) => String(i)) : Object.keys(q.criteria);
    const chosen = q.type === 'score' ? keys.at(-1)! : keys[0];
    return [key, { type: q.type, ...(q.type === 'score' ? { score: Number(chosen) } : { choice: chosen }), confidence: 1,
      probabilities: Object.fromEntries(keys.map(k => [k, k === chosen ? 1 : 0])) }];
  }));
}
const context: DraftContext = { conversation: 'Customer: Where is my lamp? I need it Friday.',
  evidence: 'Order 1001 is in transit. No estimated delivery date. Tracking: https://carrier.example/1001',
  brand_rules: 'Warm, professional, concise plain text. No unrequested offers.', signoff: 'Regards,\nTest Support', execution_records: [] };
const goodDraft = 'Your lamp is in transit. Tracking: https://carrier.example/1001\n\nRegards,\nTest Support';
const state: IntakeState = { subject: 'Re: Lamp', thread: 'Customer: Where is my lamp?\nAgent: Here is tracking.\nCustomer: Thanks!',
  has_prior_agent_reply: true, latest_sender: 'customer', has_attachments: false };
const config = { apiKey: 'test-key', mode: 'active' as const, model: 'jev-1.13.0', timeoutMs: 1000 };
function setup(transform?: (answers: Record<string, Answer>, call: number) => void, mode: 'active' | 'shadow' = 'active') {
  const store = memoryStore();
  const requests: Array<Record<string, unknown>> = [];
  const transport: typeof fetch = async (_url, init) => {
    const request = JSON.parse(String(init?.body)); requests.push(request);
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer test-key');
    assert.ok(store.runs.some(r => r.status === 'running'), 'run is saved before inference');
    const answers = answersFor(request.questions);
    transform?.(answers, requests.length);
    return Response.json({ model: 'jev-1.13.0', answers, usage: { input_tokens: 1200, output_tokens: 40 } });
  };
  const ai = createSupportAi({ store, scope: 'brand-a:ticket-a', config: { ...config, mode }, fetch: transport });
  return { ai, store, requests };
}

test('one batched assessment covers all draft dimensions and defects, with saved usage', async () => {
  const { ai, store, requests } = setup();
  const result = await ai.reviewAndRepair(goodDraft, context, async () => { throw new Error('must not repair'); });
  assert.equal(result.review.status, 'passed');
  assert.equal(requests.length, 1);
  assert.equal(Object.keys(requests[0].questions as object).length, 9);
  assert.equal(store.runs[0].status, 'completed');
  assert.equal(store.runs[0].usage?.estimated_cost_usd, 1200 * 0.042 / 1e6);
});

test('unsupported delivery promise causes one targeted repair and a second evaluation', async () => {
  const { ai, requests } = setup((answers, call) => { if (call === 1) answers.unsupported_claim = { type: 'noul', noul: 0.98 }; });
  let repairs = 0;
  const result = await ai.reviewAndRepair('It will arrive Friday.\n\nRegards,\nTest Support', context, async (original, instructions) => {
    repairs++; assert.match(original, /Friday/); assert.match(instructions.join(' '), /delivery predictions/); return goodDraft;
  });
  assert.equal(repairs, 1); assert.equal(requests.length, 2);
  assert.equal(result.draft, goodDraft); assert.equal(result.review.status, 'passed');
  assert.equal(result.review.repair_attempted, true); assert.ok(result.review.initial_run_id);
});

test('persistent defects stop after one repair', async () => {
  const { ai } = setup(a => { a.asks_known_information = { type: 'noul', noul: 0.98 }; });
  let repairs = 0;
  const result = await ai.reviewAndRepair(goodDraft, context, async () => { repairs++; return goodDraft + '\nWhat is your order number?'; });
  assert.equal(repairs, 1); assert.equal(result.review.status, 'needs_review');
});

test('missing evidence or ambiguous defects do not trigger wasteful rewrites', async () => {
  for (const probability of [0.5, 0.99]) {
    const { ai } = setup(a => { a.missing_evidence = { type: 'noul', noul: probability }; a.unsupported_claim = { type: 'noul', noul: 0.99 }; });
    const result = await ai.reviewAndRepair(goodDraft, context, async () => { assert.fail('cannot repair missing evidence'); });
    assert.equal(result.review.status, 'needs_review'); assert.equal(result.review.repair_attempted, false);
  }
});

test('high certainty in a poor score is not a good draft; tone cannot hide a factual defect', async () => {
  const { ai } = setup(a => { a.coverage = { type: 'score', score: 0, confidence: 1, probabilities: { 0: 1, 1: 0, 2: 0, 3: 0 } }; });
  const review = await ai.review(goodDraft, context);
  assert.equal(review.status, 'needs_review'); assert.equal(review.scores.coverage?.confidence, 1);
  assert.ok(review.repair_instructions.some(x => x.includes('each customer request')));
});

test('identical inputs reuse persisted results; edits, evidence and brand changes invalidate cache', async () => {
  const { ai, store, requests } = setup();
  await ai.review(goodDraft, context);
  await ai.review(goodDraft, Object.fromEntries(Object.entries(context).reverse()) as unknown as DraftContext);
  assert.equal((await ai.review(goodDraft, context)).cached, true); assert.equal(requests.length, 1);
  await ai.review(goodDraft + ' Thanks.', context);
  await ai.review(goodDraft, { ...context, evidence: context.evidence + '\nNow delivered.' });
  assert.equal(requests.length, 3);
  const other = createSupportAi({ store, scope: 'brand-b:ticket-a', config, fetch: async () => { throw new Error('brand b must not reuse brand a'); } });
  assert.equal((await other.review(goodDraft, context)).status, 'unavailable');
});

test('acknowledgements skip drafting only with resolved obligations and no new information or attachments', async () => {
  const { ai } = setup(a => {
    a.unanswered_request = { type: 'noul', noul: 0.01 };
    a.supplied_requested_information = { type: 'noul', noul: 0.01 };
    a.acknowledgement_only = { type: 'noul', noul: 0.99 };
  });
  assert.equal((await ai.intake(state)).skip_draft, true);
  assert.equal((await ai.intake({ ...state, has_prior_agent_reply: false })).skip_draft, false);
  assert.equal((await ai.intake({ ...state, has_attachments: true })).skip_draft, false);
  assert.equal((await ai.intake({ ...state, latest_sender: 'agent' })).skip_draft, false);
  const unresolved = setup(a => { a.acknowledgement_only = { type: 'noul', noul: 0.99 }; });
  assert.equal((await unresolved.ai.intake(state)).skip_draft, false);
});

test('low certainty in a non-support classification stays in customer support', async () => {
  const { ai } = setup(a => { const cls = a.classification as Extract<Answer, { type: 'choice' }>;
    cls.choice = 'spam'; cls.confidence = 0.5;
    cls.probabilities = { customer_support: 0.4, promotional: 0, transactional: 0, automated: 0, spam: 0.6, internal: 0 }; });
  const result = await ai.intake(state);
  assert.equal(result.classification, 'customer_support');
  assert.equal(result.predicted_classification, 'spam');
  assert.equal(result.classification_requires_review, true);
});

test('shadow evaluates but does not repair or skip a reply', async () => {
  const { ai } = setup(a => { a.unsupported_claim = { type: 'noul', noul: 1 }; a.acknowledgement_only = { type: 'noul', noul: 1 }; a.unanswered_request = { type: 'noul', noul: 0 }; }, 'shadow');
  assert.equal((await ai.intake(state)).skip_draft, false);
  const result = await ai.reviewAndRepair(goodDraft, context, async () => { assert.fail('shadow cannot rewrite'); });
  assert.equal(result.draft, goodDraft); assert.equal(result.review.mode, 'shadow');
});

test('missing key, HTTP errors, malformed output and model drift never produce a passing assessment', async () => {
  assert.equal(getJevConfig({}).mode, 'off');
  assert.throws(() => getJevConfig({ JEV_MODE: 'active' }), /TYPESAFE_API_KEY/);
  const off = createSupportAi({ store: memoryStore(), scope: 'x', config: { ...config, mode: 'off' }, fetch: async () => { assert.fail('off cannot call API'); } });
  assert.equal((await off.review(goodDraft, context)).status, 'disabled');
  for (const response of [new Response('private upstream body', { status: 429 }), Response.json({ answers: {} }),
    Response.json({ model: 'jev-2.0.0', answers: answersFor(DRAFT_QUESTIONS), usage: { input_tokens: 1 } })]) {
    const store = memoryStore();
    const ai = createSupportAi({ store, scope: 'x', config, fetch: async () => response });
    const review = await ai.review(goodDraft, context);
    assert.equal(review.status, 'unavailable'); assert.equal(store.runs[0].status, 'failed');
    assert.ok(!JSON.stringify(review).includes('private upstream body'));
  }
});

test('invalid probabilities, missing dimensions and invalid enums are rejected', () => {
  const answers = answersFor(INTAKE_QUESTIONS);
  assert.doesNotThrow(() => validateAnswers(answers, INTAKE_QUESTIONS));
  assert.throws(() => validateAnswers({ ...answers, unanswered_request: { type: 'noul', noul: NaN } }, INTAKE_QUESTIONS));
  assert.throws(() => validateAnswers({ ...answers, classification: { ...answers.classification, choice: 'delete_everything' } }, INTAKE_QUESTIONS));
  assert.throws(() => validateAnswers({}, DRAFT_QUESTIONS));
});

test('oversized context and storage failures avoid provider calls', async () => {
  const { ai, requests } = setup();
  assert.equal((await ai.review(goodDraft, { ...context, conversation: 'x'.repeat(60000) })).status, 'unavailable');
  assert.equal(requests.length, 0);
  const broken = createSupportAi({ scope: 'x', config, store: { async find() { throw new Error('db down'); }, async save() { throw new Error('db down'); } },
    fetch: async () => { assert.fail('do not call before saving run'); } });
  assert.equal((await broken.review(goodDraft, context)).status, 'unavailable');
});

test('deterministic link/signature checks cannot be overridden by a positive model assessment', async () => {
  const { ai } = setup();
  const result = await ai.review('Track at https://invented.example\nWrong Brand', context);
  assert.equal(result.status, 'needs_review');
  assert.ok(result.findings.some(f => f.includes('unverified link')));
  assert.ok(result.findings.some(f => f.includes('sign-off')));
});

test('tracked writing persists original output, token cost and reuses unchanged requests', async () => {
  const store = memoryStore(); let calls = 0;
  const writer = async () => { calls++; return { model: 'deepseek/deepseek-v4.1-flash', usage: { input_tokens: 2000, output_tokens: 300 }, content: goodDraft }; };
  await trackGeneration(store, 'draft', 'deepseek/deepseek-v4.1-flash', { prompt: 'a' }, writer);
  await trackGeneration(store, 'draft', 'deepseek/deepseek-v4.1-flash', { prompt: 'a' }, writer);
  assert.equal(calls, 1); assert.equal(store.runs[0].usage?.estimated_cost_usd, null);
  assert.equal(modelUsage('unknown-model').estimated_cost_usd, null);
});

test('a failed or skipped mutation blocks confirmation and resolution, regardless of planner order', () => {
  for (const status of ['failed', 'skipped']) {
    const actions = [{ type: 'resolve', status: 'proposed' }, { type: 'send_reply', status: 'proposed' }, { type: 'cancel_order', status }];
    const ordered = orderPlanActions(actions);
    assert.deepEqual(ordered.map(a => a.type), ['cancel_order', 'send_reply', 'resolve']);
    assert.ok(dependencyFailure(ordered[1], actions)); assert.ok(dependencyFailure(ordered[2], actions));
  }
  const actions = [{ type: 'cancel_order', status: 'executed' }, { type: 'send_reply', status: 'failed' }];
  assert.equal(dependencyFailure(actions[1], actions), null);
  assert.ok(dependencyFailure({ type: 'resolve' }, actions));
  actions[1].status = 'executed'; assert.equal(dependencyFailure({ type: 'resolve' }, actions), null);
});

test('ticket store refuses cross-brand persistence before reading or writing events', async () => {
  const tables: string[] = [];
  const db = { from(table: string) { tables.push(table); const chain = { select() { return chain; }, eq() { return chain; }, async single() { return { data: null, error: { message: 'wrong brand' } }; } }; return chain; } };
  const store = ticketAiStore(db as unknown as Parameters<typeof ticketAiStore>[0], 'ticket-a', 'brand-b');
  await assert.rejects(store.find('hash'), /scope/);
  assert.deepEqual(tables, ['tickets']);
});

test('provider failure is reused briefly instead of paying for repeated intake retries', async () => {
  const store = memoryStore(); let calls = 0;
  const ai = createSupportAi({ store, scope: 'x', config, fetch: async () => { calls++; return new Response('', { status: 429 }); } });
  await ai.intake(state);
  assert.equal((await ai.intake(state)).evaluation.cached, true);
  assert.equal((await ai.intake(state)).skip_draft, false);
  assert.equal(calls, 1);
  store.runs[0].created_at = new Date(Date.now() - 31_000).toISOString();
  await ai.intake(state);
  assert.equal(calls, 2);
});

test('failed repairs preserve the original draft with findings', async () => {
  const { ai } = setup(a => { a.unsupported_claim = { type: 'noul', noul: 1 }; });
  const result = await ai.reviewAndRepair(goodDraft, context, async () => { throw new Error('writer unavailable'); });
  assert.equal(result.draft, goodDraft);
  assert.equal(result.review.status, 'needs_review');
  assert.equal(result.review.repair_attempted, true);
});

test('an aborted provider request is unavailable and does not retry', async () => {
  let calls = 0;
  const ai = createSupportAi({ store: memoryStore(), scope: 'timeout', config, fetch: async (_url, init) => {
    calls++; assert.ok(init?.signal);
    throw new DOMException('Request timed out', 'TimeoutError');
  } });
  assert.equal((await ai.review(goodDraft, context)).status, 'unavailable');
  assert.equal(calls, 1);
});

test('order revision compares normalized data across hosts and invalidates changed fulfillment', () => {
  const order = { id: '1', name: '#1', totalPrice: '100.00 USD', financialStatus: 'PAID', fulfillmentStatus: 'UNFULFILLED', lineItems: [{ title: 'Lamp', quantity: 1 }], tracking: [] };
  assert.equal(orderEvidenceRevision([order]), orderEvidenceRevision([{ ...order, totalPrice: '100.00' }]));
  assert.notEqual(orderEvidenceRevision([order]), orderEvidenceRevision([{ ...order, fulfillmentStatus: 'FULFILLED' }]));
});

test('draft snapshots remain addressable for reviewer feedback when Jev is disabled', async () => {
  const store = memoryStore();
  const ai = createSupportAi({ store, scope: 'x', config: { ...config, mode: 'off' } });
  const review = await ai.review(goodDraft, context);
  await saveDraftResult(store, goodDraft, review);
  assert.equal(review.status, 'disabled');
  assert.ok(review.result_id);
  assert.equal(store.runs[0].id, review.result_id);
  assert.equal(store.runs[0].stage, 'draft_result');
  assert.equal(store.runs[0].usage, null);
});
