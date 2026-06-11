'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  Search, Inbox, Mail, FormInput, Sparkles, AlertCircle, AlertTriangle, CheckCircle2,
  Clock, ChevronLeft, ChevronRight, CheckSquare, Check, XCircle, Zap, Trash2, Archive,
  AlarmClock, Star, Bookmark, X,
} from 'lucide-react';
import type { Ticket, AgentRosterEntry } from '@/lib/types';
import { ticketTriage, ticketCsat, ticketSnoozedUntil } from '@/lib/types';
import { StatusPill } from '@/components/ui/StatusPill';
import { Button } from '@/components/ui/Button';

const SENTIMENT_DOT: Record<string, string> = {
  angry: 'var(--color-danger)',
  frustrated: 'var(--color-warning)',
};

interface SavedView {
  name: string;
  params: Record<string, string>;
}

// Source icon + human label. Colors live in the design tokens (see StatusPill).
const SOURCE_META: Record<string, { icon: typeof Mail; label: string }> = {
  email: { icon: Mail, label: 'Email' },
  form: { icon: FormInput, label: 'Form' },
  ai_escalation: { icon: Sparkles, label: 'AI Escalation' },
};

const CLASSIFICATION_LABELS: Record<string, string> = {
  customer_support: 'Support',
  promotional: 'Promo',
  transactional: 'Transactional',
  automated: 'Automated',
  spam: 'Spam',
  internal: 'Internal',
};

// Priority → design token. Used for avatar tint + priority ring.
const PRIORITY_TONE: Record<string, string> = {
  urgent: 'var(--color-priority-urgent)',
  high: 'var(--color-priority-high)',
  medium: 'var(--color-priority-medium)',
  low: 'var(--color-priority-low)',
};

interface FilterCounts {
  open: number;
  pending: number;
  resolved: number;
  closed: number;
  all: number;
  email: number;
  form: number;
  ai_escalation: number;
  urgent: number;
  high: number;
  medium: number;
  low: number;
  unassigned: number;
  breaching: number;
  awaitingFirstReply: number;
  snoozed: number;
  mine: number;
  csatAvg: number | null;
  csatCount: number;
}

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return 'now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function slaDisplay(ticket: Ticket): { text: string; color: string; breached: boolean } | null {
  if (!ticket.sla_deadline) return null;
  if (ticket.sla_breached) return { text: 'Breached', color: 'var(--color-danger)', breached: true };
  if (ticket.status === 'resolved' || ticket.status === 'closed') return null;

  const diff = new Date(ticket.sla_deadline).getTime() - Date.now();
  if (diff <= 0) return { text: 'Breached', color: 'var(--color-danger)', breached: true };

  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) {
    return { text: `${minutes}m left`, color: minutes < 30 ? 'var(--color-warning)' : 'var(--color-success)', breached: false };
  }
  const hours = Math.floor(minutes / 60);
  const remainingMins = minutes % 60;
  return { text: `${hours}h ${remainingMins}m`, color: hours < 2 ? 'var(--color-warning)' : 'var(--color-success)', breached: false };
}

// Two-letter avatar initials from a name (preferred) or email local part.
function initials(name: string | null | undefined, email: string | null | undefined): string {
  const base = (name && name.trim()) || (email || '').replace(/@.*/, '') || '?';
  const parts = base.split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return base.slice(0, 2).toUpperCase();
}

export interface TicketInboxProps {
  /** Link prefix for ticket detail pages — e.g. "/tickets" or "/agent/tickets". */
  basePath?: string;
  /** Show destructive / bulk-cleanup actions (Close All, Delete Emails, AI Clean Up). Admin only. */
  showAdminActions?: boolean;
  /** Heading shown above the inbox. */
  title?: string;
}

export function TicketInbox({ basePath = '/tickets', showAdminActions = true, title = 'Ticket Inbox' }: TicketInboxProps) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);

  // Filters
  const [statusFilter, setStatusFilter] = useState('open');
  const [sourceFilter, setSourceFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [unassignedOnly, setUnassignedOnly] = useState(false);
  const [snoozedOnly, setSnoozedOnly] = useState(false);
  const [mineOnly, setMineOnly] = useState(false);
  const [assigneeFilter, setAssigneeFilter] = useState('');
  const [search, setSearch] = useState('');
  const [orderBy, setOrderBy] = useState('sla_urgency');

  // Roster for assignee chips + filter
  const [roster, setRoster] = useState<AgentRosterEntry[]>([]);
  const rosterById = new Map(roster.map((a) => [a.id, a]));

  // Saved views (localStorage)
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const savedViewsKey = `ticketSavedViews:${basePath}`;

  // Bulk selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [aiAutoCloseLoading, setAiAutoCloseLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Counts
  const [counts, setCounts] = useState<FilterCounts>({
    open: 0, pending: 0, resolved: 0, closed: 0, all: 0,
    email: 0, form: 0, ai_escalation: 0,
    urgent: 0, high: 0, medium: 0, low: 0,
    unassigned: 0, breaching: 0, awaitingFirstReply: 0,
    snoozed: 0, mine: 0, csatAvg: null, csatCount: 0,
  });

  const perPage = 20;

  const loadCounts = useCallback(async () => {
    try {
      const res = await fetch('/api/tickets/stats');
      const data = await res.json();
      setCounts({
        open: data.openCount ?? 0,
        pending: data.pendingCount ?? 0,
        resolved: data.resolvedCount ?? 0,
        closed: data.closedCount ?? 0,
        all: (data.openCount ?? 0) + (data.pendingCount ?? 0) + (data.resolvedCount ?? 0) + (data.closedCount ?? 0),
        email: data.ticketsBySource?.email ?? 0,
        form: data.ticketsBySource?.form ?? 0,
        ai_escalation: data.ticketsBySource?.ai_escalation ?? 0,
        urgent: data.urgentCount ?? 0,
        high: data.highCount ?? 0,
        medium: data.mediumCount ?? 0,
        low: data.lowCount ?? 0,
        unassigned: data.unassignedCount ?? 0,
        breaching: data.breachingCount ?? 0,
        awaitingFirstReply: data.awaitingFirstReplyCount ?? 0,
        snoozed: data.snoozedCount ?? 0,
        mine: data.mineCount ?? 0,
        csatAvg: data.csatAvg ?? null,
        csatCount: data.csatCount ?? 0,
      });
    } catch {
      // ignore
    }
  }, []);

  const buildFilterParams = useCallback(() => {
    const params = new URLSearchParams();
    params.set('order_by', orderBy);
    if (snoozedOnly) {
      params.set('snoozed', '1');
    } else {
      if (statusFilter) params.set('status', statusFilter);
    }
    if (mineOnly) params.set('assigned_to', 'me');
    else if (assigneeFilter) params.set('assigned_to', assigneeFilter);
    if (sourceFilter) params.set('source', sourceFilter);
    if (priorityFilter) params.set('priority', priorityFilter);
    if (unassignedOnly) params.set('unassigned', '1');
    if (search) params.set('search', search);
    return params;
  }, [statusFilter, sourceFilter, priorityFilter, unassignedOnly, snoozedOnly, mineOnly, assigneeFilter, search, orderBy]);

  const loadTickets = useCallback(async () => {
    setLoading(true);
    const params = buildFilterParams();
    params.set('page', String(page));
    params.set('per_page', String(perPage));

    try {
      const res = await fetch(`/api/tickets?${params}`);
      const data = await res.json();
      setTickets(data.tickets ?? []);
      setTotal(data.total ?? 0);
      setTotalPages(data.totalPages ?? 1);
    } catch {
      setTickets([]);
    }
    setLoading(false);
  }, [page, buildFilterParams]);

  useEffect(() => { loadCounts(); }, [loadCounts]);
  useEffect(() => { loadTickets(); }, [loadTickets]);

  // Roster + saved views (once)
  useEffect(() => {
    fetch('/api/agents/roster')
      .then((r) => r.json())
      .then((d) => setRoster(d.agents ?? []))
      .catch(() => {});
    try {
      const raw = localStorage.getItem(savedViewsKey);
      if (raw) setSavedViews(JSON.parse(raw));
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Clear selection when filters change
  useEffect(() => { setSelectedIds(new Set()); }, [statusFilter, sourceFilter, priorityFilter, snoozedOnly, mineOnly, assigneeFilter, page, search]);

  // Persist the active filter so the ticket-detail workflow bar can rebuild the
  // same work queue (next/prev navigation mirrors what you were looking at here).
  useEffect(() => {
    try { sessionStorage.setItem('ticketQueueParams', buildFilterParams().toString()); } catch { /* ignore */ }
  }, [buildFilterParams]);

  function applySavedView(v: SavedView) {
    setStatusFilter(v.params.status ?? '');
    setSourceFilter(v.params.source ?? '');
    setPriorityFilter(v.params.priority ?? '');
    setUnassignedOnly(v.params.unassigned === '1');
    setSnoozedOnly(v.params.snoozed === '1');
    setMineOnly(v.params.assigned_to === 'me');
    setAssigneeFilter(v.params.assigned_to && v.params.assigned_to !== 'me' ? v.params.assigned_to : '');
    setSearch(v.params.search ?? '');
    setOrderBy(v.params.order_by ?? 'sla_urgency');
    setPage(1);
  }

  function saveCurrentView() {
    const name = prompt('Name this view (e.g. "Urgent email backlog"):');
    if (!name?.trim()) return;
    const params = Object.fromEntries(buildFilterParams().entries());
    const next = [...savedViews.filter((v) => v.name !== name.trim()), { name: name.trim(), params }];
    setSavedViews(next);
    try { localStorage.setItem(savedViewsKey, JSON.stringify(next)); } catch { /* ignore */ }
  }

  function deleteSavedView(name: string) {
    const next = savedViews.filter((v) => v.name !== name);
    setSavedViews(next);
    try { localStorage.setItem(savedViewsKey, JSON.stringify(next)); } catch { /* ignore */ }
  }

  // Clear action message after 4 seconds
  useEffect(() => {
    if (actionMessage) {
      const timer = setTimeout(() => setActionMessage(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [actionMessage]);

  const toggleSelect = (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedIds.size === tickets.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(tickets.map((t) => t.id)));
    }
  };

  const bulkUpdate = async (status: 'resolved' | 'closed') => {
    if (selectedIds.size === 0) return;
    const label = status === 'resolved' ? 'Resolved' : 'Closed';
    setBulkLoading(true);
    try {
      const res = await fetch('/api/tickets/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selectedIds), status }),
      });
      const data = await res.json();
      if (res.ok) {
        setActionMessage({ text: `${label} ${data.updated} ticket${data.updated !== 1 ? 's' : ''}`, type: 'success' });
        setSelectedIds(new Set());
        loadTickets();
        loadCounts();
      } else {
        setActionMessage({ text: data.error || `Failed to ${label.toLowerCase()} tickets`, type: 'error' });
      }
    } catch {
      setActionMessage({ text: `Failed to ${label.toLowerCase()} tickets`, type: 'error' });
    }
    setBulkLoading(false);
  };

  const aiAutoClose = async () => {
    if (!confirm('This will use AI to classify all unclassified open tickets and auto-close any that are not customer support (promotional, automated, spam, etc.). Continue?')) return;
    setAiAutoCloseLoading(true);
    try {
      const res = await fetch('/api/tickets/ai-auto-close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (res.ok) {
        const parts: string[] = [];
        if (data.classified > 0) parts.push(`classified ${data.classified}`);
        if (data.selfClosed > 0) parts.push(`deleted ${data.selfClosed} self-emails`);
        if (data.closed > 0) parts.push(`closed ${data.closed} non-support`);
        const msg = parts.length > 0 ? `AI Clean Up: ${parts.join(', ')}` : 'AI Clean Up: no action needed';
        setActionMessage({ text: msg, type: 'success' });
        loadTickets();
        loadCounts();
      } else {
        setActionMessage({ text: data.error || 'AI auto-close failed', type: 'error' });
      }
    } catch {
      setActionMessage({ text: 'AI auto-close failed', type: 'error' });
    }
    setAiAutoCloseLoading(false);
  };

  const closeAllVisible = async () => {
    const count = total;
    if (!confirm(`Close ALL ${count} tickets matching the current filter? This cannot be undone.`)) return;
    setBulkLoading(true);
    try {
      const res = await fetch('/api/tickets/close-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: statusFilter || undefined,
          source: sourceFilter || undefined,
          priority: priorityFilter || undefined,
          search: search || undefined,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setActionMessage({ text: `Closed ${data.closed} tickets`, type: 'success' });
        setSelectedIds(new Set());
        loadTickets();
        loadCounts();
      } else {
        setActionMessage({ text: data.error || 'Failed to close tickets', type: 'error' });
      }
    } catch {
      setActionMessage({ text: 'Failed to close tickets', type: 'error' });
    }
    setBulkLoading(false);
  };

  const [deleteLoading, setDeleteLoading] = useState(false);
  const deleteAllEmailTickets = async () => {
    if (!confirm('WARNING: This will PERMANENTLY DELETE all email-sourced tickets and their messages. This is a one-time cleanup action and CANNOT be undone. Are you sure?')) return;
    if (!confirm('FINAL CONFIRMATION: Permanently delete ALL email tickets? Type OK in the next prompt to confirm.')) return;
    setDeleteLoading(true);
    try {
      const res = await fetch('/api/tickets/delete-all-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (res.ok) {
        setActionMessage({ text: `Permanently deleted ${data.deleted} email tickets`, type: 'success' });
        setSelectedIds(new Set());
        loadTickets();
        loadCounts();
      } else {
        setActionMessage({ text: data.error || 'Failed to delete tickets', type: 'error' });
      }
    } catch {
      setActionMessage({ text: 'Failed to delete tickets', type: 'error' });
    }
    setDeleteLoading(false);
  };

  // Segmented "views" — drives status + unassigned/mine/snoozed filters.
  const viewFilters = [
    { key: 'open', label: 'Open', count: counts.open },
    { key: 'mine', label: 'Mine', count: counts.mine },
    { key: 'unassigned', label: 'Unassigned', count: counts.unassigned },
    { key: 'pending', label: 'Pending', count: counts.pending },
    { key: 'snoozed', label: 'Snoozed', count: counts.snoozed },
    { key: 'resolved', label: 'Resolved', count: counts.resolved },
    { key: 'closed', label: 'Closed', count: counts.closed },
    { key: '', label: 'All', count: counts.all },
  ];

  function handleViewFilter(key: string) {
    setUnassignedOnly(false);
    setSnoozedOnly(false);
    setMineOnly(false);
    if (key === 'unassigned') {
      setStatusFilter('open');
      setUnassignedOnly(true);
    } else if (key === 'snoozed') {
      setStatusFilter('');
      setSnoozedOnly(true);
    } else if (key === 'mine') {
      setStatusFilter('open');
      setMineOnly(true);
    } else {
      setStatusFilter(key);
    }
    setPage(1);
  }

  // Headline stats — all real, from /api/tickets/stats.
  const statCards = [
    { label: 'Open tickets', value: String(counts.open), tone: 'var(--color-accent)', icon: Inbox, emphasize: false },
    { label: 'Awaiting first reply', value: String(counts.awaitingFirstReply), tone: 'var(--color-warning)', icon: Clock, emphasize: false },
    { label: 'SLA breached', value: String(counts.breaching), tone: 'var(--color-danger)', icon: AlertTriangle, emphasize: counts.breaching > 0 },
    { label: 'Resolved', value: String(counts.resolved), tone: 'var(--color-success)', icon: CheckCircle2, emphasize: false },
    {
      label: counts.csatCount > 0 ? `CSAT (${counts.csatCount} ratings)` : 'CSAT',
      value: counts.csatAvg != null ? counts.csatAvg.toFixed(1) : '—',
      tone: 'var(--color-accent)',
      icon: Star,
      emphasize: false,
    },
  ];

  const allSelected = tickets.length > 0 && selectedIds.size === tickets.length;

  const inputStyle: React.CSSProperties = {
    backgroundColor: 'var(--bg-primary)',
    border: '1px solid var(--border-primary)',
    color: 'var(--text-primary)',
    borderRadius: 'var(--radius-md)',
  };

  return (
    <div className="space-y-5">
      {/* ── Header ───────────────────────────────────────────── */}
      <div className="flex items-center gap-4 flex-wrap">
        <div>
          <h1 className="font-bold" style={{ fontSize: 21, letterSpacing: '-0.03em', color: 'var(--text-primary)' }}>
            {title}
          </h1>
          <p className="mt-0.5" style={{ fontSize: 12.5, color: 'var(--text-tertiary)' }}>
            {loading ? 'Loading…' : `${total} ${total === 1 ? 'ticket' : 'tickets'} in view`}
          </p>
        </div>

        <div className="flex-1" />

        {/* Search */}
        <div
          className="flex items-center gap-2 px-3"
          style={{ ...inputStyle, height: 36, width: 240, maxWidth: '100%' }}
        >
          <Search size={15} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
          <input
            placeholder="Search subject or email…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-full bg-transparent outline-none"
            style={{ fontSize: 13, color: 'var(--text-primary)' }}
          />
        </div>

        {showAdminActions && (
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={aiAutoClose}
              disabled={aiAutoCloseLoading}
              leadingIcon={<Zap size={14} style={{ color: 'var(--color-accent)' }} />}
              title="Use AI to classify and auto-close non-support emails"
            >
              {aiAutoCloseLoading ? 'Processing…' : 'AI Clean Up'}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={closeAllVisible}
              disabled={bulkLoading || total === 0}
              leadingIcon={<Archive size={14} />}
              title="Close all tickets matching current filter"
            >
              Close All
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={deleteAllEmailTickets}
              disabled={deleteLoading}
              leadingIcon={<Trash2 size={14} />}
              title="PERMANENTLY delete all email tickets (one-time cleanup)"
            >
              {deleteLoading ? 'Deleting…' : 'Delete Emails'}
            </Button>
          </>
        )}
      </div>

      {/* ── Stat cards ───────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {statCards.map((s) => {
          const Icon = s.icon;
          return (
            <div key={s.label} className="ds-card flex items-center justify-between" style={{ padding: '15px 16px' }}>
              <div>
                <div
                  style={{
                    fontSize: 24, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1,
                    fontVariantNumeric: 'tabular-nums',
                    color: s.emphasize ? s.tone : 'var(--text-primary)',
                  }}
                >
                  {s.value}
                </div>
                <div className="mt-1.5" style={{ fontSize: 12, color: 'var(--text-tertiary)', fontWeight: 500 }}>
                  {s.label}
                </div>
              </div>
              <div
                className="grid place-items-center flex-shrink-0"
                style={{ width: 34, height: 34, borderRadius: 9, background: `color-mix(in srgb, ${s.tone} 12%, transparent)` }}
              >
                <Icon size={17} style={{ color: s.tone }} />
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Action message toast ─────────────────────────────── */}
      {actionMessage && (
        <div
          className="px-4 py-2.5 rounded-lg text-sm font-medium flex items-center gap-2"
          style={{
            backgroundColor: `color-mix(in srgb, ${actionMessage.type === 'success' ? 'var(--color-success)' : 'var(--color-danger)'} 12%, transparent)`,
            color: actionMessage.type === 'success' ? 'var(--color-success)' : 'var(--color-danger)',
            border: `1px solid color-mix(in srgb, ${actionMessage.type === 'success' ? 'var(--color-success)' : 'var(--color-danger)'} 24%, transparent)`,
          }}
        >
          {actionMessage.type === 'success' ? <CheckSquare size={14} /> : <AlertCircle size={14} />}
          {actionMessage.text}
        </div>
      )}

      {/* ── Filter bar ───────────────────────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Segmented views */}
        <div
          className="inline-flex flex-wrap"
          style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-primary)', borderRadius: 'var(--radius-md)', padding: 3 }}
        >
          {viewFilters.map((f) => {
            const noSpecial = !unassignedOnly && !snoozedOnly && !mineOnly;
            const active =
              f.key === 'unassigned' ? unassignedOnly :
              f.key === 'snoozed' ? snoozedOnly :
              f.key === 'mine' ? mineOnly :
              noSpecial && ((f.key === '' && !statusFilter) || statusFilter === f.key);
            return (
              <button
                key={f.key || 'all'}
                onClick={() => handleViewFilter(f.key)}
                className="inline-flex items-center gap-1.5"
                style={{
                  fontSize: 12.5, fontWeight: 600, padding: '6px 12px', borderRadius: 6,
                  background: active ? 'var(--btn-primary-bg)' : 'transparent',
                  color: active ? 'var(--btn-primary-fg)' : 'var(--text-secondary)',
                  transition: 'background var(--duration-fast) var(--ease-out)',
                }}
              >
                {f.label}
                <span
                  style={{
                    fontSize: 11, fontVariantNumeric: 'tabular-nums',
                    color: active ? 'color-mix(in srgb, var(--btn-primary-fg) 55%, transparent)' : 'var(--text-quaternary)',
                  }}
                >
                  {f.count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Source filter */}
        <select
          value={sourceFilter}
          onChange={(e) => { setSourceFilter(e.target.value); setPage(1); }}
          className="px-3"
          style={{ ...inputStyle, height: 36, fontSize: 12.5, fontWeight: 500, color: 'var(--text-secondary)' }}
        >
          <option value="">All sources</option>
          <option value="email">Email ({counts.email})</option>
          <option value="form">Form ({counts.form})</option>
          <option value="ai_escalation">AI Escalation ({counts.ai_escalation})</option>
        </select>

        {/* Priority filter */}
        <select
          value={priorityFilter}
          onChange={(e) => { setPriorityFilter(e.target.value); setPage(1); }}
          className="px-3"
          style={{ ...inputStyle, height: 36, fontSize: 12.5, fontWeight: 500, color: 'var(--text-secondary)' }}
        >
          <option value="">Any priority</option>
          <option value="urgent">Urgent ({counts.urgent})</option>
          <option value="high">High ({counts.high})</option>
          <option value="medium">Medium ({counts.medium})</option>
          <option value="low">Low ({counts.low})</option>
        </select>

        {/* Assignee filter */}
        {roster.length > 0 && (
          <select
            value={mineOnly ? '' : assigneeFilter}
            onChange={(e) => { setAssigneeFilter(e.target.value); setMineOnly(false); setPage(1); }}
            className="px-3"
            style={{ ...inputStyle, height: 36, fontSize: 12.5, fontWeight: 500, color: 'var(--text-secondary)' }}
          >
            <option value="">Any agent</option>
            {roster.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        )}

        <div className="flex-1" />

        {/* Select-all */}
        {tickets.length > 0 && (
          <button
            onClick={selectAll}
            className="inline-flex items-center gap-1.5 px-2.5"
            style={{ height: 36, fontSize: 12.5, fontWeight: 600, color: allSelected ? 'var(--color-accent)' : 'var(--text-tertiary)' }}
          >
            {allSelected ? <CheckSquare size={14} /> : <Check size={14} />}
            {allSelected ? 'Deselect' : 'Select all'}
          </button>
        )}

        {/* Sort */}
        <select
          value={orderBy}
          onChange={(e) => { setOrderBy(e.target.value); setPage(1); }}
          className="px-3"
          style={{ ...inputStyle, height: 36, fontSize: 12.5, fontWeight: 500, color: 'var(--text-secondary)' }}
        >
          <option value="sla_urgency">Sort: SLA urgency</option>
          <option value="newest">Sort: Newest</option>
          <option value="oldest">Sort: Oldest</option>
          <option value="priority">Sort: Priority</option>
        </select>
      </div>

      {/* ── Saved views ──────────────────────────────────────── */}
      <div className="flex items-center gap-1.5 flex-wrap" style={{ marginTop: -6 }}>
        <Bookmark size={12} style={{ color: 'var(--text-quaternary)' }} />
        {savedViews.map((v) => (
          <span
            key={v.name}
            className="inline-flex items-center gap-1 rounded-full"
            style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-primary)', padding: '3px 4px 3px 10px' }}
          >
            <button
              onClick={() => applySavedView(v)}
              style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-secondary)' }}
              title={Object.entries(v.params).map(([k, val]) => `${k}=${val}`).join(' · ')}
            >
              {v.name}
            </button>
            <button
              onClick={() => deleteSavedView(v.name)}
              className="grid place-items-center rounded-full"
              style={{ width: 16, height: 16, color: 'var(--text-quaternary)' }}
              title="Delete view"
            >
              <X size={10} />
            </button>
          </span>
        ))}
        <button
          onClick={saveCurrentView}
          className="inline-flex items-center gap-1 rounded-full"
          style={{
            fontSize: 11.5, fontWeight: 600, padding: '3px 10px',
            color: 'var(--text-tertiary)', border: '1px dashed var(--border-primary)', background: 'transparent',
          }}
          title="Save the current filters as a reusable view"
        >
          + Save view
        </button>
      </div>

      {/* ── Bulk actions bar ─────────────────────────────────── */}
      {selectedIds.size > 0 && (
        <div
          className="flex items-center gap-3 px-4 py-2.5 rounded-lg"
          style={{
            backgroundColor: 'var(--color-accent-soft)',
            border: '1px solid var(--color-accent-ring)',
          }}
        >
          <span className="text-sm font-semibold" style={{ color: 'var(--color-accent-strong)' }}>
            {selectedIds.size} selected
          </span>
          <div className="flex items-center gap-2 ml-auto">
            <Button variant="secondary" size="sm" onClick={() => bulkUpdate('resolved')} disabled={bulkLoading} leadingIcon={<CheckCircle2 size={13} style={{ color: 'var(--color-success)' }} />}>
              Resolve
            </Button>
            <Button variant="secondary" size="sm" onClick={() => bulkUpdate('closed')} disabled={bulkLoading} leadingIcon={<XCircle size={13} />}>
              Close
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>
              Clear
            </Button>
          </div>
        </div>
      )}

      {/* ── Ticket list (soft cards) ─────────────────────────── */}
      {loading ? (
        <div className="ds-card p-10 text-center">
          <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>Loading tickets…</p>
        </div>
      ) : tickets.length === 0 ? (
        <div className="ds-card p-14 text-center">
          <Inbox size={30} className="mx-auto mb-3" style={{ color: 'var(--text-quaternary)' }} />
          <p className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>No tickets found</p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>Try adjusting your filters or search</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {tickets.map((ticket) => {
            const sla = slaDisplay(ticket);
            const sourceMeta = SOURCE_META[ticket.source];
            const SourceIcon = sourceMeta?.icon;
            const isSelected = selectedIds.has(ticket.id);
            const isTrade = ticket.tags?.includes('trade-member');
            const showClassification = ticket.classification && ticket.classification !== 'customer_support';
            const priorityTone = PRIORITY_TONE[ticket.priority] ?? 'var(--color-priority-low)';
            const avatarTone = isTrade ? 'var(--color-accent)' : priorityTone;
            const triage = ticketTriage(ticket);
            const sentimentDot = triage?.sentiment ? SENTIMENT_DOT[triage.sentiment] : null;
            const csat = ticketCsat(ticket);
            const rowSnoozedUntil = ticketSnoozedUntil(ticket);
            const rowAssignee = ticket.assigned_to ? rosterById.get(ticket.assigned_to) : null;

            return (
              <Link
                key={ticket.id}
                href={`${basePath}/${ticket.id}`}
                className="ds-card group"
                style={{
                  display: 'grid',
                  gridTemplateColumns: '38px minmax(0,1fr) auto',
                  alignItems: 'center',
                  gap: 14,
                  padding: '13px 16px',
                  borderColor: isSelected ? 'var(--color-accent-ring)' : undefined,
                  boxShadow: isSelected ? '0 0 0 3px var(--color-accent-soft)' : 'var(--shadow-sm)',
                  transition: 'box-shadow var(--duration-base) var(--ease-out), border-color var(--duration-base) var(--ease-out)',
                }}
                onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.boxShadow = 'var(--shadow-md)'; }}
                onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.boxShadow = 'var(--shadow-sm)'; }}
              >
                {/* Avatar doubles as the select toggle */}
                <span
                  role="checkbox"
                  aria-checked={isSelected}
                  title={isSelected ? 'Deselect' : 'Select'}
                  onClick={(e) => toggleSelect(ticket.id, e)}
                  className="grid place-items-center relative"
                  style={{
                    width: 38, height: 38, borderRadius: 10, fontWeight: 600, fontSize: 13,
                    background: isSelected ? 'var(--color-accent)' : `color-mix(in srgb, ${avatarTone} 14%, transparent)`,
                    color: isSelected ? 'var(--color-accent-foreground)' : avatarTone,
                  }}
                >
                  {isSelected ? <Check size={18} /> : initials(ticket.customer_name, ticket.customer_email)}
                  {!isSelected && (
                    <span
                      className="absolute"
                      style={{
                        right: -2, bottom: -2, width: 12, height: 12, borderRadius: '50%',
                        background: priorityTone, border: '2.5px solid var(--bg-primary)',
                      }}
                    />
                  )}
                </span>

                {/* Subject + customer */}
                <div className="min-w-0">
                  <div className="flex items-center gap-2" style={{ marginBottom: 3 }}>
                    <span style={{ fontSize: 11.5, color: 'var(--text-quaternary)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                      #{ticket.ticket_number}
                    </span>
                    {isTrade && (
                      <span
                        style={{
                          fontSize: 9.5, fontWeight: 700, letterSpacing: '0.03em', padding: '1px 7px', borderRadius: 5,
                          color: 'var(--color-accent-strong)', background: 'var(--color-accent-soft)', border: '1px solid var(--color-accent-ring)',
                          flexShrink: 0,
                        }}
                      >
                        TRADE
                      </span>
                    )}
                    {sentimentDot && (
                      <span
                        title={`Customer sounds ${triage?.sentiment}`}
                        style={{ width: 7, height: 7, borderRadius: '50%', background: sentimentDot, flexShrink: 0 }}
                      />
                    )}
                    <span
                      className="truncate"
                      style={{ fontWeight: 600, fontSize: 14, letterSpacing: '-0.01em', color: 'var(--text-primary)' }}
                    >
                      {ticket.subject}
                    </span>
                    {showClassification && (
                      <StatusPill kind="classification" value={ticket.classification!} label={CLASSIFICATION_LABELS[ticket.classification!] ?? undefined} />
                    )}
                    {rowSnoozedUntil && (
                      <span
                        className="inline-flex items-center gap-1 flex-shrink-0"
                        style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--color-source-ai)' }}
                        title={`Snoozed until ${new Date(rowSnoozedUntil).toLocaleString()}`}
                      >
                        <AlarmClock size={11} />
                        {new Date(rowSnoozedUntil).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </span>
                    )}
                    {csat && (
                      <span
                        className="inline-flex items-center gap-0.5 flex-shrink-0"
                        style={{
                          fontSize: 10.5, fontWeight: 700,
                          color: csat.score >= 4 ? 'var(--color-success)' : csat.score <= 2 ? 'var(--color-danger)' : 'var(--color-warning)',
                        }}
                        title={`CSAT ${csat.score}/5`}
                      >
                        <Star size={10} fill="currentColor" /> {csat.score}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2.5" style={{ fontSize: 12.5, color: 'var(--text-tertiary)' }}>
                    <span className="truncate" style={{ maxWidth: 220 }}>
                      {ticket.customer_name || ticket.customer_email}
                    </span>
                    {sourceMeta && (
                      <span className="inline-flex items-center gap-1.5 flex-shrink-0">
                        {SourceIcon && <SourceIcon size={12} style={{ color: 'var(--text-quaternary)' }} />}
                        {sourceMeta.label}
                      </span>
                    )}
                  </div>
                </div>

                {/* Assignee / Priority / SLA / age */}
                <div className="flex items-center gap-3 flex-shrink-0">
                  {rowAssignee && (
                    <span
                      className="grid place-items-center"
                      title={`Assigned to ${rowAssignee.name}`}
                      style={{
                        width: 22, height: 22, borderRadius: '50%', fontSize: 9.5, fontWeight: 700,
                        background: 'var(--color-accent-soft)', color: 'var(--color-accent-strong)',
                        border: '1px solid var(--color-accent-ring)',
                      }}
                    >
                      {initials(rowAssignee.name, null)}
                    </span>
                  )}
                  {!statusFilter && <StatusPill kind="status" value={ticket.status} />}
                  <StatusPill kind="priority" value={ticket.priority} />
                  {sla ? (
                    <span
                      className="inline-flex items-center gap-1.5 justify-end"
                      style={{ fontSize: 12, fontWeight: 600, color: sla.color, minWidth: 84, fontVariantNumeric: 'tabular-nums' }}
                    >
                      {sla.breached ? <AlertTriangle size={13} /> : <Clock size={13} />}
                      {sla.text}
                    </span>
                  ) : (
                    <span style={{ fontSize: 12, color: 'var(--text-quaternary)', minWidth: 84, textAlign: 'right' }}>—</span>
                  )}
                  <span style={{ fontSize: 11.5, color: 'var(--text-quaternary)', minWidth: 30, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {timeAgo(ticket.updated_at)}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {/* ── Pagination ───────────────────────────────────────── */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            Page {page} of {totalPages}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1} aria-label="Previous page">
              <ChevronLeft size={14} />
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page === totalPages} aria-label="Next page">
              <ChevronRight size={14} />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
