'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Search, Inbox, Mail, FormInput, Sparkles, AlertCircle, Clock, ChevronLeft, ChevronRight, CheckSquare, Square, XCircle, Zap, Trash2, Archive } from 'lucide-react';
import type { Ticket } from '@/lib/types';
import { StatusPill } from '@/components/ui/StatusPill';
import { Button } from '@/components/ui/Button';

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

// Priority dot color → design token (used by the priority filter list).
const PRIORITY_DOT: Record<string, string> = {
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
}

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function slaDisplay(ticket: Ticket): { text: string; color: string } | null {
  if (!ticket.sla_deadline) return null;
  if (ticket.sla_breached) return { text: 'BREACHED', color: 'var(--color-danger)' };
  if (ticket.status === 'resolved' || ticket.status === 'closed') return null;

  const diff = new Date(ticket.sla_deadline).getTime() - Date.now();
  if (diff <= 0) return { text: 'BREACHED', color: 'var(--color-danger)' };

  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) {
    return { text: `${minutes}m left`, color: minutes < 30 ? 'var(--color-warning)' : 'var(--color-success)' };
  }
  const hours = Math.floor(minutes / 60);
  const remainingMins = minutes % 60;
  return { text: `${hours}h ${remainingMins}m left`, color: hours < 2 ? 'var(--color-warning)' : 'var(--color-success)' };
}

export default function TicketInboxPage() {
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
  const [search, setSearch] = useState('');
  const [orderBy, setOrderBy] = useState('sla_urgency');

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
    unassigned: 0,
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
      });
    } catch {
      // ignore
    }
  }, []);

  const loadTickets = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({
      page: String(page),
      per_page: String(perPage),
      order_by: orderBy,
    });
    if (statusFilter) params.set('status', statusFilter);
    if (sourceFilter) params.set('source', sourceFilter);
    if (priorityFilter) params.set('priority', priorityFilter);
    if (unassignedOnly) params.set('unassigned', '1');
    if (search) params.set('search', search);

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
  }, [page, statusFilter, sourceFilter, priorityFilter, unassignedOnly, search, orderBy]);

  useEffect(() => { loadCounts(); }, [loadCounts]);
  useEffect(() => { loadTickets(); }, [loadTickets]);

  // Clear selection when filters change
  useEffect(() => { setSelectedIds(new Set()); }, [statusFilter, sourceFilter, priorityFilter, page, search]);

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

  const bulkClose = async () => {
    if (selectedIds.size === 0) return;
    setBulkLoading(true);
    try {
      const res = await fetch('/api/tickets/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selectedIds), status: 'closed' }),
      });
      const data = await res.json();
      if (res.ok) {
        setActionMessage({ text: `Closed ${data.updated} ticket${data.updated !== 1 ? 's' : ''}`, type: 'success' });
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

  const bulkResolve = async () => {
    if (selectedIds.size === 0) return;
    setBulkLoading(true);
    try {
      const res = await fetch('/api/tickets/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selectedIds), status: 'resolved' }),
      });
      const data = await res.json();
      if (res.ok) {
        setActionMessage({ text: `Resolved ${data.updated} ticket${data.updated !== 1 ? 's' : ''}`, type: 'success' });
        setSelectedIds(new Set());
        loadTickets();
        loadCounts();
      } else {
        setActionMessage({ text: data.error || 'Failed to resolve tickets', type: 'error' });
      }
    } catch {
      setActionMessage({ text: 'Failed to resolve tickets', type: 'error' });
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

  const viewFilters = [
    { key: '', label: 'All Tickets', count: counts.all },
    { key: 'open', label: 'Open', count: counts.open },
    { key: 'unassigned', label: 'Unassigned', count: counts.unassigned },
    { key: 'pending', label: 'Pending', count: counts.pending },
    { key: 'resolved', label: 'Resolved', count: counts.resolved },
    { key: 'closed', label: 'Closed', count: counts.closed },
  ];

  const sourceFilters = [
    { key: 'email', label: 'Email', count: counts.email },
    { key: 'form', label: 'Form', count: counts.form },
    { key: 'ai_escalation', label: 'AI Escalation', count: counts.ai_escalation },
  ];

  const priorityFilters = [
    { key: 'urgent', label: 'Urgent', count: counts.urgent },
    { key: 'high', label: 'High', count: counts.high },
    { key: 'medium', label: 'Medium', count: counts.medium },
    { key: 'low', label: 'Low', count: counts.low },
  ];

  function handleViewFilter(key: string) {
    if (key === 'unassigned') {
      setStatusFilter('open');
      setUnassignedOnly(true);
    } else {
      setStatusFilter(key);
      setUnassignedOnly(false);
    }
    setPage(1);
  }

  const allSelected = tickets.length > 0 && selectedIds.size === tickets.length;

  const filterRowStyle = (active: boolean): React.CSSProperties => ({
    backgroundColor: active ? 'color-mix(in srgb, var(--color-accent) 10%, transparent)' : 'transparent',
    color: active ? 'var(--color-accent)' : 'var(--text-secondary)',
    fontWeight: active ? 500 : 400,
  });

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Inbox size={20} style={{ color: 'var(--text-primary)' }} />
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
            Ticket Inbox
          </h2>
          <span className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
            {total} {total === 1 ? 'ticket' : 'tickets'}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="secondary" size="sm" onClick={closeAllVisible} disabled={bulkLoading || total === 0} leadingIcon={<Archive size={14} />} title="Close all tickets matching current filter">
            Close All
          </Button>
          <Button variant="danger" size="sm" onClick={deleteAllEmailTickets} disabled={deleteLoading} leadingIcon={<Trash2 size={14} />} title="PERMANENTLY delete all email tickets (one-time cleanup)">
            {deleteLoading ? 'Deleting...' : 'Delete All Emails'}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={aiAutoClose}
            disabled={aiAutoCloseLoading}
            leadingIcon={<Zap size={14} style={{ color: 'var(--color-source-ai)' }} />}
            title="Use AI to classify and auto-close non-support emails"
          >
            {aiAutoCloseLoading ? 'Processing...' : 'AI Clean Up'}
          </Button>
          {/* Search */}
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-tertiary)' }} />
            <input
              placeholder="Search subject or email..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="pl-9 pr-3 py-2 text-sm rounded-lg w-64 focus:outline-none focus:ring-2"
              style={{
                backgroundColor: 'var(--bg-primary)',
                border: '1px solid var(--border-primary)',
                color: 'var(--text-primary)',
                '--tw-ring-color': 'var(--color-accent)',
              } as React.CSSProperties}
            />
          </div>
          {/* Sort */}
          <select
            value={orderBy}
            onChange={(e) => { setOrderBy(e.target.value); setPage(1); }}
            className="text-sm rounded-lg px-3 py-2 focus:outline-none"
            style={{
              backgroundColor: 'var(--bg-primary)',
              border: '1px solid var(--border-primary)',
              color: 'var(--text-primary)',
            }}
          >
            <option value="sla_urgency">SLA Urgency</option>
            <option value="newest">Newest First</option>
            <option value="oldest">Oldest First</option>
            <option value="priority">Priority</option>
          </select>
        </div>
      </div>

      {/* Action Message Toast */}
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

      {/* Bulk Actions Bar */}
      {selectedIds.size > 0 && (
        <div
          className="flex items-center gap-3 px-4 py-2.5 rounded-lg"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--color-accent) 8%, var(--bg-primary))',
            border: '1px solid color-mix(in srgb, var(--color-accent) 20%, transparent)',
          }}
        >
          <span className="text-sm font-medium" style={{ color: 'var(--color-accent)' }}>
            {selectedIds.size} selected
          </span>
          <div className="flex items-center gap-2 ml-auto">
            <Button variant="secondary" size="sm" onClick={bulkResolve} disabled={bulkLoading} leadingIcon={<CheckSquare size={12} style={{ color: 'var(--color-success)' }} />}>
              Resolve
            </Button>
            <Button variant="secondary" size="sm" onClick={bulkClose} disabled={bulkLoading} leadingIcon={<XCircle size={12} />}>
              Close
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>
              Clear
            </Button>
          </div>
        </div>
      )}

      {/* Main layout: sidebar + list */}
      <div className="flex gap-4">
        {/* Filter Sidebar */}
        <div className="w-48 flex-shrink-0 space-y-5">
          {/* Views */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider px-2 mb-2" style={{ color: 'var(--text-tertiary)' }}>
              Views
            </p>
            <div className="space-y-0.5">
              {viewFilters.map((f) => {
                const active = f.key === 'unassigned'
                  ? unassignedOnly
                  : !unassignedOnly && ((f.key === '' && !statusFilter) || statusFilter === f.key);
                return (
                  <button
                    key={f.key}
                    onClick={() => handleViewFilter(f.key)}
                    className="w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-[13px] transition-colors"
                    style={filterRowStyle(active)}
                  >
                    <span>{f.label}</span>
                    <span className="text-[11px] min-w-[20px] text-center" style={{ color: 'var(--text-tertiary)' }}>
                      {f.count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Sources */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider px-2 mb-2" style={{ color: 'var(--text-tertiary)' }}>
              Sources
            </p>
            <div className="space-y-0.5">
              {sourceFilters.map((f) => {
                const active = sourceFilter === f.key;
                return (
                  <button
                    key={f.key}
                    onClick={() => { setSourceFilter(active ? '' : f.key); setPage(1); }}
                    className="w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-[13px] transition-colors"
                    style={filterRowStyle(active)}
                  >
                    <span>{f.label}</span>
                    <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>{f.count}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Priority */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider px-2 mb-2" style={{ color: 'var(--text-tertiary)' }}>
              Priority
            </p>
            <div className="space-y-0.5">
              {priorityFilters.map((f) => {
                const active = priorityFilter === f.key;
                return (
                  <button
                    key={f.key}
                    onClick={() => { setPriorityFilter(active ? '' : f.key); setPage(1); }}
                    className="w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-[13px] transition-colors"
                    style={filterRowStyle(active)}
                  >
                    <span className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: PRIORITY_DOT[f.key] }} />
                      {f.label}
                    </span>
                    <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>{f.count}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Ticket List */}
        <div className="flex-1 min-w-0">
          <div className="ds-card overflow-hidden">
            {/* Select All Header */}
            {tickets.length > 0 && (
              <div className="flex items-center gap-3 px-4 py-2 border-b" style={{ borderColor: 'var(--border-secondary)' }}>
                <button onClick={selectAll} className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  {allSelected ? <CheckSquare size={14} style={{ color: 'var(--color-accent)' }} /> : <Square size={14} />}
                  <span>{allSelected ? 'Deselect all' : 'Select all'}</span>
                </button>
              </div>
            )}

            {loading ? (
              <div className="p-8 text-center">
                <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>Loading...</p>
              </div>
            ) : tickets.length === 0 ? (
              <div className="p-12 text-center">
                <Inbox size={32} className="mx-auto mb-3" style={{ color: 'var(--text-tertiary)' }} />
                <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>No tickets found</p>
                <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>Try adjusting your filters</p>
              </div>
            ) : (
              <div className="divide-y" style={{ borderColor: 'var(--border-secondary)' }}>
                {tickets.map((ticket) => {
                  const sla = slaDisplay(ticket);
                  const sourceMeta = SOURCE_META[ticket.source];
                  const SourceIcon = sourceMeta?.icon;
                  const hasNoAgentReply = !ticket.first_response_at && ticket.status === 'open';
                  const isSelected = selectedIds.has(ticket.id);
                  const showClassification = ticket.classification && ticket.classification !== 'customer_support';

                  return (
                    <div
                      key={ticket.id}
                      className="flex items-start gap-0 transition-colors"
                      style={{ backgroundColor: isSelected ? 'color-mix(in srgb, var(--color-accent) 5%, transparent)' : 'transparent' }}
                      onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.backgroundColor = 'var(--bg-hover)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = isSelected ? 'color-mix(in srgb, var(--color-accent) 5%, transparent)' : 'transparent'; }}
                    >
                      {/* Checkbox */}
                      <button
                        onClick={(e) => toggleSelect(ticket.id, e)}
                        className="flex-shrink-0 p-3 pt-4"
                        style={{ color: isSelected ? 'var(--color-accent)' : 'var(--text-tertiary)' }}
                      >
                        {isSelected ? <CheckSquare size={15} /> : <Square size={15} />}
                      </button>

                      {/* Ticket Content — Link */}
                      <Link href={`/tickets/${ticket.id}`} className="flex-1 min-w-0 px-2 py-3">
                        <div className="flex items-start gap-3">
                          {/* Unread dot */}
                          <div className="pt-1.5 w-2 flex-shrink-0">
                            {hasNoAgentReply && (
                              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: 'var(--color-accent)' }} />
                            )}
                          </div>

                          {/* Main content */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-xs font-mono" style={{ color: 'var(--text-tertiary)' }}>
                                #{ticket.ticket_number}
                              </span>
                              {ticket.tags?.includes('trade-member') && (
                                <StatusPill kind="source" value="ai_escalation" label="Trade" />
                              )}
                              <span className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                                {ticket.subject}
                              </span>
                            </div>

                            <div className="flex items-center gap-2 mb-1.5">
                              <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                                {ticket.customer_name || ticket.customer_email}
                              </span>
                              {sourceMeta && (
                                <StatusPill
                                  kind="source"
                                  value={ticket.source}
                                  label={sourceMeta.label}
                                  icon={SourceIcon ? <SourceIcon size={10} /> : undefined}
                                />
                              )}
                              {showClassification && (
                                <StatusPill
                                  kind="classification"
                                  value={ticket.classification!}
                                  label={CLASSIFICATION_LABELS[ticket.classification!] ?? undefined}
                                />
                              )}
                            </div>

                            {ticket.tags && ticket.tags.length > 0 && (
                              <div className="flex items-center gap-1 flex-wrap">
                                {ticket.tags.map((tag) => (
                                  <span
                                    key={tag}
                                    className="text-[10px] px-1.5 py-0.5 rounded"
                                    style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}
                                  >
                                    {tag}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>

                          {/* Right side */}
                          <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                            <div className="flex items-center gap-1.5">
                              <StatusPill kind="status" value={ticket.status} />
                              <StatusPill kind="priority" value={ticket.priority} />
                            </div>

                            {sla && (
                              <span className="text-[10px] font-medium flex items-center gap-1" style={{ color: sla.color }}>
                                {sla.text === 'BREACHED' ? <AlertCircle size={10} /> : <Clock size={10} />}
                                {sla.text}
                              </span>
                            )}

                            <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                              {timeAgo(ticket.updated_at)}
                            </span>
                          </div>
                        </div>
                      </Link>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
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
      </div>
    </div>
  );
}
