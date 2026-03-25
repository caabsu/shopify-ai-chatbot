'use client';

import { useState, useEffect } from 'react';
import { BarChart3, Tag, DollarSign, TrendingUp, Calendar, Truck, ExternalLink } from 'lucide-react';

interface LabelStats {
  totalLabels: number;
  totalShippingCost: number;
  avgCostPerReturn: number;
  labelsThisMonth: number;
  mostUsedCarrier: string;
  costByCarrier: Record<string, { count: number; cost: number }>;
  dailyCosts: Record<string, number>;
  recentLabels: Array<{
    id: string;
    orderNumber: string;
    customer: string;
    carrier: string;
    trackingNumber: string | null;
    cost: number;
    date: string;
    labelUrl: string | null;
  }>;
}

export default function LabelStatsPage() {
  const [stats, setStats] = useState<LabelStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/returns/label-stats')
      .then((r) => r.json())
      .then((data) => setStats(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 w-48 rounded-lg" style={{ backgroundColor: 'var(--bg-tertiary)' }} />
        <div className="grid grid-cols-5 gap-4">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-24 rounded-xl" style={{ backgroundColor: 'var(--bg-tertiary)' }} />
          ))}
        </div>
      </div>
    );
  }

  if (!stats) {
    return <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>Failed to load label statistics.</p>;
  }

  const maxDailyCost = Math.max(...Object.values(stats.dailyCosts), 1);
  const carrierEntries = Object.entries(stats.costByCarrier).sort((a, b) => b[1].cost - a[1].cost);
  const maxCarrierCost = Math.max(...carrierEntries.map(([, v]) => v.cost), 1);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <BarChart3 size={20} style={{ color: 'var(--text-primary)' }} />
        <div>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Label Statistics</h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
            Shipping label costs and carrier usage for returns
          </p>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-5 gap-4">
        {[
          { label: 'Total Labels', value: stats.totalLabels.toString(), icon: Tag, color: 'var(--text-primary)' },
          { label: 'Total Shipping Cost', value: `$${stats.totalShippingCost.toFixed(2)}`, icon: DollarSign, color: '#22c55e' },
          { label: 'Avg Cost / Return', value: `$${stats.avgCostPerReturn.toFixed(2)}`, icon: TrendingUp, color: '#6366f1' },
          { label: 'Labels This Month', value: stats.labelsThisMonth.toString(), icon: Calendar, color: '#f59e0b' },
          { label: 'Most Used Carrier', value: stats.mostUsedCarrier, icon: Truck, color: '#3b82f6' },
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

      {/* Charts Row */}
      <div className="grid grid-cols-2 gap-5">
        {/* Cost Over Time */}
        <div
          className="rounded-xl p-5"
          style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-primary)' }}
        >
          <h3 className="text-sm font-medium mb-4" style={{ color: 'var(--text-primary)' }}>Cost Over Time (Last 30 Days)</h3>
          <div className="flex items-end gap-[3px] h-32">
            {Object.entries(stats.dailyCosts).map(([date, cost]) => {
              const height = maxDailyCost > 0 ? (cost / maxDailyCost) * 100 : 0;
              return (
                <div key={date} className="flex-1 flex flex-col items-center justify-end h-full group relative">
                  <div
                    className="w-full rounded-t transition-colors"
                    style={{
                      height: `${Math.max(height, cost > 0 ? 4 : 0)}%`,
                      backgroundColor: cost > 0 ? 'var(--color-accent)' : 'var(--bg-tertiary)',
                      opacity: cost > 0 ? 0.8 : 0.3,
                      minHeight: cost > 0 ? '2px' : '0',
                    }}
                  />
                  <div
                    className="absolute bottom-full mb-1 hidden group-hover:block text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap z-10"
                    style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}
                  >
                    {date}: ${cost.toFixed(2)}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex justify-between mt-2">
            <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
              {Object.keys(stats.dailyCosts)[0]}
            </span>
            <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
              {Object.keys(stats.dailyCosts).pop()}
            </span>
          </div>
        </div>

        {/* Cost by Carrier */}
        <div
          className="rounded-xl p-5"
          style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-primary)' }}
        >
          <h3 className="text-sm font-medium mb-4" style={{ color: 'var(--text-primary)' }}>Cost by Carrier</h3>
          <div className="space-y-3">
            {carrierEntries.map(([carrier, data]) => {
              const pct = maxCarrierCost > 0 ? (data.cost / maxCarrierCost) * 100 : 0;
              return (
                <div key={carrier}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>{carrier}</span>
                    <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                      {data.count} labels - ${data.cost.toFixed(2)}
                    </span>
                  </div>
                  <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${pct}%`, backgroundColor: 'var(--color-accent)' }}
                    />
                  </div>
                </div>
              );
            })}
            {carrierEntries.length === 0 && (
              <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>No carrier data yet.</p>
            )}
          </div>
        </div>
      </div>

      {/* Recent Labels Table */}
      <div
        className="rounded-xl overflow-hidden"
        style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-primary)' }}
      >
        <div className="px-5 py-4" style={{ borderBottom: '1px solid var(--border-secondary)' }}>
          <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Recent Labels</h3>
        </div>
        {stats.recentLabels.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>No labels created yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-secondary)' }}>
                  {['Order #', 'Customer', 'Carrier', 'Tracking #', 'Cost', 'Date', 'Label'].map((h) => (
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
                {stats.recentLabels.map((label) => (
                  <tr
                    key={label.id}
                    style={{ borderBottom: '1px solid var(--border-secondary)' }}
                  >
                    <td className="px-4 py-3 font-mono text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                      {label.orderNumber}
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {label.customer}
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {label.carrier}
                    </td>
                    <td className="px-4 py-3 text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>
                      {label.trackingNumber || '\u2014'}
                    </td>
                    <td className="px-4 py-3 text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                      ${label.cost.toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                      {new Date(label.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </td>
                    <td className="px-4 py-3">
                      {label.labelUrl ? (
                        <a
                          href={label.labelUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs font-medium"
                          style={{ color: 'var(--color-accent)' }}
                        >
                          <ExternalLink size={10} /> View
                        </a>
                      ) : (
                        <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{'\u2014'}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
