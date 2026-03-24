'use client';

import { useState, useEffect } from 'react';
import { BarChart3, Loader2, Package } from 'lucide-react';

interface DayCount {
  date: string;
  count: number;
}

interface RecentLookup {
  order_number: string | null;
  email: string;
  status: string;
  carrier: string | null;
  created_at: string;
}

interface InsightsData {
  totalLookups: number;
  lookupsThisWeek: number;
  lookupsToday: number;
  byStatus: Record<string, number>;
  byCarrier: Record<string, number>;
  byDay: DayCount[];
  recentLookups: RecentLookup[];
}

// ── Status helpers ─────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, { bg: string; color: string; label: string }> = {
  delivered:       { bg: 'rgba(34,197,94,0.12)',  color: '#22c55e', label: 'Delivered' },
  in_transit:      { bg: 'rgba(59,130,246,0.12)',  color: '#3b82f6', label: 'In Transit' },
  out_for_delivery:{ bg: 'rgba(99,102,241,0.12)',  color: '#6366f1', label: 'Out for Delivery' },
  info_received:   { bg: 'rgba(245,158,11,0.12)',  color: '#f59e0b', label: 'Info Received' },
  not_found:       { bg: 'rgba(107,114,128,0.12)', color: '#6b7280', label: 'Not Found' },
  exception:       { bg: 'rgba(239,68,68,0.12)',   color: '#ef4444', label: 'Exception' },
  expired:         { bg: 'rgba(156,163,175,0.12)', color: '#9ca3af', label: 'Expired' },
};

function statusStyle(status: string) {
  return STATUS_COLORS[status] ?? { bg: 'rgba(107,114,128,0.12)', color: '#6b7280', label: status };
}

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function formatDateShort(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ── Component ──────────────────────────────────────────────────────────────

export default function TrackingInsightsPage() {
  const [data, setData] = useState<InsightsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch('/api/tracking/insights')
      .then((r) => r.json())
      .then((d) => {
        if (d.error) { setError(d.error); } else { setData(d); }
        setLoading(false);
      })
      .catch((e) => { setError(String(e)); setLoading(false); });
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 size={24} className="animate-spin" style={{ color: 'var(--text-tertiary)' }} />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="text-center py-20">
        <BarChart3 size={40} className="mx-auto mb-4" style={{ color: 'var(--text-tertiary)' }} />
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          {error ?? 'Failed to load insights'}
        </p>
      </div>
    );
  }

  // ── Derived values ────────────────────────────────────────────────────────

  const maxDayCount = Math.max(...data.byDay.map((d) => d.count), 1);

  const statusEntries = Object.entries(data.byStatus).sort((a, b) => b[1] - a[1]);
  const maxStatus = Math.max(...statusEntries.map(([, v]) => v), 1);

  const carrierEntries = Object.entries(data.byCarrier).sort((a, b) => b[1] - a[1]);
  const maxCarrier = Math.max(...carrierEntries.map(([, v]) => v), 1);

  const mostCommonStatus = statusEntries[0]?.[0] ?? '—';
  const mostCommonStyle = statusStyle(mostCommonStatus);

  // Show date labels every 5 days on the bar chart
  const labelIndices = new Set<number>();
  for (let i = 0; i < data.byDay.length; i += 5) labelIndices.add(i);
  labelIndices.add(data.byDay.length - 1);

  return (
    <div className="space-y-6">
      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <BarChart3 size={20} style={{ color: 'var(--text-primary)' }} />
        <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
          Tracking Insights
        </h2>
      </div>

      {/* ── Stat cards ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Lookups', value: data.totalLookups.toLocaleString() },
          { label: 'This Week', value: data.lookupsThisWeek.toLocaleString() },
          { label: 'Today', value: data.lookupsToday.toLocaleString() },
          {
            label: 'Most Common Status',
            value: mostCommonStyle.label,
            valueColor: mostCommonStyle.color,
          },
        ].map((card, i) => (
          <div
            key={i}
            className="rounded-xl p-4"
            style={{
              backgroundColor: 'var(--bg-primary)',
              border: '1px solid var(--border-primary)',
            }}
          >
            <p className="text-xs mb-1.5" style={{ color: 'var(--text-tertiary)' }}>
              {card.label}
            </p>
            <p
              className="text-2xl font-semibold"
              style={{ color: card.valueColor ?? 'var(--color-accent)' }}
            >
              {card.value}
            </p>
          </div>
        ))}
      </div>

      {/* ── Lookups Over Time bar chart ──────────────────────────────────── */}
      <div
        className="rounded-xl p-5"
        style={{
          backgroundColor: 'var(--bg-primary)',
          border: '1px solid var(--border-primary)',
        }}
      >
        <h3 className="text-sm font-medium mb-4" style={{ color: 'var(--text-primary)' }}>
          Lookups Over Time
          <span className="ml-2 text-xs font-normal" style={{ color: 'var(--text-tertiary)' }}>
            (last 30 days)
          </span>
        </h3>

        {/* Bars */}
        <div className="flex items-end gap-[2px]" style={{ height: 120 }}>
          {data.byDay.map((d, i) => {
            const pct = maxDayCount > 0 ? (d.count / maxDayCount) * 100 : 0;
            return (
              <div
                key={d.date}
                className="flex-1 flex flex-col items-center justify-end group"
                style={{ height: '100%' }}
                title={`${d.date}: ${d.count} lookup${d.count !== 1 ? 's' : ''}`}
              >
                <div
                  style={{
                    width: '100%',
                    height: `${Math.max(pct, d.count > 0 ? 4 : 0)}%`,
                    backgroundColor: 'var(--color-accent)',
                    borderRadius: '2px 2px 0 0',
                    opacity: d.count > 0 ? 1 : 0.15,
                    minHeight: d.count > 0 ? 3 : 0,
                    transition: 'opacity 0.15s',
                  }}
                />
              </div>
            );
          })}
        </div>

        {/* X-axis date labels */}
        <div className="flex items-start gap-[2px] mt-1">
          {data.byDay.map((d, i) => (
            <div key={d.date} className="flex-1 text-center" style={{ minWidth: 0 }}>
              {labelIndices.has(i) ? (
                <span
                  className="text-[9px] leading-tight"
                  style={{ color: 'var(--text-tertiary)', display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                >
                  {formatDateShort(d.date)}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      </div>

      {/* ── By Status + By Carrier ───────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* By Status */}
        <div
          className="rounded-xl p-5"
          style={{
            backgroundColor: 'var(--bg-primary)',
            border: '1px solid var(--border-primary)',
          }}
        >
          <h3 className="text-sm font-medium mb-4" style={{ color: 'var(--text-primary)' }}>
            By Status
          </h3>
          {statusEntries.length === 0 ? (
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>No data yet</p>
          ) : (
            <div className="space-y-3">
              {statusEntries.map(([status, count]) => {
                const st = statusStyle(status);
                return (
                  <div key={status}>
                    <div className="flex items-center justify-between mb-1">
                      <span
                        className="text-[11px] font-medium px-2 py-0.5 rounded-full"
                        style={{ backgroundColor: st.bg, color: st.color }}
                      >
                        {st.label}
                      </span>
                      <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                        {count}
                      </span>
                    </div>
                    <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--bg-secondary)' }}>
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${(count / maxStatus) * 100}%`,
                          backgroundColor: st.color,
                          minWidth: 3,
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* By Carrier */}
        <div
          className="rounded-xl p-5"
          style={{
            backgroundColor: 'var(--bg-primary)',
            border: '1px solid var(--border-primary)',
          }}
        >
          <h3 className="text-sm font-medium mb-4" style={{ color: 'var(--text-primary)' }}>
            By Carrier
          </h3>
          {carrierEntries.length === 0 ? (
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>No data yet</p>
          ) : (
            <div className="space-y-3">
              {carrierEntries.map(([carrier, count]) => (
                <div key={carrier}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                      {carrier}
                    </span>
                    <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                      {count}
                    </span>
                  </div>
                  <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--bg-secondary)' }}>
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${(count / maxCarrier) * 100}%`,
                        backgroundColor: 'var(--color-accent)',
                        minWidth: 3,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Recent Lookups table ─────────────────────────────────────────── */}
      <div
        className="rounded-xl overflow-hidden"
        style={{
          backgroundColor: 'var(--bg-primary)',
          border: '1px solid var(--border-primary)',
        }}
      >
        <div className="px-5 py-4" style={{ borderBottom: '1px solid var(--border-primary)' }}>
          <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            Recent Lookups
          </h3>
        </div>

        {data.recentLookups.length === 0 ? (
          <div className="flex flex-col items-center py-12 gap-3">
            <Package size={32} style={{ color: 'var(--text-tertiary)' }} />
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>No lookups recorded yet</p>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              Lookups will appear here once customers use the tracking widget
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-primary)' }}>
                  {['Order #', 'Email', 'Status', 'Carrier', 'Time'].map((h) => (
                    <th
                      key={h}
                      className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wider"
                      style={{ color: 'var(--text-tertiary)' }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.recentLookups.map((row, i) => {
                  const st = statusStyle(row.status);
                  return (
                    <tr
                      key={i}
                      style={{
                        borderBottom: i < data.recentLookups.length - 1 ? '1px solid var(--border-primary)' : 'none',
                      }}
                    >
                      <td className="px-5 py-3 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                        {row.order_number ? `#${row.order_number}` : <span style={{ color: 'var(--text-tertiary)' }}>—</span>}
                      </td>
                      <td className="px-5 py-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
                        {row.email || <span style={{ color: 'var(--text-tertiary)' }}>—</span>}
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className="text-[11px] font-medium px-2 py-0.5 rounded-full"
                          style={{ backgroundColor: st.bg, color: st.color }}
                        >
                          {st.label}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
                        {row.carrier ?? <span style={{ color: 'var(--text-tertiary)' }}>—</span>}
                      </td>
                      <td className="px-5 py-3 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                        {relativeTime(row.created_at)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
