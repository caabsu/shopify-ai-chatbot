'use client';

import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Wifi, WifiOff, CheckCircle, XCircle, Clock, Package } from 'lucide-react';

interface RmaSyncLogEntry {
  id: string;
  delivery_id: string;
  order_number: string | null;
  customer_name: string | null;
  status: string;
  processed_at: string | null;
  refund_amount: number | null;
  refund_processed: boolean;
  refund_processed_at: string | null;
  return_request_id: string | null;
  shopify_refund_id: string | null;
  error: string | null;
  brand_id: string;
  created_at: string;
  updated_at: string;
}

interface ConnectionStatus {
  connected: boolean | null;
  message?: string;
  loading: boolean;
}

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  new: { bg: 'rgba(156,163,175,0.12)', text: '#9ca3af' },
  accepting: { bg: 'rgba(245,158,11,0.12)', text: '#f59e0b' },
  accepted: { bg: 'rgba(245,158,11,0.12)', text: '#f59e0b' },
  processing: { bg: 'rgba(99,102,241,0.12)', text: '#6366f1' },
  processed: { bg: 'rgba(59,130,246,0.12)', text: '#3b82f6' },
  putting_away: { bg: 'rgba(168,85,247,0.12)', text: '#a855f7' },
  put_away: { bg: 'rgba(168,85,247,0.12)', text: '#a855f7' },
  complete: { bg: 'rgba(34,197,94,0.12)', text: '#22c55e' },
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

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function RmaPage() {
  const [entries, setEntries] = useState<RmaSyncLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [lastSynced, setLastSynced] = useState<Date | null>(null);
  const [connection, setConnection] = useState<ConnectionStatus>({ connected: null, loading: true });
  const [syncResult, setSyncResult] = useState<{
    summary?: { synced: number; refunded: number; skipped: number; errors: number; dryRun: boolean };
    error?: string;
  } | null>(null);

  const loadEntries = useCallback(async () => {
    try {
      const res = await fetch('/api/returns/rma?limit=100');
      if (!res.ok) return;
      const data = await res.json() as { entries: RmaSyncLogEntry[] };
      setEntries(data.entries ?? []);
      setLastSynced(new Date());
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  const checkConnection = useCallback(async () => {
    setConnection({ connected: null, loading: true });
    try {
      const res = await fetch('/api/returns/rma?action=test-connection');
      const data = await res.json() as { connected: boolean; message?: string };
      setConnection({ connected: data.connected, message: data.message, loading: false });
    } catch {
      setConnection({ connected: false, message: 'Could not reach backend', loading: false });
    }
  }, []);

  const triggerSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch('/api/returns/rma', { method: 'POST' });
      const data = await res.json() as { success?: boolean; summary?: RmaSyncLogEntry; error?: string };
      if (res.ok) {
        setSyncResult({ summary: data.summary as unknown as { synced: number; refunded: number; skipped: number; errors: number; dryRun: boolean } });
        await loadEntries();
      } else {
        setSyncResult({ error: data.error || 'Sync failed' });
      }
    } catch (err) {
      setSyncResult({ error: err instanceof Error ? err.message : 'Sync failed' });
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    loadEntries();
    checkConnection();
  }, [loadEntries, checkConnection]);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      loadEntries();
    }, 30 * 1000);
    return () => clearInterval(interval);
  }, [loadEntries]);

  const totalRefunded = entries.filter((e) => e.refund_processed).length;
  const totalPending = entries.filter((e) => !e.refund_processed && !e.error).length;
  const totalErrors = entries.filter((e) => !!e.error).length;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Package size={20} style={{ color: 'var(--text-primary)' }} />
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
            Red Stag RMA Sync
          </h2>
          {lastSynced && (
            <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              Updated {timeAgo(lastSynced.toISOString())}
            </span>
          )}
        </div>
        <button
          onClick={triggerSync}
          disabled={syncing}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
          style={{
            backgroundColor: 'var(--color-accent)',
            color: '#fff',
          }}
        >
          <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
          {syncing ? 'Syncing...' : 'Sync Now'}
        </button>
      </div>

      {/* Connection Status + Stats Row */}
      <div className="grid grid-cols-4 gap-4">
        {/* Connection Status */}
        <div
          className="rounded-xl p-4"
          style={{
            backgroundColor: 'var(--bg-primary)',
            border: '1px solid var(--border-primary)',
            boxShadow: 'var(--shadow-sm)',
          }}
        >
          <div className="flex items-center gap-2 mb-2">
            {connection.loading ? (
              <Clock size={16} style={{ color: 'var(--text-tertiary)' }} />
            ) : connection.connected ? (
              <Wifi size={16} style={{ color: '#22c55e' }} />
            ) : (
              <WifiOff size={16} style={{ color: '#ef4444' }} />
            )}
            <span className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
              Red Stag API
            </span>
          </div>
          <p
            className="text-sm font-semibold"
            style={{
              color: connection.loading
                ? 'var(--text-secondary)'
                : connection.connected
                ? '#22c55e'
                : '#ef4444',
            }}
          >
            {connection.loading ? 'Checking...' : connection.connected ? 'Connected' : 'Disconnected'}
          </p>
          <button
            onClick={checkConnection}
            className="mt-2 text-[11px]"
            style={{ color: 'var(--text-tertiary)', background: 'none', border: 'none', cursor: 'pointer' }}
          >
            Re-check
          </button>
        </div>

        {/* Stats */}
        {[
          { label: 'Total RMAs', value: entries.length, color: 'var(--text-primary)' },
          { label: 'Refunded', value: totalRefunded, color: '#22c55e' },
          { label: 'Pending', value: totalPending, color: '#f59e0b' },
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
            <p className="text-xs font-medium uppercase tracking-wider mb-2" style={{ color: 'var(--text-tertiary)' }}>
              {stat.label}
            </p>
            <p className="text-2xl font-bold" style={{ color: stat.color }}>
              {stat.value}
            </p>
          </div>
        ))}
      </div>

      {/* Sync Result Banner */}
      {syncResult && (
        <div
          className="rounded-xl p-4"
          style={{
            backgroundColor: syncResult.error ? 'rgba(239,68,68,0.08)' : 'rgba(34,197,94,0.08)',
            border: `1px solid ${syncResult.error ? 'rgba(239,68,68,0.2)' : 'rgba(34,197,94,0.2)'}`,
          }}
        >
          {syncResult.error ? (
            <div className="flex items-center gap-2">
              <XCircle size={16} style={{ color: '#ef4444' }} />
              <span className="text-sm" style={{ color: '#ef4444' }}>
                Sync failed: {syncResult.error}
              </span>
            </div>
          ) : syncResult.summary ? (
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <CheckCircle size={16} style={{ color: '#22c55e' }} />
                <span className="text-sm font-medium" style={{ color: '#22c55e' }}>
                  Sync complete{syncResult.summary.dryRun ? ' (DRY RUN)' : ''}
                </span>
              </div>
              <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                {syncResult.summary.synced} synced &middot;{' '}
                {syncResult.summary.refunded} refunded &middot;{' '}
                {syncResult.summary.skipped} skipped &middot;{' '}
                {syncResult.summary.errors} errors
              </span>
            </div>
          ) : null}
        </div>
      )}

      {/* Main Table */}
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
            <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>Loading sync log...</p>
          </div>
        ) : entries.length === 0 ? (
          <div className="p-12 text-center">
            <Package size={32} className="mx-auto mb-3" style={{ color: 'var(--text-tertiary)' }} />
            <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>No RMA records yet</p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
              Records appear here after the first sync runs
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-secondary)' }}>
                  {['Order #', 'Customer', 'Delivery ID', 'RMA Status', 'Refund Amount', 'Refunded', 'Last Updated'].map((h) => (
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
                {entries.map((entry) => {
                  const statusColor = STATUS_COLORS[entry.status] ?? { bg: 'rgba(156,163,175,0.12)', text: '#9ca3af' };
                  return (
                    <tr
                      key={entry.id}
                      className="transition-colors"
                      style={{ borderBottom: '1px solid var(--border-secondary)' }}
                      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-hover)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                    >
                      {/* Order # */}
                      <td className="px-4 py-3">
                        {entry.order_number ? (
                          <span className="font-mono text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                            #{entry.order_number}
                          </span>
                        ) : (
                          <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>—</span>
                        )}
                      </td>

                      {/* Customer */}
                      <td className="px-4 py-3">
                        <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                          {entry.customer_name || '—'}
                        </span>
                      </td>

                      {/* Delivery ID */}
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs" style={{ color: 'var(--text-tertiary)' }}>
                          {entry.delivery_id}
                        </span>
                      </td>

                      {/* RMA Status */}
                      <td className="px-4 py-3">
                        <span
                          className="inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-full"
                          style={{ backgroundColor: statusColor.bg, color: statusColor.text }}
                        >
                          {entry.status}
                        </span>
                      </td>

                      {/* Refund Amount */}
                      <td className="px-4 py-3">
                        {entry.refund_amount != null ? (
                          <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                            ${entry.refund_amount.toFixed(2)}
                          </span>
                        ) : (
                          <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>—</span>
                        )}
                      </td>

                      {/* Refunded */}
                      <td className="px-4 py-3">
                        {entry.error ? (
                          <div className="flex items-center gap-1.5" title={entry.error}>
                            <XCircle size={14} style={{ color: '#ef4444' }} />
                            <span className="text-xs max-w-[140px] truncate" style={{ color: '#ef4444' }}>
                              {entry.error}
                            </span>
                          </div>
                        ) : entry.refund_processed ? (
                          <div className="flex items-center gap-1.5">
                            <CheckCircle size={14} style={{ color: '#22c55e' }} />
                            <span className="text-xs" style={{ color: '#22c55e' }}>
                              {formatDate(entry.refund_processed_at)}
                            </span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <Clock size={14} style={{ color: 'var(--text-tertiary)' }} />
                            <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Pending</span>
                          </div>
                        )}
                      </td>

                      {/* Last Updated */}
                      <td className="px-4 py-3">
                        <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                          {timeAgo(entry.updated_at)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Footer note */}
      <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
        Sync runs automatically every 15 minutes. RMAs with status &quot;processed&quot; or &quot;complete&quot; trigger a Shopify refund.
        {process.env.NEXT_PUBLIC_RMA_DRY_RUN === 'true' && (
          <span style={{ color: '#f59e0b' }}> DRY RUN mode active — no refunds are actually processed.</span>
        )}
      </p>
    </div>
  );
}
