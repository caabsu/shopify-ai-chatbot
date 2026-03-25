'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { BarChart3, Package, TrendingUp, DollarSign, Clock, CheckCircle } from 'lucide-react';

interface AnalyticsData {
  totalReturns: number;
  returnsThisMonth: number;
  approvalRate: number;
  avgRefundAmount: number;
  avgProcessingTime: number;
  refundOnlyCount: number;
  byStatus: Record<string, number>;
  byReason: Record<string, number>;
  byResolution: Record<string, number>;
  dailyReturns: Record<string, number>;
  recentReturns: Array<{
    id: string;
    orderNumber: string;
    customer: string;
    status: string;
    reason: string;
    amount: number | null;
    daysOpen: number;
    createdAt: string;
  }>;
}

const STATUS_COLORS: Record<string, string> = {
  pending_review: '#f59e0b',
  approved: '#22c55e',
  partially_approved: '#6366f1',
  denied: '#ef4444',
  shipped: '#3b82f6',
  received: '#8b5cf6',
  refunded: '#10b981',
  closed: '#6b7280',
  cancelled: '#9ca3af',
};

const REASON_LABELS: Record<string, string> = {
  defective: 'Defective / Damaged',
  wrong_item: 'Wrong Item',
  not_as_described: 'Not as Described',
  changed_mind: 'Changed Mind',
  too_small: 'Too Small',
  too_large: 'Too Large',
  arrived_late: 'Arrived Late',
  damaged_on_arrival: 'Damaged on Arrival',
  other: 'Other',
};

export default function ReturnsAnalyticsPage() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/returns/analytics')
      .then((r) => r.json())
      .then((d) => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 w-48 rounded-lg" style={{ backgroundColor: 'var(--bg-tertiary)' }} />
        <div className="grid grid-cols-6 gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-24 rounded-xl" style={{ backgroundColor: 'var(--bg-tertiary)' }} />
          ))}
        </div>
      </div>
    );
  }

  if (!data) {
    return <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>Failed to load analytics.</p>;
  }

  const maxDaily = Math.max(...Object.values(data.dailyReturns), 1);

  function renderHorizontalBars(entries: [string, number][], labelMap?: Record<string, string>, colorMap?: Record<string, string>) {
    const max = Math.max(...entries.map(([, v]) => v), 1);
    return (
      <div className="space-y-2.5">
        {entries.map(([key, count]) => {
          const pct = (count / max) * 100;
          const label = labelMap?.[key] || key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
          const color = colorMap?.[key] || 'var(--color-accent)';
          return (
            <div key={key}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{label}</span>
                <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{count}</span>
              </div>
              <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
                <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  const statusEntries = Object.entries(data.byStatus).sort((a, b) => b[1] - a[1]);
  const reasonEntries = Object.entries(data.byReason).sort((a, b) => b[1] - a[1]);
  const resolutionEntries = Object.entries(data.byResolution).sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <BarChart3 size={20} style={{ color: 'var(--text-primary)' }} />
        <div>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Returns Analytics</h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
            Overview of return request trends, reasons, and processing metrics
          </p>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-6 gap-4">
        {[
          { label: 'Total Returns', value: data.totalReturns.toString(), icon: Package, color: 'var(--text-primary)' },
          { label: 'This Month', value: data.returnsThisMonth.toString(), icon: TrendingUp, color: '#3b82f6' },
          { label: 'Approval Rate', value: `${data.approvalRate.toFixed(0)}%`, icon: CheckCircle, color: '#22c55e' },
          { label: 'Avg Refund', value: `$${data.avgRefundAmount.toFixed(2)}`, icon: DollarSign, color: '#f59e0b' },
          { label: 'Avg Processing', value: `${data.avgProcessingTime.toFixed(1)}d`, icon: Clock, color: '#6366f1' },
          { label: 'Refund-Only', value: data.refundOnlyCount.toString(), icon: CheckCircle, color: '#10b981' },
        ].map((stat) => (
          <div
            key={stat.label}
            className="rounded-xl p-4"
            style={{
              backgroundColor: 'var(--bg-primary)',
              border: '1px solid var(--border-primary)',
              boxShadow: 'var(--shadow-sm)',
            }}
          >
            <div className="flex items-center gap-2 mb-2">
              <stat.icon size={14} style={{ color: 'var(--text-tertiary)' }} />
              <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                {stat.label}
              </span>
            </div>
            <p className="text-xl font-bold" style={{ color: stat.color }}>{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Returns Over Time */}
      <div
        className="rounded-xl p-5"
        style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-primary)' }}
      >
        <h3 className="text-sm font-medium mb-4" style={{ color: 'var(--text-primary)' }}>Returns Over Time (Last 30 Days)</h3>
        <div className="flex items-end gap-[3px] h-32">
          {Object.entries(data.dailyReturns).map(([date, count]) => {
            const height = maxDaily > 0 ? (count / maxDaily) * 100 : 0;
            return (
              <div key={date} className="flex-1 flex flex-col items-center justify-end h-full group relative">
                <div
                  className="w-full rounded-t transition-colors"
                  style={{
                    height: `${Math.max(height, count > 0 ? 4 : 0)}%`,
                    backgroundColor: count > 0 ? 'var(--color-accent)' : 'var(--bg-tertiary)',
                    opacity: count > 0 ? 0.8 : 0.3,
                    minHeight: count > 0 ? '2px' : '0',
                  }}
                />
                <div
                  className="absolute bottom-full mb-1 hidden group-hover:block text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap z-10"
                  style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}
                >
                  {date}: {count}
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex justify-between mt-2">
          <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
            {Object.keys(data.dailyReturns)[0]}
          </span>
          <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
            {Object.keys(data.dailyReturns).pop()}
          </span>
        </div>
      </div>

      {/* Breakdowns Row */}
      <div className="grid grid-cols-3 gap-5">
        {/* By Status */}
        <div
          className="rounded-xl p-5"
          style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-primary)' }}
        >
          <h3 className="text-sm font-medium mb-4" style={{ color: 'var(--text-primary)' }}>By Status</h3>
          {renderHorizontalBars(statusEntries, undefined, STATUS_COLORS)}
        </div>

        {/* By Reason */}
        <div
          className="rounded-xl p-5"
          style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-primary)' }}
        >
          <h3 className="text-sm font-medium mb-4" style={{ color: 'var(--text-primary)' }}>By Reason</h3>
          {renderHorizontalBars(reasonEntries, REASON_LABELS)}
        </div>

        {/* By Resolution */}
        <div
          className="rounded-xl p-5"
          style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-primary)' }}
        >
          <h3 className="text-sm font-medium mb-4" style={{ color: 'var(--text-primary)' }}>By Resolution Type</h3>
          {renderHorizontalBars(resolutionEntries)}
        </div>
      </div>

      {/* Recent Returns Table */}
      <div
        className="rounded-xl overflow-hidden"
        style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-primary)' }}
      >
        <div className="px-5 py-4" style={{ borderBottom: '1px solid var(--border-secondary)' }}>
          <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Recent Returns</h3>
        </div>
        {data.recentReturns.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>No returns yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-secondary)' }}>
                  {['Order #', 'Customer', 'Status', 'Reason', 'Amount', 'Days Open', 'Created'].map((h) => (
                    <th
                      key={h}
                      className="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-wider"
                      style={{ color: 'var(--text-tertiary)' }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.recentReturns.map((r) => {
                  const statusColor = STATUS_COLORS[r.status] || '#9ca3af';
                  const reasonLabel = REASON_LABELS[r.reason] || r.reason.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
                  return (
                    <tr key={r.id} style={{ borderBottom: '1px solid var(--border-secondary)' }}>
                      <td className="px-4 py-3">
                        <Link
                          href={`/returns/${r.id}`}
                          className="font-mono text-xs font-medium"
                          style={{ color: 'var(--color-accent)' }}
                        >
                          {r.orderNumber}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-secondary)' }}>{r.customer}</td>
                      <td className="px-4 py-3">
                        <span
                          className="inline-flex items-center text-[10px] font-medium px-2 py-0.5 rounded-full"
                          style={{
                            backgroundColor: `${statusColor}1a`,
                            color: statusColor,
                          }}
                        >
                          {r.status.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-secondary)' }}>{reasonLabel}</td>
                      <td className="px-4 py-3 text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                        {r.amount != null ? `$${r.amount.toFixed(2)}` : '\u2014'}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className="text-xs font-medium"
                          style={{ color: r.daysOpen > 7 ? '#ef4444' : r.daysOpen > 3 ? '#f59e0b' : 'var(--text-secondary)' }}
                        >
                          {r.daysOpen}d
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                        {new Date(r.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
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
