'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Search, ChevronLeft, ChevronRight, Users } from 'lucide-react';

interface Session {
  id: string;
  session_id: string;
  concept: string;
  status: string;
  profile_name?: string;
  email?: string;
  started_at: string;
  completed_at?: string;
  duration_seconds?: number;
}

interface FilterCounts {
  all: number;
  started: number;
  in_progress: number;
  completed: number;
  abandoned: number;
}

interface ConceptCounts {
  all: number;
  reveal: number;
  'style-profile': number;
}

const STATUS_STYLES: Record<string, { backgroundColor: string; color: string }> = {
  started:     { backgroundColor: 'color-mix(in srgb, #6b7280 12%, transparent)', color: '#6b7280' },
  in_progress: { backgroundColor: 'color-mix(in srgb, #3b82f6 12%, transparent)', color: '#3b82f6' },
  completed:   { backgroundColor: 'color-mix(in srgb, #10b981 12%, transparent)', color: '#10b981' },
  abandoned:   { backgroundColor: 'color-mix(in srgb, #ef4444 12%, transparent)', color: '#ef4444' },
};

const CONCEPT_STYLES: Record<string, { backgroundColor: string; color: string; label: string }> = {
  reveal:          { backgroundColor: 'color-mix(in srgb, #f59e0b 12%, transparent)', color: '#f59e0b', label: 'The Reveal' },
  'style-profile': { backgroundColor: 'color-mix(in srgb, #8b5cf6 12%, transparent)', color: '#8b5cf6', label: 'The Style Profile' },
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

function formatDuration(seconds?: number): string {
  if (!seconds) return '--';
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (minutes < 60) return `${minutes}m ${secs}s`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins}m`;
}

export default function FunnelSessionsPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState('');
  const [conceptFilter, setConceptFilter] = useState('');
  const [search, setSearch] = useState('');

  // Counts
  const [statusCounts, setStatusCounts] = useState<FilterCounts>({
    all: 0, started: 0, in_progress: 0, completed: 0, abandoned: 0,
  });
  const [conceptCounts, setConceptCounts] = useState<ConceptCounts>({
    all: 0, reveal: 0, 'style-profile': 0,
  });

  const [hoveredRow, setHoveredRow] = useState<string | null>(null);

  const perPage = 20;

  const loadSessions = useCallback(async () => {
    setLoading(true);
    setError(null);

    const params = new URLSearchParams({
      page: String(page),
      per_page: String(perPage),
    });
    if (statusFilter) params.set('status', statusFilter);
    if (conceptFilter) params.set('concept', conceptFilter);
    if (search) params.set('search', search);

    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL}/api/quiz/sessions?${params}`
      );
      if (!res.ok) throw new Error(`Failed to fetch sessions (${res.status})`);
      const data = await res.json();
      setSessions(data.sessions ?? []);
      setTotal(data.total ?? 0);
      setTotalPages(data.totalPages ?? 1);

      // Derive counts from response if provided, otherwise keep existing
      if (data.statusCounts) {
        setStatusCounts(data.statusCounts);
      }
      if (data.conceptCounts) {
        setConceptCounts(data.conceptCounts);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sessions');
      setSessions([]);
    }
    setLoading(false);
  }, [page, statusFilter, conceptFilter, search]);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  // Reset page when filters change
  useEffect(() => { setPage(1); }, [statusFilter, conceptFilter, search]);

  const statusFilters = [
    { key: '', label: 'All', count: statusCounts.all },
    { key: 'started', label: 'Started', count: statusCounts.started },
    { key: 'in_progress', label: 'In Progress', count: statusCounts.in_progress },
    { key: 'completed', label: 'Completed', count: statusCounts.completed },
    { key: 'abandoned', label: 'Abandoned', count: statusCounts.abandoned },
  ];

  const conceptFilters = [
    { key: '', label: 'All', count: conceptCounts.all },
    { key: 'reveal', label: 'The Reveal', count: conceptCounts.reveal },
    { key: 'style-profile', label: 'The Style Profile', count: conceptCounts['style-profile'] },
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Users size={20} style={{ color: 'var(--text-primary)' }} />
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
            Sessions
          </h2>
          <span className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
            {total} {total === 1 ? 'session' : 'sessions'}
          </span>
        </div>
        <div className="relative">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2"
            style={{ color: 'var(--text-tertiary)' }}
          />
          <input
            placeholder="Search email or profile..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 pr-3 py-2 text-sm rounded-lg w-64 focus:outline-none focus:ring-2"
            style={{
              backgroundColor: 'var(--bg-primary)',
              border: '1px solid var(--border-primary)',
              color: 'var(--text-primary)',
              '--tw-ring-color': '#10b981',
            } as React.CSSProperties}
          />
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div
          className="px-4 py-2.5 rounded-lg text-sm"
          style={{
            backgroundColor: 'color-mix(in srgb, #ef4444 8%, transparent)',
            color: '#ef4444',
            border: '1px solid color-mix(in srgb, #ef4444 20%, transparent)',
          }}
        >
          {error}
        </div>
      )}

      {/* Main layout: sidebar + table */}
      <div className="flex gap-4">
        {/* Filter Sidebar */}
        <div className="w-48 flex-shrink-0 space-y-5">
          {/* Status Views */}
          <div>
            <p
              className="text-[10px] font-semibold uppercase tracking-wider px-2 mb-2"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Views
            </p>
            <div className="space-y-0.5">
              {statusFilters.map((f) => {
                const active = statusFilter === f.key;
                return (
                  <button
                    key={f.key}
                    onClick={() => setStatusFilter(f.key)}
                    className="w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-[13px] transition-colors"
                    style={{
                      backgroundColor: active ? 'color-mix(in srgb, #10b981 10%, transparent)' : 'transparent',
                      color: active ? '#10b981' : 'var(--text-secondary)',
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

          {/* Concept Filter */}
          <div>
            <p
              className="text-[10px] font-semibold uppercase tracking-wider px-2 mb-2"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Concept
            </p>
            <div className="space-y-0.5">
              {conceptFilters.map((f) => {
                const active = conceptFilter === f.key;
                return (
                  <button
                    key={f.key}
                    onClick={() => setConceptFilter(active && f.key !== '' ? '' : f.key)}
                    className="w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-[13px] transition-colors"
                    style={{
                      backgroundColor: active ? 'color-mix(in srgb, #10b981 10%, transparent)' : 'transparent',
                      color: active ? '#10b981' : 'var(--text-secondary)',
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

        {/* Sessions Table */}
        <div className="flex-1 min-w-0">
          <div
            className="rounded-xl overflow-hidden"
            style={{
              backgroundColor: 'var(--bg-primary)',
              border: '1px solid var(--border-primary)',
              boxShadow: 'var(--shadow-sm)',
            }}
          >
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-primary)' }}>
                  {['Session ID', 'Concept', 'Status', 'Profile', 'Email', 'Started', 'Duration'].map((col) => (
                    <th
                      key={col}
                      style={{
                        padding: '10px 16px',
                        textAlign: 'left',
                        fontSize: 11,
                        fontWeight: 600,
                        textTransform: 'uppercase',
                        letterSpacing: '0.06em',
                        color: 'var(--text-tertiary)',
                        backgroundColor: 'var(--bg-secondary)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i}>
                      {[60, 100, 80, 100, 140, 80, 60].map((w, j) => (
                        <td key={j} style={{ padding: '12px 16px' }}>
                          <div
                            style={{
                              height: 14,
                              width: w,
                              borderRadius: 6,
                              backgroundColor: 'var(--bg-tertiary)',
                              animation: 'pulse 1.5s ease-in-out infinite',
                            }}
                          />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : sessions.length === 0 ? (
                  <tr>
                    <td colSpan={7}>
                      <div style={{ padding: '48px 16px', textAlign: 'center' }}>
                        <Users
                          size={32}
                          style={{ color: 'var(--text-tertiary)', margin: '0 auto 12px' }}
                        />
                        <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-secondary)' }}>
                          No sessions found
                        </p>
                        <p style={{ fontSize: 12, marginTop: 4, color: 'var(--text-tertiary)' }}>
                          Try adjusting your filters or search
                        </p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  sessions.map((session, idx) => {
                    const statusStyle = STATUS_STYLES[session.status] ?? STATUS_STYLES.started;
                    const conceptStyle = CONCEPT_STYLES[session.concept];
                    const isHovered = hoveredRow === session.id;
                    const isLast = idx === sessions.length - 1;
                    const sessionIdShort = (session.session_id || session.id).slice(0, 8);

                    return (
                      <tr
                        key={session.id}
                        onMouseEnter={() => setHoveredRow(session.id)}
                        onMouseLeave={() => setHoveredRow(null)}
                        style={{
                          backgroundColor: isHovered ? 'var(--bg-hover)' : 'transparent',
                          borderBottom: isLast ? 'none' : '1px solid var(--border-secondary)',
                          transition: 'background-color 150ms ease',
                        }}
                      >
                        {/* Session ID */}
                        <td style={{ padding: '12px 16px' }}>
                          <Link
                            href={`/funnel/sessions/${session.session_id || session.id}`}
                            style={{ fontSize: 13, fontFamily: 'var(--font-mono, monospace)', color: '#10b981', textDecoration: 'none' }}
                            onMouseEnter={(e) => (e.currentTarget.style.textDecoration = 'underline')}
                            onMouseLeave={(e) => (e.currentTarget.style.textDecoration = 'none')}
                          >
                            {sessionIdShort}
                          </Link>
                        </td>

                        {/* Concept */}
                        <td style={{ padding: '12px 16px' }}>
                          {conceptStyle ? (
                            <span
                              style={{
                                display: 'inline-block',
                                fontSize: 11,
                                fontWeight: 600,
                                padding: '3px 8px',
                                borderRadius: 9999,
                                backgroundColor: conceptStyle.backgroundColor,
                                color: conceptStyle.color,
                              }}
                            >
                              {conceptStyle.label}
                            </span>
                          ) : (
                            <span style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>
                              {session.concept || '--'}
                            </span>
                          )}
                        </td>

                        {/* Status */}
                        <td style={{ padding: '12px 16px' }}>
                          <span
                            style={{
                              display: 'inline-block',
                              fontSize: 11,
                              fontWeight: 600,
                              padding: '3px 8px',
                              borderRadius: 9999,
                              textTransform: 'capitalize',
                              backgroundColor: statusStyle.backgroundColor,
                              color: statusStyle.color,
                            }}
                          >
                            {session.status.replace(/_/g, ' ')}
                          </span>
                        </td>

                        {/* Profile */}
                        <td style={{ padding: '12px 16px' }}>
                          <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>
                            {session.profile_name || '--'}
                          </span>
                        </td>

                        {/* Email */}
                        <td style={{ padding: '12px 16px' }}>
                          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                            {session.email || '--'}
                          </span>
                        </td>

                        {/* Started */}
                        <td style={{ padding: '12px 16px', whiteSpace: 'nowrap' }}>
                          <span style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>
                            {timeAgo(session.started_at)}
                          </span>
                        </td>

                        {/* Duration */}
                        <td style={{ padding: '12px 16px', whiteSpace: 'nowrap' }}>
                          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                            {formatDuration(session.duration_seconds)}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
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
                  className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg transition-colors disabled:opacity-30"
                  style={{
                    backgroundColor: 'var(--bg-primary)',
                    border: '1px solid var(--border-primary)',
                    color: 'var(--text-secondary)',
                  }}
                >
                  <ChevronLeft size={14} />
                  Previous
                </button>
                <button
                  onClick={() => setPage(Math.min(totalPages, page + 1))}
                  disabled={page === totalPages}
                  className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg transition-colors disabled:opacity-30"
                  style={{
                    backgroundColor: 'var(--bg-primary)',
                    border: '1px solid var(--border-primary)',
                    color: 'var(--text-secondary)',
                  }}
                >
                  Next
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
