'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import {
  Sparkles, CheckCircle2, XCircle, Loader2, ChevronDown, ChevronUp, Mail,
  Ban, Undo2, MapPin, Tag, AlertTriangle, Flag, Archive, ExternalLink,
  ShieldCheck, Check, CornerDownRight, Wand2, ChevronLeft, ChevronRight, BrainCircuit, Layers3,
} from 'lucide-react';
import {
  BatchRunPanel,
  type AutopilotBatchSummary,
} from '@/components/autopilot/BatchRunPanel';
import type {
  Ticket,
  TicketMessage,
  AutopilotPlan,
  AutopilotAction,
  AutopilotRelatedTicketSnapshot,
} from '@/lib/types';
import { ticketAutopilot, ticketTriage } from '@/lib/types';
import { autopilotPlanRequiresRevision } from '@/lib/autopilot-execution-policy';
import {
  autopilotConflictNeedsRegeneration,
  consolidatedTicketIdsFromPlan,
  requestAutopilotPlanRefresh,
} from '@/lib/autopilot-client';

/**
 * Autopilot review workstation — full-viewport, one plan at a time.
 * Queue rail on the left, the active plan front and center, approve →
 * auto-advance to the next. Built for working a queue down to zero.
 */

// ── meta ─────────────────────────────────────────────────────────────────────

const ACTION_META: Record<string, { icon: typeof Mail; tone: string; label: string }> = {
  send_reply: { icon: Mail, tone: 'var(--color-info)', label: 'Reply' },
  resolve: { icon: CheckCircle2, tone: 'var(--color-success)', label: 'Resolve' },
  close_not_support: { icon: Archive, tone: 'var(--text-tertiary)', label: 'Close' },
  set_priority: { icon: Flag, tone: 'var(--color-warning)', label: 'Priority' },
  add_tags: { icon: Tag, tone: 'var(--color-info)', label: 'Tags' },
  cancel_order: { icon: Ban, tone: 'var(--color-danger)', label: 'Cancel order' },
  refund_order: { icon: Undo2, tone: 'var(--color-source-ai)', label: 'Refund' },
  update_shipping_address: { icon: MapPin, tone: 'var(--color-warning)', label: 'Address' },
  consolidate_related_tickets: { icon: Layers3, tone: 'var(--color-source-ai)', label: 'Consolidate tickets' },
  escalate_human: { icon: AlertTriangle, tone: 'var(--color-danger)', label: 'Needs human' },
};

function confTone(c: number): string {
  if (c >= 0.85) return 'var(--color-success)';
  if (c >= 0.65) return 'var(--color-warning)';
  return 'var(--color-danger)';
}

function isReviewedCalibration(basis?: { sample_count: number; effective_sample_weight: number }): boolean {
  return Boolean(basis && basis.sample_count > 0 && basis.effective_sample_weight > 0);
}

function planConfidenceDisplay(plan: AutopilotPlan): { value: number; calibrated: boolean } {
  const calibrated = isReviewedCalibration(plan.analysis.confidence_basis);
  return {
    value: plan.analysis.overall_confidence,
    calibrated,
  };
}

function actionConfidenceDisplay(action: AutopilotAction): { value: number; calibrated: boolean } {
  const calibrated = isReviewedCalibration(action.confidence_basis);
  return {
    value: action.confidence,
    calibrated,
  };
}

function timeAgo(dateStr: string): string {
  const s = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const sectionLabel: React.CSSProperties = {
  fontSize: 10.5, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase',
  color: 'var(--text-quaternary)',
};

interface CardState {
  approvals: Record<string, boolean>;
  edits: Record<string, string>;
  instruction: string;
}
const EMPTY_CARD: CardState = { approvals: {}, edits: {}, instruction: '' };

function cardStateKey(ticket: Ticket): string {
  const plan = ticketAutopilot(ticket);
  return `${ticket.id}:${plan?.id ?? 'legacy'}:${plan?.revision ?? plan?.revision_count ?? 0}`;
}

function cardHasLocalChanges(ticket: Ticket, state: CardState | undefined): boolean {
  if (!state) return false;
  if (state.instruction.trim()) return true;
  if (Object.values(state.approvals).some((approved) => approved === false)) return true;
  const plan = ticketAutopilot(ticket);
  return Object.entries(state.edits).some(([actionId, editedText]) => {
    const action = plan?.actions.find((candidate) => candidate.id === actionId);
    if (!action || action.type !== 'send_reply') return true;
    return editedText.trim() !== String(action.params.reply_text ?? '').trim();
  });
}

interface LearningStats {
  available: boolean;
  reviewed_runs: number;
  active_memories: number;
  candidate_memories: number;
  average_memory_confidence: number;
  human_revisions: number;
  last_reviewed_at: string | null;
}
type ExecutionReceipt = NonNullable<AutopilotPlan['execution_receipts']>[number];

const EMPTY_LEARNING: LearningStats = {
  available: false,
  reviewed_runs: 0,
  active_memories: 0,
  candidate_memories: 0,
  average_memory_confidence: 0,
  human_revisions: 0,
  last_reviewed_at: null,
};

// ── page ─────────────────────────────────────────────────────────────────────

export default function AutopilotPage() {
  const [tab, setTab] = useState<'pending' | 'done' | 'dismissed'>('pending');
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [counts, setCounts] = useState({ pending: 0, done: 0, dismissed: 0 });
  const [learning, setLearning] = useState<LearningStats>(EMPTY_LEARNING);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [cardState, setCardState] = useState<Record<string, CardState>>({});
  const [running, setRunning] = useState(false);
  const [revising, setRevising] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchRunning, setBatchRunning] = useState(false);
  const [reconcilingReceipt, setReconcilingReceipt] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ type: 'success' | 'warning' | 'error'; text: string } | null>(null);
  const decisionOperationsRef = useRef(new Map<string, { signature: string; key: string }>());
  const initialTicketSelectionAppliedRef = useRef(false);
  const ticketContextVersionsRef = useRef(new Map<string, number | null>());
  const [, setClockTick] = useState(0);

  // Conversation threads, fetched lazily for the active ticket only
  const [threads, setThreads] = useState<Record<string, TicketMessage[]>>({});

  const load = useCallback(async (
    background = false,
    anchor?: { ticketId: string | null; index: number },
  ): Promise<Ticket[]> => {
    if (!background) setLoading(true);
    try {
      const res = await fetch(`/api/autopilot?tab=${tab}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('Queue request failed');
      const data = await res.json();
      const list: Ticket[] = data.tickets ?? [];
      // Oldest first for pending — work the queue in arrival order
      if (tab === 'pending') {
        list.sort((a, b) => {
          const pa = ticketAutopilot(a)?.proposed_at ?? '';
          const pb = ticketAutopilot(b)?.proposed_at ?? '';
          return pa.localeCompare(pb);
        });
      }
      const changedContextTicketIds = new Set<string>();
      for (const ticket of list) {
        const contextVersion = Number.isInteger(ticket.context_version)
          ? Number(ticket.context_version)
          : null;
        const previousVersion = ticketContextVersionsRef.current.get(ticket.id);
        if (previousVersion !== undefined && previousVersion !== contextVersion) {
          changedContextTicketIds.add(ticket.id);
        }
        ticketContextVersionsRef.current.set(ticket.id, contextVersion);
      }
      if (changedContextTicketIds.size > 0) {
        setThreads((current) => {
          const hasCachedChange = [...changedContextTicketIds].some((ticketId) => (
            Object.prototype.hasOwnProperty.call(current, ticketId)
          ));
          if (!hasCachedChange) return current;
          return Object.fromEntries(
            Object.entries(current).filter(([ticketId]) => !changedContextTicketIds.has(ticketId)),
          );
        });
      }
      setTickets(list);
      setCounts(data.counts ?? { pending: 0, done: 0, dismissed: 0 });
      setLearning(data.learning ?? EMPTY_LEARNING);
      const shouldApplyRequestedTicket = !background && !initialTicketSelectionAppliedRef.current;
      const requestedTicket = shouldApplyRequestedTicket && typeof window !== 'undefined'
        ? new URLSearchParams(window.location.search).get('ticket')
        : null;
      if (shouldApplyRequestedTicket) initialTicketSelectionAppliedRef.current = true;
      setActiveId((prev) => {
        if (requestedTicket && list.some((ticket) => ticket.id === requestedTicket)) return requestedTicket;
        if (anchor?.ticketId && list.some((ticket) => ticket.id === anchor.ticketId)) return anchor.ticketId;
        if (prev && list.some((ticket) => ticket.id === prev)) return prev;
        if (anchor) return list[Math.min(Math.max(0, anchor.index), Math.max(0, list.length - 1))]?.id ?? null;
        return list[0]?.id ?? null;
      });
      if (!background) setLoading(false);
      return list;
    } catch {
      if (!background) setTickets([]);
    }
    if (!background) setLoading(false);
    return [];
  }, [tab]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const timer = setInterval(() => setClockTick((value) => value + 1), 15_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 4500);
    return () => clearTimeout(t);
  }, [flash]);

  const active = useMemo(() => tickets.find((t) => t.id === activeId) ?? null, [tickets, activeId]);
  const activeIndex = useMemo(() => tickets.findIndex((t) => t.id === activeId), [tickets, activeId]);
  const activeThread = activeId ? threads[activeId] : undefined;

  // Load the conversation for the active ticket (once per ticket)
  useEffect(() => {
    if (!activeId || activeThread !== undefined) return;
    const controller = new AbortController();
    fetch(`/api/tickets/${activeId}`, { cache: 'no-store', signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error('Conversation request failed');
        return response.json();
      })
      .then((d) => {
        if (Array.isArray(d.messages)) {
          setThreads((prev) => ({ ...prev, [activeId]: d.messages }));
        }
      })
      .catch(() => {});
    return () => controller.abort();
  }, [activeId, activeThread]);

  const getState = (ticket: Ticket): CardState => cardState[cardStateKey(ticket)] ?? EMPTY_CARD;
  const patchState = (ticket: Ticket, patch: Partial<CardState>) => {
    const key = cardStateKey(ticket);
    setCardState((prev) => ({ ...prev, [key]: { ...(prev[key] ?? EMPTY_CARD), ...patch } }));
  };
  const batchExcludedTicketIds = useMemo(
    () => tickets.filter((ticket) => cardHasLocalChanges(ticket, cardState[cardStateKey(ticket)])).map((ticket) => ticket.id),
    [cardState, tickets],
  );

  const goRelative = useCallback((delta: number) => {
    if (tickets.length === 0) return;
    const next = Math.min(tickets.length - 1, Math.max(0, (activeIndex < 0 ? 0 : activeIndex) + delta));
    setActiveId(tickets[next]?.id ?? null);
  }, [tickets, activeIndex]);

  const advanceAfterDecision = useCallback((decidedId: string, relatedTicketIds: string[] = []) => {
    const removedIds = new Set([decidedId, ...relatedTicketIds]);
    setTickets((prev) => {
      const idx = prev.findIndex((t) => t.id === decidedId);
      const removedCount = prev.filter((ticket) => removedIds.has(ticket.id)).length;
      const next = prev.filter((ticket) => !removedIds.has(ticket.id));
      setActiveId(next[Math.min(idx, next.length - 1)]?.id ?? null);
      if (removedCount > 0) {
        setCounts((current) => ({
          ...current,
          pending: Math.max(0, current.pending - removedCount),
        }));
      }
      return next;
    });
  }, []);

  const decide = useCallback(async (ticket: Ticket, decision: 'approve' | 'dismiss') => {
    const state = getState(ticket);
    const stateKey = cardStateKey(ticket);
    const plan = ticketAutopilot(ticket);
    if (!plan || running || batchRunning) return;
    if (plan.version !== 2 || !plan.id || !plan.context_fingerprint || !Number.isInteger(plan.context_version)) {
      setRunning(true);
      const refresh = await requestAutopilotPlanRefresh({
        ticketId: ticket.id,
        planId: plan.id,
        planRevision: plan.revision ?? plan.revision_count ?? 0,
        contextFingerprint: plan.context_fingerprint,
        contextVersion: plan.context_version,
        reason: 'LEGACY_PLAN',
      });
      const refreshed = refresh.ok
        ? await load(true, { ticketId: ticket.id, index: activeIndex })
        : [];
      const replacement = refreshed.find((item) => item.id === ticket.id);
      const replacementPlan = replacement ? ticketAutopilot(replacement) : null;
      setFlash({
        type: refresh.ok ? 'warning' : 'error',
        text: refresh.ok && replacementPlan
          ? `Nothing ran. Autopilot rebuilt legacy ticket #${ticket.ticket_number} as revision ${replacementPlan.revision ?? replacementPlan.revision_count ?? 0}; review it before approving.`
          : `Nothing ran. Ticket #${ticket.ticket_number} could not be regenerated: ${refresh.error || 'try again shortly.'}`,
      });
      setRunning(false);
      return;
    }
    if (decision === 'approve' && autopilotPlanRequiresRevision(plan)) {
      setFlash({
        type: 'warning',
        text: `#${ticket.ticket_number} cannot run because safety validation requires a reviewer-guided revision.`,
      });
      return;
    }

    if (decision === 'approve' && !plan.actions.some((a) => (
      plan.status === 'executing' ? a.status !== 'skipped' : state.approvals[a.id] !== false
    ))) {
      setFlash({ type: 'error', text: 'All actions are unchecked — nothing to run.' });
      return;
    }

    const submittedActions = plan.actions.map((a) => ({
      id: a.id,
      approved: plan.status === 'executing' ? a.status !== 'skipped' : state.approvals[a.id] !== false,
      ...(a.type === 'send_reply'
        ? plan.status === 'executing'
          ? { reply_text: String(a.params.reply_text ?? '') }
          : Object.prototype.hasOwnProperty.call(state.edits, a.id)
            ? { reply_text: state.edits[a.id] }
            : {}
        : {}),
    }));
    const operationSignature = JSON.stringify({
      decision,
      planId: plan.id,
      revision: plan.revision ?? plan.revision_count ?? 0,
      actions: submittedActions,
    });
    const existingOperation = plan.execution_attempt_id
      ? { signature: operationSignature, key: plan.execution_attempt_id }
      : decisionOperationsRef.current.get(ticket.id);
    const operationKey = existingOperation?.signature === operationSignature
      ? existingOperation.key
      : crypto.randomUUID();
    decisionOperationsRef.current.set(ticket.id, { signature: operationSignature, key: operationKey });

    setRunning(true);
    try {
      const res = await fetch(`/api/autopilot/${ticket.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision,
          decision_mode: 'individual_review',
          plan_id: plan.id,
          plan_revision: plan.revision ?? plan.revision_count ?? 0,
          context_fingerprint: plan.context_fingerprint,
          context_version: plan.context_version,
          idempotency_key: operationKey,
          actions: submittedActions,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const stale = res.status === 409 || res.status === 412;
        if (stale) {
          const conflictCode = typeof data.code === 'string' ? data.code : null;
          const needsRegeneration = autopilotConflictNeedsRegeneration(conflictCode);
          const refresh = needsRegeneration
            ? await requestAutopilotPlanRefresh({
                ticketId: ticket.id,
                planId: plan.id,
                planRevision: plan.revision ?? plan.revision_count ?? 0,
                contextFingerprint: plan.context_fingerprint,
                contextVersion: plan.context_version,
                reason: conflictCode ?? 'stale_conflict',
              })
            : null;
          decisionOperationsRef.current.delete(ticket.id);
          setThreads((prev) => {
            if (!Object.prototype.hasOwnProperty.call(prev, ticket.id)) return prev;
            const next = { ...prev };
            delete next[ticket.id];
            return next;
          });
          setCardState((prev) => {
            const next = { ...prev };
            delete next[stateKey];
            return next;
          });
          const refreshed = await load(true, { ticketId: ticket.id, index: activeIndex });
          const replacement = refreshed.find((item) => item.id === ticket.id);
          const replacementPlan = replacement ? ticketAutopilot(replacement) : null;
          const revision = replacementPlan?.revision ?? replacementPlan?.revision_count ?? 0;
          const replacementAdvanced = Boolean(
            replacementPlan
            && (
              replacementPlan.id !== plan.id
              || revision > (plan.revision ?? plan.revision_count ?? 0)
            ),
          );
          setFlash({
            type: refresh && !refresh.ok ? 'error' : 'warning',
            text: needsRegeneration && refresh?.ok && replacementPlan && replacementAdvanced
              ? `Nothing ran. ${data.error || 'Live evidence no longer matched the draft.'} Autopilot rebuilt revision ${revision}; review the updated draft before approving.`
              : needsRegeneration && refresh && !refresh.ok
                ? `Nothing ran. ${data.error || 'The plan became stale.'} Automatic regeneration failed: ${refresh.error || 'try again shortly.'}`
              : replacementPlan
                ? `Nothing ran. ${data.error || 'The plan changed.'} Loaded revision ${revision} for review.`
                : `Nothing ran. ${data.error || 'The plan changed.'} It is no longer in the pending queue.`,
          });
        } else {
          setFlash({ type: 'error', text: data.error || 'Failed' });
        }
      } else if (res.status === 202 && data.reconciliation_required === true) {
        // Keep the exact operation key. The provider may have completed the
        // mutation, so repeating it is unsafe until the durable receipt is
        // reconciled from the live provider state.
        setFlash({
          type: 'warning',
          text: `#${ticket.ticket_number} paused safely: ${data.error || 'a provider result is still being verified.'} No later action ran. Open the receipt details to reconcile and resume this same run.`,
        });
        await load(true);
      } else if (res.status === 202 && data.in_progress === true) {
        // Keep the stable execution key. Another worker still owns a live
        // fenced lease, so this request is observational rather than terminal.
        setFlash({
          type: 'success',
          text: `#${ticket.ticket_number} is still executing. The queue will keep it available until the active run finishes.`,
        });
        await load(true);
      } else if (decision === 'dismiss') {
        decisionOperationsRef.current.delete(ticket.id);
        setFlash({ type: 'success', text: `#${ticket.ticket_number} dismissed` });
        advanceAfterDecision(ticket.id);
        await load(true, { ticketId: null, index: activeIndex });
      } else {
        decisionOperationsRef.current.delete(ticket.id);
        const p = data.plan as AutopilotPlan;
        const ok = p.actions.filter((a) => a.status === 'executed').length;
        const bad = p.actions.filter((a) => a.status === 'failed').length;
        setFlash({
          type: bad === 0 ? 'success' : 'error',
          text: bad === 0
            ? `#${ticket.ticket_number} done — ${ok} action${ok === 1 ? '' : 's'} executed${data.learning_captured ? '; learning captured' : ''}`
            : `#${ticket.ticket_number} — ${ok} executed, ${bad} failed (see Executed tab)`,
        });
        advanceAfterDecision(ticket.id, consolidatedTicketIdsFromPlan(p));
        await load(true, { ticketId: null, index: activeIndex });
      }
    } catch {
      setFlash({ type: 'error', text: 'Request failed' });
    }
    setRunning(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, batchRunning, cardState, advanceAfterDecision, activeIndex, load]);

  const reconcile = useCallback(async (
    ticket: Ticket,
    receipt: ExecutionReceipt,
    outcome: 'executed' | 'failed',
  ) => {
    if (reconcilingReceipt) return;
    const providerName = receipt.action_type === 'send_reply' ? 'Resend' : 'Shopify/provider';
    const verified = window.confirm(
      outcome === 'executed'
        ? `Confirm that you checked ${providerName} and found this exact operation completed. This records a high-trust execution label.`
        : `Confirm that you checked ${providerName} after the safety window and verified this exact operation did not complete. Do not continue if the provider result is still pending or unclear.`,
    );
    if (!verified) return;
    const note = window.prompt(
      outcome === 'executed'
        ? `Enter the ${providerName} reference or verification note proving this action completed:`
        : `Enter the ${providerName} reference or verification note proving this action did not complete:`,
    )?.trim();
    if (!note) return;
    setReconcilingReceipt(receipt.id);
    try {
      const response = await fetch(`/api/autopilot/${ticket.id}/reconcile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ receipt_id: receipt.id, outcome, note, provider_verified: true }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Reconciliation failed');
      setFlash({
        type: payload.resume_safe === true ? 'success' : 'error',
        text: payload.resume_safe === true
          ? 'Provider outcome recorded. Resume the original run to finalize it safely.'
          : payload.terminalized === true
            ? 'Provider outcome recorded. Ticket context had changed, so the stale run was closed without executing remaining actions.'
            : 'Provider outcome recorded, but ticket context changed. Finalize the stale run; no remaining action will execute.',
      });
      await load(true);
    } catch (error) {
      setFlash({ type: 'error', text: error instanceof Error ? error.message : 'Reconciliation failed' });
    } finally {
      setReconcilingReceipt(null);
    }
  }, [load, reconcilingReceipt]);

  const revise = useCallback(async (ticket: Ticket) => {
    const stateKey = cardStateKey(ticket);
    const instruction = getState(ticket).instruction.trim();
    if (!instruction || revising) return;
    const pendingPlan = ticketAutopilot(ticket);
    if (!pendingPlan) return;
    setRevising(true);
    try {
      const res = await fetch(`/api/autopilot/${ticket.id}/revise`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instruction,
          plan_id: pendingPlan.id,
          plan_revision: pendingPlan.revision ?? pendingPlan.revision_count ?? 0,
          context_fingerprint: pendingPlan.context_fingerprint,
          context_version: pendingPlan.context_version,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const stale = res.status === 409 || res.status === 412;
        if (stale) {
          setThreads((prev) => {
            if (!Object.prototype.hasOwnProperty.call(prev, ticket.id)) return prev;
            const next = { ...prev };
            delete next[ticket.id];
            return next;
          });
          setCardState((prev) => {
            const next = { ...prev };
            delete next[stateKey];
            return next;
          });
          await load(true, { ticketId: ticket.id, index: activeIndex });
          setFlash({
            type: 'warning',
            text: `Revision was not applied. ${data.error || 'The plan changed.'} The latest plan is loaded for review.`,
          });
        } else {
          setFlash({ type: 'error', text: data.error || 'Revision failed' });
        }
      } else {
        setFlash({ type: 'success', text: 'Plan revised' });
        setCardState((prev) => {
          const next = { ...prev };
          delete next[stateKey];
          return next;
        });
        await load(true, { ticketId: ticket.id, index: activeIndex });
      }
    } catch {
      setFlash({ type: 'error', text: 'Revision failed' });
    }
    setRevising(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revising, cardState, load, activeIndex]);

  const handleBatchComplete = useCallback(async (summary: AutopilotBatchSummary) => {
    const succeededTicketIds = new Set(
      summary.results
        .filter((result) => result.status === 'succeeded')
        .map((result) => result.candidate.ticketId),
    );
    if (succeededTicketIds.size > 0) {
      setCardState((current) => Object.fromEntries(
        Object.entries(current).filter(([key]) => (
          ![...succeededTicketIds].some((ticketId) => key.startsWith(`${ticketId}:`))
        )),
      ));
    }
    await load(true, { ticketId: activeId, index: activeIndex });
    const unresolved = summary.stale + summary.failed + summary.inProgress + summary.notRun;
    setFlash({
      type: summary.failed > 0 ? 'error' : unresolved > 0 ? 'warning' : 'success',
      text: unresolved === 0
        ? `Batch complete — ${summary.succeeded} plan${summary.succeeded === 1 ? '' : 's'} executed; each result was captured for learning.`
        : `Batch finished: ${summary.succeeded} completed, ${summary.stale} refreshed/skipped, ${summary.failed} failed, ${summary.inProgress} still running, ${summary.notRun} not started.`,
    });
  }, [activeId, activeIndex, load]);

  // Keyboard: ←/→ or J/K navigate · ⌘↵ approve & run · D dismiss
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (batchOpen) return;
      const el = document.activeElement as HTMLElement | null;
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        if (active && tab === 'pending') { e.preventDefault(); decide(active, 'approve'); }
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'ArrowRight' || e.key === 'j' || e.key === 'J') { e.preventDefault(); goRelative(1); }
      else if (e.key === 'ArrowLeft' || e.key === 'k' || e.key === 'K') { e.preventDefault(); goRelative(-1); }
      else if ((e.key === 'd' || e.key === 'D') && active && tab === 'pending') { e.preventDefault(); decide(active, 'dismiss'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, tab, decide, goRelative, batchOpen]);

  const tabs = [
    { key: 'pending' as const, label: 'Queue', count: counts.pending },
    { key: 'done' as const, label: 'Executed', count: counts.done },
    { key: 'dismissed' as const, label: 'Dismissed', count: counts.dismissed },
  ];

  return (
    // Break out of the shell's 1400px container to full viewport width
    <div className="os-review-workstation">
      <div
        className="grid grid-cols-1 lg:grid-cols-[minmax(260px,320px)_minmax(0,1fr)]"
        style={{
          height: 'calc(100dvh - 125px)',
          background: 'var(--bg-secondary)',
        }}
      >
        {/* ════ Queue rail ════ */}
        <aside
          className="hidden lg:flex flex-col min-h-0"
          style={{ borderRight: '1px solid var(--border-primary)', background: 'var(--bg-primary)' }}
        >
          <div className="px-4 pt-4 pb-3" style={{ borderBottom: '1px solid var(--border-secondary)' }}>
            <div className="flex items-center gap-2">
              <Sparkles size={16} style={{ color: 'var(--color-source-ai)' }} />
              <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>Plan review</span>
              <div className="flex-1" />
              <Link href="/support" title="View scheduled actions and automatic execution history"><ShieldCheck size={13} style={{ color: 'var(--color-success)' }} /></Link>
            </div>
            <div className="flex items-center gap-1 mt-3">
              {tabs.map((t) => {
                const isActive = tab === t.key;
                return (
                  <button
                    key={t.key}
                    onClick={() => setTab(t.key)}
                    className="inline-flex items-center gap-1.5"
                    style={{
                      fontSize: 11.5, fontWeight: 600, padding: '4px 9px', borderRadius: 7,
                      background: isActive ? 'var(--bg-tertiary)' : 'transparent',
                      color: isActive ? 'var(--text-primary)' : 'var(--text-tertiary)',
                    }}
                  >
                    {t.label}
                    <span style={{ fontSize: 10.5, fontVariantNumeric: 'tabular-nums', color: 'var(--text-quaternary)' }}>{t.count}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto py-1.5">
            {tickets.map((t, i) => {
              const p = ticketAutopilot(t);
              const isActive = t.id === activeId;
              const confidence = p ? planConfidenceDisplay(p) : null;
              const tone = confidence ? confTone(confidence.value) : 'var(--text-quaternary)';
              return (
                <button
                  key={t.id}
                  onClick={() => setActiveId(t.id)}
                  className="w-full text-left px-4 py-2.5 block"
                  style={{
                    background: isActive ? 'var(--bg-secondary)' : 'transparent',
                    borderLeft: `2.5px solid ${isActive ? 'var(--color-accent)' : 'transparent'}`,
                  }}
                >
                  <div className="flex items-center gap-2">
                    <span style={{ fontSize: 10.5, color: 'var(--text-quaternary)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                      {i + 1}.
                    </span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                      #{t.ticket_number}
                    </span>
                    <span className="truncate" style={{ fontSize: 12.5, fontWeight: isActive ? 650 : 500, color: 'var(--text-primary)' }}>
                      {t.subject}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5" style={{ paddingLeft: 22 }}>
                    <span className="truncate" style={{ fontSize: 11, color: 'var(--text-tertiary)', maxWidth: 150 }}>
                      {t.customer_name || t.customer_email}
                    </span>
                    {p && (
                      <span
                        title={confidence?.calibrated
                          ? 'Reviewed-calibrated effective confidence'
                          : 'Policy-capped effective confidence; no reviewed calibration samples yet'}
                        style={{ fontSize: 10.5, fontWeight: 700, color: tone, fontVariantNumeric: 'tabular-nums', marginLeft: 'auto' }}
                      >
                        {((confidence?.value ?? 0) * 100).toFixed(0)}% {confidence?.calibrated ? 'cal.' : 'guarded'}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
            {!loading && tickets.length === 0 && (
              <p className="px-4 py-6 text-center" style={{ fontSize: 12, color: 'var(--text-quaternary)' }}>
                {tab === 'pending' ? 'Queue is clear' : 'Empty'}
              </p>
            )}
          </div>
        </aside>

        {/* ════ Focus pane ════ */}
        <div className="flex flex-col min-h-0 min-w-0">
          {/* progress strip */}
          <div
            className="flex min-h-[50px] flex-wrap items-center gap-2 px-3 py-2 sm:gap-3 sm:px-5 flex-shrink-0"
            style={{ borderBottom: '1px solid var(--border-primary)', background: 'var(--bg-primary)' }}
          >
            <select
              aria-label="Autopilot queue view"
              value={tab}
              onChange={(event) => setTab(event.target.value as typeof tab)}
              className="rounded-md px-2 py-1.5 lg:hidden"
              style={{
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-primary)',
                color: 'var(--text-primary)',
                fontSize: 12,
                fontWeight: 650,
              }}
            >
              {tabs.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.label} ({item.count})
                </option>
              ))}
            </select>
            {tab === 'pending' && tickets.length > 0 && activeIndex >= 0 ? (
              <>
                <span style={{ fontSize: 13, color: 'var(--text-tertiary)', fontVariantNumeric: 'tabular-nums' }}>
                  <strong style={{ color: 'var(--text-primary)', fontWeight: 700 }}>{activeIndex + 1}</strong> of {tickets.length} in queue
                </span>
                <span className="hidden sm:block" style={{ width: 120, height: 5, borderRadius: 99, background: 'var(--bg-tertiary)', overflow: 'hidden' }}>
                  <span style={{ display: 'block', height: '100%', width: `${((activeIndex + 1) / tickets.length) * 100}%`, background: 'var(--color-accent)', transition: 'width 180ms ease' }} />
                </span>
              </>
            ) : (
              <span style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>
                {tab === 'done' ? 'Executed plans' : tab === 'dismissed' ? 'Dismissed plans' : ''}
              </span>
            )}

            {flash && (
              <span
                role={flash.type === 'error' ? 'alert' : 'status'}
                aria-live={flash.type === 'error' ? 'assertive' : 'polite'}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md"
                style={{
                  fontSize: 12, fontWeight: 600,
                  color: flash.type === 'success'
                    ? 'var(--color-success)'
                    : flash.type === 'warning'
                      ? 'var(--color-warning)'
                      : 'var(--color-danger)',
                  background: `color-mix(in srgb, ${
                    flash.type === 'success'
                      ? 'var(--color-success)'
                      : flash.type === 'warning'
                        ? 'var(--color-warning)'
                        : 'var(--color-danger)'
                  } 10%, transparent)`,
                }}
              >
                {flash.type === 'success'
                  ? <CheckCircle2 size={13} />
                  : flash.type === 'warning'
                    ? <AlertTriangle size={13} />
                    : <XCircle size={13} />}
                {flash.text}
              </span>
            )}

            <div className="flex-1" />
            {tab === 'pending' && tickets.length > 0 && (
              <button
                onClick={() => setBatchOpen(true)}
                disabled={running || revising || batchRunning}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg disabled:opacity-40"
                style={{
                  fontSize: 11.5,
                  fontWeight: 700,
                  color: 'var(--color-source-ai)',
                  border: '1px solid color-mix(in srgb, var(--color-source-ai) 28%, var(--border-primary))',
                  background: 'color-mix(in srgb, var(--color-source-ai) 8%, transparent)',
                }}
              >
                <Layers3 size={13} />
                Batch approve &amp; run
              </button>
            )}
            {learning.available && (
              <span
                className="hidden md:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md"
                title={`${learning.reviewed_runs} reviewed runs; ${learning.human_revisions} human revisions; ${learning.candidate_memories} candidate memories awaiting more evidence; ${Math.round(learning.average_memory_confidence * 100)}% average confidence among active memories`}
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: 'var(--color-source-ai)',
                  background: 'color-mix(in srgb, var(--color-source-ai) 9%, transparent)',
                }}
              >
                <BrainCircuit size={12} />
                {learning.reviewed_runs} reviews · {learning.active_memories} active memories
                {learning.active_memories > 0 && ` · ${Math.round(learning.average_memory_confidence * 100)}% avg active-memory confidence`}
              </span>
            )}
            <span className="hidden xl:inline" style={{ fontSize: 11, color: 'var(--text-quaternary)' }}>
              <kbd style={kbd}>←</kbd><kbd style={kbd}>→</kbd> move · <kbd style={kbd}>⌘↵</kbd> approve & run · <kbd style={kbd}>D</kbd> dismiss
            </span>
            <div className="flex items-center gap-1.5">
              <button onClick={() => goRelative(-1)} disabled={activeIndex <= 0} style={{ ...navBtn, opacity: activeIndex <= 0 ? 0.35 : 1 }} title="Previous (←/K)">
                <ChevronLeft size={15} />
              </button>
              <button onClick={() => goRelative(1)} disabled={activeIndex >= tickets.length - 1} style={{ ...navBtn, opacity: activeIndex >= tickets.length - 1 ? 0.35 : 1 }} title="Next (→/J)">
                <ChevronRight size={15} />
              </button>
            </div>
          </div>

          {/* active plan */}
          {loading ? (
            <div className="flex-1 grid place-items-center">
              <span className="inline-flex items-center gap-2" style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>
                <Loader2 size={15} className="animate-spin" /> Loading…
              </span>
            </div>
          ) : !active ? (
            <div className="flex-1 grid place-items-center">
              <div className="text-center">
                <Sparkles size={30} className="mx-auto mb-3" style={{ color: 'var(--text-quaternary)' }} />
                <p style={{ fontSize: 14, fontWeight: 650, color: 'var(--text-secondary)' }}>
                  {tab === 'pending' ? 'Queue is clear — nice work' : 'Nothing here yet'}
                </p>
                {tab === 'pending' && (
                  <p className="mt-1" style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                    New tickets are analyzed automatically as email syncs.
                  </p>
                )}
              </div>
            </div>
          ) : (
            <FocusPlan
              key={cardStateKey(active)}
              ticket={active}
              messages={threads[active.id]}
              state={getState(active)}
              patch={(p) => patchState(active, p)}
              pending={tab === 'pending'}
              running={running || batchRunning}
              revising={revising}
              reconcilingReceipt={reconcilingReceipt}
              onDecide={(d) => decide(active, d)}
              onRevise={() => revise(active)}
              onReconcile={(receipt, outcome) => reconcile(active, receipt, outcome)}
            />
          )}
        </div>
      </div>
      <BatchRunPanel
        open={batchOpen}
        excludeTicketIds={batchExcludedTicketIds}
        onClose={() => {
          if (!batchRunning) setBatchOpen(false);
        }}
        onRunningChange={setBatchRunning}
        onComplete={handleBatchComplete}
      />
    </div>
  );
}

const kbd: React.CSSProperties = {
  fontFamily: 'inherit', fontWeight: 700, fontSize: 10, padding: '1px 5px', borderRadius: 4,
  border: '1px solid var(--border-primary)', background: 'var(--bg-tertiary)', margin: '0 2px',
};

const navBtn: React.CSSProperties = {
  display: 'inline-grid', placeItems: 'center', width: 30, height: 30, borderRadius: 8,
  border: '1px solid var(--border-primary)', background: 'var(--bg-primary)', color: 'var(--text-secondary)',
};

// ── focus plan ───────────────────────────────────────────────────────────────

function FocusPlan({
  ticket, messages, state, patch, pending, running, revising, reconcilingReceipt, onDecide, onRevise, onReconcile,
}: {
  ticket: Ticket;
  messages?: TicketMessage[];
  state: CardState;
  patch: (p: Partial<CardState>) => void;
  pending: boolean;
  running: boolean;
  revising: boolean;
  reconcilingReceipt: string | null;
  onDecide: (d: 'approve' | 'dismiss') => void;
  onRevise: () => void;
  onReconcile: (receipt: ExecutionReceipt, outcome: 'executed' | 'failed') => void;
}) {
  const plan = ticketAutopilot(ticket);
  const triage = ticketTriage(ticket);
  const instructionRef = useRef<HTMLTextAreaElement>(null);
  if (!plan) return null;

  const planActions = plan.actions;
  const executing = plan.status === 'executing';
  const liveReservations = plan.execution_receipts?.filter((receipt) => (
    receipt.status === 'reserved'
    && Boolean(receipt.lease_expires_at)
    && Date.parse(receipt.lease_expires_at!) > Date.now()
  )) ?? [];
  const unresolvedReceipts = plan.execution_receipts?.filter((receipt) => (
    receipt.status === 'uncertain'
    || (receipt.status === 'reserved' && !liveReservations.some((live) => live.id === receipt.id))
  )) ?? [];
  const terminalizationNeeded = plan.execution_receipts?.some((receipt) => (
    (receipt.status === 'executed' || receipt.status === 'failed')
    && receipt.context_after === null
  )) ?? false;
  const replyAction = plan.actions.find((a) => a.type === 'send_reply');
  const otherActions = plan.actions.filter((a) => a.type !== 'send_reply');
  const selectedCount = plan.actions.filter((a) => (
    executing ? a.status !== 'skipped' : state.approvals[a.id] !== false
  )).length;
  const confidence = planConfidenceDisplay(plan);
  const overallTone = confTone(confidence.value);
  const busy = running || revising;
  const executionReady = plan.version === 2
    && typeof plan.id === 'string'
    && Boolean(plan.context_fingerprint)
    && Number.isInteger(plan.context_version);
  const reviewOnly = autopilotPlanRequiresRevision(plan);
  const runReady = executionReady && !reviewOnly;
  const rawConfidence = plan.analysis.model_confidence ?? plan.analysis.overall_confidence;
  const confidenceTitle = confidence.calibrated && plan.analysis.confidence_basis
    ? `Calibrated from raw ${Math.round(rawConfidence * 100)}% using ${plan.analysis.confidence_basis.sample_count} relevant reviewed samples (${plan.analysis.confidence_basis.effective_sample_weight.toFixed(1)} effective weight).`
    : `Policy-capped effective confidence is ${Math.round(confidence.value * 100)}% (raw model ${Math.round(rawConfidence * 100)}%); there are no relevant reviewed calibration samples yet.`;

  function toggleActionApproval(actionId: string) {
    const approvals = { ...state.approvals };
    const currentlyApproved = approvals[actionId] !== false;

    if (currentlyApproved) {
      // If a prerequisite is skipped, every direct or transitive dependent must
      // also be skipped so the UI cannot submit an internally invalid plan.
      const skipped = new Set([actionId]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const action of planActions) {
          if (!skipped.has(action.id) && action.depends_on?.some((dependency) => skipped.has(dependency))) {
            skipped.add(action.id);
            changed = true;
          }
        }
      }
      for (const id of skipped) approvals[id] = false;
    } else {
      // Re-selecting a dependent action also re-selects all of its prerequisites.
      const selected = new Set<string>();
      const selectWithDependencies = (id: string) => {
        if (selected.has(id)) return;
        selected.add(id);
        const action = planActions.find((candidate) => candidate.id === id);
        for (const dependency of action?.depends_on ?? []) selectWithDependencies(dependency);
        approvals[id] = true;
      };
      selectWithDependencies(actionId);
    }

    for (const [id, approved] of Object.entries(approvals)) {
      if (approved) delete approvals[id];
    }
    patch({ approvals });
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 relative">
      {revising && (
        <div className="absolute inset-0 z-10 grid place-items-center" style={{ background: 'color-mix(in srgb, var(--bg-secondary) 78%, transparent)', backdropFilter: 'blur(1.5px)' }}>
          <span className="inline-flex items-center gap-2" style={{ fontSize: 14, fontWeight: 650, color: 'var(--color-source-ai)' }}>
            <Loader2 size={16} className="animate-spin" /> Autopilot is revising the plan…
          </span>
        </div>
      )}

      {/* scrollable body */}
      <div className="flex-1 overflow-y-auto min-h-0">
          <div className="px-4 pt-5 pb-4 mx-auto sm:px-6" style={{ maxWidth: 1500 }}>
          {/* header */}
          <div className="flex items-start gap-4 mb-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2.5 flex-wrap" style={{ rowGap: 4 }}>
                <Link
                  href={`/tickets/${ticket.id}`}
                  className="inline-flex items-center gap-1 flex-shrink-0"
                  title="Open the full ticket"
                  style={{ fontSize: 11.5, fontWeight: 700, fontVariantNumeric: 'tabular-nums', padding: '3px 9px', borderRadius: 7, background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}
                >
                  #{ticket.ticket_number} <ExternalLink size={10} />
                </Link>
                <h1 className="truncate" style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>
                  {ticket.subject}
                </h1>
              </div>
              <div className="flex items-center gap-2 mt-1.5 flex-wrap" style={{ fontSize: 12.5, color: 'var(--text-tertiary)' }}>
                <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>{ticket.customer_name || ticket.customer_email}</span>
                <Dot /> <span>{timeAgo(plan.proposed_at)}</span>
                {triage?.sentiment && (triage.sentiment === 'angry' || triage.sentiment === 'frustrated') && (
                  <><Dot /><span className="capitalize" style={{ fontWeight: 650, color: triage.sentiment === 'angry' ? 'var(--color-danger)' : 'var(--color-warning)' }}>{triage.sentiment} customer</span></>
                )}
                {plan.trigger === 'customer_reply' && (<><Dot /><span style={{ color: 'var(--color-info)', fontWeight: 600 }}>re-planned after reply</span></>)}
              {plan.trigger === 'stale_check' && (<><Dot /><span style={{ color: 'var(--color-warning)', fontWeight: 600 }}>follow-up — ticket still open</span></>)}
                {(plan.revision_count ?? 0) > 0 && (<><Dot /><span style={{ color: 'var(--color-source-ai)', fontWeight: 600 }}>rev {plan.revision_count}</span></>)}
                {plan.generation && (
                  <>
                    <Dot />
                    <span
                      title={`${plan.generation.provider} · ${plan.generation.model} · ${plan.generation.thinking} thinking`}
                      style={{ color: 'var(--color-info)', fontWeight: 650 }}
                    >
                      V4 {plan.generation.tier === 'pro' ? 'Pro · thinking' : 'Flash · non-thinking'}
                    </span>
                  </>
                )}
                {plan.learning && (<><Dot /><span style={{ color: 'var(--color-source-ai)', fontWeight: 600 }}>{plan.learning.reviewed_run_count} reviewed runs · {plan.learning.memory_count} memories considered</span></>)}
              </div>
            </div>
            <span
              className="flex-shrink-0"
              title={confidenceTitle}
              style={{ fontSize: 12, fontWeight: 700, padding: '4px 12px', borderRadius: 99, color: overallTone, background: `color-mix(in srgb, ${overallTone} 11%, transparent)`, fontVariantNumeric: 'tabular-nums' }}
            >
              {(confidence.value * 100).toFixed(0)}% {confidence.calibrated ? 'calibrated' : 'guarded'}
            </span>
          </div>

          {pending && !executionReady && (
            <section
              className="mb-4 flex items-start gap-3 rounded-xl px-4 py-3"
              style={{
                border: '1px solid color-mix(in srgb, var(--color-warning) 42%, var(--border-primary))',
                background: 'color-mix(in srgb, var(--color-warning) 8%, var(--bg-primary))',
              }}
            >
              <AlertTriangle size={16} style={{ color: 'var(--color-warning)', marginTop: 1, flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)' }}>Legacy plan awaiting regeneration</div>
                <p className="mt-1" style={{ fontSize: 11.5, lineHeight: 1.5, color: 'var(--text-tertiary)' }}>
                  This card predates exact plan and context tokens. It is visible for continuity, but it cannot be approved, revised, or batch-run until the v2 planner replaces it.
                </p>
              </div>
            </section>
          )}

          {executing && (
            <section
              className="mb-4 rounded-xl px-4 py-3"
              style={{
                border: `1px solid ${unresolvedReceipts.length ? 'color-mix(in srgb, var(--color-warning) 45%, var(--border-primary))' : 'var(--border-primary)'}`,
                background: unresolvedReceipts.length
                  ? 'color-mix(in srgb, var(--color-warning) 8%, var(--bg-primary))'
                  : 'var(--bg-primary)',
              }}
            >
              <div className="flex items-start gap-3">
                {liveReservations.length
                  ? <Loader2 size={16} className="animate-spin" style={{ color: 'var(--color-info)', marginTop: 1 }} />
                  : <AlertTriangle size={16} style={{ color: unresolvedReceipts.length ? 'var(--color-warning)' : 'var(--color-info)', marginTop: 1 }} />}
                <div className="flex-1 min-w-0">
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)' }}>
                    {liveReservations.length
                      ? 'Autopilot action is executing'
                      : unresolvedReceipts.length ? 'Provider reconciliation required' : 'Interrupted run ready to resume'}
                  </div>
                  <p className="mt-1" style={{ fontSize: 11.5, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
                    {liveReservations.length
                      ? 'Another request owns a live worker lease. This plan stays in the queue and the provider action will not be started twice.'
                      : unresolvedReceipts.length
                      ? 'Check the provider before choosing an outcome. Autopilot will never repeat an ambiguous side effect automatically.'
                      : 'Resume uses the original operation key and durable receipts; completed actions will not run twice.'}
                  </p>
                  {liveReservations.map((receipt) => {
                    const action = plan.actions.find((candidate) => candidate.id === receipt.action_id);
                    return (
                      <div key={receipt.id} className="mt-2" style={{ fontSize: 11.5, fontWeight: 650, color: 'var(--text-secondary)' }}>
                        {action?.title ?? receipt.action_type} · reserved until {new Date(receipt.lease_expires_at!).toLocaleTimeString()}
                      </div>
                    );
                  })}
                  {unresolvedReceipts.map((receipt) => {
                    const action = plan.actions.find((candidate) => candidate.id === receipt.action_id);
                    const busyReceipt = reconcilingReceipt === receipt.id;
                    const failureReadyAt = receipt.failure_reconcile_after
                      ? Date.parse(receipt.failure_reconcile_after)
                      : Number.POSITIVE_INFINITY;
                    const canConfirmFailed = Number.isFinite(failureReadyAt) && failureReadyAt <= Date.now();
                    return (
                      <div key={receipt.id} className="mt-2 flex items-center gap-2 flex-wrap">
                        <span style={{ fontSize: 11.5, fontWeight: 650, color: 'var(--text-secondary)' }}>
                          {action?.title ?? receipt.action_type} · {receipt.status}
                        </span>
                        <button
                          onClick={() => onReconcile(receipt, 'executed')}
                          disabled={Boolean(reconcilingReceipt)}
                          className="text-xs font-semibold px-2.5 py-1.5 rounded-md disabled:opacity-40"
                          style={{ color: 'var(--color-success)', background: 'color-mix(in srgb, var(--color-success) 10%, transparent)' }}
                        >
                          {busyReceipt ? 'Saving…' : 'Confirm completed'}
                        </button>
                        <button
                          onClick={() => onReconcile(receipt, 'failed')}
                          disabled={Boolean(reconcilingReceipt) || !canConfirmFailed}
                          className="text-xs font-semibold px-2.5 py-1.5 rounded-md disabled:opacity-40"
                          style={{ color: 'var(--color-danger)', background: 'color-mix(in srgb, var(--color-danger) 9%, transparent)' }}
                          title={canConfirmFailed
                            ? 'Confirm only after checking the provider directly.'
                            : receipt.failure_reconcile_after
                              ? `Failure confirmation unlocks after ${new Date(receipt.failure_reconcile_after).toLocaleString()}.`
                              : 'Failure confirmation is unavailable until the provider quiescence window is known.'}
                        >
                          {canConfirmFailed
                            ? 'Confirm not completed'
                            : receipt.failure_reconcile_after
                              ? `Wait until ${new Date(receipt.failure_reconcile_after).toLocaleTimeString()}`
                              : 'Safety window pending'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>
          )}

          {/* two-pane: context+actions | draft */}
          <div
            className={replyAction
              ? 'grid grid-cols-1 gap-5 items-start xl:grid-cols-[minmax(340px,5fr)_minmax(420px,7fr)]'
              : 'grid grid-cols-1 gap-5 items-start'}
          >
            {/* left: customer email + analysis + actions + instruction */}
            <div className="space-y-4 min-w-0">
              <ConversationSection messages={messages} customerName={ticket.customer_name} />

              <section className="ds-card" style={{ padding: '16px 18px' }}>
                <div style={sectionLabel}>Analysis</div>
                <p className="mt-2" style={{ fontSize: 13.5, color: 'var(--text-primary)', lineHeight: 1.6 }}>{plan.analysis.summary}</p>
                {plan.analysis.reasoning && (
                  <p className="mt-2" style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.55 }}>{plan.analysis.reasoning}</p>
                )}
                {reviewOnly && (
                  <div
                    className="mt-3 flex items-start gap-2 rounded-lg px-3 py-2.5"
                    style={{ background: 'color-mix(in srgb, var(--color-warning) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--color-warning) 30%, transparent)' }}
                  >
                    <AlertTriangle size={14} style={{ color: 'var(--color-warning)', marginTop: 1, flexShrink: 0 }} />
                    <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                      Safety validation withheld the generated actions. Nothing on this card can run; add corrective instructions below and select Revise.
                    </p>
                  </div>
                )}
                {plan.operator_instruction && (
                  <p className="mt-2.5 flex items-start gap-1.5" style={{ fontSize: 11.5, color: 'var(--color-source-ai)' }}>
                    <CornerDownRight size={12} style={{ marginTop: 1, flexShrink: 0 }} />
                    <span>Revised after your note: “{plan.operator_instruction.slice(0, 200)}{plan.operator_instruction.length > 200 ? '…' : ''}”</span>
                  </p>
                )}
              </section>

              {otherActions.length > 0 && (
                <section className="ds-card" style={{ padding: '14px 18px 10px' }}>
                  <div className="flex items-center justify-between mb-2">
                    <div style={sectionLabel}>Actions</div>
                    {pending && !executing && runReady && <span style={{ fontSize: 11, color: 'var(--text-quaternary)', fontVariantNumeric: 'tabular-nums' }}>{selectedCount} of {plan.actions.length} selected</span>}
                  </div>
                  <div className="space-y-1.5 pb-2">
                    {otherActions.map((action) => (
                      <ActionRow
                        key={action.id}
                        action={action}
                        pending={pending && !executing && runReady}
                        approved={state.approvals[action.id] !== false}
                        onToggleApproved={() => toggleActionApproval(action.id)}
                      />
                    ))}
                  </div>
                </section>
              )}

              {pending && !executing && executionReady && (
                <section
                  className="flex items-start gap-2 rounded-xl px-3.5 py-2"
                  style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-primary)', boxShadow: 'var(--shadow-sm)' }}
                >
                  <Wand2 size={14} style={{ color: 'var(--color-source-ai)', marginTop: 9, flexShrink: 0 }} />
                  <textarea
                    ref={instructionRef}
                    value={state.instruction}
                    onChange={(e) => patch({ instruction: e.target.value })}
                    onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); e.stopPropagation(); onRevise(); } }}
                    placeholder="Add info only you know, correct something, or request changes — Autopilot rebuilds the plan."
                    rows={state.instruction.length > 90 ? 3 : 2}
                    className="flex-1 bg-transparent outline-none resize-none"
                    style={{ fontSize: 12.5, color: 'var(--text-primary)', lineHeight: 1.55, paddingTop: 7, paddingBottom: 7 }}
                    disabled={busy}
                  />
                  <button
                    onClick={onRevise}
                    disabled={busy || !state.instruction.trim()}
                    className="flex-shrink-0 self-center text-xs font-semibold px-3.5 py-2 rounded-lg disabled:opacity-35"
                    style={{ color: 'var(--color-source-ai)', background: 'color-mix(in srgb, var(--color-source-ai) 11%, transparent)' }}
                  >
                    Revise
                  </button>
                </section>
              )}
            </div>

            {/* right: the draft reply, given the space it deserves */}
            {replyAction && (
              <DraftPane
                action={replyAction}
                pending={pending && !executing && runReady}
                approved={state.approvals[replyAction.id] !== false}
                editedText={state.edits[replyAction.id]}
                onToggleApproved={() => toggleActionApproval(replyAction.id)}
                onEditText={(text) => {
                  const edits = { ...state.edits };
                  if (text.trim() === String(replyAction.params.reply_text ?? '').trim()) {
                    delete edits[replyAction.id];
                  } else {
                    edits[replyAction.id] = text;
                  }
                  patch({ edits });
                }}
              />
            )}
          </div>
        </div>
      </div>

      {/* decision bar */}
      <div
        className="flex min-h-[60px] flex-wrap items-center gap-2 px-4 py-2 sm:gap-3 sm:px-6 flex-shrink-0"
        style={{ borderTop: '1px solid var(--border-primary)', background: 'var(--bg-primary)' }}
      >
        {pending ? (
          <>
            <span className="w-full lg:w-auto lg:flex-1" style={{ fontSize: 12, color: 'var(--text-quaternary)' }}>
              {executing
                ? terminalizationNeeded
                  ? 'Ticket context changed; finalize this stale run without executing remaining actions.'
                  : liveReservations.length
                  ? 'An active worker lease is executing this run; wait for it to finish.'
                  : unresolvedReceipts.length
                  ? 'Reconcile the ambiguous provider action before resuming this run.'
                  : 'Resume from durable receipts; completed actions will be skipped.'
                : !executionReady
                  ? 'This legacy plan cannot run. Autopilot is retrying a safe v2 regeneration.'
                  : reviewOnly
                    ? 'This safety fallback is reviewable but cannot run. Add corrective instructions and select Revise.'
                  : `Approving runs ${selectedCount} action${selectedCount === 1 ? '' : 's'} immediately, then moves to the next plan.`}
            </span>
            <div className="hidden lg:block lg:flex-1" />
            {!executing && (
              <button
                onClick={() => onDecide('dismiss')}
                disabled={busy || !executionReady}
                className="text-sm font-semibold px-4 py-2.5 rounded-lg disabled:opacity-50"
                style={{ color: 'var(--text-tertiary)' }}
              >
                Dismiss
              </button>
            )}
            <button
              onClick={() => onDecide('approve')}
              disabled={busy || !runReady || selectedCount === 0 || unresolvedReceipts.length > 0 || liveReservations.length > 0}
              className="inline-flex items-center gap-2 text-sm font-semibold px-5 py-2.5 rounded-lg disabled:opacity-50"
              style={{ background: 'var(--btn-primary-bg, var(--color-accent))', color: 'var(--btn-primary-fg, #fff)' }}
            >
              {running ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              {running ? 'Running…' : terminalizationNeeded ? 'Finalize stale run' : executing ? 'Resume run' : !executionReady ? 'Awaiting v2 plan' : reviewOnly ? 'Revision required' : 'Approve & run'}
            </button>
          </>
        ) : (
          <span className="inline-flex items-center gap-2" style={{ fontSize: 12.5, color: 'var(--text-tertiary)' }}>
            {plan.status === 'executed' && <><CheckCircle2 size={13} style={{ color: 'var(--color-success)' }} /> Executed {plan.executed_at ? timeAgo(plan.executed_at) : ''}{plan.decided_by ? ` by ${plan.decided_by}` : ''}</>}
            {plan.status === 'partially_executed' && <><AlertTriangle size={13} style={{ color: 'var(--color-warning)' }} /> Partially executed — some actions failed</>}
            {plan.status === 'failed' && <><XCircle size={13} style={{ color: 'var(--color-danger)' }} /> Execution failed</>}
            {plan.status === 'dismissed' && <>Dismissed {plan.decided_at ? timeAgo(plan.decided_at) : ''}{plan.decided_by ? ` by ${plan.decided_by}` : ''}</>}
          </span>
        )}
      </div>
    </div>
  );
}

function Dot() {
  return <span style={{ color: 'var(--text-quaternary)' }}>·</span>;
}

// ── conversation (the original email, in-page) ──────────────────────────────

function ConversationSection({ messages, customerName }: { messages?: TicketMessage[]; customerName: string | null }) {
  const [showFull, setShowFull] = useState(false);
  const [showEarlier, setShowEarlier] = useState(false);

  const visible = (messages ?? []).filter((m) => !m.is_internal_note && m.sender_type !== 'system');
  const latestCustomerIdx = visible.map((m) => m.sender_type).lastIndexOf('customer');
  const latest = latestCustomerIdx >= 0 ? visible[latestCustomerIdx] : visible[visible.length - 1];
  const earlier = visible.filter((m) => m !== latest);

  const latestText = (latest?.content ?? '').trim();
  const isLong = latestText.split('\n').length > 7 || latestText.length > 600;

  return (
    <section className="ds-card" style={{ padding: '14px 18px 16px' }}>
      <div className="flex items-center justify-between">
        <div style={sectionLabel}>Customer email</div>
        {latest && (
          <span style={{ fontSize: 11, color: 'var(--text-quaternary)' }}>{timeAgo(latest.created_at)}</span>
        )}
      </div>

      {!messages ? (
        <p className="mt-2 inline-flex items-center gap-1.5" style={{ fontSize: 12, color: 'var(--text-quaternary)' }}>
          <Loader2 size={11} className="animate-spin" /> Loading conversation…
        </p>
      ) : !latest ? (
        <p className="mt-2" style={{ fontSize: 12, color: 'var(--text-quaternary)' }}>No messages on this ticket.</p>
      ) : (
        <>
          <div className="mt-2 flex items-center gap-1.5" style={{ fontSize: 11.5, fontWeight: 650, color: 'var(--text-secondary)' }}>
            {latest.sender_name || customerName || latest.sender_email || 'Customer'}
          </div>
          <div
            className="mt-1 whitespace-pre-wrap"
            style={{
              fontSize: 12.5, color: 'var(--text-primary)', lineHeight: 1.6, overflowWrap: 'anywhere',
              ...(showFull
                ? { maxHeight: 380, overflowY: 'auto' }
                : isLong
                ? { display: '-webkit-box', WebkitLineClamp: 7, WebkitBoxOrient: 'vertical', overflow: 'hidden' }
                : {}),
            }}
          >
            {latestText}
          </div>
          {isLong && (
            <button
              onClick={() => setShowFull((v) => !v)}
              className="mt-1.5 inline-flex items-center gap-1"
              style={{ fontSize: 11.5, fontWeight: 650, color: 'var(--color-accent)' }}
            >
              {showFull ? <>Show less <ChevronUp size={11} /></> : <>Show full message <ChevronDown size={11} /></>}
            </button>
          )}

          {earlier.length > 0 && (
            <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--border-secondary)' }}>
              <button
                onClick={() => setShowEarlier((v) => !v)}
                className="inline-flex items-center gap-1.5"
                style={{ fontSize: 11.5, fontWeight: 650, color: 'var(--text-tertiary)' }}
              >
                {showEarlier ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                Earlier conversation ({earlier.length} message{earlier.length === 1 ? '' : 's'})
              </button>
              {showEarlier && (
                <div className="mt-2 space-y-2.5" style={{ maxHeight: 320, overflowY: 'auto' }}>
                  {earlier.map((m) => (
                    <div key={m.id} className="rounded-lg px-3 py-2" style={{ background: 'var(--bg-secondary)' }}>
                      <div className="flex items-center justify-between" style={{ fontSize: 10.5 }}>
                        <span style={{ fontWeight: 700, color: m.sender_type === 'customer' ? 'var(--color-info)' : 'var(--text-tertiary)' }}>
                          {m.sender_type === 'customer' ? (m.sender_name || customerName || 'Customer') : (m.sender_name || 'Warm by Design')}
                        </span>
                        <span style={{ color: 'var(--text-quaternary)' }}>{timeAgo(m.created_at)}</span>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap" style={{ fontSize: 11.5, color: 'var(--text-secondary)', lineHeight: 1.55, overflowWrap: 'anywhere' }}>
                        {m.content.length > 900 ? `${m.content.slice(0, 900)}…` : m.content}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

// ── draft pane (right column) ────────────────────────────────────────────────

function DraftPane({
  action, pending, approved, editedText, onToggleApproved, onEditText,
}: {
  action: AutopilotAction;
  pending: boolean;
  approved: boolean;
  editedText?: string;
  onToggleApproved: () => void;
  onEditText: (text: string) => void;
}) {
  const replyText = editedText ?? String(action.params.reply_text ?? '');
  const confidence = actionConfidenceDisplay(action);
  const tone = confTone(confidence.value);
  const edited = !!editedText && editedText !== String(action.params.reply_text ?? '');

  return (
    <section
      className="ds-card flex flex-col min-w-0"
      style={{ padding: 0, overflow: 'hidden', opacity: pending && !approved ? 0.5 : 1, transition: 'opacity 130ms ease' }}
    >
      <div className="flex items-center gap-2.5 px-4 py-3" style={{ borderBottom: '1px solid var(--border-secondary)' }}>
        {pending && (
          <button
            role="checkbox"
            aria-checked={approved}
            onClick={onToggleApproved}
            className="grid place-items-center flex-shrink-0"
            title={approved ? 'Reply will be sent — click to skip' : 'Skipped — click to include'}
            style={{
              width: 17, height: 17, borderRadius: 5,
              border: `1.5px solid ${approved ? 'var(--color-accent)' : 'var(--border-primary)'}`,
              background: approved ? 'var(--color-accent)' : 'transparent',
              color: 'var(--color-accent-foreground, #fff)',
            }}
          >
            {approved && <Check size={11} strokeWidth={3} />}
          </button>
        )}
        <Mail size={14} style={{ color: 'var(--color-info)' }} />
        <span style={{ fontSize: 13, fontWeight: 650, color: 'var(--text-primary)' }}>{action.title}</span>
        {edited && <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--color-source-ai)' }}>edited</span>}
        {action.status === 'executed' && <span style={{ fontSize: 11, fontWeight: 650, color: 'var(--color-success)' }}>✓ {action.result}</span>}
        {action.status === 'failed' && <span style={{ fontSize: 11, fontWeight: 650, color: 'var(--color-danger)' }} title={action.result ?? ''}>✗ failed</span>}
        <div className="flex-1" />
        <span
          title={confidence.calibrated && action.confidence_basis
            ? `Calibrated from ${Math.round((action.model_confidence ?? action.confidence) * 100)}% using ${action.confidence_basis.sample_count} reviewed samples.`
            : `Policy-capped effective confidence; raw model ${Math.round((action.model_confidence ?? action.confidence) * 100)}%, with no relevant reviewed calibration samples yet.`}
          style={{ fontSize: 12, fontWeight: 700, color: tone, fontVariantNumeric: 'tabular-nums' }}
        >
          {(confidence.value * 100).toFixed(0)}% {confidence.calibrated ? 'calibrated' : 'guarded'}
        </span>
      </div>
      {action.detail && (
        <p className="px-4 pt-2.5" style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>{action.detail}</p>
      )}
      {pending ? (
        <textarea
          value={replyText}
          onChange={(e) => onEditText(e.target.value)}
          className="w-full flex-1 resize-none focus:outline-none px-4 py-3"
          style={{
            fontSize: 13.5, background: 'transparent', color: 'var(--text-primary)', lineHeight: 1.65,
            border: 'none', minHeight: Math.min(560, Math.max(280, replyText.split('\n').length * 24 + 60)),
          }}
        />
      ) : (
        <pre className="px-4 py-3 whitespace-pre-wrap" style={{ fontSize: 13, color: 'var(--text-secondary)', fontFamily: 'inherit', lineHeight: 1.65 }}>
          {replyText}
        </pre>
      )}
    </section>
  );
}

// ── compact action row (left column) ────────────────────────────────────────

function ActionRow({
  action, pending, approved, onToggleApproved,
}: {
  action: AutopilotAction;
  pending: boolean;
  approved: boolean;
  onToggleApproved: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const meta = ACTION_META[action.type] ?? ACTION_META.escalate_human;
  const Icon = meta.icon;
  const confidence = actionConfidenceDisplay(action);
  const tone = confTone(confidence.value);
  const relatedTickets = action.type === 'consolidate_related_tickets' && Array.isArray(action.params.related_tickets)
    ? action.params.related_tickets.filter((value): value is AutopilotRelatedTicketSnapshot => (
        Boolean(value) && typeof value === 'object' && typeof (value as AutopilotRelatedTicketSnapshot).ticket_id === 'string'
      ))
    : [];
  const paramRows = Object.entries(action.params).filter(
    ([k]) => ![
      'order_id', 'reply_text', 'original_params', 'original_type', 'edited_by_reviewer',
      'classification', 'related_ticket_ids', 'related_tickets',
    ].includes(k)
  );
  const expandable = !!action.detail || paramRows.length > 0 || relatedTickets.length > 0;

  return (
    <div
      className="rounded-lg"
      style={{ border: '1px solid var(--border-secondary)', opacity: pending && !approved ? 0.45 : 1, transition: 'opacity 130ms ease' }}
    >
      <div
        className="flex items-center gap-2.5 px-3 py-2"
        style={{ cursor: expandable ? 'pointer' : 'default' }}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('[data-no-expand]')) return;
          if (expandable) setExpanded((v) => !v);
        }}
      >
        {pending && (
          <button
            data-no-expand
            role="checkbox"
            aria-checked={approved}
            onClick={onToggleApproved}
            className="grid place-items-center flex-shrink-0"
            style={{
              width: 16, height: 16, borderRadius: 5,
              border: `1.5px solid ${approved ? 'var(--color-accent)' : 'var(--border-primary)'}`,
              background: approved ? 'var(--color-accent)' : 'transparent',
              color: 'var(--color-accent-foreground, #fff)',
            }}
          >
            {approved && <Check size={10} strokeWidth={3} />}
          </button>
        )}
        <span className="grid place-items-center flex-shrink-0" style={{ width: 24, height: 24, borderRadius: 7, background: `color-mix(in srgb, ${meta.tone} 12%, transparent)` }}>
          <Icon size={12} style={{ color: meta.tone }} />
        </span>
        <span className="min-w-0 flex-1 truncate" style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)' }}>
          {action.title}
        </span>
        {action.status === 'executed' && <span className="text-[10.5px] font-semibold flex-shrink-0" style={{ color: 'var(--color-success)' }}>✓</span>}
        {action.status === 'failed' && <span className="text-[10.5px] font-semibold flex-shrink-0" style={{ color: 'var(--color-danger)' }} title={action.result ?? ''}>✗</span>}
        {action.status === 'skipped' && <span className="text-[10.5px] flex-shrink-0" style={{ color: 'var(--text-quaternary)' }}>skipped</span>}
        <span
          className="flex-shrink-0"
          title={confidence.calibrated && action.confidence_basis
            ? `Calibrated from ${Math.round((action.model_confidence ?? action.confidence) * 100)}% using ${action.confidence_basis.sample_count} reviewed samples.`
            : `Policy-capped effective confidence; raw model ${Math.round((action.model_confidence ?? action.confidence) * 100)}%, with no relevant reviewed calibration samples yet.`}
          style={{ fontSize: 11, fontWeight: 700, color: tone, fontVariantNumeric: 'tabular-nums' }}
        >
          {(confidence.value * 100).toFixed(0)}% {confidence.calibrated ? 'cal.' : 'guarded'}
        </span>
        {expandable && (
          <span style={{ color: 'var(--text-quaternary)' }} className="flex-shrink-0">
            {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </span>
        )}
      </div>
      {expanded && (
        <div className="px-3 pb-2.5" style={{ paddingLeft: pending ? 42 : 14 }}>
          {action.detail && <p style={{ fontSize: 11.5, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{action.detail}</p>}
          {(action.status === 'executed' || action.status === 'failed') && action.result && (
            <p className="mt-1" style={{ fontSize: 11, color: action.status === 'failed' ? 'var(--color-danger)' : 'var(--color-success)' }}>{action.result}</p>
          )}
          {relatedTickets.length > 0 && (
            <div
              className="rounded-md mt-2 overflow-hidden"
              style={{ border: '1px solid var(--border-secondary)', background: 'var(--bg-secondary)' }}
            >
              <div className="px-2.5 py-2" style={{ fontSize: 10.5, color: 'var(--text-tertiary)', borderBottom: '1px solid var(--border-secondary)' }}>
                One reply is sent from this ticket. These related tickets are closed and linked here; their original message histories stay intact.
              </div>
              {relatedTickets.map((related) => (
                <div
                  key={related.ticket_id}
                  className="px-2.5 py-2"
                  style={{ borderBottom: '1px solid var(--border-secondary)' }}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Link
                      href={`/tickets/${related.ticket_id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 hover:underline"
                      style={{ fontSize: 11.5, fontWeight: 650, color: 'var(--text-primary)' }}
                    >
                      #{related.ticket_number} <ExternalLink size={10} />
                    </Link>
                    <span className="truncate" style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{related.subject}</span>
                    <span className="ml-auto flex-shrink-0" style={{ fontSize: 10, color: 'var(--text-quaternary)' }}>
                      {related.status} · {related.response_state.replace(/_/g, ' ')}
                    </span>
                  </div>
                  <div className="flex items-start gap-2 mt-1">
                    <p className="flex-1" style={{ fontSize: 10.5, lineHeight: 1.4, color: 'var(--text-tertiary)' }}>
                      {related.relation_reason}
                    </p>
                    <span style={{ fontSize: 10, fontWeight: 650, color: confTone(related.relation_confidence) }}>
                      {Math.round(related.relation_confidence * 100)}% related
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
          {paramRows.length > 0 && (
            <div className="rounded-md px-2.5 py-1.5 mt-1.5 space-y-0.5" style={{ background: 'var(--bg-secondary)' }}>
              {paramRows.map(([k, v]) => (
                <div key={k} className="flex gap-2" style={{ fontSize: 11 }}>
                  <span style={{ color: 'var(--text-quaternary)', minWidth: 78, textTransform: 'capitalize' }}>{k.replace(/_/g, ' ')}</span>
                  <span style={{ color: 'var(--text-secondary)' }}>
                    {typeof v === 'object' && v !== null
                      ? Object.entries(v as Record<string, unknown>).filter(([, vv]) => vv).map(([, vv]) => String(vv)).join(', ')
                      : String(v)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
