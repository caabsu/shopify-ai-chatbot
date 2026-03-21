'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Search, Inbox, Mail, FormInput, Sparkles, AlertCircle, Clock, ChevronLeft, ChevronRight, CheckSquare, Square, XCircle, Zap, Trash2, Archive } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Ticket } from '@/lib/types';

const TAG_COLORS = [
  { bg: 'rgba(59,130,246,0.1)', text: '#3b82f6' },
  { bg: 'rgba(34,197,94,0.1)', text: '#22c55e' },
  { bg: 'rgba(168,85,247,0.1)', text: '#a855f7' },
  { bg: 'rgba(249,115,22,0.1)', text: '#f97316' },
  { bg: 'rgba(236,72,153,0.1)', text: '#ec4899' },
  { bg: 'rgba(20,184,166,0.1)', text: '#14b8a6' },
];

function getTagColor(index: number) {
  return TAG_COLORS[index % TAG_COLORS.length];
}

const PRIORITY_STYLES: Record<string, { bg: string; text: string }> = {
  urgent: { bg: 'rgba(239,68,68,0.12)', text: '#ef4444' },
  high: { bg: 'rgba(249,115,22,0.12)', text: '#f97316' },
  medium: { bg: 'rgba(59,130,246,0.12)', text: '#3b82f6' },
  low: { bg: 'rgba(156,163,175,0.12)', text: '#9ca3af' },
};

const SOURCE_STYLES: Record<string, { bg: string; text: string; icon: typeof Mail; label: string }> = {
  email: { bg: 'rgba(99,102,241,0.1)', text: '#6366f1', icon: Mail, label: 'Email' },
  form: { bg: 'rgba(16,185,129,0.1)', text: '#10b981', icon: FormInput, label: 'Form' },
  ai_escalation: { bg: 'rgba(168,85,247,0.1)', text: '#a855f7', icon: Sparkles, label: 'AI Escalation' },
};

const STATUS_STYLES: Record<string, { bg: string; text: string }> = {
  open: { bg: 'rgba(59,130,246,0.12)', text: '#3b82f6' },
  pending: { bg: 'rgba(245,158,11,0.12)', text: '#f59e0b' },
  resolved: { bg: 'rgba(34,197,94,0.12)', text: '#22c55e' },
  closed: { bg: 'rgba(156,163,175,0.12)', text: '#9ca3af' },
};

const CLASSIFICATION_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  customer_support: { bg: 'rgba(34,197,94,0.1)', text: '#22c55e', label: 'Support' },
  promotional: { bg: 'rgba(249,115,22,0.1)', text: '#f97316', label: 'Promo' },
  transactional: { bg: 'rgba(59,130,246,0.1)', text: '#3b82f6', label: 'Transactional' },
  automated: { bg: 'rgba(156,163,175,0.1)', text: '#9ca3af', label: 'Automated' },
  spam: { bg: 'rgba(239,68,68,0.1)', text: '#ef4444', label: 'Spam' },
  internal: { bg: 'rgba(168,85,247,0.1)', text: '#a855f7', label: 'Internal' },
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
  if (ticket.sla_breached) return { text: 'BREACHED', color: '#ef4444' };
  if (ticket.status === 'resolved' || ticket.status === 'closed') return null;

  const diff = new Date(ticket.sla_deadline).getTime() - Date.now();
  if (diff <= 0) return { text: 'BREACHED', color: '#ef4444' };

  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) {
    return { text: `${minutes}m left`, color: minutes < 30 ? '#f97316' : '#22c55e' };
  }
  const hours = Math.floor(minutes / 60);
  const remainingMins = minutes % 60;
  return { text: `${hours}h ${remainingMins}m left`, color: hours < 2 ? '#f97316' : '#22c55e' };
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

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Inbox size={20} style={{ color: 'var(--text-primary)' }} />
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
            Ticket Inbox
          </h2>
          <span className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
            {total} {total === 1 ? 'ticket' : 'tickets'}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {/* Close All */}
          <button
            onClick={closeAllVisible}
            disabled={bulkLoading || total === 0}
            className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg font-medium transition-colors disabled:opacity-50"
            style={{
              backgroundColor: 'rgba(156,163,175,0.1)',
              color: '#9ca3af',
              border: '1px solid rgba(156,163,175,0.2)',
            }}
            title="Close all tickets matching current filter"
          >
            <Archive size={14} />
            Close All
          </button>
          {/* Delete All Email Tickets (one-time cleanup) */}
          <button
            onClick={deleteAllEmailTickets}
            disabled={deleteLoading}
            className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg font-medium transition-colors disabled:opacity-50"
            style={{
              backgroundColor: 'rgba(239,68,68,0.1)',
              color: '#ef4444',
              border: '1px solid rgba(239,68,68,0.2)',
            }}
            title="PERMANENTLY delete all email tickets (one-time cleanup)"
          >
            <Trash2 size={14} />
            {deleteLoading ? 'Deleting...' : 'Delete All Emails'}
          </button>
          {/* AI Auto-Close Button */}
          <button
            onClick={aiAutoClose}
            disabled={aiAutoCloseLoading}
            className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg font-medium transition-colors disabled:opacity-50"
            style={{
              backgroundColor: 'rgba(168,85,247,0.1)',
              color: '#a855f7',
              border: '1px solid rgba(168,85,247,0.2)',
            }}
            title="Use AI to classify and auto-close non-support emails"
          >
            <Zap size={14} />
            {aiAutoCloseLoading ? 'Processing...' : 'AI Clean Up'}
          </button>
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
            backgroundColor: actionMessage.type === 'success' ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
            color: actionMessage.type === 'success' ? '#22c55e' : '#ef4444',
            border: `1px solid ${actionMessage.type === 'success' ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}`,
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
            <button
              onClick={bulkResolve}
              disabled={bulkLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors disabled:opacity-50"
              style={{
                backgroundColor: 'rgba(34,197,94,0.1)',
                color: '#22c55e',
                border: '1px solid rgba(34,197,94,0.2)',
              }}
            >
              <CheckSquare size={12} />
              Resolve
            </button>
            <button
              onClick={bulkClose}
              disabled={bulkLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors disabled:opacity-50"
              style={{
                backgroundColor: 'rgba(156,163,175,0.1)',
                color: '#9ca3af',
                border: '1px solid rgba(156,163,175,0.2)',
              }}
            >
              <XCircle size={12} />
              Close
            </button>
            <button
              onClick={() => setSelectedIds(new Set())}
              className="text-xs px-2 py-1.5 rounded-lg"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Clear
            </button>
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
                    style={{
                      backgroundColor: active ? 'color-mix(in srgb, var(--color-accent) 10%, transparent)' : 'transparent',
                      color: active ? 'var(--color-accent)' : 'var(--text-secondary)',
                      fontWeight: active ? 500 : 400,
                    }}
                  >
                    <span>{f.label}</span>
                    <span
                      className="text-[11px] min-w-[20px] text-center"
                      style={{ color: 'var(--text-tertiary)' }}
                    >
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
                    style={{
                      backgroundColor: active ? 'color-mix(in srgb, var(--color-accent) 10%, transparent)' : 'transparent',
                      color: active ? 'var(--color-accent)' : 'var(--text-secondary)',
                      fontWeight: active ? 500 : 400,
                    }}
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
                const pStyle = PRIORITY_STYLES[f.key];
                return (
                  <button
                    key={f.key}
                    onClick={() => { setPriorityFilter(active ? '' : f.key); setPage(1); }}
                    className="w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-[13px] transition-colors"
                    style={{
                      backgroundColor: active ? 'color-mix(in srgb, var(--color-accent) 10%, transparent)' : 'transparent',
                      color: active ? 'var(--color-accent)' : 'var(--text-secondary)',
                      fontWeight: active ? 500 : 400,
                    }}
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: pStyle.text }}
                      />
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
          <div
            className="rounded-xl overflow-hidden"
            style={{
              backgroundColor: 'var(--bg-primary)',
              border: '1px solid var(--border-primary)',
              boxShadow: 'var(--shadow-sm)',
            }}
          >
            {/* Select All Header */}
            {tickets.length > 0 && (
              <div
                className="flex items-center gap-3 px-4 py-2 border-b"
                style={{ borderColor: 'var(--border-secondary)' }}
              >
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
                  const source = SOURCE_STYLES[ticket.source];
                  const priority = PRIORITY_STYLES[ticket.priority];
                  const hasNoAgentReply = !ticket.first_response_at && ticket.status === 'open';
                  const isSelected = selectedIds.has(ticket.id);
                  const cls = ticket.classification ? CLASSIFICATION_STYLES[ticket.classification] : null;

                  return (
                    <div
                      key={ticket.id}
                      className="flex items-start gap-0 transition-colors"
                      style={{
                        backgroundColor: isSelected ? 'color-mix(in srgb, var(--color-accent) 5%, transparent)' : 'transparent',
                      }}
                      onMouseEnter={(e) => {
                        if (!isSelected) e.currentTarget.style.backgroundColor = 'var(--bg-hover)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = isSelected ? 'color-mix(in srgb, var(--color-accent) 5%, transparent)' : 'transparent';
                      }}
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
                      <Link
                        href={`/tickets/${ticket.id}`}
                        className="flex-1 min-w-0 px-2 py-3"
                      >
                        <div className="flex items-start gap-3">
                          {/* Unread dot */}
                          <div className="pt-1.5 w-2 flex-shrink-0">
                            {hasNoAgentReply && (
                              <div
                                className="w-2 h-2 rounded-full"
                                style={{ backgroundColor: 'var(--color-accent)' }}
                              />
                            )}
                          </div>

                          {/* Main content */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-xs font-mono" style={{ color: 'var(--text-tertiary)' }}>
                                #{ticket.ticket_number}
                              </span>
                              {ticket.tags?.includes('trade-member') && (
                                <span
                                  className="text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide"
                                  style={{ backgroundColor: 'rgba(99,102,241,0.15)', color: '#6366f1', border: '1px solid rgba(99,102,241,0.3)' }}
                                >
                                  Trade
                                </span>
                              )}
                              <span
                                className="text-sm font-medium truncate"
                                style={{ color: 'var(--text-primary)' }}
                              >
                                {ticket.subject}
                              </span>
                            </div>

                            <div className="flex items-center gap-2 mb-1.5">
                              <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                                {ticket.customer_name || ticket.customer_email}
                              </span>
                              {source && (
                                <span
                                  className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded"
                                  style={{ backgroundColor: source.bg, color: source.text }}
                                >
                                  <source.icon size={10} />
                                  {source.label}
                                </span>
                              )}
                              {cls && ticket.classification !== 'customer_support' && (
                                <span
                                  className="text-[10px] font-medium px-1.5 py-0.5 rounded"
                                  style={{ backgroundColor: cls.bg, color: cls.text }}
                                >
                                  {cls.label}
                                </span>
                              )}
                            </div>

                            {ticket.tags && ticket.tags.length > 0 && (
                              <div className="flex items-center gap-1 flex-wrap">
                                {ticket.tags.map((tag, i) => {
                                  const tc = getTagColor(i);
                                  return (
                                    <span
                                      key={tag}
                                      className="text-[10px] px-1.5 py-0.5 rounded"
                                      style={{ backgroundColor: tc.bg, color: tc.text }}
                                    >
                                      {tag}
                                    </span>
                                  );
                                })}
                              </div>
                            )}
                          </div>

                          {/* Right side */}
                          <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                            <div className="flex items-center gap-1.5">
                              <span
                                className="text-[10px] font-medium px-2 py-0.5 rounded-full capitalize"
                                style={{
                                  backgroundColor: STATUS_STYLES[ticket.status]?.bg || 'rgba(156,163,175,0.12)',
                                  color: STATUS_STYLES[ticket.status]?.text || '#9ca3af',
                                }}
                              >
                                {ticket.status}
                              </span>
                              <span
                                className="text-[10px] font-medium px-2 py-0.5 rounded-full uppercase"
                                style={{ backgroundColor: priority.bg, color: priority.text }}
                              >
                                {ticket.priority}
                              </span>
                            </div>

                            {sla && (
                              <span
                                className="text-[10px] font-medium flex items-center gap-1"
                                style={{ color: sla.color }}
                              >
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
                <button
                  onClick={() => setPage(Math.max(1, page - 1))}
                  disabled={page === 1}
                  className="p-2 rounded-lg transition-colors disabled:opacity-30"
                  style={{
                    backgroundColor: 'var(--bg-primary)',
                    border: '1px solid var(--border-primary)',
                    color: 'var(--text-secondary)',
                  }}
                >
                  <ChevronLeft size={14} />
                </button>
                <button
                  onClick={() => setPage(Math.min(totalPages, page + 1))}
                  disabled={page === totalPages}
                  className="p-2 rounded-lg transition-colors disabled:opacity-30"
                  style={{
                    backgroundColor: 'var(--bg-primary)',
                    border: '1px solid var(--border-primary)',
                    color: 'var(--text-secondary)',
                  }}
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
