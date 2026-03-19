'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Users, ChevronLeft, ChevronRight } from 'lucide-react';

interface TradeMember {
  id: string;
  customer_name: string;
  customer_email: string;
  company_name: string | null;
  member_type: string;
  status: string;
  orders_count: number;
  total_spent: number;
  approved_at: string;
}

interface MembersResponse {
  members: TradeMember[];
  total: number;
  page: number;
  totalPages: number;
}

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  active: { bg: 'rgba(34,197,94,0.12)', text: '#22c55e', label: 'Active' },
  suspended: { bg: 'rgba(245,158,11,0.12)', text: '#f59e0b', label: 'Suspended' },
  revoked: { bg: 'rgba(239,68,68,0.12)', text: '#ef4444', label: 'Revoked' },
};

function formatCurrency(cents: number): string {
  const dollars = Math.round(cents / 100);
  return '$' + dollars.toLocaleString('en-US');
}

export default function TradeMembersPage() {
  const router = useRouter();
  const [members, setMembers] = useState<TradeMember[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);

  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');

  const [counts, setCounts] = useState({
    all: 0,
    active: 0,
    suspended: 0,
    revoked: 0,
  });

  const perPage = 20;

  const loadCounts = useCallback(async () => {
    try {
      const [activeRes, suspendedRes, revokedRes] = await Promise.all([
        fetch('/api/trade/members?status=active&limit=0'),
        fetch('/api/trade/members?status=suspended&limit=0'),
        fetch('/api/trade/members?status=revoked&limit=0'),
      ]);
      const [activeData, suspendedData, revokedData] = await Promise.all([
        activeRes.json(), suspendedRes.json(), revokedRes.json(),
      ]);
      const active = activeData.total ?? 0;
      const suspended = suspendedData.total ?? 0;
      const revoked = revokedData.total ?? 0;
      setCounts({ all: active + suspended + revoked, active, suspended, revoked });
    } catch {
      // ignore
    }
  }, []);

  const loadMembers = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({
      page: String(page),
      limit: String(perPage),
    });
    if (statusFilter) params.set('status', statusFilter);
    if (search) params.set('search', search);

    try {
      const res = await fetch(`/api/trade/members?${params}`);
      const data: MembersResponse = await res.json();
      setMembers(data.members ?? []);
      setTotal(data.total ?? 0);
      setTotalPages(data.totalPages ?? 1);
    } catch {
      setMembers([]);
    }
    setLoading(false);
  }, [page, statusFilter, search]);

  useEffect(() => { loadCounts(); }, [loadCounts]);
  useEffect(() => { loadMembers(); }, [loadMembers]);

  const viewFilters = [
    { key: '', label: 'All Members', count: counts.all },
    { key: 'active', label: 'Active', count: counts.active },
    { key: 'suspended', label: 'Suspended', count: counts.suspended },
    { key: 'revoked', label: 'Revoked', count: counts.revoked },
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Users size={20} style={{ color: 'var(--text-primary)' }} />
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
            Trade Members
          </h2>
          <span className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
            {total} {total === 1 ? 'member' : 'members'}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-tertiary)' }} />
            <input
              placeholder="Search name, email, company..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="pl-9 pr-3 py-2 text-sm rounded-lg w-72 focus:outline-none focus:ring-2"
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

      {/* Main layout: sidebar + table */}
      <div className="flex gap-4">
        {/* Filter Sidebar */}
        <div className="w-48 flex-shrink-0 space-y-5">
          <div>
            <p
              className="text-[10px] font-semibold uppercase tracking-wider px-2 mb-2"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Status
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
                      backgroundColor: active
                        ? 'color-mix(in srgb, var(--color-accent) 10%, transparent)'
                        : 'transparent',
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

        {/* Members Table */}
        <div className="flex-1 min-w-0">
          <div
            className="rounded-xl overflow-hidden"
            style={{
              backgroundColor: 'var(--bg-primary)',
              border: '1px solid var(--border-primary)',
              boxShadow: 'var(--shadow-sm)',
            }}
          >
            {/* Table Header */}
            <div
              className="grid text-[11px] font-semibold uppercase tracking-wider px-4 py-2.5"
              style={{
                gridTemplateColumns: '2fr 1.5fr 1fr 1fr 0.8fr 1fr 1fr',
                color: 'var(--text-tertiary)',
                borderBottom: '1px solid var(--border-primary)',
                backgroundColor: 'var(--bg-secondary)',
              }}
            >
              <span>Name</span>
              <span>Company</span>
              <span>Type</span>
              <span>Status</span>
              <span>Orders</span>
              <span>Total Spent</span>
              <span>Joined</span>
            </div>

            {loading ? (
              <div className="p-8 text-center">
                <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>Loading...</p>
              </div>
            ) : members.length === 0 ? (
              <div className="p-12 text-center">
                <Users size={32} className="mx-auto mb-3" style={{ color: 'var(--text-tertiary)' }} />
                <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
                  No members found
                </p>
                <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
                  Try adjusting your filters
                </p>
              </div>
            ) : (
              <div className="divide-y" style={{ borderColor: 'var(--border-secondary)' }}>
                {members.map((member) => {
                  const statusStyle = STATUS_STYLES[member.status] ?? {
                    bg: 'rgba(156,163,175,0.12)',
                    text: '#9ca3af',
                    label: member.status,
                  };

                  return (
                    <div
                      key={member.id}
                      onClick={() => router.push(`/trade/members/${member.id}`)}
                      className="grid items-center px-4 py-3 cursor-pointer transition-colors"
                      style={{
                        gridTemplateColumns: '2fr 1.5fr 1fr 1fr 0.8fr 1fr 1fr',
                        backgroundColor: 'transparent',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = 'var(--bg-hover)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = 'transparent';
                      }}
                    >
                      {/* Name */}
                      <div className="min-w-0 pr-3">
                        <p
                          className="text-sm font-medium truncate"
                          style={{ color: 'var(--text-primary)' }}
                        >
                          {member.customer_name}
                        </p>
                        <p
                          className="text-xs truncate"
                          style={{ color: 'var(--text-tertiary)' }}
                        >
                          {member.customer_email}
                        </p>
                      </div>

                      {/* Company */}
                      <div className="min-w-0 pr-3">
                        <p
                          className="text-sm truncate"
                          style={{ color: 'var(--text-secondary)' }}
                        >
                          {member.company_name ?? '—'}
                        </p>
                      </div>

                      {/* Type */}
                      <div>
                        <span
                          className="text-xs capitalize"
                          style={{ color: 'var(--text-secondary)' }}
                        >
                          {(member.business_type || '').replace(/_/g, ' ')}
                        </span>
                      </div>

                      {/* Status */}
                      <div>
                        <span
                          className="text-[11px] font-medium px-2 py-0.5 rounded-full"
                          style={{
                            backgroundColor: statusStyle.bg,
                            color: statusStyle.text,
                          }}
                        >
                          {statusStyle.label}
                        </span>
                      </div>

                      {/* Orders */}
                      <div>
                        <span
                          className="text-sm"
                          style={{ color: 'var(--text-secondary)' }}
                        >
                          {member.orders_count}
                        </span>
                      </div>

                      {/* Total Spent */}
                      <div>
                        <span
                          className="text-sm font-medium"
                          style={{ color: 'var(--text-primary)' }}
                        >
                          {formatCurrency(member.total_spent)}
                        </span>
                      </div>

                      {/* Joined */}
                      <div>
                        <span
                          className="text-xs"
                          style={{ color: 'var(--text-tertiary)' }}
                        >
                          {new Date(member.approved_at).toLocaleDateString()}
                        </span>
                      </div>
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
