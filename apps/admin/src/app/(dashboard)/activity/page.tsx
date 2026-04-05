'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Activity, RefreshCw, Wifi, WifiOff, Clock,
  CheckCircle2, XCircle, Info, Package, Mail, ShoppingCart,
  Zap,
} from 'lucide-react';

interface ActivityEvent {
  id: number;
  timestamp: string;
  type: string;
  status: 'success' | 'error' | 'info';
  summary: string;
  details?: Record<string, unknown>;
}

interface ActivityData {
  events: ActivityEvent[];
  counts: Record<string, number>;
  serverUptime: number;
}

const TYPE_CONFIG: Record<string, { icon: typeof Activity; color: string; label: string }> = {
  'webhook.products': { icon: Package, color: '#6366f1', label: 'Product Sync' },
  'webhook.orders': { icon: ShoppingCart, color: '#3b82f6', label: 'Order Webhook' },
  'email.sent': { icon: Mail, color: '#22c55e', label: 'Email Sent' },
  'email.failed': { icon: Mail, color: '#ef4444', label: 'Email Failed' },
  'review.submitted': { icon: Zap, color: '#eab308', label: 'Review Submitted' },
  'review.scheduled': { icon: Clock, color: '#f59e0b', label: 'Review Scheduled' },
};

const STATUS_ICON: Record<string, typeof CheckCircle2> = {
  success: CheckCircle2,
  error: XCircle,
  info: Info,
};

const STATUS_COLOR: Record<string, string> = {
  success: '#22c55e',
  error: '#ef4444',
  info: '#6366f1',
};

function formatTime(ts: string): string {
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  if (diffMs < 60000) return `${Math.floor(diffMs / 1000)}s ago`;
  if (diffMs < 3600000) return `${Math.floor(diffMs / 60000)}m ago`;
  if (diffMs < 86400000) return `${Math.floor(diffMs / 3600000)}h ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

export default function ActivityPage() {
  const [data, setData] = useState<ActivityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/activity?limit=200');
      const json = await res.json();
      setData(json);
    } catch {
      // Silently fail on refresh
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchData]);

  const events = data?.events ?? [];
  const filteredEvents = filter === 'all'
    ? events
    : events.filter((e) => e.type.startsWith(filter) || e.status === filter);

  const webhookCount = events.filter((e) => e.type.startsWith('webhook')).length;
  const emailCount = events.filter((e) => e.type.startsWith('email')).length;
  const errorCount = events.filter((e) => e.status === 'error').length;
  const successCount = events.filter((e) => e.status === 'success').length;

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 w-48 rounded-lg" style={{ backgroundColor: 'var(--bg-tertiary)' }} />
        <div className="h-64 rounded-xl" style={{ backgroundColor: 'var(--bg-tertiary)' }} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
            System Activity
          </h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
            Live webhook events, email sends, and system health
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors"
            style={{
              backgroundColor: autoRefresh ? 'rgba(34,197,94,0.10)' : 'var(--bg-secondary)',
              color: autoRefresh ? '#22c55e' : 'var(--text-tertiary)',
              border: `1px solid ${autoRefresh ? 'rgba(34,197,94,0.25)' : 'var(--border-primary)'}`,
            }}
          >
            {autoRefresh ? <Wifi size={12} /> : <WifiOff size={12} />}
            {autoRefresh ? 'Live' : 'Paused'}
          </button>
          <button
            onClick={fetchData}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors"
            style={{
              backgroundColor: 'var(--bg-secondary)',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border-primary)',
            }}
          >
            <RefreshCw size={12} /> Refresh
          </button>
        </div>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: 'Total Events', value: events.length, color: 'var(--text-primary)', icon: Activity },
          { label: 'Webhooks', value: webhookCount, color: '#6366f1', icon: Package },
          { label: 'Emails', value: emailCount, color: '#3b82f6', icon: Mail },
          { label: 'Errors', value: errorCount, color: '#ef4444', icon: XCircle },
          { label: 'Server Uptime', value: formatUptime(data?.serverUptime ?? 0), color: '#22c55e', icon: Clock },
        ].map((stat) => {
          const Icon = stat.icon;
          return (
            <div
              key={stat.label}
              className="rounded-xl p-4"
              style={{
                backgroundColor: 'var(--bg-primary)',
                border: '1px solid var(--border-primary)',
              }}
            >
              <div className="flex items-center gap-2 mb-1">
                <Icon size={14} style={{ color: stat.color }} />
                <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>{stat.label}</span>
              </div>
              <p className="text-xl font-bold" style={{ color: stat.color }}>
                {stat.value}
              </p>
            </div>
          );
        })}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        {[
          { key: 'all', label: 'All', count: events.length },
          { key: 'webhook', label: 'Webhooks', count: webhookCount, color: '#6366f1' },
          { key: 'email', label: 'Emails', count: emailCount, color: '#3b82f6' },
          { key: 'success', label: 'Success', count: successCount, color: '#22c55e' },
          { key: 'error', label: 'Errors', count: errorCount, color: '#ef4444' },
        ].map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className="text-[11px] font-medium px-3 py-1.5 rounded-full transition-colors"
            style={{
              backgroundColor: filter === f.key
                ? (f.color ? `color-mix(in srgb, ${f.color} 15%, var(--bg-primary))` : 'var(--bg-tertiary)')
                : 'var(--bg-secondary)',
              color: filter === f.key ? (f.color || 'var(--text-primary)') : 'var(--text-tertiary)',
              border: filter === f.key
                ? `1px solid ${f.color || 'var(--border-primary)'}`
                : '1px solid var(--border-secondary)',
            }}
          >
            {f.label}{f.count > 0 ? ` (${f.count})` : ''}
          </button>
        ))}
      </div>

      {/* Event list */}
      <div
        className="rounded-xl overflow-hidden"
        style={{
          backgroundColor: 'var(--bg-primary)',
          border: '1px solid var(--border-primary)',
        }}
      >
        {filteredEvents.length === 0 ? (
          <div className="py-16 text-center">
            <Activity size={32} style={{ color: 'var(--text-tertiary)', margin: '0 auto 8px' }} />
            <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
              {events.length === 0 ? 'No events yet' : 'No matching events'}
            </p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
              {events.length === 0
                ? 'Events will appear here when Shopify sends webhooks, emails are processed, or reviews are submitted. The log resets on server restart.'
                : 'Try a different filter.'}
            </p>
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: 'var(--border-secondary)' }}>
            {filteredEvents.map((event) => {
              const typeConfig = TYPE_CONFIG[event.type] || { icon: Activity, color: 'var(--text-tertiary)', label: event.type };
              const TypeIcon = typeConfig.icon;
              const StatusIcon = STATUS_ICON[event.status] || Info;
              const statusColor = STATUS_COLOR[event.status] || 'var(--text-tertiary)';

              return (
                <div
                  key={event.id}
                  className="flex items-start gap-3 px-5 py-3 hover:bg-[var(--bg-secondary)] transition-colors"
                >
                  {/* Status dot */}
                  <div className="mt-1 flex-shrink-0">
                    <StatusIcon size={14} style={{ color: statusColor }} />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span
                        className="text-[10px] font-medium px-2 py-0.5 rounded-full flex-shrink-0"
                        style={{ backgroundColor: `color-mix(in srgb, ${typeConfig.color} 12%, transparent)`, color: typeConfig.color }}
                      >
                        <TypeIcon size={10} className="inline mr-1" style={{ verticalAlign: '-1px' }} />
                        {typeConfig.label}
                      </span>
                      <span className="text-[11px] truncate" style={{ color: 'var(--text-primary)' }}>
                        {event.summary}
                      </span>
                    </div>
                    {event.details && Object.keys(event.details).length > 0 && (
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                        {Object.entries(event.details).map(([key, val]) => (
                          <span key={key} className="text-[10px] font-mono" style={{ color: 'var(--text-tertiary)' }}>
                            {key}={String(val)}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Timestamp */}
                  <div className="flex-shrink-0 text-right">
                    <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                      {formatTime(event.timestamp)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
