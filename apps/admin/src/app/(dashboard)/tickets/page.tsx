'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Search, Inbox, Mail, FormInput, Sparkles, AlertCircle, Clock, ChevronLeft, ChevronRight } from 'lucide-react';
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
  const [search, setSearch] = useState('');
  const [orderBy, setOrderBy] = useState('sla_urgency');

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
  }, [page, statusFilter, sourceFilter, priorityFilter, search, orderBy]);

  useEffect(() => { loadCounts(); }, [loadCounts]);
  useEffect(() => { loadTickets(); }, [loadTickets]);

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
      // We signal unassigned through a special param
    } else {
      setStatusFilter(key);
    }
    setPage(1);
  }

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
                const active = (f.key === '' && !statusFilter) || statusFilter === f.key;
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

                  return (
                    <Link
                      key={ticket.id}
                      href={`/tickets/${ticket.id}`}
                      className="block px-4 py-3 transition-colors"
                      style={{
                        backgroundColor: 'transparent',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = 'var(--bg-hover)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = 'transparent';
                      }}
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
                            {/* Ticket number */}
                            <span className="text-xs font-mono" style={{ color: 'var(--text-tertiary)' }}>
                              #{ticket.ticket_number}
                            </span>
                            {/* Subject */}
                            <span
                              className="text-sm font-medium truncate"
                              style={{ color: 'var(--text-primary)' }}
                            >
                              {ticket.subject}
                            </span>
                          </div>

                          <div className="flex items-center gap-2 mb-1.5">
                            {/* Customer */}
                            <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                              {ticket.customer_name || ticket.customer_email}
                            </span>
                            {/* Source badge */}
                            {source && (
                              <span
                                className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded"
                                style={{
                                  backgroundColor: source.bg,
                                  color: source.text,
                                }}
                              >
                                <source.icon size={10} />
                                {source.label}
                              </span>
                            )}
                          </div>

                          {/* Tags */}
                          {ticket.tags && ticket.tags.length > 0 && (
                            <div className="flex items-center gap-1 flex-wrap">
                              {ticket.tags.map((tag, i) => {
                                const tc = getTagColor(i);
                                return (
                                  <span
                                    key={tag}
                                    className="text-[10px] px-1.5 py-0.5 rounded"
                                    style={{
                                      backgroundColor: tc.bg,
                                      color: tc.text,
                                    }}
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
                          {/* Priority */}
                          <span
                            className="text-[10px] font-medium px-2 py-0.5 rounded-full uppercase"
                            style={{
                              backgroundColor: priority.bg,
                              color: priority.text,
                            }}
                          >
                            {ticket.priority}
                          </span>

                          {/* SLA */}
                          {sla && (
                            <span
                              className="text-[10px] font-medium flex items-center gap-1"
                              style={{ color: sla.color }}
                            >
                              {sla.text === 'BREACHED' ? (
                                <AlertCircle size={10} />
                              ) : (
                                <Clock size={10} />
                              )}
                              {sla.text}
                            </span>
                          )}

                          {/* Time */}
                          <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                            {timeAgo(ticket.updated_at)}
                          </span>
                        </div>
                      </div>
                    </Link>
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
