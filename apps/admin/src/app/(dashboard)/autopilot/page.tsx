'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import {
  Sparkles, CheckCircle2, XCircle, Loader2, ChevronDown, ChevronUp, Mail,
  Ban, Undo2, MapPin, Tag, AlertTriangle, Flag, Archive, ExternalLink,
  ShieldCheck, Check, CornerDownRight, Wand2, ChevronLeft, ChevronRight,
} from 'lucide-react';
import type { Ticket, TicketMessage, AutopilotPlan, AutopilotAction } from '@/lib/types';
import { ticketAutopilot, ticketTriage } from '@/lib/types';

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
  escalate_human: { icon: AlertTriangle, tone: 'var(--color-danger)', label: 'Needs human' },
};

function confTone(c: number): string {
  if (c >= 0.85) return 'var(--color-success)';
  if (c >= 0.65) return 'var(--color-warning)';
  return 'var(--color-danger)';
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

// ── page ─────────────────────────────────────────────────────────────────────

export default function AutopilotPage() {
  const [tab, setTab] = useState<'pending' | 'done' | 'dismissed'>('pending');
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [counts, setCounts] = useState({ pending: 0, done: 0, dismissed: 0 });
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [cardState, setCardState] = useState<Record<string, CardState>>({});
  const [running, setRunning] = useState(false);
  const [revising, setRevising] = useState(false);
  const [flash, setFlash] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Conversation threads, fetched lazily for the active ticket only
  const [threads, setThreads] = useState<Record<string, TicketMessage[]>>({});

  const load = useCallback(async (background = false) => {
    if (!background) setLoading(true);
    try {
      const res = await fetch(`/api/autopilot?tab=${tab}`);
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
      setTickets(list);
      setCounts(data.counts ?? { pending: 0, done: 0, dismissed: 0 });
      setActiveId((prev) => (prev && list.some((t) => t.id === prev) ? prev : list[0]?.id ?? null));
    } catch {
      if (!background) setTickets([]);
    }
    if (!background) setLoading(false);
  }, [tab]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 4500);
    return () => clearTimeout(t);
  }, [flash]);

  const active = useMemo(() => tickets.find((t) => t.id === activeId) ?? null, [tickets, activeId]);
  const activeIndex = useMemo(() => tickets.findIndex((t) => t.id === activeId), [tickets, activeId]);

  // Load the conversation for the active ticket (once per ticket)
  useEffect(() => {
    if (!activeId || threads[activeId]) return;
    fetch(`/api/tickets/${activeId}`)
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d.messages)) {
          setThreads((prev) => ({ ...prev, [activeId]: d.messages }));
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  const getState = (id: string): CardState => cardState[id] ?? EMPTY_CARD;
  const patchState = (id: string, patch: Partial<CardState>) =>
    setCardState((prev) => ({ ...prev, [id]: { ...(prev[id] ?? EMPTY_CARD), ...patch } }));

  const goRelative = useCallback((delta: number) => {
    if (tickets.length === 0) return;
    const next = Math.min(tickets.length - 1, Math.max(0, (activeIndex < 0 ? 0 : activeIndex) + delta));
    setActiveId(tickets[next]?.id ?? null);
  }, [tickets, activeIndex]);

  const advanceAfterDecision = useCallback((decidedId: string) => {
    setTickets((prev) => {
      const idx = prev.findIndex((t) => t.id === decidedId);
      const next = prev.filter((t) => t.id !== decidedId);
      setActiveId(next[Math.min(idx, next.length - 1)]?.id ?? null);
      return next;
    });
    setCounts((c) => ({ ...c, pending: Math.max(0, c.pending - 1) }));
  }, []);

  const decide = useCallback(async (ticket: Ticket, decision: 'approve' | 'dismiss') => {
    const state = getState(ticket.id);
    const plan = ticketAutopilot(ticket);
    if (!plan || running) return;

    if (decision === 'approve' && !plan.actions.some((a) => state.approvals[a.id] !== false)) {
      setFlash({ type: 'error', text: 'All actions are unchecked — nothing to run.' });
      return;
    }

    setRunning(true);
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
        setFlash({ type: 'error', text: data.error || 'Failed' });
      } else if (decision === 'dismiss') {
        setFlash({ type: 'success', text: `#${ticket.ticket_number} dismissed` });
        advanceAfterDecision(ticket.id);
      } else {
        const p = data.plan as AutopilotPlan;
        const ok = p.actions.filter((a) => a.status === 'executed').length;
        const bad = p.actions.filter((a) => a.status === 'failed').length;
        setFlash({
          type: bad === 0 ? 'success' : 'error',
          text: bad === 0
            ? `#${ticket.ticket_number} done — ${ok} action${ok === 1 ? '' : 's'} executed`
            : `#${ticket.ticket_number} — ${ok} executed, ${bad} failed (see Executed tab)`,
        });
        advanceAfterDecision(ticket.id);
      }
    } catch {
      setFlash({ type: 'error', text: 'Request failed' });
    }
    setRunning(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, cardState, advanceAfterDecision]);

  const revise = useCallback(async (ticket: Ticket) => {
    const instruction = getState(ticket.id).instruction.trim();
    if (!instruction || revising) return;
    setRevising(true);
    try {
      const res = await fetch(`/api/autopilot/${ticket.id}/revise`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFlash({ type: 'error', text: data.error || 'Revision failed' });
      } else {
        setFlash({ type: 'success', text: 'Plan revised' });
        setCardState((prev) => ({ ...prev, [ticket.id]: { ...EMPTY_CARD } }));
        await load(true);
      }
    } catch {
      setFlash({ type: 'error', text: 'Revision failed' });
    }
    setRevising(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revising, cardState, load]);

  // Keyboard: ←/→ or J/K navigate · ⌘↵ approve & run · D dismiss
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
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
  }, [active, tab, decide, goRelative]);

  const tabs = [
    { key: 'pending' as const, label: 'Queue', count: counts.pending },
    { key: 'done' as const, label: 'Executed', count: counts.done },
    { key: 'dismissed' as const, label: 'Dismissed', count: counts.dismissed },
  ];

  return (
    // Break out of the shell's 1400px container to full viewport width
    <div style={{ marginLeft: 'calc(50% - 50vw)', marginRight: 'calc(50% - 50vw)', marginTop: -24, marginBottom: -24 }}>
      <div
        className="grid"
        style={{
          gridTemplateColumns: 'minmax(260px, 320px) 1fr',
          height: 'calc(100vh - 96px)',
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
              <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>Autopilot</span>
              <div className="flex-1" />
              <span title="Nothing runs without your approval"><ShieldCheck size={13} style={{ color: 'var(--color-success)' }} /></span>
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
              const tone = p ? confTone(p.analysis.overall_confidence) : 'var(--text-quaternary)';
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
                      <span style={{ fontSize: 10.5, fontWeight: 700, color: tone, fontVariantNumeric: 'tabular-nums', marginLeft: 'auto' }}>
                        {(p.analysis.overall_confidence * 100).toFixed(0)}%
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
            className="flex items-center gap-3 px-5 flex-shrink-0"
            style={{ height: 50, borderBottom: '1px solid var(--border-primary)', background: 'var(--bg-primary)' }}
          >
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
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md"
                style={{
                  fontSize: 12, fontWeight: 600,
                  color: flash.type === 'success' ? 'var(--color-success)' : 'var(--color-danger)',
                  background: `color-mix(in srgb, ${flash.type === 'success' ? 'var(--color-success)' : 'var(--color-danger)'} 10%, transparent)`,
                }}
              >
                {flash.type === 'success' ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
                {flash.text}
              </span>
            )}

            <div className="flex-1" />
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
              key={active.id}
              ticket={active}
              messages={threads[active.id]}
              state={getState(active.id)}
              patch={(p) => patchState(active.id, p)}
              pending={tab === 'pending'}
              running={running}
              revising={revising}
              onDecide={(d) => decide(active, d)}
              onRevise={() => revise(active)}
            />
          )}
        </div>
      </div>
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
  ticket, messages, state, patch, pending, running, revising, onDecide, onRevise,
}: {
  ticket: Ticket;
  messages?: TicketMessage[];
  state: CardState;
  patch: (p: Partial<CardState>) => void;
  pending: boolean;
  running: boolean;
  revising: boolean;
  onDecide: (d: 'approve' | 'dismiss') => void;
  onRevise: () => void;
}) {
  const plan = ticketAutopilot(ticket);
  const triage = ticketTriage(ticket);
  const instructionRef = useRef<HTMLTextAreaElement>(null);
  if (!plan) return null;

  const replyAction = plan.actions.find((a) => a.type === 'send_reply');
  const otherActions = plan.actions.filter((a) => a.type !== 'send_reply');
  const selectedCount = plan.actions.filter((a) => state.approvals[a.id] !== false).length;
  const overallTone = confTone(plan.analysis.overall_confidence);
  const busy = running || revising;

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
        <div className="px-6 pt-5 pb-4 mx-auto" style={{ maxWidth: 1500 }}>
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
              </div>
            </div>
            <span
              className="flex-shrink-0"
              title="Overall plan confidence"
              style={{ fontSize: 12, fontWeight: 700, padding: '4px 12px', borderRadius: 99, color: overallTone, background: `color-mix(in srgb, ${overallTone} 11%, transparent)`, fontVariantNumeric: 'tabular-nums' }}
            >
              {(plan.analysis.overall_confidence * 100).toFixed(0)}% confident
            </span>
          </div>

          {/* two-pane: context+actions | draft */}
          <div className="grid gap-5 items-start" style={{ gridTemplateColumns: replyAction ? 'minmax(340px, 5fr) minmax(420px, 7fr)' : '1fr' }}>
            {/* left: customer email + analysis + actions + instruction */}
            <div className="space-y-4 min-w-0">
              <ConversationSection messages={messages} customerName={ticket.customer_name} />

              <section className="ds-card" style={{ padding: '16px 18px' }}>
                <div style={sectionLabel}>Analysis</div>
                <p className="mt-2" style={{ fontSize: 13.5, color: 'var(--text-primary)', lineHeight: 1.6 }}>{plan.analysis.summary}</p>
                {plan.analysis.reasoning && (
                  <p className="mt-2" style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.55 }}>{plan.analysis.reasoning}</p>
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
                    {pending && <span style={{ fontSize: 11, color: 'var(--text-quaternary)', fontVariantNumeric: 'tabular-nums' }}>{selectedCount} of {plan.actions.length} selected</span>}
                  </div>
                  <div className="space-y-1.5 pb-2">
                    {otherActions.map((action) => (
                      <ActionRow
                        key={action.id}
                        action={action}
                        pending={pending}
                        approved={state.approvals[action.id] !== false}
                        onToggleApproved={() => patch({ approvals: { ...state.approvals, [action.id]: !(state.approvals[action.id] !== false) } })}
                      />
                    ))}
                  </div>
                </section>
              )}

              {pending && (
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
                pending={pending}
                approved={state.approvals[replyAction.id] !== false}
                editedText={state.edits[replyAction.id]}
                onToggleApproved={() => patch({ approvals: { ...state.approvals, [replyAction.id]: !(state.approvals[replyAction.id] !== false) } })}
                onEditText={(text) => patch({ edits: { ...state.edits, [replyAction.id]: text } })}
              />
            )}
          </div>
        </div>
      </div>

      {/* decision bar */}
      <div
        className="flex items-center gap-3 px-6 flex-shrink-0"
        style={{ height: 60, borderTop: '1px solid var(--border-primary)', background: 'var(--bg-primary)' }}
      >
        {pending ? (
          <>
            <span style={{ fontSize: 12, color: 'var(--text-quaternary)' }}>
              Approving runs {selectedCount} action{selectedCount === 1 ? '' : 's'} immediately, then moves to the next plan.
            </span>
            <div className="flex-1" />
            <button
              onClick={() => onDecide('dismiss')}
              disabled={busy}
              className="text-sm font-semibold px-4 py-2.5 rounded-lg disabled:opacity-50"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Dismiss
            </button>
            <button
              onClick={() => onDecide('approve')}
              disabled={busy || selectedCount === 0}
              className="inline-flex items-center gap-2 text-sm font-semibold px-5 py-2.5 rounded-lg disabled:opacity-50"
              style={{ background: 'var(--btn-primary-bg, var(--color-accent))', color: 'var(--btn-primary-fg, #fff)' }}
            >
              {running ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              {running ? 'Running…' : 'Approve & run'}
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
  const tone = confTone(action.confidence);
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
        <span style={{ fontSize: 12, fontWeight: 700, color: tone, fontVariantNumeric: 'tabular-nums' }}>
          {(action.confidence * 100).toFixed(0)}%
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
  const tone = confTone(action.confidence);
  const paramRows = Object.entries(action.params).filter(
    ([k]) => !['order_id', 'reply_text', 'original_params', 'original_type', 'edited_by_reviewer', 'classification'].includes(k)
  );
  const expandable = !!action.detail || paramRows.length > 0;

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
        <span className="flex-shrink-0" style={{ fontSize: 11, fontWeight: 700, color: tone, fontVariantNumeric: 'tabular-nums' }}>
          {(action.confidence * 100).toFixed(0)}%
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
