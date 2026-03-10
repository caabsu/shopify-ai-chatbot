'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Search } from 'lucide-react';
import { formatDate, cn } from '@/lib/utils';
import type { Conversation } from '@/lib/types';

const statusColors: Record<string, { bg: string; text: string }> = {
  active: { bg: 'rgba(34,197,94,0.12)', text: '#22c55e' },
  closed: { bg: 'rgba(156,163,175,0.12)', text: '#9ca3af' },
  escalated: { bg: 'rgba(239,68,68,0.12)', text: '#ef4444' },
};

export default function ChatbotConversationsPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page) });
    if (status) params.set('status', status);
    if (search) params.set('search', search);

    const res = await fetch(`/api/conversations?${params}`);
    const data = await res.json();
    setConversations(data.conversations ?? []);
    setTotal(data.total ?? 0);
    setTotalPages(data.totalPages ?? 1);
    setLoading(false);
  }, [page, status, search]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
        AI Conversations ({total})
      </h2>

      <div className="flex gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-tertiary)' }} />
          <input
            placeholder="Search by email or name..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg focus:outline-none focus:ring-2"
            style={{
              backgroundColor: 'var(--bg-primary)',
              border: '1px solid var(--border-primary)',
              color: 'var(--text-primary)',
              '--tw-ring-color': 'var(--color-accent)',
            } as React.CSSProperties}
          />
        </div>
        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value); setPage(1); }}
          className="text-sm rounded-lg px-3 py-2 focus:outline-none"
          style={{
            backgroundColor: 'var(--bg-primary)',
            border: '1px solid var(--border-primary)',
            color: 'var(--text-primary)',
          }}
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="closed">Closed</option>
          <option value="escalated">Escalated</option>
        </select>
      </div>

      <div
        className="rounded-xl overflow-hidden"
        style={{
          backgroundColor: 'var(--bg-primary)',
          border: '1px solid var(--border-primary)',
        }}
      >
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-primary)' }}>
              <th className="px-4 py-3 text-left font-medium" style={{ color: 'var(--text-secondary)' }}>Customer</th>
              <th className="px-4 py-3 text-left font-medium" style={{ color: 'var(--text-secondary)' }}>Status</th>
              <th className="px-4 py-3 text-left font-medium" style={{ color: 'var(--text-secondary)' }}>Messages</th>
              <th className="px-4 py-3 text-left font-medium" style={{ color: 'var(--text-secondary)' }}>Started</th>
              <th className="px-4 py-3 text-left font-medium" style={{ color: 'var(--text-secondary)' }}>Last Message</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center" style={{ color: 'var(--text-tertiary)' }}>
                  Loading...
                </td>
              </tr>
            ) : conversations.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center" style={{ color: 'var(--text-tertiary)' }}>
                  No conversations found
                </td>
              </tr>
            ) : conversations.map((c) => {
              const sc = statusColors[c.status] || statusColors.closed;
              return (
                <tr
                  key={c.id}
                  className="transition-colors cursor-pointer"
                  style={{ borderBottom: '1px solid var(--border-secondary)' }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-hover)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                >
                  <td className="px-4 py-3">
                    <Link href={`/chatbot/conversations/${c.id}`} className="font-medium" style={{ color: 'var(--text-primary)' }}>
                      {c.customer_email || c.customer_name || 'Anonymous'}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className="px-2 py-0.5 rounded-full text-xs font-medium"
                      style={{ backgroundColor: sc.bg, color: sc.text }}
                    >
                      {c.status}
                    </span>
                  </td>
                  <td className="px-4 py-3" style={{ color: 'var(--text-secondary)' }}>{c.message_count}</td>
                  <td className="px-4 py-3" style={{ color: 'var(--text-secondary)' }}>{formatDate(c.created_at)}</td>
                  <td className="px-4 py-3" style={{ color: 'var(--text-secondary)' }}>
                    {c.last_message_at ? formatDate(c.last_message_at) : '-'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex justify-center gap-2">
          <button
            onClick={() => setPage(Math.max(1, page - 1))}
            disabled={page === 1}
            className="px-3 py-1.5 text-sm rounded-lg disabled:opacity-50"
            style={{
              border: '1px solid var(--border-primary)',
              color: 'var(--text-secondary)',
            }}
          >
            Previous
          </button>
          <span className="px-3 py-1.5 text-sm" style={{ color: 'var(--text-secondary)' }}>
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage(Math.min(totalPages, page + 1))}
            disabled={page === totalPages}
            className="px-3 py-1.5 text-sm rounded-lg disabled:opacity-50"
            style={{
              border: '1px solid var(--border-primary)',
              color: 'var(--text-secondary)',
            }}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
