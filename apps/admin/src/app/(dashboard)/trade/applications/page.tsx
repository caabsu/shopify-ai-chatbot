'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Search, ChevronLeft, ChevronRight, ExternalLink, FileText, Archive, Trash2, MoreHorizontal } from 'lucide-react';

interface TradeApplication {
  id: string;
  created_at: string;
  first_name: string;
  last_name: string;
  full_name: string;
  email: string;
  company_name: string;
  business_type: string;
  website_url?: string;
  website?: string;
  status: 'pending' | 'approved' | 'rejected' | 'archived';
}

interface ApplicationCounts {
  all: number;
  pending: number;
  approved: number;
  rejected: number;
  archived: number;
}

interface ApiResponse {
  applications: TradeApplication[];
  total: number;
  page: number;
  totalPages: number;
  counts: ApplicationCounts;
}

const STATUS_STYLES: Record<string, { bg: string; text: string }> = {
  pending:  { bg: 'rgba(245,158,11,0.12)',  text: '#f59e0b' },
  approved: { bg: 'rgba(34,197,94,0.12)',   text: '#22c55e' },
  rejected: { bg: 'rgba(239,68,68,0.12)',   text: '#ef4444' },
  archived: { bg: 'rgba(148,163,184,0.12)', text: '#94a3b8' },
};

const TABS = [
  { key: '',         label: 'All' },
  { key: 'pending',  label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'archived', label: 'Archived' },
] as const;

function formatBusinessType(raw: string): string {
  if (!raw) return '—';
  const spaced = raw.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function SkeletonRow() {
  return (
    <tr>
      {[30, 140, 160, 140, 120, 120, 80, 30].map((w, i) => (
        <td key={i} style={{ padding: '12px 16px' }}>
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
  );
}

export default function TradeApplicationsPage() {
  const router = useRouter();

  const [applications, setApplications] = useState<TradeApplication[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [counts, setCounts] = useState<ApplicationCounts>({ all: 0, pending: 0, approved: 0, rejected: 0, archived: 0 });
  const [hoveredRow, setHoveredRow] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkActing, setBulkActing] = useState(false);
  const [actionMenuId, setActionMenuId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ type: 'single' | 'bulk'; id?: string } | null>(null);

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce search input ~300ms
  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [search]);

  const loadApplications = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({
      page: String(page),
      limit: '20',
    });
    if (statusFilter) params.set('status', statusFilter);
    if (debouncedSearch) params.set('search', debouncedSearch);

    try {
      const res = await fetch(`/api/trade/applications?${params}`);
      const data: ApiResponse = await res.json();
      setApplications(data.applications ?? []);
      setTotal(data.total ?? 0);
      setTotalPages(data.totalPages ?? 1);
      if (data.counts) setCounts(data.counts);
    } catch {
      setApplications([]);
    }
    setLoading(false);
    setSelectedIds(new Set());
  }, [page, statusFilter, debouncedSearch]);

  useEffect(() => { loadApplications(); }, [loadApplications]);

  // Reset page when filter/search changes
  useEffect(() => { setPage(1); }, [statusFilter]);

  // Close action menu on click outside
  useEffect(() => {
    function handleClick() { setActionMenuId(null); }
    if (actionMenuId) {
      document.addEventListener('click', handleClick);
      return () => document.removeEventListener('click', handleClick);
    }
  }, [actionMenuId]);

  function handleTabClick(key: string) {
    setStatusFilter(key);
    setPage(1);
  }

  function getTabCount(key: string): number {
    if (key === '') return counts.all;
    return counts[key as keyof ApplicationCounts] ?? 0;
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedIds.size === applications.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(applications.map((a) => a.id)));
    }
  }

  async function handleArchive(id: string) {
    try {
      const res = await fetch(`/api/trade/applications/${id}/archive`, { method: 'POST' });
      if (res.ok) await loadApplications();
      else alert('Failed to archive application');
    } catch {
      alert('Failed to archive application');
    }
  }

  async function handleDelete(id: string) {
    try {
      const res = await fetch(`/api/trade/applications/${id}/delete`, { method: 'POST' });
      if (res.ok) {
        setConfirmDelete(null);
        await loadApplications();
      } else {
        alert('Failed to delete application');
      }
    } catch {
      alert('Failed to delete application');
    }
  }

  async function handleBulkArchive() {
    setBulkActing(true);
    try {
      const res = await fetch('/api/trade/applications/bulk/archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selectedIds) }),
      });
      if (res.ok) await loadApplications();
      else alert('Failed to archive applications');
    } catch {
      alert('Failed to archive applications');
    }
    setBulkActing(false);
  }

  async function handleBulkDelete() {
    setBulkActing(true);
    try {
      const res = await fetch('/api/trade/applications/bulk/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selectedIds) }),
      });
      if (res.ok) {
        setConfirmDelete(null);
        await loadApplications();
      } else {
        alert('Failed to delete applications');
      }
    } catch {
      alert('Failed to delete applications');
    }
    setBulkActing(false);
  }

  const canManage = (status: string) => status !== 'approved';

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <FileText size={20} style={{ color: 'var(--text-primary)' }} />
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
            Trade Applications
          </h2>
          <span className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
            {total} {total === 1 ? 'application' : 'applications'}
          </span>
        </div>

        {/* Search */}
        <div className="relative">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2"
            style={{ color: 'var(--text-tertiary)' }}
          />
          <input
            placeholder="Search name, email, company..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
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

      {/* Filter Tabs */}
      <div className="flex items-center justify-between">
        <div
          className="flex items-center gap-1 p-1 rounded-lg w-fit"
          style={{ backgroundColor: 'var(--bg-tertiary)' }}
        >
          {TABS.map((tab) => {
            const active = statusFilter === tab.key;
            const count = getTabCount(tab.key);
            return (
              <button
                key={tab.key}
                onClick={() => handleTabClick(tab.key)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition-colors font-medium"
                style={{
                  backgroundColor: active ? 'var(--bg-primary)' : 'transparent',
                  color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                  boxShadow: active ? 'var(--shadow-sm)' : 'none',
                }}
              >
                {tab.label}
                <span
                  className="text-[11px] px-1.5 py-0.5 rounded-full font-medium"
                  style={{
                    backgroundColor: active
                      ? 'color-mix(in srgb, var(--color-accent) 12%, transparent)'
                      : 'transparent',
                    color: active ? 'var(--color-accent)' : 'var(--text-tertiary)',
                  }}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Bulk actions bar */}
        {selectedIds.size > 0 && (
          <div
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg"
            style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-primary)' }}
          >
            <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
              {selectedIds.size} selected
            </span>
            <button
              onClick={handleBulkArchive}
              disabled={bulkActing}
              className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md transition-colors disabled:opacity-50"
              style={{ color: 'var(--text-secondary)', backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-primary)' }}
            >
              <Archive size={12} />
              Archive
            </button>
            <button
              onClick={() => setConfirmDelete({ type: 'bulk' })}
              disabled={bulkActing}
              className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md transition-colors disabled:opacity-50"
              style={{ color: '#ef4444', backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-primary)' }}
            >
              <Trash2 size={12} />
              Delete
            </button>
          </div>
        )}
      </div>

      {/* Delete Confirmation Dialog */}
      {confirmDelete && (
        <div
          className="flex items-center justify-between px-4 py-3 rounded-xl text-sm"
          style={{
            backgroundColor: 'rgba(239,68,68,0.08)',
            border: '1px solid rgba(239,68,68,0.2)',
          }}
        >
          <span style={{ color: 'var(--text-primary)' }}>
            {confirmDelete.type === 'bulk'
              ? `Permanently delete ${selectedIds.size} application(s)? This cannot be undone.`
              : 'Permanently delete this application? This cannot be undone.'}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setConfirmDelete(null)}
              className="px-3 py-1.5 text-xs font-medium rounded-lg"
              style={{ color: 'var(--text-secondary)', backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-primary)' }}
            >
              Cancel
            </button>
            <button
              onClick={() => {
                if (confirmDelete.type === 'bulk') handleBulkDelete();
                else if (confirmDelete.id) handleDelete(confirmDelete.id);
              }}
              disabled={bulkActing}
              className="px-3 py-1.5 text-xs font-medium rounded-lg text-white disabled:opacity-50"
              style={{ backgroundColor: '#dc2626' }}
            >
              Delete
            </button>
          </div>
        </div>
      )}

      {/* Table Card */}
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
              <th style={{ padding: '10px 12px', width: 36, backgroundColor: 'var(--bg-secondary)' }}>
                <input
                  type="checkbox"
                  checked={applications.length > 0 && selectedIds.size === applications.length}
                  onChange={toggleSelectAll}
                  style={{ cursor: 'pointer', accentColor: 'var(--color-accent)' }}
                />
              </th>
              {['Date', 'Name', 'Company', 'Business Type', 'Website', 'Status'].map((col) => (
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
              <th style={{ padding: '10px 12px', width: 36, backgroundColor: 'var(--bg-secondary)' }} />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} />)
            ) : applications.length === 0 ? (
              <tr>
                <td colSpan={8}>
                  <div
                    style={{
                      padding: '48px 16px',
                      textAlign: 'center',
                    }}
                  >
                    <FileText
                      size={32}
                      style={{ color: 'var(--text-tertiary)', margin: '0 auto 12px' }}
                    />
                    <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-secondary)' }}>
                      No applications found
                    </p>
                    <p style={{ fontSize: 12, marginTop: 4, color: 'var(--text-tertiary)' }}>
                      Try adjusting your filters or search
                    </p>
                  </div>
                </td>
              </tr>
            ) : (
              applications.map((app, idx) => {
                const statusStyle = STATUS_STYLES[app.status] ?? STATUS_STYLES.pending;
                const isHovered = hoveredRow === app.id;
                const isLast = idx === applications.length - 1;
                const isSelected = selectedIds.has(app.id);
                const websiteUrl = app.website_url || app.website;

                return (
                  <tr
                    key={app.id}
                    onMouseEnter={() => setHoveredRow(app.id)}
                    onMouseLeave={() => setHoveredRow(null)}
                    style={{
                      backgroundColor: isSelected
                        ? 'color-mix(in srgb, var(--color-accent) 5%, transparent)'
                        : isHovered ? 'var(--bg-hover)' : 'transparent',
                      borderBottom: isLast ? 'none' : '1px solid var(--border-secondary)',
                      transition: 'background-color 150ms ease',
                    }}
                  >
                    {/* Checkbox */}
                    <td style={{ padding: '12px 12px', width: 36 }}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelect(app.id)}
                        onClick={(e) => e.stopPropagation()}
                        style={{ cursor: 'pointer', accentColor: 'var(--color-accent)' }}
                      />
                    </td>

                    {/* Date */}
                    <td
                      style={{ padding: '12px 16px', whiteSpace: 'nowrap', cursor: 'pointer' }}
                      onClick={() => router.push(`/trade/applications/${app.id}`)}
                    >
                      <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                        {formatDate(app.created_at)}
                      </span>
                    </td>

                    {/* Name */}
                    <td
                      style={{ padding: '12px 16px', cursor: 'pointer' }}
                      onClick={() => router.push(`/trade/applications/${app.id}`)}
                    >
                      <div>
                        <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', margin: 0 }}>
                          {app.full_name || `${app.first_name || ''} ${app.last_name || ''}`.trim() || '—'}
                        </p>
                        <p style={{ fontSize: 12, color: 'var(--text-tertiary)', margin: 0 }}>
                          {app.email}
                        </p>
                      </div>
                    </td>

                    {/* Company */}
                    <td
                      style={{ padding: '12px 16px', cursor: 'pointer' }}
                      onClick={() => router.push(`/trade/applications/${app.id}`)}
                    >
                      <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>
                        {app.company_name || '—'}
                      </span>
                    </td>

                    {/* Business Type */}
                    <td
                      style={{ padding: '12px 16px', cursor: 'pointer' }}
                      onClick={() => router.push(`/trade/applications/${app.id}`)}
                    >
                      <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                        {formatBusinessType(app.business_type)}
                      </span>
                    </td>

                    {/* Website */}
                    <td style={{ padding: '12px 16px' }}>
                      {websiteUrl ? (
                        <a
                          href={websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="flex items-center gap-1"
                          style={{ fontSize: 13, color: 'var(--color-accent)', textDecoration: 'none' }}
                          onMouseEnter={(e) => (e.currentTarget.style.textDecoration = 'underline')}
                          onMouseLeave={(e) => (e.currentTarget.style.textDecoration = 'none')}
                        >
                          <span className="truncate" style={{ maxWidth: 140 }}>
                            {websiteUrl.replace(/^https?:\/\//, '')}
                          </span>
                          <ExternalLink size={11} style={{ flexShrink: 0 }} />
                        </a>
                      ) : (
                        <span style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>—</span>
                      )}
                    </td>

                    {/* Status */}
                    <td
                      style={{ padding: '12px 16px', cursor: 'pointer' }}
                      onClick={() => router.push(`/trade/applications/${app.id}`)}
                    >
                      <span
                        style={{
                          display: 'inline-block',
                          fontSize: 11,
                          fontWeight: 600,
                          padding: '3px 8px',
                          borderRadius: 9999,
                          textTransform: 'capitalize',
                          backgroundColor: statusStyle.bg,
                          color: statusStyle.text,
                        }}
                      >
                        {app.status}
                      </span>
                    </td>

                    {/* Actions menu */}
                    <td style={{ padding: '12px 12px', width: 36, position: 'relative' }}>
                      {canManage(app.status) && (
                        <>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setActionMenuId(actionMenuId === app.id ? null : app.id);
                            }}
                            className="p-1 rounded transition-colors"
                            style={{
                              color: 'var(--text-tertiary)',
                              opacity: isHovered || actionMenuId === app.id ? 1 : 0,
                              transition: 'opacity 150ms ease',
                            }}
                          >
                            <MoreHorizontal size={14} />
                          </button>
                          {actionMenuId === app.id && (
                            <div
                              className="absolute right-12 top-1/2 -translate-y-1/2 z-10 rounded-lg py-1 min-w-[120px]"
                              style={{
                                backgroundColor: 'var(--bg-primary)',
                                border: '1px solid var(--border-primary)',
                                boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                              }}
                              onClick={(e) => e.stopPropagation()}
                            >
                              {app.status !== 'archived' && (
                                <button
                                  onClick={() => { setActionMenuId(null); handleArchive(app.id); }}
                                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors"
                                  style={{ color: 'var(--text-secondary)' }}
                                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-hover)')}
                                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                                >
                                  <Archive size={12} />
                                  Archive
                                </button>
                              )}
                              <button
                                onClick={() => { setActionMenuId(null); setConfirmDelete({ type: 'single', id: app.id }); }}
                                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors"
                                style={{ color: '#ef4444' }}
                                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-hover)')}
                                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                              >
                                <Trash2 size={12} />
                                Delete
                              </button>
                            </div>
                          )}
                        </>
                      )}
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
        <div className="flex items-center justify-between">
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
  );
}
