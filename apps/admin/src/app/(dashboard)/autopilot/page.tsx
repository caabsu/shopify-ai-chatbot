'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  Sparkles, CheckCircle2, XCircle, Loader2, ChevronDown, ChevronUp, Mail,
  Ban, Undo2, MapPin, Tag, AlertTriangle, Flag, Archive, User, ExternalLink,
  ShieldCheck, Clock,
} from 'lucide-react';
import type { Ticket, AutopilotPlan, AutopilotAction } from '@/lib/types';
import { ticketAutopilot, ticketTriage } from '@/lib/types';
import { Button } from '@/components/ui/Button';

const ACTION_META: Record<string, { icon: typeof Mail; label: string; tone: string }> = {
  send_reply: { icon: Mail, label: 'Send reply', tone: 'var(--color-info)' },
  resolve: { icon: CheckCircle2, label: 'Resolve', tone: 'var(--color-success)' },
  close_not_support: { icon: Archive, label: 'Close (not support)', tone: 'var(--text-tertiary)' },
  set_priority: { icon: Flag, label: 'Set priority', tone: 'var(--color-warning)' },
  add_tags: { icon: Tag, label: 'Add tags', tone: 'var(--color-info)' },
  cancel_order: { icon: Ban, label: 'Cancel order', tone: 'var(--color-danger)' },
  refund_order: { icon: Undo2, label: 'Refund order', tone: 'var(--color-source-ai)' },
  update_shipping_address: { icon: MapPin, label: 'Update address', tone: 'var(--color-warning)' },
  escalate_human: { icon: AlertTriangle, label: 'Needs human', tone: 'var(--color-danger)' },
};

function confidenceTone(c: number): string {
  if (c >= 0.85) return 'var(--color-success)';
  if (c >= 0.65) return 'var(--color-warning)';
  return 'var(--color-danger)';
}

function timeAgo(dateStr: string): string {
  const s = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function ConfidenceBadge({ value }: { value: number }) {
  const tone = confidenceTone(value);
  return (
    <span
      className="inline-flex items-center gap-1.5 flex-shrink-0"
      title={`Confidence ${(value * 100).toFixed(0)}%`}
      style={{ fontSize: 11, fontWeight: 700, color: tone, fontVariantNumeric: 'tabular-nums' }}
    >
      <span style={{ width: 34, height: 4, borderRadius: 99, background: 'var(--bg-tertiary)', overflow: 'hidden', display: 'inline-block' }}>
        <span style={{ display: 'block', height: '100%', width: `${value * 100}%`, background: tone }} />
      </span>
      {(value * 100).toFixed(0)}%
    </span>
  );
}

interface CardState {
  /** action id → approved (default true) */
  approvals: Record<string, boolean>;
  /** action id → edited reply text */
  edits: Record<string, string>;
  expanded: Record<string, boolean>;
  running: boolean;
}

export default function AutopilotPage() {
  const [tab, setTab] = useState<'pending' | 'done' | 'dismissed'>('pending');
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [counts, setCounts] = useState({ pending: 0, done: 0, dismissed: 0 });
  const [loading, setLoading] = useState(true);
  const [cardState, setCardState] = useState<Record<string, CardState>>({});
  const [toast, setToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/autopilot?tab=${tab}`);
      const data = await res.json();
      setTickets(data.tickets ?? []);
      setCounts(data.counts ?? { pending: 0, done: 0, dismissed: 0 });
    } catch {
      setTickets([]);
    }
    setLoading(false);
  }, [tab]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  function getState(ticketId: string): CardState {
    return cardState[ticketId] ?? { approvals: {}, edits: {}, expanded: {}, running: false };
  }

  function patchState(ticketId: string, patch: Partial<CardState>) {
    setCardState((prev) => ({ ...prev, [ticketId]: { ...getState(ticketId), ...patch } }));
  }

  async function decide(ticket: Ticket, decision: 'approve' | 'dismiss') {
    const state = getState(ticket.id);
    const plan = ticketAutopilot(ticket);
    if (!plan) return;

    if (decision === 'approve') {
      const anyApproved = plan.actions.some((a) => state.approvals[a.id] !== false);
      if (!anyApproved) { setToast({ type: 'error', text: 'All actions are toggled off — nothing to run.' }); return; }
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
        setToast({ type: 'success', text: `Plan dismissed for #${ticket.ticket_number}` });
      } else {
        const p = data.plan as AutopilotPlan;
        const ok = p.actions.filter((a) => a.status === 'executed').length;
        const bad = p.actions.filter((a) => a.status === 'failed').length;
        setToast({
          type: bad === 0 ? 'success' : 'error',
          text: bad === 0
            ? `#${ticket.ticket_number}: ${ok} action${ok === 1 ? '' : 's'} executed`
            : `#${ticket.ticket_number}: ${ok} executed, ${bad} failed — see Done tab`,
        });
      }
      load();
    } catch {
      setToast({ type: 'error', text: 'Request failed' });
    }
    patchState(ticket.id, { running: false });
  }

  const tabs = [
    { key: 'pending' as const, label: 'Pending review', count: counts.pending },
    { key: 'done' as const, label: 'Executed', count: counts.done },
    { key: 'dismissed' as const, label: 'Dismissed', count: counts.dismissed },
  ];

  return (
    <div className="space-y-5" style={{ maxWidth: 880 }}>
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <div
          className="grid place-items-center"
          style={{ width: 38, height: 38, borderRadius: 11, background: 'color-mix(in srgb, var(--color-source-ai) 14%, transparent)' }}
        >
          <Sparkles size={19} style={{ color: 'var(--color-source-ai)' }} />
        </div>
        <div>
          <h1 className="font-bold" style={{ fontSize: 21, letterSpacing: '-0.03em', color: 'var(--text-primary)' }}>
            Autopilot
          </h1>
          <p style={{ fontSize: 12.5, color: 'var(--text-tertiary)' }}>
            Every incoming ticket is analyzed automatically. Review the proposed actions, edit if needed, approve — Autopilot executes.
          </p>
        </div>
        <div className="flex-1" />
        <span
          className="inline-flex items-center gap-1.5"
          style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-tertiary)', padding: '4px 10px', borderRadius: 99, border: '1px solid var(--border-primary)', background: 'var(--bg-primary)' }}
        >
          <ShieldCheck size={12} style={{ color: 'var(--color-success)' }} />
          Nothing runs without your approval
        </span>
      </div>

      {/* Toast */}
      {toast && (
        <div
          className="px-4 py-2.5 rounded-lg text-sm font-medium flex items-center gap-2"
          style={{
            backgroundColor: `color-mix(in srgb, ${toast.type === 'success' ? 'var(--color-success)' : 'var(--color-danger)'} 12%, transparent)`,
            color: toast.type === 'success' ? 'var(--color-success)' : 'var(--color-danger)',
            border: `1px solid color-mix(in srgb, ${toast.type === 'success' ? 'var(--color-success)' : 'var(--color-danger)'} 24%, transparent)`,
          }}
        >
          {toast.type === 'success' ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
          {toast.text}
        </div>
      )}

      {/* Tabs */}
      <div
        className="inline-flex"
        style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-primary)', borderRadius: 'var(--radius-md)', padding: 3 }}
      >
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className="inline-flex items-center gap-1.5"
            style={{
              fontSize: 12.5, fontWeight: 600, padding: '6px 14px', borderRadius: 6,
              background: tab === t.key ? 'var(--btn-primary-bg)' : 'transparent',
              color: tab === t.key ? 'var(--btn-primary-fg)' : 'var(--text-secondary)',
            }}
          >
            {t.label}
            <span style={{ fontSize: 11, fontVariantNumeric: 'tabular-nums', opacity: 0.7 }}>{t.count}</span>
          </button>
        ))}
      </div>

      {/* Cards */}
      {loading ? (
        <div className="ds-card p-10 text-center">
          <Loader2 size={20} className="animate-spin mx-auto mb-2" style={{ color: 'var(--text-tertiary)' }} />
          <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>Loading plans…</p>
        </div>
      ) : tickets.length === 0 ? (
        <div className="ds-card p-14 text-center">
          <Sparkles size={30} className="mx-auto mb-3" style={{ color: 'var(--text-quaternary)' }} />
          <p className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>
            {tab === 'pending' ? 'All clear — no plans waiting for review' : 'Nothing here yet'}
          </p>
          {tab === 'pending' && (
            <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
              New tickets are analyzed automatically as email syncs.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {tickets.map((ticket) => {
            const plan = ticketAutopilot(ticket);
            if (!plan) return null;
            const state = getState(ticket.id);
            const triage = ticketTriage(ticket);
            const isPending = plan.status === 'proposed';

            return (
              <div key={ticket.id} className="ds-card" style={{ padding: 0, overflow: 'hidden' }}>
                {/* Card header */}
                <div className="flex items-start gap-3 px-5 pt-4 pb-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span style={{ fontSize: 11.5, color: 'var(--text-quaternary)', fontVariantNumeric: 'tabular-nums' }}>
                        #{ticket.ticket_number}
                      </span>
                      <span className="truncate" style={{ fontWeight: 650, fontSize: 14.5, color: 'var(--text-primary)' }}>
                        {ticket.subject}
                      </span>
                      {triage?.sentiment && (triage.sentiment === 'angry' || triage.sentiment === 'frustrated') && (
                        <span
                          className="text-[10px] font-semibold px-1.5 py-0.5 rounded capitalize"
                          style={{
                            background: `color-mix(in srgb, ${triage.sentiment === 'angry' ? 'var(--color-danger)' : 'var(--color-warning)'} 12%, transparent)`,
                            color: triage.sentiment === 'angry' ? 'var(--color-danger)' : 'var(--color-warning)',
                          }}
                        >
                          {triage.sentiment}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2.5 mt-1" style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                      <span className="inline-flex items-center gap-1"><User size={11} /> {ticket.customer_name || ticket.customer_email}</span>
                      <span className="inline-flex items-center gap-1"><Clock size={11} /> {timeAgo(plan.proposed_at)}</span>
                      {plan.trigger === 'customer_reply' && (
                        <span style={{ color: 'var(--color-info)', fontWeight: 600 }}>re-planned after customer reply</span>
                      )}
                      <Link
                        href={`/tickets/${ticket.id}`}
                        className="inline-flex items-center gap-1"
                        style={{ color: 'var(--color-accent)', fontWeight: 600 }}
                      >
                        Open ticket <ExternalLink size={10} />
                      </Link>
                    </div>
                  </div>
                  <ConfidenceBadge value={plan.analysis.overall_confidence} />
                </div>

                {/* AI analysis */}
                <div className="px-5 pb-3">
                  <p style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.55 }}>{plan.analysis.summary}</p>
                  {plan.analysis.reasoning && (
                    <p className="mt-1" style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
                      {plan.analysis.reasoning}
                    </p>
                  )}
                </div>

                {/* Actions */}
                <div style={{ borderTop: '1px solid var(--border-secondary)' }}>
                  {plan.actions.map((action) => (
                    <ActionRow
                      key={action.id}
                      action={action}
                      pending={isPending}
                      approved={state.approvals[action.id] !== false}
                      expanded={!!state.expanded[action.id] || action.type === 'send_reply'}
                      editedText={state.edits[action.id]}
                      onToggleApproved={() =>
                        patchState(ticket.id, { approvals: { ...state.approvals, [action.id]: !(state.approvals[action.id] !== false) } })}
                      onToggleExpanded={() =>
                        patchState(ticket.id, { expanded: { ...state.expanded, [action.id]: !state.expanded[action.id] } })}
                      onEditText={(text) => patchState(ticket.id, { edits: { ...state.edits, [action.id]: text } })}
                    />
                  ))}
                </div>

                {/* Footer */}
                {isPending ? (
                  <div className="flex items-center gap-2 px-5 py-3" style={{ borderTop: '1px solid var(--border-secondary)', background: 'var(--bg-secondary)' }}>
                    <span style={{ fontSize: 11.5, color: 'var(--text-quaternary)' }}>
                      {plan.actions.filter((a) => state.approvals[a.id] !== false).length} of {plan.actions.length} actions selected
                    </span>
                    <div className="flex-1" />
                    <Button variant="ghost" size="sm" onClick={() => decide(ticket, 'dismiss')} disabled={state.running}>
                      Dismiss
                    </Button>
                    <Button variant="primary" size="sm" onClick={() => decide(ticket, 'approve')} disabled={state.running}
                      leadingIcon={state.running ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}>
                      {state.running ? 'Running…' : 'Approve & run'}
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 px-5 py-2.5" style={{ borderTop: '1px solid var(--border-secondary)', background: 'var(--bg-secondary)', fontSize: 11.5, color: 'var(--text-tertiary)' }}>
                    {plan.status === 'executed' && <><CheckCircle2 size={12} style={{ color: 'var(--color-success)' }} /> Executed {plan.executed_at ? timeAgo(plan.executed_at) : ''} by {plan.decided_by}</>}
                    {plan.status === 'partially_executed' && <><AlertTriangle size={12} style={{ color: 'var(--color-warning)' }} /> Partially executed — some actions failed</>}
                    {plan.status === 'failed' && <><XCircle size={12} style={{ color: 'var(--color-danger)' }} /> Execution failed</>}
                    {plan.status === 'dismissed' && <>Dismissed {plan.decided_at ? timeAgo(plan.decided_at) : ''} by {plan.decided_by}</>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

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
  const hasDetailBlock = isReply || ['cancel_order', 'refund_order', 'update_shipping_address', 'escalate_human'].includes(action.type);

  return (
    <div style={{ borderBottom: '1px solid var(--border-secondary)', opacity: pending && !approved ? 0.45 : 1 }}>
      <div className="flex items-center gap-3 px-5 py-2.5">
        {pending && (
          <button
            role="checkbox"
            aria-checked={approved}
            onClick={onToggleApproved}
            className="grid place-items-center flex-shrink-0"
            title={approved ? 'Will run — click to skip' : 'Skipped — click to include'}
            style={{
              width: 18, height: 18, borderRadius: 5,
              border: `1.5px solid ${approved ? 'var(--color-accent)' : 'var(--border-primary)'}`,
              background: approved ? 'var(--color-accent)' : 'transparent',
              color: 'var(--color-accent-foreground, #fff)',
            }}
          >
            {approved && <CheckCircle2 size={12} />}
          </button>
        )}
        <span
          className="grid place-items-center flex-shrink-0"
          style={{ width: 26, height: 26, borderRadius: 8, background: `color-mix(in srgb, ${meta.tone} 13%, transparent)` }}
        >
          <Icon size={13} style={{ color: meta.tone }} />
        </span>
        <div className="min-w-0 flex-1">
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{action.title}</span>
          {!expanded && action.detail && (
            <span className="block truncate" style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>{action.detail}</span>
          )}
        </div>
        {action.status === 'executed' && <span className="text-[11px] font-semibold flex-shrink-0" style={{ color: 'var(--color-success)' }}>✓ {action.result}</span>}
        {action.status === 'failed' && <span className="text-[11px] font-semibold flex-shrink-0" style={{ color: 'var(--color-danger)' }} title={action.result ?? ''}>✗ failed</span>}
        {action.status === 'skipped' && <span className="text-[11px] flex-shrink-0" style={{ color: 'var(--text-quaternary)' }}>skipped</span>}
        <ConfidenceBadge value={action.confidence} />
        {hasDetailBlock && (
          <button onClick={onToggleExpanded} style={{ color: 'var(--text-tertiary)' }} className="flex-shrink-0">
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        )}
      </div>

      {expanded && (
        <div className="px-5 pb-3" style={{ paddingLeft: pending ? 64 : 46 }}>
          {action.detail && (
            <p className="mb-2" style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{action.detail}</p>
          )}
          {isReply && (
            pending ? (
              <textarea
                value={replyText}
                onChange={(e) => onEditText(e.target.value)}
                rows={Math.min(14, Math.max(5, replyText.split('\n').length + 1))}
                className="w-full text-xs rounded-lg px-3 py-2.5 resize-y focus:outline-none"
                style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', color: 'var(--text-primary)', lineHeight: 1.55 }}
              />
            ) : (
              <pre className="text-xs whitespace-pre-wrap rounded-lg px-3 py-2.5" style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-secondary)', fontFamily: 'inherit', lineHeight: 1.55 }}>
                {replyText}
              </pre>
            )
          )}
          {!isReply && Object.keys(action.params).length > 0 && action.type !== 'escalate_human' && (
            <div className="text-[11.5px] rounded-lg px-3 py-2" style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}>
              {Object.entries(action.params)
                .filter(([k]) => !['order_id'].includes(k))
                .map(([k, v]) => (
                  <div key={k}><span style={{ color: 'var(--text-quaternary)' }}>{k.replace(/_/g, ' ')}:</span> {typeof v === 'object' ? JSON.stringify(v) : String(v)}</div>
                ))}
            </div>
          )}
          {action.type === 'escalate_human' && action.params.reason ? (
            <p className="text-[11.5px]" style={{ color: 'var(--color-warning)' }}>Reason: {String(action.params.reason)}</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
