import { randomInt } from 'node:crypto';
import { NextRequest } from 'next/server';
import { supabase } from './supabase';
import { executeAutopilotRequest } from './autopilot-executor';
import { autopilotPlanFingerprint } from './autopilot-plan-fingerprint';
import { automaticPlanEligibility, scheduledRunTime } from './support-automation-policy';
import { ticketAutopilot, type Ticket, type TicketMessage } from './types';
import type { SupportAutomationJob, SupportAutomationSettings } from './support-automation-types';

async function holdTicket(job: SupportAutomationJob, reason: string) {
  const hold = await supabase.from('support_automation_holds').upsert({ ticket_id: job.ticket_id, brand_id: job.brand_id });
  if (hold.error) throw new Error('Could not hold the interrupted ticket.');
  const [ticket, receipts] = await Promise.all([
    supabase.from('tickets').select('metadata').eq('id', job.ticket_id).eq('brand_id', job.brand_id).single(),
    supabase.from('autopilot_action_executions').select('id,action_id,action_type,status,result,error,provider_reference,started_at').eq('plan_id', job.plan_id).eq('brand_id', job.brand_id).order('started_at'),
  ]);
  const currentPlan = ticket.data?.metadata?.autopilot;
  const snapshot = currentPlan?.id === job.plan_id ? currentPlan : job.plan_snapshot;
  const updated = await supabase.from('support_automation_jobs').update({ status: 'needs_review', reason, completed_at: new Date().toISOString(), plan_snapshot: { ...snapshot, ...(!receipts.error ? { execution_receipts: receipts.data } : {}) } }).eq('id', job.id).eq('brand_id', job.brand_id);
  if (updated.error) throw new Error('Could not record automation interruption.');
  const waiting = await supabase.from('support_automation_jobs').update({ status: 'cancelled', reason: 'Ticket held after an interrupted execution.' }).eq('ticket_id', job.ticket_id).eq('brand_id', job.brand_id).eq('status', 'scheduled');
  if (waiting.error) throw new Error('Could not stop remaining queued actions for the held ticket.');
}
async function executionFence(job: SupportAutomationJob) {
  const [settings, hold, current] = await Promise.all([
    supabase.from('support_automation_settings').select('enabled, updated_at').eq('brand_id', job.brand_id).single(),
    supabase.from('support_automation_holds').select('ticket_id').eq('ticket_id', job.ticket_id).maybeSingle(),
    supabase.from('support_automation_jobs').select('status').eq('id', job.id).eq('brand_id', job.brand_id).single(),
  ]);
  if (settings.error || hold.error || current.error || !settings.data?.enabled || hold.data || current.data?.status !== 'running'
    || Date.parse(settings.data.updated_at) > Date.parse(job.started_at || job.created_at)) throw new Error('Automation was paused, its rules changed, or a person took over. Remaining actions were stopped.');
}

/** One bounded worker tick. DB compare-and-set claims and the existing action
 * ledger fence duplicate workers. A crashed running job is held, never replayed. */
export async function runSupportAutomation() {
  const now = new Date();
  const workerDeadline = now.getTime() + 200000;
  const allowedBrands = (process.env.SUPPORT_AUTOMATION_BRAND_IDS ?? '').split(',').map(id => id.trim()).filter(Boolean);
  let settingsQuery = supabase.from('support_automation_settings').select('*').eq('enabled', true);
  if (allowedBrands.length) settingsQuery = settingsQuery.in('brand_id', allowedBrands);
  const settingsResult = await settingsQuery;
  if (settingsResult.error) throw new Error('Support automation schema is unavailable.');
  let scheduled = 0;
  let completed = 0;
  let reviewed = 0;
  // Never re-run a mutation whose provider outcome is unknown after a crash.
  let interruptedQuery = supabase.from('support_automation_jobs').select('*').eq('status', 'running').lt('started_at', new Date(now.getTime() - 15 * 60000).toISOString()).limit(25);
  if (allowedBrands.length) interruptedQuery = interruptedQuery.in('brand_id', allowedBrands);
  const interrupted = await interruptedQuery;
  if (interrupted.error) throw new Error('Could not inspect interrupted automation runs.');
  for (const job of (interrupted.data || []) as SupportAutomationJob[]) await holdTicket(job, 'Worker interrupted. Inspect action receipts and reconcile provider outcomes before retrying.');

  for (const settings of (settingsResult.data || []) as SupportAutomationSettings[]) {
    const [tickets, holds, existing, heartbeat] = await Promise.all([
      supabase.from('tickets').select('*').eq('brand_id', settings.brand_id).in('status', ['open', 'pending']).is('merged_into_ticket_id', null).filter('metadata->autopilot->>status', 'eq', 'proposed').filter('metadata->autopilot->>proposed_at', 'gte', settings.activated_at).order('updated_at', { ascending: false }).limit(200),
      supabase.from('support_automation_holds').select('ticket_id').eq('brand_id', settings.brand_id),
      supabase.from('support_automation_jobs').select('plan_id').eq('brand_id', settings.brand_id).gte('created_at', settings.activated_at),
      supabase.from('support_automation_settings').update({ last_worker_at: now.toISOString() }).eq('brand_id', settings.brand_id),
    ]);
    if (tickets.error || holds.error || existing.error || heartbeat.error) throw new Error('Could not load the automation queue.');
    const held = new Set((holds.data || []).map(h => h.ticket_id));
    const queued = new Set((existing.data || []).map(j => j.plan_id));
    for (const ticket of (tickets.data || []) as Ticket[]) {
      if (scheduled + reviewed >= 12 || Date.now() - now.getTime() > 30000) break;
      const plan = ticketAutopilot(ticket);
      if (!plan?.id || !Number.isInteger(ticket.context_version) || plan.version !== 2 || queued.has(plan.id) || held.has(ticket.id)) continue;
      const messages = await supabase.from('ticket_messages').select('*').eq('ticket_id', ticket.id).order('created_at');
      if (messages.error) continue;
      const verdict = automaticPlanEligibility({ ticket, settings, messages: messages.data as TicketMessage[], fingerprintPlan: autopilotPlanFingerprint, now });
      const inserted = await supabase.from('support_automation_jobs').upsert({ brand_id: settings.brand_id, ticket_id: ticket.id, plan_id: plan.id, plan_fingerprint: autopilotPlanFingerprint(plan), context_version: ticket.context_version, status: verdict.eligible ? 'scheduled' : 'needs_review', scheduled_for: scheduledRunTime(now, randomInt(0, 900001) / 900000), reason: verdict.reason, confidence: verdict.candidate?.effectiveConfidence || Math.max(0, Math.min(1, plan.analysis.overall_confidence || 0)), plan_snapshot: plan }, { onConflict: 'plan_id', ignoreDuplicates: true }).select('id');
      if (inserted.error) throw new Error('Could not persist the scheduled support action.');
      if (inserted.data?.length) verdict.eligible ? scheduled++ : reviewed++;
    }
  }

  const enabledBrands = (settingsResult.data || []).map(s => s.brand_id);
  if (!enabledBrands.length) return { scheduled, completed, reviewed };
  const due = await supabase.from('support_automation_jobs').select('*').in('brand_id', enabledBrands).eq('status', 'scheduled').lte('scheduled_for', now.toISOString()).order('scheduled_for').limit(1);
  if (due.error) throw new Error('Could not load due support actions.');
  for (const original of (due.data || []) as SupportAutomationJob[]) {
    const claimed = await supabase.rpc('claim_support_automation_job', { p_job_id: original.id });
    if (claimed.error) throw new Error('Could not claim the scheduled support action.');
    const job = (claimed.data as SupportAutomationJob[] | null)?.[0];
    if (!job) {
      // A changed plan/customer reply invalidates this exact frozen job. A new
      // plan receives a new delay; do not substitute it into the old job.
      const live = await supabase.from('tickets').select('context_version,metadata,status').eq('id', original.ticket_id).eq('brand_id', original.brand_id).single();
      if (!live.error && (live.data.context_version !== original.context_version || live.data.metadata?.autopilot?.id !== original.plan_id || live.data.metadata?.autopilot?.status !== 'proposed' || !['open','pending'].includes(live.data.status))) {
        await supabase.from('support_automation_jobs').update({ status: 'cancelled', reason: 'Ticket or plan changed before execution.' }).eq('id', original.id).eq('status', 'scheduled');
      }
      continue;
    }
    try {
      const [ticketResult, messages, settings, brand] = await Promise.all([
        supabase.from('tickets').select('*').eq('id', job.ticket_id).eq('brand_id', job.brand_id).single(),
        supabase.from('ticket_messages').select('*').eq('ticket_id', job.ticket_id).order('created_at'),
        supabase.from('support_automation_settings').select('*').eq('brand_id', job.brand_id).single(),
        supabase.from('brands').select('id,slug,name').eq('id', job.brand_id).single(),
      ]);
      if (ticketResult.error || messages.error || settings.error || brand.error) throw new Error('Execution evidence is unavailable.');
      const ticket = ticketResult.data as Ticket;
      const plan = ticketAutopilot(ticket);
      if (!plan || autopilotPlanFingerprint(plan) !== job.plan_fingerprint) throw new Error('The frozen plan changed before execution.');
      const eligibility = automaticPlanEligibility({ ticket, settings: settings.data as SupportAutomationSettings, messages: messages.data as TicketMessage[], fingerprintPlan: autopilotPlanFingerprint });
      if (!eligibility.eligible) throw new Error(eligibility.reason);
      await executionFence(job);
      const candidate = eligibility.candidate;
      const request = new NextRequest(`http://supportos.internal/api/autopilot/${job.ticket_id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision: 'approve', decision_mode: 'batch_threshold', idempotency_key: job.id, plan_id: candidate.planId, plan_revision: candidate.planRevision, plan_fingerprint: job.plan_fingerprint, context_version: candidate.contextVersion, context_fingerprint: candidate.contextFingerprint, actions: candidate.actionVerdicts }) });
      // Internal identity is constructed only after secret-authenticated worker
      // dispatch and DB brand lookup; never accepted from an HTTP request body.
      const result = await executeAutopilotRequest(request, { params: Promise.resolve({ id: job.ticket_id }) }, { brandId: job.brand_id, brandSlug: brand.data.slug, brandName: brand.data.name, role: 'admin', name: 'SupportOS Automation' }, async () => {
        if (Date.now() > workerDeadline) throw new Error('Execution time budget reached. Review remaining actions before resuming.');
        await executionFence(job);
      });
      const body = await result.json();
      if (!result.ok || body.plan?.status !== 'executed') {
        await holdTicket(job, typeof body.error === 'string' ? body.error : 'Execution needs review. Inspect the receipts before retrying.');
        reviewed++;
      } else {
        const receipts = await supabase.from('autopilot_action_executions').select('id,action_id,action_type,status,result,error,provider_reference,started_at').eq('plan_id', job.plan_id).eq('brand_id', job.brand_id).order('started_at');
        if (receipts.error) throw new Error('Execution finished, but receipts could not be loaded. Review the execution ledger.');
        const saved = await supabase.from('support_automation_jobs').update({ status: 'completed', completed_at: new Date().toISOString(), result: body, plan_snapshot: { ...body.plan, execution_receipts: receipts.data }, reason: 'All planned actions completed and their outcomes were verified.' }).eq('id', job.id).eq('status', 'running');
        if (saved.error) throw new Error('Execution finished, but its queue record could not be finalized.');
        completed++;
      }
    } catch (error) {
      await holdTicket(job, error instanceof Error ? error.message : 'Execution needs review.'); reviewed++;
    }
  }
  return { scheduled, completed, reviewed };
}
