import assert from 'node:assert/strict';
import test from 'node:test';
import { automaticPlanEligibility, scheduledRunTime } from './support-automation-policy';
import { autopilotPlanFingerprint } from './autopilot-plan-fingerprint';
import type { AutopilotPlan, Ticket, TicketMessage } from './types';
import type { SupportAutomationSettings } from './support-automation-types';
import { SUPPORT_QUALITY_CHECKS } from '../../../backend/src/services/support-quality-policy';

const now = new Date('2026-09-16T12:00:00Z');
const id = '00000000-0000-4000-8000-000000000001';
const settings: SupportAutomationSettings = { brand_id: id, enabled: true, min_confidence: .90, mutation_min_confidence: .95, allow_cancellation: true, allow_retention_refund: true, activated_at: '2026-09-16T00:00:00Z', updated_at: '2026-09-16T00:00:00Z', last_worker_at: null };
const message = { id, sender_type: 'customer', content: 'Where is my order?', created_at: '2026-09-16T11:00:00Z', is_internal_note: false } as TicketMessage;
function fixture() {
  const p: AutopilotPlan = { id, version: 2, revision: 0, status: 'proposed', trigger: 'customer_reply', proposed_at: '2026-09-16T11:30:00Z', context_version: 2, context_fingerprint: 'context', generation: { provider: 'vercel-ai-gateway', model: 'deepseek/deepseek-v4.1-flash', tier: 'flash', thinking: 'disabled', calibration_key: 'cohort' }, analysis: { summary: 'Order status', reasoning: 'Verified', overall_confidence: .97, quality_assessment: { version: 'support-quality-v1', passed: true, confidence: .97, checks: [], summary: 'Verified', checked_at: now.toISOString() } }, actions: [{ id: 'reply-action', type: 'send_reply', title: 'Reply', detail: 'Status reply', confidence: .97, params: { reply_text: 'Your order is being prepared.' }, status: 'proposed' }], evidence: { shopify_orders: { hash: 'order', fetched_at: now.toISOString(), valid_until: '2026-09-16T13:00:00Z', order_count: 1, projection_version: 'shopify-support-prompt-v2' }, customer_history: { hash: 'history', fetched_at: now.toISOString(), valid_until: '2026-09-16T13:00:00Z', ticket_count: 1, ticket_message_count: 1, conversation_count: 0, chat_message_count: 0, projection_version: 'customer-support-context-v1' } } };
  const ticket = { id, brand_id: id, ticket_number: 1001, customer_email: 'test@example.com', customer_name: 'Test', subject: 'Order status', status: 'open', tags: [], context_version: 2, metadata: { autopilot: p } } as unknown as Ticket;
  p.prompt_version = 'support-plan-2026-09-v41-quality-retention';
  p.analysis.quality_assessment!.checks = SUPPORT_QUALITY_CHECKS.map(name => ({ name, passed: true, detail: 'Verified from the order and conversation.' }));
  return { ticket, plan: p, settings: structuredClone(settings), messages: [structuredClone(message)], fingerprintPlan: autopilotPlanFingerprint, now };
}
test('a fresh, independently verified routine plan is eligible', () => assert.equal(automaticPlanEligibility(fixture()).eligible, true));
test('confidence is the weakest action, not the raw model score', () => { const f = fixture(); f.plan.actions[0].confidence = .6; f.plan.analysis.model_confidence = .99; assert.equal(automaticPlanEligibility(f).eligible, false); });
test('a high plan score cannot override low independent verification confidence', () => { const f = fixture(); f.plan.analysis.quality_assessment!.confidence = .5; assert.equal(automaticPlanEligibility(f).eligible, false); });
test('expired evidence, stale context, paused settings and assigned tickets block execution', () => {
  for (const edit of [(f: ReturnType<typeof fixture>) => { f.plan.evidence!.shopify_orders!.valid_until = '2026-09-15T00:00:00Z'; }, (f: ReturnType<typeof fixture>) => { f.ticket.context_version = 3; }, (f: ReturnType<typeof fixture>) => { f.settings.enabled = false; }, (f: ReturnType<typeof fixture>) => { f.ticket.assigned_to = id; }]) { const f = fixture(); edit(f); assert.equal(automaticPlanEligibility(f).eligible, false); }
});
test('a failed independent check, old backlog and manual holds cannot be bypassed with 100% scores', () => {
  for (const edit of [(f: ReturnType<typeof fixture>) => { f.plan.analysis.quality_assessment!.passed = false; }, (f: ReturnType<typeof fixture>) => { f.plan.proposed_at = '2026-09-15T00:00:00Z'; }, (f: ReturnType<typeof fixture>) => { f.ticket.tags = ['needs-human']; }]) { const f = fixture(); edit(f); assert.equal(automaticPlanEligibility(f).eligible, false); }
});
test('explicit requests for a person and a newer delivered reply stop automatic sends', () => { const f = fixture(); f.messages[0].content = 'I want to speak to a human'; assert.equal(automaticPlanEligibility(f).eligible, false); f.messages[0].content = 'Where is it?'; f.messages.push({ ...message, sender_type: 'agent', metadata: { email_status: 'sent' } }); assert.equal(automaticPlanEligibility(f).eligible, false); });
test('first request cannot cancel, while a sent offer and later choice authorize an unfulfilled order', () => {
  const f = fixture(); f.plan.actions.unshift({ id: 'cancel', type: 'cancel_order', title: 'Cancel', detail: 'Cancel', confidence: .97, params: { order_id: 'gid://shopify/Order/1', observed_fulfillment_status: 'UNFULFILLED', tracking_present: false }, status: 'proposed' });
  f.messages[0].content = 'Please cancel my order.';
  assert.equal(automaticPlanEligibility(f).eligible, false);
  f.messages.unshift({ ...message, id: 'offer', sender_type: 'agent', created_at: '2026-09-16T10:00:00Z', metadata: { email_status: 'sent', support_retention_offer: { version: 'retention-30-v1', order_id: 'gid://shopify/Order/1', order_name: '#1001', refund_percent: 30 } } });
  assert.equal(automaticPlanEligibility(f).eligible, true);
  f.plan.actions[0].params.tracking_present = true;
  assert.equal(automaticPlanEligibility(f).eligible, false);
});
test('random delay is bounded to 15–30 minutes and invalid samples fail', () => { assert.equal(scheduledRunTime(now, 0), '2026-09-16T12:15:00.000Z'); assert.equal(scheduledRunTime(now, 1), '2026-09-16T12:30:00.000Z'); assert.throws(() => scheduledRunTime(now, NaN)); });
