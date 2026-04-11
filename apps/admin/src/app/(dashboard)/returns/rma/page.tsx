'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { RefreshCw, Wifi, WifiOff, CheckCircle, XCircle, Clock, Package, Mail, ExternalLink } from 'lucide-react';

interface RmaSyncLogEntry {
  id: string;
  delivery_id: string;
  increment_id: string | null;
  order_number: string | null;
  customer_name: string | null;
  customer_email: string | null;
  order_total: number | null;
  line_items_summary: string | null;
  fulfillment_status: string | null;
  shopify_order_id: string | null;
  status: string;
  rma_state: string | null;
  processed_at: string | null;
  refund_amount: number | null;
  refund_processed: boolean;
  refund_processed_at: string | null;
  return_request_id: string | null;
  shopify_refund_id: string | null;
  sku_details: Array<{ sku: string; qty: number; qty_expected?: number; qty_received?: number; qty_processed?: number; qty_shortage?: number; qty_overage?: number }> | null;
  tracking_numbers: string[] | null;
  carrier_name: string | null;
  shopify_refund_status: string | null;
  rma_created_at: string | null;
  rma_delivered_at: string | null;
  rma_completed_at: string | null;
  warehouse_id: string | null;
  exceptions: Array<{ reason: string; comment: string | null; status: string; qty: string; sku?: string }> | null;
  status_history: Array<{ status: string; comment: string | null; created_at: string }> | null;
  containers: Array<{ weight: string; weight_unit: string; damage_type: string; notes: string | null }> | null;
  sender_ref_alt: string | null;
  match_method: string | null;
  weight_info: { total_weight: string; weight_unit: string } | null;
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
  ready_to_process: { bg: 'rgba(14,165,233,0.12)', text: '#0ea5e9' },
  processing: { bg: 'rgba(99,102,241,0.12)', text: '#6366f1' },
  processing_exception: { bg: 'rgba(239,68,68,0.12)', text: '#ef4444' },
  processed: { bg: 'rgba(59,130,246,0.12)', text: '#3b82f6' },
  putting_away: { bg: 'rgba(168,85,247,0.12)', text: '#a855f7' },
  put_away: { bg: 'rgba(168,85,247,0.12)', text: '#a855f7' },
  complete: { bg: 'rgba(34,197,94,0.12)', text: '#22c55e' },
};

const FULFILLMENT_COLORS: Record<string, { bg: string; text: string }> = {
  FULFILLED: { bg: 'rgba(34,197,94,0.12)', text: '#22c55e' },
  PARTIALLY_FULFILLED: { bg: 'rgba(245,158,11,0.12)', text: '#f59e0b' },
  UNFULFILLED: { bg: 'rgba(156,163,175,0.12)', text: '#9ca3af' },
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

function daysSince(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24));
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '\u2014';
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
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
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
      <div className="grid grid-cols-5 gap-4">
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
          { label: 'Errors', value: totalErrors, color: '#ef4444' },
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
                {(syncResult.summary as Record<string, number>).matched ?? 0} matched &middot;{' '}
                {(syncResult.summary as Record<string, number>).unmatched ?? 0} unmatched &middot;{' '}
                {syncResult.summary.refunded} refunded &middot;{' '}
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
                  {['Order #', 'Customer', 'Email', 'Order Total', 'Fulfillment', 'RMA Status', 'Match', 'Age', 'Refund', 'Status', 'Updated'].map((h) => (
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
                  const fulfillmentColor = entry.fulfillment_status
                    ? FULFILLMENT_COLORS[entry.fulfillment_status] ?? { bg: 'rgba(156,163,175,0.12)', text: '#9ca3af' }
                    : null;
                  const age = daysSince(entry.rma_created_at || entry.created_at);
                  const isExpanded = expandedRow === entry.id;

                  return (
                    <>
                      <tr
                        key={entry.id}
                        className="transition-colors cursor-pointer"
                        style={{ borderBottom: '1px solid var(--border-secondary)' }}
                        onClick={() => setExpandedRow(isExpanded ? null : entry.id)}
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
                            <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{'\u2014'}</span>
                          )}
                        </td>

                        {/* Customer */}
                        <td className="px-4 py-3">
                          <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                            {entry.customer_name || '\u2014'}
                          </span>
                        </td>

                        {/* Email */}
                        <td className="px-4 py-3">
                          {entry.customer_email ? (
                            <span className="text-xs flex items-center gap-1" style={{ color: 'var(--text-secondary)' }}>
                              <Mail size={10} />
                              {entry.customer_email}
                            </span>
                          ) : (
                            <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{'\u2014'}</span>
                          )}
                        </td>

                        {/* Order Total */}
                        <td className="px-4 py-3">
                          {entry.order_total != null ? (
                            <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                              ${entry.order_total.toFixed(2)}
                            </span>
                          ) : (
                            <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{'\u2014'}</span>
                          )}
                        </td>

                        {/* Fulfillment Status */}
                        <td className="px-4 py-3">
                          {fulfillmentColor ? (
                            <span
                              className="inline-flex items-center text-[10px] font-medium px-2 py-0.5 rounded-full"
                              style={{ backgroundColor: fulfillmentColor.bg, color: fulfillmentColor.text }}
                            >
                              {entry.fulfillment_status!.replace(/_/g, ' ')}
                            </span>
                          ) : (
                            <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{'\u2014'}</span>
                          )}
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

                        {/* Match Method */}
                        <td className="px-4 py-3">
                          {entry.match_method && entry.match_method !== 'none' ? (
                            <span
                              className="inline-flex items-center text-[10px] font-medium px-2 py-0.5 rounded-full"
                              style={{
                                backgroundColor: entry.match_method === 'order_number' ? 'rgba(34,197,94,0.12)' : 'rgba(99,102,241,0.12)',
                                color: entry.match_method === 'order_number' ? '#22c55e' : '#6366f1',
                              }}
                            >
                              {entry.match_method.replace(/_/g, ' ')}
                            </span>
                          ) : (
                            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ backgroundColor: 'rgba(239,68,68,0.12)', color: '#ef4444' }}>
                              unmatched
                            </span>
                          )}
                        </td>

                        {/* Age */}
                        <td className="px-4 py-3">
                          <span
                            className="text-xs font-medium"
                            style={{ color: age > 7 ? '#ef4444' : age > 3 ? '#f59e0b' : 'var(--text-secondary)' }}
                          >
                            {age}d
                          </span>
                        </td>

                        {/* Refund Amount */}
                        <td className="px-4 py-3">
                          {entry.refund_amount != null ? (
                            <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                              ${entry.refund_amount.toFixed(2)}
                            </span>
                          ) : (
                            <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{'\u2014'}</span>
                          )}
                        </td>

                        {/* Refunded */}
                        <td className="px-4 py-3">
                          {entry.error ? (
                            <div className="flex items-center gap-1.5" title={entry.error}>
                              <XCircle size={14} style={{ color: '#ef4444' }} />
                              <span className="text-xs max-w-[100px] truncate" style={{ color: '#ef4444' }}>
                                Error
                              </span>
                            </div>
                          ) : entry.refund_processed ? (
                            <div className="flex items-center gap-1.5">
                              <CheckCircle size={14} style={{ color: '#22c55e' }} />
                              <span className="text-xs" style={{ color: '#22c55e' }}>Done</span>
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

                      {/* Expanded row */}
                      {isExpanded && (
                        <tr key={`${entry.id}-expanded`} style={{ borderBottom: '1px solid var(--border-secondary)' }}>
                          <td colSpan={11} className="px-4 py-4" style={{ backgroundColor: 'var(--bg-secondary)' }}>
                            <div className="grid grid-cols-4 gap-4 text-xs">
                              {/* Order Info */}
                              <div>
                                <p className="font-semibold mb-1 uppercase tracking-wider text-[10px]" style={{ color: 'var(--text-tertiary)' }}>Order Number</p>
                                <p className="font-mono font-medium" style={{ color: 'var(--text-primary)' }}>
                                  {entry.order_number ? `#${entry.order_number}` : '\u2014'}
                                </p>
                                {entry.sender_ref_alt && entry.sender_ref_alt !== entry.order_number && (
                                  <p className="mt-0.5 text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                                    Raw ref: {entry.sender_ref_alt}
                                  </p>
                                )}
                              </div>
                              <div>
                                <p className="font-semibold mb-1 uppercase tracking-wider text-[10px]" style={{ color: 'var(--text-tertiary)' }}>Customer</p>
                                <p style={{ color: 'var(--text-primary)' }}>{entry.customer_name || '\u2014'}</p>
                                {entry.customer_email && (
                                  <p className="mt-0.5" style={{ color: 'var(--text-secondary)' }}>{entry.customer_email}</p>
                                )}
                              </div>
                              <div>
                                <p className="font-semibold mb-1 uppercase tracking-wider text-[10px]" style={{ color: 'var(--text-tertiary)' }}>Order Total</p>
                                <p className="font-medium" style={{ color: 'var(--text-primary)' }}>
                                  {entry.order_total != null ? `$${entry.order_total.toFixed(2)}` : '\u2014'}
                                </p>
                              </div>
                              <div>
                                <p className="font-semibold mb-1 uppercase tracking-wider text-[10px]" style={{ color: 'var(--text-tertiary)' }}>Match Method</p>
                                <span
                                  className="inline-flex items-center text-[10px] font-medium px-2 py-0.5 rounded-full"
                                  style={{
                                    backgroundColor: !entry.match_method || entry.match_method === 'none'
                                      ? 'rgba(239,68,68,0.12)' : entry.match_method === 'order_number'
                                      ? 'rgba(34,197,94,0.12)' : 'rgba(99,102,241,0.12)',
                                    color: !entry.match_method || entry.match_method === 'none'
                                      ? '#ef4444' : entry.match_method === 'order_number'
                                      ? '#22c55e' : '#6366f1',
                                  }}
                                >
                                  {entry.match_method?.replace(/_/g, ' ') || 'unmatched'}
                                </span>
                              </div>

                              {/* Warehouse & Shipping */}
                              <div>
                                <p className="font-semibold mb-1 uppercase tracking-wider text-[10px]" style={{ color: 'var(--text-tertiary)' }}>Delivery ID</p>
                                <p className="font-mono" style={{ color: 'var(--text-primary)' }}>{entry.delivery_id}</p>
                                {entry.increment_id && (
                                  <p className="mt-0.5 text-[10px]" style={{ color: 'var(--text-tertiary)' }}>Inc: {entry.increment_id}</p>
                                )}
                              </div>
                              <div>
                                <p className="font-semibold mb-1 uppercase tracking-wider text-[10px]" style={{ color: 'var(--text-tertiary)' }}>Warehouse</p>
                                <p style={{ color: 'var(--text-primary)' }}>{entry.warehouse_id ? `WH-${entry.warehouse_id}` : '\u2014'}</p>
                                {entry.carrier_name && (
                                  <p className="mt-0.5" style={{ color: 'var(--text-secondary)' }}>{entry.carrier_name}</p>
                                )}
                              </div>
                              <div>
                                <p className="font-semibold mb-1 uppercase tracking-wider text-[10px]" style={{ color: 'var(--text-tertiary)' }}>Tracking</p>
                                {entry.tracking_numbers?.map((tn, i) => (
                                  <p key={i} className="font-mono text-[10px]" style={{ color: 'var(--text-primary)' }}>{tn}</p>
                                )) || <p style={{ color: 'var(--text-tertiary)' }}>{'\u2014'}</p>}
                              </div>
                              <div>
                                <p className="font-semibold mb-1 uppercase tracking-wider text-[10px]" style={{ color: 'var(--text-tertiary)' }}>Weight</p>
                                <p style={{ color: 'var(--text-primary)' }}>
                                  {entry.weight_info ? `${entry.weight_info.total_weight} ${entry.weight_info.weight_unit}` : '\u2014'}
                                </p>
                              </div>

                              {/* Timeline */}
                              <div>
                                <p className="font-semibold mb-1 uppercase tracking-wider text-[10px]" style={{ color: 'var(--text-tertiary)' }}>RMA Created</p>
                                <p style={{ color: 'var(--text-secondary)' }}>{formatDate(entry.rma_created_at)}</p>
                              </div>
                              <div>
                                <p className="font-semibold mb-1 uppercase tracking-wider text-[10px]" style={{ color: 'var(--text-tertiary)' }}>Delivered to WH</p>
                                <p style={{ color: 'var(--text-secondary)' }}>{formatDate(entry.rma_delivered_at)}</p>
                              </div>
                              <div>
                                <p className="font-semibold mb-1 uppercase tracking-wider text-[10px]" style={{ color: 'var(--text-tertiary)' }}>Processed</p>
                                <p style={{ color: 'var(--text-secondary)' }}>{formatDate(entry.processed_at)}</p>
                              </div>
                              <div>
                                <p className="font-semibold mb-1 uppercase tracking-wider text-[10px]" style={{ color: 'var(--text-tertiary)' }}>RMA Status</p>
                                <span
                                  className="inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-full"
                                  style={{ backgroundColor: statusColor.bg, color: statusColor.text }}
                                >
                                  {entry.status}
                                </span>
                                {entry.rma_state && entry.rma_state !== entry.status && (
                                  <span className="ml-1 text-[10px]" style={{ color: 'var(--text-tertiary)' }}>({entry.rma_state})</span>
                                )}
                              </div>

                              {/* Line Items */}
                              <div className="col-span-4">
                                <p className="font-semibold mb-1 uppercase tracking-wider text-[10px]" style={{ color: 'var(--text-tertiary)' }}>Shopify Line Items</p>
                                <p style={{ color: 'var(--text-secondary)' }}>{entry.line_items_summary || '\u2014'}</p>
                              </div>

                              {/* SKU Details */}
                              {entry.sku_details && entry.sku_details.length > 0 && (
                                <div className="col-span-4">
                                  <p className="font-semibold mb-2 uppercase tracking-wider text-[10px]" style={{ color: 'var(--text-tertiary)' }}>Warehouse SKU Details (Red Stag)</p>
                                  <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--border-primary)' }}>
                                    <table className="w-full text-xs">
                                      <thead>
                                        <tr style={{ backgroundColor: 'var(--bg-tertiary)', borderBottom: '1px solid var(--border-primary)' }}>
                                          <th className="text-left px-3 py-1.5 font-semibold" style={{ color: 'var(--text-tertiary)' }}>SKU</th>
                                          <th className="text-left px-3 py-1.5 font-semibold" style={{ color: 'var(--text-tertiary)' }}>Expected</th>
                                          <th className="text-left px-3 py-1.5 font-semibold" style={{ color: 'var(--text-tertiary)' }}>Received</th>
                                          <th className="text-left px-3 py-1.5 font-semibold" style={{ color: 'var(--text-tertiary)' }}>Processed</th>
                                          <th className="text-left px-3 py-1.5 font-semibold" style={{ color: 'var(--text-tertiary)' }}>Shortage</th>
                                          <th className="text-left px-3 py-1.5 font-semibold" style={{ color: 'var(--text-tertiary)' }}>Overage</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {entry.sku_details.map((sku, idx) => (
                                          <tr key={idx} style={{ borderBottom: idx < entry.sku_details!.length - 1 ? '1px solid var(--border-secondary)' : 'none' }}>
                                            <td className="px-3 py-1.5 font-mono font-medium" style={{ color: 'var(--text-primary)' }}>{sku.sku || '\u2014'}</td>
                                            <td className="px-3 py-1.5" style={{ color: 'var(--text-secondary)' }}>{sku.qty_expected ?? sku.qty}</td>
                                            <td className="px-3 py-1.5" style={{ color: 'var(--text-secondary)' }}>{sku.qty_received ?? '\u2014'}</td>
                                            <td className="px-3 py-1.5" style={{ color: 'var(--text-secondary)' }}>{sku.qty_processed ?? '\u2014'}</td>
                                            <td className="px-3 py-1.5" style={{ color: (sku.qty_shortage ?? 0) > 0 ? '#ef4444' : 'var(--text-secondary)' }}>{sku.qty_shortage ?? '\u2014'}</td>
                                            <td className="px-3 py-1.5" style={{ color: (sku.qty_overage ?? 0) > 0 ? '#f59e0b' : 'var(--text-secondary)' }}>{sku.qty_overage ?? '\u2014'}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              )}

                              {/* Exceptions (damage reports, shortages) */}
                              {entry.exceptions && entry.exceptions.length > 0 && (
                                <div className="col-span-4">
                                  <p className="font-semibold mb-2 uppercase tracking-wider text-[10px]" style={{ color: '#f59e0b' }}>Warehouse Exceptions</p>
                                  <div className="space-y-1.5">
                                    {entry.exceptions.map((exc, idx) => (
                                      <div key={idx} className="rounded-lg px-3 py-2" style={{ backgroundColor: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.15)' }}>
                                        <div className="flex items-center gap-2">
                                          <span className="font-medium" style={{ color: '#f59e0b' }}>{exc.reason.replace(/_/g, ' ')}</span>
                                          {exc.sku && <span className="font-mono text-[10px]" style={{ color: 'var(--text-tertiary)' }}>{exc.sku}</span>}
                                          <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: exc.status === 'approved' ? 'rgba(34,197,94,0.12)' : 'rgba(156,163,175,0.12)', color: exc.status === 'approved' ? '#22c55e' : '#9ca3af' }}>{exc.status}</span>
                                          <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>qty: {exc.qty}</span>
                                        </div>
                                        {exc.comment && <p className="mt-1" style={{ color: 'var(--text-secondary)' }}>{exc.comment}</p>}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* Status Timeline */}
                              {entry.status_history && entry.status_history.length > 0 && (
                                <div className="col-span-4">
                                  <p className="font-semibold mb-2 uppercase tracking-wider text-[10px]" style={{ color: 'var(--text-tertiary)' }}>Status Timeline</p>
                                  <div className="flex flex-wrap gap-1.5">
                                    {entry.status_history
                                      .filter((h, i, arr) => i === 0 || h.status !== arr[i - 1].status)
                                      .map((h, idx) => {
                                        const sc = STATUS_COLORS[h.status] ?? { bg: 'rgba(156,163,175,0.12)', text: '#9ca3af' };
                                        return (
                                          <div key={idx} className="flex items-center gap-1">
                                            <span className="inline-flex items-center text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ backgroundColor: sc.bg, color: sc.text }}>
                                              {h.status.replace(/_/g, ' ')}
                                            </span>
                                            <span className="text-[9px]" style={{ color: 'var(--text-tertiary)' }}>
                                              {new Date(h.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                            </span>
                                            {idx < entry.status_history!.filter((h2, i2, a2) => i2 === 0 || h2.status !== a2[i2 - 1].status).length - 1 && (
                                              <span style={{ color: 'var(--text-tertiary)' }}>{'\u2192'}</span>
                                            )}
                                          </div>
                                        );
                                      })}
                                  </div>
                                </div>
                              )}

                              {/* Refund Details */}
                              <div className="col-span-2">
                                <p className="font-semibold mb-1 uppercase tracking-wider text-[10px]" style={{ color: 'var(--text-tertiary)' }}>Refund Amount</p>
                                <p className="font-medium" style={{ color: entry.refund_amount != null ? '#22c55e' : 'var(--text-tertiary)' }}>
                                  {entry.refund_amount != null ? `$${entry.refund_amount.toFixed(2)}` : '\u2014'}
                                </p>
                              </div>
                              <div className="col-span-2">
                                <p className="font-semibold mb-1 uppercase tracking-wider text-[10px]" style={{ color: 'var(--text-tertiary)' }}>Refund Status</p>
                                <p style={{ color: 'var(--text-secondary)' }}>
                                  {entry.refund_processed_at ? `Processed: ${formatDate(entry.refund_processed_at)}` : 'Not yet processed'}
                                  {entry.shopify_refund_id && ` (Shopify ID: ${entry.shopify_refund_id})`}
                                </p>
                              </div>

                              {/* Error */}
                              {entry.error && (
                                <div className="col-span-4 rounded-lg p-3" style={{ backgroundColor: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.15)' }}>
                                  <p className="font-semibold mb-1 uppercase tracking-wider text-[10px]" style={{ color: '#ef4444' }}>Error</p>
                                  <p style={{ color: '#ef4444' }}>{entry.error}</p>
                                </div>
                              )}

                              {/* Actions */}
                              <div className="col-span-4 flex gap-3 pt-1">
                                {entry.return_request_id && (
                                  <Link
                                    href={`/returns/${entry.return_request_id}`}
                                    className="inline-flex items-center gap-1 text-xs font-medium"
                                    style={{ color: 'var(--color-accent)' }}
                                  >
                                    <ExternalLink size={10} /> View Return Request
                                  </Link>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
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
          <span style={{ color: '#f59e0b' }}> DRY RUN mode active -- no refunds are actually processed.</span>
        )}
      </p>
    </div>
  );
}
