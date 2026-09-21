import { selectAutopilotBatch, DEFAULT_AUTOPILOT_BATCH_SETTINGS } from './autopilot-batch-policy';
import { ticketAutopilot, type Ticket, type TicketMessage } from './types';
import type { SupportAutomationSettings } from './support-automation-types';
import { retentionDecision, retentionRefundAmount } from '../../../backend/src/services/support-retention-policy';
import { validSupportQuality } from '../../../backend/src/services/support-quality-policy';

export const AUTOMATION_POLICY_VERSION = 'support-automation-2026-09-v1';
const ROUTINE_ACTIONS = new Set(['send_reply', 'resolve', 'add_tags', 'set_priority', 'cancel_order', 'refund_order']);
export function automaticPlanEligibility(input: { ticket: Ticket; settings: SupportAutomationSettings; messages: TicketMessage[]; fingerprintPlan: Parameters<typeof selectAutopilotBatch>[0]['fingerprintPlan']; now?: Date }) {
  const now = input.now || new Date();
  const plan = ticketAutopilot(input.ticket);
  const deny = (reason: string) => ({ eligible: false as const, reason, candidate: null });
  if (!input.settings.enabled) return deny('Automation is paused.');
  if (!plan) return deny('Waiting for a complete plan.');
  if (!Number.isFinite(Date.parse(plan.proposed_at)) || !Number.isFinite(Date.parse(input.settings.activated_at))) return deny('Plan or activation time is invalid.');
  const quality = plan.analysis.quality_assessment;
  if (quality?.passed !== true || !validSupportQuality(quality)) return deny('Independent knowledge and quality verification has not passed.');
  if (Date.parse(plan.proposed_at) < Date.parse(input.settings.activated_at)) return deny('This plan predates automation activation and remains in manual review.');
  if (input.ticket.assigned_to) return deny('A person is assigned to this ticket.');
  if (input.ticket.tags?.some(t => ['needs-human', 'manual-review', 'automation-hold'].includes(t))) return deny('This ticket is held for a person.');
  const snoozed = input.ticket.metadata?.snoozed_until;
  if (typeof snoozed === 'string' && Date.parse(snoozed) > now.getTime()) return deny('This ticket is snoozed.');
  if (plan.actions.some(a => !ROUTINE_ACTIONS.has(a.type))) return deny('This action needs individual review.');
  const mutations = plan.actions.filter(a => ['cancel_order', 'refund_order'].includes(a.type));
  const threshold = mutations.length ? input.settings.mutation_min_confidence : input.settings.min_confidence;
  if (quality.confidence < threshold) return deny('Independent verification confidence is below the automatic execution threshold.');
  const customerMessages = input.messages.filter(m => m.sender_type === 'customer' && !m.is_internal_note);
  const latest = customerMessages.at(-1);
  if (!latest) return deny('No customer message is available.');
  if (/\b(?:chargeback|fraud|attorney|lawsuit|legal action|speak to (?:a )?(?:human|person|manager)|human agent)\b/i.test(latest.content)) return deny('The customer needs human attention.');
  const publicMessages = input.messages.filter(m => !m.is_internal_note && ['customer', 'agent'].includes(m.sender_type) && (m.sender_type === 'customer' || ['sent', 'delivered'].includes(String(m.metadata?.email_status))));
  if (publicMessages.at(-1)?.sender_type !== 'customer') return deny('The customer has already received a reply.');
  if (mutations.length > 1) return deny('Multiple money or order changes require individual review.');
  if (mutations.length) {
    const decision = retentionDecision(input.messages);
    const action = mutations[0];
    if (action.params.order_id !== decision.orderId) return deny('No double confirmation for this exact order.');
    if (action.type === 'cancel_order' && (!input.settings.allow_cancellation || decision.choice !== 'cancel')) return deny('Cancellation needs an explicit choice after the offer.');
    if (action.type === 'cancel_order' && (action.params.observed_fulfillment_status !== 'UNFULFILLED' || action.params.tracking_present !== false)) return deny('Fulfilled or tracked orders need human review.');
    if (action.type === 'refund_order') {
      if (!input.settings.allow_retention_refund || decision.choice !== 'keep') return deny('The customer has not accepted the 30% keep-order offer.');
      const refund = action.params.retention_refund as { total_paid?: number; already_refunded?: number } | undefined;
      if (!refund || retentionRefundAmount(Number(refund.total_paid), Number(refund.already_refunded)) !== Number(action.params.amount)) return deny('The refund is not the verified remaining 30% concession.');
    }
  }
  const result = selectAutopilotBatch({ tickets: [input.ticket], now, settings: { ...DEFAULT_AUTOPILOT_BATCH_SETTINGS, minConfidencePercent: (mutations.length ? input.settings.mutation_min_confidence : input.settings.min_confidence) * 100, includeHighImpact: mutations.length > 0, requireCalibrated: false }, fingerprintPlan: input.fingerprintPlan });
  if (!result.eligible[0]) return deny(result.excluded[0]?.detail || 'The plan is not executable.');
  for (const evidence of [plan.evidence?.shopify_orders, plan.evidence?.customer_history]) {
    if (!evidence || !Number.isFinite(Date.parse(evidence.valid_until)) || Date.parse(evidence.valid_until) <= now.getTime()) return deny('Verified evidence is missing or expired.');
  }
  return { eligible: true as const, reason: 'Policy, identity, evidence and confidence checks passed.', candidate: result.eligible[0] };
}

export function scheduledRunTime(now: Date, random: number): string {
  if (!Number.isFinite(random) || random < 0 || random > 1) throw new Error('Random sample must be between zero and one.');
  return new Date(now.getTime() + (900 + Math.floor(random * 900)) * 1000).toISOString();
}
