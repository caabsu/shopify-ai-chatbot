'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  Sparkles, CheckCircle2, XCircle, Loader2, ChevronDown, ChevronUp, Mail,
  Ban, Undo2, MapPin, Tag, AlertTriangle, Flag, Archive, ExternalLink,
  ShieldCheck, Check, CornerDownRight, Wand2,
} from 'lucide-react';
import type { Ticket, AutopilotPlan, AutopilotAction } from '@/lib/types';
import { ticketAutopilot, ticketTriage } from '@/lib/types';

// ── meta ─────────────────────────────────────────────────────────────────────

const ACTION_META: Record<string, { icon: typeof Mail; tone: string }> = {
  send_reply: { icon: Mail, tone: 'var(--color-info)' },
  resolve: { icon: CheckCircle2, tone: 'var(--color-success)' },
  close_not_support: { icon: Archive, tone: 'var(--text-tertiary)' },
  set_priority: { icon: Flag, tone: 'var(--color-warning)' },
  add_tags: { icon: Tag, tone: 'var(--color-info)' },
  cancel_order: { icon: Ban, tone: 'var(--color-danger)' },
  refund_order: { icon: Undo2, tone: 'var(--color-source-ai)' },
  update_shipping_address: { icon: MapPin, tone: 'var(--color-warning)' },
  escalate_human: { icon: AlertTriangle, tone: 'var(--color-danger)' },
};

function confTone(c: number): string {
  if (c >= 0.85) return 'var(--color-success)';
  if (c >= 0.65) return 'var(--color-warning)';
  return 'var(--color-danger)';
}

function confLabel(c: number): string {
  if (c >= 0.85) return 'High';
  if (c >= 0.65) return 'Medium';
  return 'Low';
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

// ── page ─────────────────────────────────────────────────────────────────────

interface CardState {
  approvals: Record<string, boolean>;
  edits: Record<string, string>;
  expanded: Record<string, boolean>;
  instruction: string;
  running: boolean;
  revising: boolean;
}

const EMPTY_CARD: CardState = { approvals: {}, edits: {}, expanded: {}, instruction: '', running: false, revising: false };

export default function AutopilotPage() {
  const [tab, setTab] = useState<'pending' | 'done' | 'dismissed'>('pending');
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [counts, setCounts] = useState({ pending: 0, done: 0, dismissed: 0 });
  const [loading, setLoading] = useState(true);
  const [cardState, setCardState] = useState<Record<string, CardState>>({});
  const [toast, setToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const load = useCallback(async (background = false) => {
    if (!background) setLoading(true);
    try {
      const res = await fetch(`/api/autopilot?tab=${tab}`);
      const data = await res.json();
      setTickets(data.tickets ?? []);
      setCounts(data.counts ?? { pending: 0, done: 0, dismissed: 0 });
    } catch {
      if (!background) setTickets([]);
    }
    if (!background) setLoading(false);
  }, [tab]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  const getState = (id: string): CardState => cardState[id] ?? EMPTY_CARD;
  const patchState = (id: string, patch: Partial<CardState>) =>
    setCardState((prev) => ({ ...prev, [id]: { ...(prev[id] ?? EMPTY_CARD), ...patch } }));

  async function decide(ticket: Ticket, decision: 'approve' | 'dismiss') {
    const state = getState(ticket.id);
    const plan = ticketAutopilot(ticket);
    if (!plan) return;

    if (decision === 'approve' && !plan.actions.some((a) => state.approvals[a.id] !== false)) {
      setToast({ type: 'error', text: 'All actions are unchecked — nothing to run.' });
      return;
    }

    patchState(ticket.id, { running: true });
    try {
      const res = await fetch(`/api/autopilot/${ticket.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision,
          actions: plan.actions.map((a) => ({
            id: a.id,
            approved: state.approvals[a.id] !== false,
            ...(a.type === 'send_reply' && state.edits[a.id] ? { reply_text: state.edits[a.id] } : {}),
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setToast({ type: 'error', text: data.error || 'Failed' });
      } else if (decision === 'dismiss') {
        setToast({ type: 'success', text: `Dismissed plan for #${ticket.ticket_number}` });
      } else {
        const p = data.plan as AutopilotPlan;
        const ok = p.actions.filter((a) => a.status === 'executed').length;
        const bad = p.actions.filter((a) => a.status === 'failed').length;
        setToast({
          type: bad === 0 ? 'success' : 'error',
          text: bad === 0
            ? `#${ticket.ticket_number} — ${ok} action${ok === 1 ? '' : 's'} executed`
            : `#${ticket.ticket_number} — ${ok} executed, ${bad} failed (see Executed tab)`,
        });
      }
      load(true);
    } catch {
      setToast({ type: 'error', text: 'Request failed' });
    }
    patchState(ticket.id, { running: false });
  }

  async function revise(ticket: Ticket) {
    const state = getState(ticket.id);
    const instruction = state.instruction.trim();
    if (!instruction) return;

    patchState(ticket.id, { revising: true });
    try {
      const res = await fetch(`/api/autopilot/${ticket.id}/revise`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction }),
      });
      const data = await res.json();
      if (!res.ok) {
        setToast({ type: 'error', text: data.error || 'Revision failed' });
      } else {
        setToast({ type: 'success', text: `Plan revised for #${ticket.ticket_number}` });
        // reset edits/approvals — it's a new plan
        setCardState((prev) => ({ ...prev, [ticket.id]: { ...EMPTY_CARD } }));
        await load(true);
      }
    } catch {
      setToast({ type: 'error', text: 'Revision failed' });
    }
    patchState(ticket.id, { revising: false, instruction: '' });
  }

  const tabs = [
    { key: 'pending' as const, label: 'Needs review', count: counts.pending },
    { key: 'done' as const, label: 'Executed', count: counts.done },
    { key: 'dismissed' as const, label: 'Dismissed', count: counts.dismissed },
  ];

  return (
    <div className="space-y-6" style={{ maxWidth: 780 }}>
      {/* ── Header ── */}
      <div>
        <div className="flex items-center gap-3">
          <h1 className="font-bold inline-flex items-center gap-2.5" style={{ fontSize: 22, letterSpacing: '-0.03em', color: 'var(--text-primary)' }}>
            <Sparkles size={20} style={{ color: 'var(--color-source-ai)' }} />
            Autopilot
          </h1>
          <div className="flex-1" />
          <span className="inline-flex items-center gap-1.5" style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-tertiary)' }}>
            <ShieldCheck size={13} style={{ color: 'var(--color-success)' }} />
            Nothing runs without your approval
          </span>
        </div>
        <p className="mt-1" style={{ fontSize: 13, color: 'var(--text-tertiary)', maxWidth: 560 }}>
          Every incoming email is analyzed on sync. Review each plan, edit or instruct, then approve.
        </p>
      </div>

      {/* ── Toast ── */}
      {toast && (
        <div
          className="px-4 py-2.5 rounded-lg text-sm font-medium flex items-center gap-2"
          style={{
            backgroundColor: `color-mix(in srgb, ${toast.type === 'success' ? 'var(--color-success)' : 'var(--color-danger)'} 10%, transparent)`,
            color: toast.type === 'success' ? 'var(--color-success)' : 'var(--color-danger)',
            border: `1px solid color-mix(in srgb, ${toast.type === 'success' ? 'var(--color-success)' : 'var(--color-danger)'} 22%, transparent)`,
          }}
        >
          {toast.type === 'success' ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
          {toast.text}
        </div>
      )}

      {/* ── Tabs ── */}
      <div className="flex items-center gap-1" style={{ borderBottom: '1px solid var(--border-primary)' }}>
        {tabs.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className="inline-flex items-center gap-2 relative"
              style={{
                fontSize: 13, fontWeight: 600, padding: '8px 14px 10px',
                color: active ? 'var(--text-primary)' : 'var(--text-tertiary)',
              }}
            >
              {t.label}
              <span
                style={{
                  fontSize: 11, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
                  padding: '1px 7px', borderRadius: 99,
                  background: active && t.key === 'pending' && t.count > 0 ? 'var(--color-accent)' : 'var(--bg-tertiary)',
                  color: active && t.key === 'pending' && t.count > 0 ? 'var(--color-accent-foreground, #fff)' : 'var(--text-tertiary)',
                }}
              >
                {t.count}
              </span>
              {active && (
                <span style={{ position: 'absolute', left: 0, right: 0, bottom: -1, height: 2, background: 'var(--text-primary)', borderRadius: 2 }} />
              )}
            </button>
          );
        })}
      </div>

      {/* ── Cards ── */}
      {loading ? (
        <div className="ds-card p-12 text-center">
          <Loader2 size={18} className="animate-spin mx-auto mb-2" style={{ color: 'var(--text-tertiary)' }} />
          <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>Loading…</p>
        </div>
      ) : tickets.length === 0 ? (
        <div className="ds-card p-14 text-center">
          <Sparkles size={26} className="mx-auto mb-3" style={{ color: 'var(--text-quaternary)' }} />
          <p className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>
            {tab === 'pending' ? 'All clear' : 'Nothing here yet'}
          </p>
          {tab === 'pending' && (
            <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
              New tickets are analyzed automatically as email syncs.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-5">
          {tickets.map((ticket) => (
            <PlanCard
              key={ticket.id}
              ticket={ticket}
              state={getState(ticket.id)}
              patch={(p) => patchState(ticket.id, p)}
              onDecide={(d) => decide(ticket, d)}
              onRevise={() => revise(ticket)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── card ─────────────────────────────────────────────────────────────────────

function PlanCard({
  ticket, state, patch, onDecide, onRevise,
}: {
  ticket: Ticket;
  state: CardState;
  patch: (p: Partial<CardState>) => void;
  onDecide: (d: 'approve' | 'dismiss') => void;
  onRevise: () => void;
}) {
  const plan = ticketAutopilot(ticket);
  if (!plan) return null;
  const triage = ticketTriage(ticket);
  const isPending = plan.status === 'proposed';
  const selectedCount = plan.actions.filter((a) => state.approvals[a.id] !== false).length;
  const overallTone = confTone(plan.analysis.overall_confidence);
  const busy = state.running || state.revising;

  return (
    <div
      className="ds-card"
      style={{ padding: 0, overflow: 'hidden', position: 'relative', opacity: state.running ? 0.75 : 1 }}
    >
      {/* revising overlay */}
      {state.revising && (
        <div
          className="absolute inset-0 z-10 grid place-items-center"
          style={{ background: 'color-mix(in srgb, var(--bg-primary) 78%, transparent)', backdropFilter: 'blur(1.5px)' }}
        >
          <span className="inline-flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--color-source-ai)' }}>
            <Loader2 size={15} className="animate-spin" /> Autopilot is revising the plan…
          </span>
        </div>
      )}

      {/* ── header ── */}
      <div className="px-5 pt-4">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap" style={{ rowGap: 4 }}>
              <Link
                href={`/tickets/${ticket.id}`}
                className="inline-flex items-center gap-1 flex-shrink-0"
                title="Open the full ticket"
                style={{
                  fontSize: 11, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
                  padding: '2px 8px', borderRadius: 6,
                  background: 'var(--bg-tertiary)', color: 'var(--text-secondary)',
                }}
              >
                #{ticket.ticket_number} <ExternalLink size={9} />
              </Link>
              <span className="truncate" style={{ fontWeight: 650, fontSize: 15, letterSpacing: '-0.01em', color: 'var(--text-primary)' }}>
                {ticket.subject}
              </span>
            </div>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap" style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
              <span className="font-medium" style={{ color: 'var(--text-secondary)' }}>
                {ticket.customer_name || ticket.customer_email}
              </span>
              <span style={{ color: 'var(--text-quaternary)' }}>·</span>
              <span>{timeAgo(plan.proposed_at)}</span>
              {triage?.sentiment && (triage.sentiment === 'angry' || triage.sentiment === 'frustrated') && (
                <>
                  <span style={{ color: 'var(--text-quaternary)' }}>·</span>
                  <span className="capitalize font-semibold" style={{ color: triage.sentiment === 'angry' ? 'var(--color-danger)' : 'var(--color-warning)' }}>
                    {triage.sentiment} customer
                  </span>
                </>
              )}
              {plan.trigger === 'customer_reply' && (
                <>
                  <span style={{ color: 'var(--text-quaternary)' }}>·</span>
                  <span style={{ color: 'var(--color-info)', fontWeight: 600 }}>re-planned after reply</span>
                </>
              )}
              {(plan.revision_count ?? 0) > 0 && (
                <>
                  <span style={{ color: 'var(--text-quaternary)' }}>·</span>
                  <span style={{ color: 'var(--color-source-ai)', fontWeight: 600 }}>rev {plan.revision_count}</span>
                </>
              )}
            </div>
          </div>
          <span
            className="flex-shrink-0 inline-flex items-center gap-1.5"
            title={`Overall confidence ${(plan.analysis.overall_confidence * 100).toFixed(0)}%`}
            style={{
              fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99,
              color: overallTone, background: `color-mix(in srgb, ${overallTone} 11%, transparent)`,
            }}
          >
            {confLabel(plan.analysis.overall_confidence)} · {(plan.analysis.overall_confidence * 100).toFixed(0)}%
          </span>
        </div>

        {/* analysis */}
        <div className="mt-3 pb-4">
          <p style={{ fontSize: 13.5, color: 'var(--text-primary)', lineHeight: 1.6 }}>{plan.analysis.summary}</p>
          {plan.analysis.reasoning && (
            <p className="mt-1.5" style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.55 }}>
              {plan.analysis.reasoning}
            </p>
          )}
          {plan.operator_instruction && (
            <p className="mt-2 inline-flex items-start gap-1.5" style={{ fontSize: 11.5, color: 'var(--color-source-ai)' }}>
              <CornerDownRight size={12} style={{ marginTop: 1, flexShrink: 0 }} />
              <span>Revised after your note: “{plan.operator_instruction.slice(0, 160)}{plan.operator_instruction.length > 160 ? '…' : ''}”</span>
            </p>
          )}
        </div>
      </div>

      {/* ── actions ── */}
      <div className="px-5 pb-1" style={{ borderTop: '1px solid var(--border-secondary)' }}>
        <div className="flex items-center justify-between pt-3 pb-2">
          <span style={sectionLabel}>Proposed actions</span>
          {isPending && plan.actions.length > 1 && (
            <span style={{ fontSize: 11, color: 'var(--text-quaternary)', fontVariantNumeric: 'tabular-nums' }}>
              {selectedCount} of {plan.actions.length} selected
            </span>
          )}
        </div>
        <div className="space-y-1.5 pb-4">
          {plan.actions.map((action) => (
            <ActionRow
              key={action.id}
              action={action}
              pending={isPending}
              approved={state.approvals[action.id] !== false}
              expanded={state.expanded[action.id] ?? action.type === 'send_reply'}
              editedText={state.edits[action.id]}
              onToggleApproved={() => patch({ approvals: { ...state.approvals, [action.id]: !(state.approvals[action.id] !== false) } })}
              onToggleExpanded={() => patch({ expanded: { ...state.expanded, [action.id]: !(state.expanded[action.id] ?? action.type === 'send_reply') } })}
              onEditText={(text) => patch({ edits: { ...state.edits, [action.id]: text } })}
            />
          ))}
        </div>
      </div>

      {/* ── instruct + decide ── */}
      {isPending ? (
        <div className="px-5 py-4 space-y-3" style={{ borderTop: '1px solid var(--border-secondary)', background: 'var(--bg-secondary)' }}>
          {/* AI instruction box */}
          <div
            className="flex items-start gap-2 rounded-lg px-3 py-2"
            style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-primary)' }}
          >
            <Wand2 size={14} style={{ color: 'var(--color-source-ai)', marginTop: 7, flexShrink: 0 }} />
            <textarea
              value={state.instruction}
              onChange={(e) => patch({ instruction: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onRevise(); }}
              placeholder="Add info only you know, correct something, or request changes — Autopilot will rebuild the plan. (⌘↵ to send)"
              rows={state.instruction.length > 80 ? 3 : 1}
              className="flex-1 bg-transparent outline-none resize-none"
              style={{ fontSize: 12.5, color: 'var(--text-primary)', lineHeight: 1.5, paddingTop: 6, paddingBottom: 6 }}
              disabled={busy}
            />
            <button
              onClick={onRevise}
              disabled={busy || !state.instruction.trim()}
              className="flex-shrink-0 self-center text-xs font-semibold px-3 py-1.5 rounded-md disabled:opacity-35"
              style={{
                color: 'var(--color-source-ai)',
                background: 'color-mix(in srgb, var(--color-source-ai) 11%, transparent)',
              }}
            >
              Revise
            </button>
          </div>

          {/* decisions */}
          <div className="flex items-center gap-2">
            <span style={{ fontSize: 11.5, color: 'var(--text-quaternary)' }}>
              Approving runs {selectedCount} action{selectedCount === 1 ? '' : 's'} immediately.
            </span>
            <div className="flex-1" />
            <button
              onClick={() => onDecide('dismiss')}
              disabled={busy}
              className="text-xs font-semibold px-3.5 py-2 rounded-lg disabled:opacity-50"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Dismiss
            </button>
            <button
              onClick={() => onDecide('approve')}
              disabled={busy || selectedCount === 0}
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-lg disabled:opacity-50"
              style={{ background: 'var(--btn-primary-bg, var(--color-accent))', color: 'var(--btn-primary-fg, #fff)' }}
            >
              {state.running ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
              {state.running ? 'Running…' : 'Approve & run'}
            </button>
          </div>
        </div>
      ) : (
        <div
          className="flex items-center gap-2 px-5 py-3"
          style={{ borderTop: '1px solid var(--border-secondary)', background: 'var(--bg-secondary)', fontSize: 11.5, color: 'var(--text-tertiary)' }}
        >
          {plan.status === 'executed' && <><CheckCircle2 size={12} style={{ color: 'var(--color-success)' }} /> Executed {plan.executed_at ? timeAgo(plan.executed_at) : ''}{plan.decided_by ? ` by ${plan.decided_by}` : ''}</>}
          {plan.status === 'partially_executed' && <><AlertTriangle size={12} style={{ color: 'var(--color-warning)' }} /> Partially executed — review failed actions above</>}
          {plan.status === 'failed' && <><XCircle size={12} style={{ color: 'var(--color-danger)' }} /> Execution failed</>}
          {plan.status === 'dismissed' && <>Dismissed {plan.decided_at ? timeAgo(plan.decided_at) : ''}{plan.decided_by ? ` by ${plan.decided_by}` : ''}</>}
        </div>
      )}
    </div>
  );
}

// ── action row ───────────────────────────────────────────────────────────────

function ActionRow({
  action, pending, approved, expanded, editedText,
  onToggleApproved, onToggleExpanded, onEditText,
}: {
  action: AutopilotAction;
  pending: boolean;
  approved: boolean;
  expanded: boolean;
  editedText?: string;
  onToggleApproved: () => void;
  onToggleExpanded: () => void;
  onEditText: (text: string) => void;
}) {
  const meta = ACTION_META[action.type] ?? ACTION_META.escalate_human;
  const Icon = meta.icon;
  const isReply = action.type === 'send_reply';
  const replyText = editedText ?? String(action.params.reply_text ?? '');
  const tone = confTone(action.confidence);
  const expandable = isReply || action.detail || Object.keys(action.params).length > 0;

  const paramRows = Object.entries(action.params).filter(
    ([k]) => !['order_id', 'reply_text', 'original_params', 'original_type', 'edited_by_reviewer', 'classification'].includes(k)
  );

  return (
    <div
      className="rounded-lg"
      style={{
        border: '1px solid var(--border-secondary)',
        background: 'var(--bg-primary)',
        opacity: pending && !approved ? 0.45 : 1,
        transition: 'opacity 130ms ease',
      }}
    >
      {/* row */}
      <div
        className="flex items-center gap-3 px-3 py-2.5"
        style={{ cursor: expandable ? 'pointer' : 'default' }}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('[data-no-expand]')) return;
          if (expandable) onToggleExpanded();
        }}
      >
        {pending && (
          <button
            data-no-expand
            role="checkbox"
            aria-checked={approved}
            onClick={onToggleApproved}
            className="grid place-items-center flex-shrink-0"
            title={approved ? 'Will run — click to skip' : 'Skipped — click to include'}
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
        <span
          className="grid place-items-center flex-shrink-0"
          style={{ width: 26, height: 26, borderRadius: 7, background: `color-mix(in srgb, ${meta.tone} 12%, transparent)` }}
        >
          <Icon size={13} style={{ color: meta.tone }} />
        </span>
        <span className="min-w-0 flex-1 truncate" style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
          {action.title}
        </span>

        {action.status === 'executed' && (
          <span className="text-[11px] font-semibold flex-shrink-0 truncate" style={{ color: 'var(--color-success)', maxWidth: 220 }} title={action.result ?? ''}>
            ✓ {action.result}
          </span>
        )}
        {action.status === 'failed' && (
          <span className="text-[11px] font-semibold flex-shrink-0" style={{ color: 'var(--color-danger)' }} title={action.result ?? ''}>
            ✗ {action.result?.slice(0, 60)}
          </span>
        )}
        {action.status === 'skipped' && (
          <span className="text-[11px] flex-shrink-0" style={{ color: 'var(--text-quaternary)' }}>skipped</span>
        )}

        <span
          className="flex-shrink-0"
          title={`Confidence: ${confLabel(action.confidence)}`}
          style={{ fontSize: 11.5, fontWeight: 700, color: tone, fontVariantNumeric: 'tabular-nums' }}
        >
          {(action.confidence * 100).toFixed(0)}%
        </span>
        {expandable && (
          <span style={{ color: 'var(--text-quaternary)' }} className="flex-shrink-0">
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </span>
        )}
      </div>

      {/* expanded */}
      {expanded && (
        <div className="px-3 pb-3" style={{ paddingLeft: pending ? 46 : 29 }}>
          {action.detail && (
            <p className="mb-2" style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
              {action.detail}
            </p>
          )}

          {isReply && (
            pending ? (
              <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--border-primary)' }}>
                <div className="flex items-center justify-between px-3 py-1.5" style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-secondary)' }}>
                  <span style={sectionLabel}>Draft reply — edit freely</span>
                  {editedText && editedText !== String(action.params.reply_text ?? '') && (
                    <span style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--color-source-ai)' }}>edited</span>
                  )}
                </div>
                <textarea
                  data-no-expand
                  value={replyText}
                  onChange={(e) => onEditText(e.target.value)}
                  rows={Math.min(16, Math.max(6, replyText.split('\n').length + 1))}
                  className="w-full resize-y focus:outline-none px-3.5 py-3"
                  style={{ fontSize: 12.5, background: 'var(--bg-primary)', color: 'var(--text-primary)', lineHeight: 1.6, border: 'none' }}
                />
              </div>
            ) : (
              <pre
                className="text-xs whitespace-pre-wrap rounded-lg px-3.5 py-3"
                style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-secondary)', fontFamily: 'inherit', lineHeight: 1.6 }}
              >
                {replyText}
              </pre>
            )
          )}

          {!isReply && paramRows.length > 0 && (
            <div className="rounded-lg px-3 py-2 space-y-0.5" style={{ background: 'var(--bg-secondary)' }}>
              {paramRows.map(([k, v]) => (
                <div key={k} className="flex gap-2" style={{ fontSize: 11.5 }}>
                  <span style={{ color: 'var(--text-quaternary)', minWidth: 86, textTransform: 'capitalize' }}>{k.replace(/_/g, ' ')}</span>
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
