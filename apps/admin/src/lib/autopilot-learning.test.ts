import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildAutopilotReviewEvent,
  isReviewerGuidedAutopilotRevision,
  selectRenderableReviewedLearningEpisodes,
} from './autopilot-learning';
import type { AutopilotPlan, Ticket } from './types';

const PLAN_ID = '00000000-0000-4000-8000-000000000001';
const ACTION_ID = '00000000-0000-4000-8000-000000000002';

function plan(patch: Partial<AutopilotPlan> = {}): AutopilotPlan {
  return {
    version: 2,
    id: PLAN_ID,
    revision: 0,
    planner_version: 'autopilot-v2',
    prompt_version: 'test',
    context_fingerprint: 'context',
    context_version: 1,
    status: 'executing',
    trigger: 'sweep',
    proposed_at: '2026-07-17T00:00:00.000Z',
    analysis: {
      summary: 'summary',
      reasoning: 'reasoning',
      model_confidence: 0.9,
      overall_confidence: 0.9,
    },
    actions: [{
      id: ACTION_ID,
      type: 'send_reply',
      title: 'Reply',
      detail: 'Reply',
      params: { reply_text: 'Grounded reply.' },
      confidence: 0.9,
      status: 'approved',
    }],
    ...patch,
  };
}

const ticket: Ticket = {
  id: '00000000-0000-4000-8000-000000000003',
  brand_id: '00000000-0000-4000-8000-000000000004',
  ticket_number: 3149,
  source: 'email',
  status: 'open',
  priority: 'medium',
  category: 'support',
  subject: 'Cancellation request',
  customer_email: 'customer@example.com',
  customer_name: 'Customer',
  customer_phone: null,
  shopify_customer_id: null,
  assigned_to: null,
  tags: [],
  conversation_id: null,
  order_id: null,
  metadata: null,
  first_response_at: null,
  resolved_at: null,
  closed_at: null,
  sla_deadline: null,
  classification: 'customer_support',
  classification_confidence: 1,
  sla_breached: false,
  created_at: '2026-07-17T00:00:00.000Z',
  updated_at: '2026-07-17T00:00:00.000Z',
  context_version: 1,
};

test('threshold batch approvals are distinct lower-trust evidence, not clean human review', () => {
  const original = plan({ status: 'proposed' });
  const individual = buildAutopilotReviewEvent({
    ticket,
    originalPlan: structuredClone(original),
    finalPlan: plan(),
    decision: 'approve',
    decisionMode: 'individual_review',
    actor: { role: 'admin' },
  });
  const batch = buildAutopilotReviewEvent({
    ticket,
    originalPlan: structuredClone(original),
    finalPlan: plan(),
    decision: 'approve',
    decisionMode: 'batch_threshold',
    actor: { role: 'admin' },
  });

  assert.equal(individual.signal_type, 'clean_approval');
  assert.equal(individual.trust_score, 0.72);
  assert.equal(batch.signal_type, 'batch_approval');
  assert.equal(batch.trust_score, 0.58);
  assert.equal(batch.payload.decision_mode, 'batch_threshold');
  assert.ok(batch.trust_score < individual.trust_score);
});

test('a reviewer-guided revision keeps its high-trust revision signal when executed in a batch', () => {
  const revised = plan({
    trigger: 'revision',
    revision_count: 1,
    operator_instruction: 'Use the verified policy wording.',
  });
  const event = buildAutopilotReviewEvent({
    ticket,
    originalPlan: plan({ status: 'proposed' }),
    finalPlan: revised,
    decision: 'approve',
    decisionMode: 'batch_threshold',
    actor: { role: 'admin' },
  });

  assert.equal(isReviewerGuidedAutopilotRevision(revised), true);
  assert.equal(event.signal_type, 'human_revision');
  assert.equal(event.trust_score, 0.97);
});

test('an automatic replan delta is never mislabeled as a human edit or revision', () => {
  const parent = plan({
    id: '00000000-0000-4000-8000-000000000010',
    status: 'executed',
    actions: [{
      ...plan().actions[0],
      id: '00000000-0000-4000-8000-000000000011',
      params: { reply_text: 'Old model draft.' },
    }],
  });
  const automatic = plan({
    id: '00000000-0000-4000-8000-000000000012',
    parent_plan_id: parent.id,
    trigger: 'customer_reply',
    actions: [{
      ...plan().actions[0],
      id: '00000000-0000-4000-8000-000000000013',
      params: { reply_text: 'New model draft after the customer replied.' },
    }],
  });
  const event = buildAutopilotReviewEvent({
    ticket,
    originalPlan: parent,
    finalPlan: automatic,
    decision: 'approve',
    decisionMode: 'batch_threshold',
    actor: { role: 'admin' },
  });

  assert.equal(isReviewerGuidedAutopilotRevision(automatic), false);
  assert.equal(event.signal_type, 'batch_approval');
  assert.equal(event.trust_score, 0.58);
});

test('review calibration lineage belongs to the model plan that was compared', () => {
  const flash = plan({
    status: 'proposed',
    prompt_version: 'support-plan-v4',
    generation: {
      provider: 'vercel-ai-gateway',
      model: 'deepseek/deepseek-v4.1-flash',
      tier: 'flash',
      thinking: 'disabled',
      calibration_key: 'vercel-ai-gateway:deepseek/deepseek-v4.1-flash:support-plan-v4',
    },
  });
  const humanEdited = plan({
    generation: {
      provider: 'vercel-ai-gateway',
      model: 'deepseek/deepseek-v4-pro',
      tier: 'pro',
      thinking: 'high',
      calibration_key: 'vercel-ai-gateway:deepseek/deepseek-v4-pro:support-plan-v4',
    },
    actions: [{
      ...plan().actions[0],
      params: { reply_text: 'Human-corrected reply.', edited_by_reviewer: true },
    }],
  });

  const event = buildAutopilotReviewEvent({
    ticket,
    originalPlan: flash,
    finalPlan: humanEdited,
    decision: 'approve',
    decisionMode: 'individual_review',
    actor: { role: 'admin' },
  });

  assert.equal(event.signal_type, 'human_edit');
  assert.equal(event.payload.model_provider, 'vercel-ai-gateway');
  assert.equal(event.payload.model_id, 'deepseek/deepseek-v4.1-flash');
  assert.equal(event.payload.model_tier, 'flash');
  assert.equal(event.payload.model_prompt_version, 'support-plan-v4');
  assert.equal(
    event.payload.calibration_key,
    'vercel-ai-gateway:deepseek/deepseek-v4.1-flash:support-plan-v4',
  );
});

test('non-renderable batch episodes cannot crowd human precedent out of the prompt window', () => {
  const approvedAction = {
    action_type: 'send_reply',
    verdict: 'approved',
  };
  const events = [
    ...Array.from({ length: 7 }, (_, index) => ({
      id: `batch-${index}`,
      signal_type: 'batch_approval',
      payload: { actions: [approvedAction] },
    })),
    {
      id: 'human-clean',
      signal_type: 'clean_approval',
      payload: { actions: [approvedAction] },
    },
  ];

  const rendered = selectRenderableReviewedLearningEpisodes(events, 5);

  assert.deepEqual(rendered.map(({ event }) => event.id), ['human-clean']);
  assert.match(rendered[0]?.line ?? '', /Clean human approval/);
});
