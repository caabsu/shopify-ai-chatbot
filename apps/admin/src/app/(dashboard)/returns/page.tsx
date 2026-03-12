'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Search, RotateCcw, Sparkles, ChevronLeft, ChevronRight, Package } from 'lucide-react';
import type { ReturnRequest } from '@/lib/types';

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  pending_review: { bg: 'rgba(245,158,11,0.12)', text: '#f59e0b', label: 'Pending Review' },
  approved: { bg: 'rgba(59,130,246,0.12)', text: '#3b82f6', label: 'Approved' },
  partially_approved: { bg: 'rgba(59,130,246,0.12)', text: '#3b82f6', label: 'Partial' },
  denied: { bg: 'rgba(239,68,68,0.12)', text: '#ef4444', label: 'Denied' },
  shipped: { bg: 'rgba(99,102,241,0.12)', text: '#6366f1', label: 'Shipped' },
  received: { bg: 'rgba(168,85,247,0.12)', text: '#a855f7', label: 'Received' },
  refunded: { bg: 'rgba(34,197,94,0.12)', text: '#22c55e', label: 'Refunded' },
  closed: { bg: 'rgba(156,163,175,0.12)', text: '#9ca3af', label: 'Closed' },
  cancelled: { bg: 'rgba(156,163,175,0.12)', text: '#9ca3af', label: 'Cancelled' },
};

interface FilterCounts {
  all: number;
  pending_review: number;
  approved: number;
  partially_approved: number;
  denied: number;
  shipped: number;
  received: number;
  refunded: number;
  closed: number;
  cancelled: number;
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

function getAiBadge(rec: ReturnRequest['ai_recommendation']): { text: string; bg: string; color: string } | null {
  if (!rec) return null;
  const pct = Math.round(rec.confidence * 100);
  if (rec.decision === 'approve') {
    return { text: `AI: Approve (${pct}%)`, bg: 'rgba(34,197,94,0.12)', color: '#22c55e' };
  }
  if (rec.decision === 'deny') {
    return { text: `AI: Deny (${pct}%)`, bg: 'rgba(239,68,68,0.12)', color: '#ef4444' };
  }
  return { text: `AI: Review (${pct}%)`, bg: 'rgba(245,158,11,0.12)', color: '#f59e0b' };
}

export default function ReturnsPage() {
  const [returns, setReturns] = useState<ReturnRequest[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);

  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');

  const [counts, setCounts] = useState<FilterCounts>({
    all: 0, pending_review: 0, approved: 0, partially_approved: 0,
    denied: 0, shipped: 0, received: 0, refunded: 0, closed: 0, cancelled: 0,
  });

  const perPage = 20;

  const loadCounts = useCallback(async () => {
    try {
      const res = await fetch('/api/returns/stats');
      const data = await res.json();
      setCounts({
        all: data.all ?? 0,
        pending_review: data.pending_review ?? 0,
        approved: data.approved ?? 0,
        partially_approved: data.partially_approved ?? 0,
        denied: data.denied ?? 0,
        shipped: data.shipped ?? 0,
        received: data.received ?? 0,
        refunded: data.refunded ?? 0,
        closed: data.closed ?? 0,
        cancelled: data.cancelled ?? 0,
      });
    } catch {
      // ignore
    }
  }, []);

  const loadReturns = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({
      page: String(page),
      per_page: String(perPage),
    });
    if (statusFilter) params.set('status', statusFilter);
    if (search) params.set('search', search);

    try {
      const res = await fetch(`/api/returns?${params}`);
      const data = await res.json();
      setReturns(data.returns ?? []);
      setTotal(data.total ?? 0);
      setTotalPages(data.totalPages ?? 1);
    } catch {
      setReturns([]);
    }
    setLoading(false);
  }, [page, statusFilter, search]);

  useEffect(() => { loadCounts(); }, [loadCounts]);
  useEffect(() => { loadReturns(); }, [loadReturns]);

  const viewFilters = [
    { key: '', label: 'All Returns', count: counts.all },
    { key: 'pending_review', label: 'Pending Review', count: counts.pending_review },
    { key: 'approved', label: 'Approved', count: counts.approved },
    { key: 'denied', label: 'Denied', count: counts.denied },
    { key: 'shipped', label: 'Shipped', count: counts.shipped },
    { key: 'received', label: 'Received', count: counts.received },
    { key: 'refunded', label: 'Refunded', count: counts.refunded },
    { key: 'closed', label: 'Closed', count: counts.closed },
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <RotateCcw size={20} style={{ color: 'var(--text-primary)' }} />
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
            Returns
          </h2>
          <span className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
            {total} {total === 1 ? 'return' : 'returns'}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-tertiary)' }} />
            <input
              placeholder="Search order or email..."
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
        </div>
      </div>

      {/* Main layout: sidebar + list */}
      <div className="flex gap-4">
        {/* Filter Sidebar */}
        <div className="w-48 flex-shrink-0 space-y-5">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider px-2 mb-2" style={{ color: 'var(--text-tertiary)' }}>
              Views
            </p>
            <div className="space-y-0.5">
              {viewFilters.map((f) => {
                const active = statusFilter === f.key;
                return (
                  <button
                    key={f.key}
                    onClick={() => { setStatusFilter(f.key); setPage(1); }}
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
        </div>

        {/* Return List */}
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
            ) : returns.length === 0 ? (
              <div className="p-12 text-center">
                <Package size={32} className="mx-auto mb-3" style={{ color: 'var(--text-tertiary)' }} />
                <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>No returns found</p>
                <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>Try adjusting your filters</p>
              </div>
            ) : (
              <div className="divide-y" style={{ borderColor: 'var(--border-secondary)' }}>
                {returns.map((ret) => {
                  const statusStyle = STATUS_STYLES[ret.status] || STATUS_STYLES.closed;
                  const aiBadge = getAiBadge(ret.ai_recommendation);
                  const itemCount = ret.items?.length ?? 0;
                  const totalAmount = ret.items?.reduce((sum, item) => sum + item.price * item.quantity, 0) ?? 0;

                  return (
                    <Link
                      key={ret.id}
                      href={`/returns/${ret.id}`}
                      className="block px-4 py-3 transition-colors"
                      style={{ backgroundColor: 'transparent' }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = 'var(--bg-hover)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = 'transparent';
                      }}
                    >
                      <div className="flex items-start gap-3">
                        {/* Pending dot */}
                        <div className="pt-1.5 w-2 flex-shrink-0">
                          {ret.status === 'pending_review' && (
                            <div
                              className="w-2 h-2 rounded-full"
                              style={{ backgroundColor: '#f59e0b' }}
                            />
                          )}
                        </div>

                        {/* Main content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-mono" style={{ color: 'var(--text-tertiary)' }}>
                              #{ret.order_number}
                            </span>
                            <span
                              className="text-sm font-medium truncate"
                              style={{ color: 'var(--text-primary)' }}
                            >
                              {ret.customer_name || ret.customer_email}
                            </span>
                          </div>

                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                              {itemCount} {itemCount === 1 ? 'item' : 'items'} — ${totalAmount.toFixed(2)}
                            </span>
                            {aiBadge && (
                              <span
                                className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded"
                                style={{
                                  backgroundColor: aiBadge.bg,
                                  color: aiBadge.color,
                                }}
                              >
                                <Sparkles size={10} />
                                {aiBadge.text}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Right side */}
                        <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                          <span
                            className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                            style={{
                              backgroundColor: statusStyle.bg,
                              color: statusStyle.text,
                            }}
                          >
                            {statusStyle.label}
                          </span>
                          <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                            {timeAgo(ret.created_at)}
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
