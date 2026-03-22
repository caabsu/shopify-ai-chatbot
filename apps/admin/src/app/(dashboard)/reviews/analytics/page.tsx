'use client';

import { useState, useEffect, useCallback } from 'react';
import { BarChart3, Star, TrendingUp, TrendingDown, MessageSquare, RefreshCw, Loader2, AlertTriangle, Lightbulb } from 'lucide-react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip } from 'recharts';
import { useBrand } from '@/components/brand-context';

interface StatsCard {
  label: string;
  value: string;
  change: number | null;
}

interface RatingDistribution {
  star: number;
  count: number;
  percentage: number;
}

interface TimeSeriesPoint {
  date: string;
  count: number;
}

interface Theme {
  name: string;
  sentiment: number;
  mention_count: number;
  quotes: string[];
}

interface ActionItem {
  priority: 'high' | 'medium' | 'low';
  title: string;
  description: string;
  evidence: string;
}

interface AnalyticsData {
  stats: StatsCard[];
  rating_distribution: RatingDistribution[];
  reviews_over_time: TimeSeriesPoint[];
  themes: Theme[];
  action_items: ActionItem[];
}

const PRIORITY_COLORS: Record<string, { bg: string; border: string; color: string }> = {
  high: { bg: 'rgba(239,68,68,0.08)', border: 'rgba(239,68,68,0.25)', color: '#ef4444' },
  medium: { bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.25)', color: '#f59e0b' },
  low: { bg: 'rgba(34,197,94,0.08)', border: 'rgba(34,197,94,0.25)', color: '#22c55e' },
};

export default function ReviewAnalyticsPage() {
  const { brandSlug } = useBrand();
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadAnalytics = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);

    try {
      const params = new URLSearchParams();
      if (refresh) params.set('refresh', '1');
      const res = await fetch(`/api/reviews/analytics?${params}`);
      const result = await res.json();
      setData(result);
    } catch {
      // ignore
    }

    if (refresh) setRefreshing(false);
    else setLoading(false);
  }, []);

  useEffect(() => {
    loadAnalytics();
  }, [loadAnalytics]);

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 w-48 rounded-lg" style={{ backgroundColor: 'var(--bg-tertiary)' }} />
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 rounded-xl" style={{ backgroundColor: 'var(--bg-tertiary)' }} />
          ))}
        </div>
        <div className="h-64 rounded-xl" style={{ backgroundColor: 'var(--bg-tertiary)' }} />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-20">
        <BarChart3 size={40} className="mx-auto mb-4" style={{ color: 'var(--text-tertiary)' }} />
        <h3 className="text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>
          No analytics data yet
        </h3>
        <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
          Analytics will appear once you have reviews
        </p>
      </div>
    );
  }

  const defaultStats: StatsCard[] = data.stats?.length
    ? data.stats
    : [
        { label: 'Total Reviews', value: '0', change: null },
        { label: 'Avg Rating', value: '0.0', change: null },
        { label: 'Collection Rate', value: '0%', change: null },
        { label: 'Response Rate', value: '0%', change: null },
      ];

  const ratingDist = data.rating_distribution ?? [];
  const maxCount = Math.max(...ratingDist.map((r) => r.count), 1);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <BarChart3 size={20} style={{ color: 'var(--text-primary)' }} />
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
            Review Analytics
          </h2>
        </div>
        <button
          onClick={() => loadAnalytics(true)}
          disabled={refreshing}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors"
          style={{ border: '1px solid var(--border-primary)', color: 'var(--text-primary)' }}
        >
          {refreshing ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <RefreshCw size={12} />
          )}
          Refresh Analysis
        </button>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {defaultStats.map((stat, i) => (
          <div
            key={i}
            className="rounded-xl p-4"
            style={{
              backgroundColor: 'var(--bg-primary)',
              border: '1px solid var(--border-primary)',
            }}
          >
            <p className="text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>
              {stat.label}
            </p>
            <div className="flex items-end gap-2">
              <span className="text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>
                {stat.value}
              </span>
              {stat.change !== null && (
                <span
                  className="flex items-center gap-0.5 text-[11px] font-medium mb-1"
                  style={{ color: stat.change >= 0 ? '#22c55e' : '#ef4444' }}
                >
                  {stat.change >= 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                  {stat.change >= 0 ? '+' : ''}
                  {stat.change}%
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Rating Distribution */}
        <div
          className="rounded-xl p-5"
          style={{
            backgroundColor: 'var(--bg-primary)',
            border: '1px solid var(--border-primary)',
          }}
        >
          <h3 className="text-sm font-medium mb-4" style={{ color: 'var(--text-primary)' }}>
            Rating Distribution
          </h3>
          <div className="space-y-2.5">
            {[5, 4, 3, 2, 1].map((star) => {
              const entry = ratingDist.find((r) => r.star === star);
              const count = entry?.count ?? 0;
              const pct = entry?.percentage ?? 0;
              return (
                <div key={star} className="flex items-center gap-3">
                  <div className="flex items-center gap-1 w-12 flex-shrink-0">
                    <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                      {star}
                    </span>
                    <Star size={11} fill="#f59e0b" stroke="#f59e0b" />
                  </div>
                  <div className="flex-1 h-5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--bg-secondary)' }}>
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${maxCount > 0 ? (count / maxCount) * 100 : 0}%`,
                        backgroundColor: '#f59e0b',
                        minWidth: count > 0 ? '4px' : '0',
                      }}
                    />
                  </div>
                  <div className="w-16 text-right flex-shrink-0">
                    <span className="text-[11px] font-medium" style={{ color: 'var(--text-secondary)' }}>
                      {count}
                    </span>
                    <span className="text-[10px] ml-1" style={{ color: 'var(--text-tertiary)' }}>
                      ({pct}%)
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Reviews Over Time */}
        <div
          className="rounded-xl p-5"
          style={{
            backgroundColor: 'var(--bg-primary)',
            border: '1px solid var(--border-primary)',
          }}
        >
          <h3 className="text-sm font-medium mb-4" style={{ color: 'var(--text-primary)' }}>
            Reviews Over Time
          </h3>
          {data.reviews_over_time && data.reviews_over_time.length > 0 ? (
            <div style={{ width: '100%', height: 200 }}>
              <ResponsiveContainer>
                <LineChart data={data.reviews_over_time}>
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }}
                    tickLine={false}
                    axisLine={{ stroke: 'var(--border-primary)' }}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }}
                    tickLine={false}
                    axisLine={false}
                    width={30}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'var(--bg-primary)',
                      border: '1px solid var(--border-primary)',
                      borderRadius: '8px',
                      fontSize: '12px',
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="count"
                    stroke="var(--color-accent)"
                    strokeWidth={2}
                    dot={{ r: 3, fill: 'var(--color-accent)' }}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex items-center justify-center h-48">
              <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                Not enough data for chart
              </p>
            </div>
          )}
        </div>
      </div>

      {/* AI Themes */}
      {data.themes && data.themes.length > 0 && (
        <div>
          <h3 className="text-sm font-medium mb-3 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <Lightbulb size={16} /> AI Themes
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {data.themes.map((theme, i) => (
              <div
                key={i}
                className="rounded-xl p-4"
                style={{
                  backgroundColor: 'var(--bg-primary)',
                  border: '1px solid var(--border-primary)',
                }}
              >
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                    {theme.name}
                  </h4>
                  <span className="text-[10px] font-medium" style={{ color: 'var(--text-tertiary)' }}>
                    {theme.mention_count} mentions
                  </span>
                </div>
                {/* Sentiment bar */}
                <div className="mb-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                      Sentiment
                    </span>
                    <span className="text-[10px] font-medium" style={{ color: 'var(--text-secondary)' }}>
                      {theme.sentiment.toFixed(1)}/5
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--bg-secondary)' }}>
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${(theme.sentiment / 5) * 100}%`,
                        backgroundColor:
                          theme.sentiment >= 4
                            ? '#22c55e'
                            : theme.sentiment >= 3
                              ? '#f59e0b'
                              : '#ef4444',
                      }}
                    />
                  </div>
                </div>
                {/* Quotes */}
                {theme.quotes && theme.quotes.length > 0 && (
                  <div className="space-y-1.5">
                    {theme.quotes.slice(0, 2).map((quote, qi) => (
                      <p
                        key={qi}
                        className="text-[11px] italic leading-relaxed pl-2"
                        style={{
                          color: 'var(--text-tertiary)',
                          borderLeft: '2px solid var(--border-primary)',
                        }}
                      >
                        &quot;{quote}&quot;
                      </p>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Action Items */}
      {data.action_items && data.action_items.length > 0 && (
        <div>
          <h3 className="text-sm font-medium mb-3 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <AlertTriangle size={16} /> Action Items
          </h3>
          <div className="space-y-3">
            {data.action_items.map((item, i) => {
              const pStyle = PRIORITY_COLORS[item.priority] || PRIORITY_COLORS.low;
              return (
                <div
                  key={i}
                  className="rounded-xl p-4"
                  style={{
                    backgroundColor: pStyle.bg,
                    border: `1px solid ${pStyle.border}`,
                  }}
                >
                  <div className="flex items-start gap-3">
                    <span
                      className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded mt-0.5 flex-shrink-0"
                      style={{
                        backgroundColor: pStyle.color,
                        color: '#ffffff',
                      }}
                    >
                      {item.priority}
                    </span>
                    <div className="flex-1 min-w-0">
                      <h4 className="text-sm font-medium mb-0.5" style={{ color: 'var(--text-primary)' }}>
                        {item.title}
                      </h4>
                      <p className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>
                        {item.description}
                      </p>
                      {item.evidence && (
                        <p className="text-[11px] italic" style={{ color: 'var(--text-tertiary)' }}>
                          Evidence: {item.evidence}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
