'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Search, Inbox, Mail, FormInput, Sparkles, AlertCircle, Clock, ChevronLeft, ChevronRight, CheckSquare, Square, XCircle } from 'lucide-react';
import type { Ticket } from '@/lib/types';

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
  if (minutes < 60) return { text: `${minutes}m left`, color: minutes < 30 ? '#f97316' : '#22c55e' };
  const hours = Math.floor(minutes / 60);
  return { text: `${hours}h ${minutes % 60}m left`, color: hours < 2 ? '#f97316' : '#22c55e' };
}

export default function AgentTicketInboxPage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('open');
  const [search, setSearch] = useState('');
  const [orderBy, setOrderBy] = useState('sla_urgency');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const perPage = 20;

  const loadTickets = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({
      page: String(page),
      per_page: String(perPage),
      order_by: orderBy,
    });
    if (statusFilter) params.set('status', statusFilter);
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
  }, [page, statusFilter, search, orderBy]);

  useEffect(() => { loadTickets(); }, [loadTickets]);
  useEffect(() => { setSelectedIds(new Set()); }, [statusFilter, page, search]);
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
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedIds.size === tickets.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(tickets.map((t) => t.id)));
  };

  const bulkAction = async (status: string, label: string) => {
    if (selectedIds.size === 0) return;
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
      } else {
        setActionMessage({ text: data.error || `Failed to ${label.toLowerCase()}`, type: 'error' });
      }
    } catch {
      setActionMessage({ text: `Failed to ${label.toLowerCase()}`, type: 'error' });
    }
    setBulkLoading(false);
  };

  const statusTabs = [
    { key: 'open', label: 'Open' },
    { key: 'pending', label: 'Pending' },
    { key: 'resolved', label: 'Resolved' },
    { key: '', label: 'All' },
  ];

  const allSelected = tickets.length > 0 && selectedIds.size === tickets.length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Inbox size={20} style={{ color: 'var(--text-primary)' }} />
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
            Tickets
          </h2>
          <span className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
            {total} {total === 1 ? 'ticket' : 'tickets'}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-tertiary)' }} />
            <input
              placeholder="Search..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="pl-9 pr-3 py-2 text-sm rounded-lg w-56 focus:outline-none focus:ring-2"
              style={{
                backgroundColor: 'var(--bg-primary)',
                border: '1px solid var(--border-primary)',
                color: 'var(--text-primary)',
                // @ts-expect-error CSS custom property
                '--tw-ring-color': 'var(--color-accent)',
              }}
            />
          </div>
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
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="priority">Priority</option>
          </select>
        </div>
      </div>

      {/* Status tabs */}
      <div className="flex gap-1">
        {statusTabs.map((tab) => {
          const active = statusFilter === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => { setStatusFilter(tab.key); setPage(1); }}
              className="px-4 py-2 text-sm rounded-lg font-medium transition-colors"
              style={{
                backgroundColor: active ? 'color-mix(in srgb, var(--color-accent) 12%, transparent)' : 'transparent',
                color: active ? 'var(--color-accent)' : 'var(--text-secondary)',
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Action messages */}
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

      {/* Bulk bar */}
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
              onClick={() => bulkAction('resolved', 'Resolved')}
              disabled={bulkLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors disabled:opacity-50"
              style={{ backgroundColor: 'rgba(34,197,94,0.1)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.2)' }}
            >
              <CheckSquare size={12} /> Resolve
            </button>
            <button
              onClick={() => bulkAction('closed', 'Closed')}
              disabled={bulkLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors disabled:opacity-50"
              style={{ backgroundColor: 'rgba(156,163,175,0.1)', color: '#9ca3af', border: '1px solid rgba(156,163,175,0.2)' }}
            >
              <XCircle size={12} /> Close
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

      {/* Ticket list */}
      <div
        className="rounded-xl overflow-hidden"
        style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-primary)', boxShadow: 'var(--shadow-sm)' }}
      >
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
            <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>No tickets</p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>Try adjusting your filters</p>
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: 'var(--border-secondary)' }}>
            {tickets.map((ticket) => {
              const sla = slaDisplay(ticket);
              const source = SOURCE_STYLES[ticket.source];
              const priority = PRIORITY_STYLES[ticket.priority];
              const hasNoReply = !ticket.first_response_at && ticket.status === 'open';
              const isSelected = selectedIds.has(ticket.id);

              return (
                <div
                  key={ticket.id}
                  className="flex items-start gap-0 transition-colors"
                  style={{ backgroundColor: isSelected ? 'color-mix(in srgb, var(--color-accent) 5%, transparent)' : 'transparent' }}
                  onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.backgroundColor = 'var(--bg-hover)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = isSelected ? 'color-mix(in srgb, var(--color-accent) 5%, transparent)' : 'transparent'; }}
                >
                  <button
                    onClick={(e) => toggleSelect(ticket.id, e)}
                    className="flex-shrink-0 p-3 pt-4"
                    style={{ color: isSelected ? 'var(--color-accent)' : 'var(--text-tertiary)' }}
                  >
                    {isSelected ? <CheckSquare size={15} /> : <Square size={15} />}
                  </button>

                  <Link href={`/agent/tickets/${ticket.id}`} className="flex-1 min-w-0 px-2 py-3">
                    <div className="flex items-start gap-3">
                      <div className="pt-1.5 w-2 flex-shrink-0">
                        {hasNoReply && <div className="w-2 h-2 rounded-full" style={{ backgroundColor: 'var(--color-accent)' }} />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-mono" style={{ color: 'var(--text-tertiary)' }}>#{ticket.ticket_number}</span>
                          <span className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{ticket.subject}</span>
                        </div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{ticket.customer_name || ticket.customer_email}</span>
                          {source && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded" style={{ backgroundColor: source.bg, color: source.text }}>
                              <source.icon size={10} />{source.label}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full capitalize" style={{ backgroundColor: STATUS_STYLES[ticket.status]?.bg, color: STATUS_STYLES[ticket.status]?.text }}>{ticket.status}</span>
                          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full uppercase" style={{ backgroundColor: priority.bg, color: priority.text }}>{ticket.priority}</span>
                        </div>
                        {sla && (
                          <span className="text-[10px] font-medium flex items-center gap-1" style={{ color: sla.color }}>
                            {sla.text === 'BREACHED' ? <AlertCircle size={10} /> : <Clock size={10} />}{sla.text}
                          </span>
                        )}
                        <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>{timeAgo(ticket.updated_at)}</span>
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
          <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Page {page} of {totalPages}</span>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1} className="p-2 rounded-lg transition-colors disabled:opacity-30" style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-primary)', color: 'var(--text-secondary)' }}>
              <ChevronLeft size={14} />
            </button>
            <button onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page === totalPages} className="p-2 rounded-lg transition-colors disabled:opacity-30" style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-primary)', color: 'var(--text-secondary)' }}>
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
