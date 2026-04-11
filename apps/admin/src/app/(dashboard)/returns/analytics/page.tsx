'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  BarChart3, Package, TrendingUp, DollarSign, Clock, CheckCircle,
  AlertTriangle, Warehouse, ArrowUpDown, RefreshCw, Box, Truck,
  XCircle, ArrowDown, ArrowUp, Layers,
} from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────

interface AnalyticsData {
  returns: {
    total: number;
    thisMonth: number;
    approvalRate: number;
    avgRefund: number;
    totalRefunded: number;
    avgProcessingHours: number;
    byStatus: Record<string, number>;
    byReason: Record<string, number>;
    dailyReturns: Record<string, number>;
  };
  rma: {
    total: number;
    refunded: number;
    pending: number;
    errors: number;
    avgProcessingDays: number;
    byStatus: Record<string, number>;
    byMatchMethod: Record<string, number>;
    skuReturnFrequency: Array<[string, number]>;
    exceptionSummary: Record<string, number>;
  };
  inventory: {
    totalSkus: number;
    totalOnHand: number;
    totalAvailable: number;
    totalAllocated: number;
    lowStock: Array<{ sku: string; available: number; onHand: number }>;
    outOfStock: Array<{ sku: string }>;
  };
}

interface InventoryItem {
  sku: string;
  qty: number;
  qty_available: number;
  qty_allocated: number;
  qty_on_hand: number;
  qty_backordered: number;
  qty_expected: number;
  qty_reserved: number;
}

interface WarehouseInfo {
  warehouse_id: number;
  name: string;
  is_active: number;
  address: { street1: string; street2: string; city: string; region: string; postcode: string };
}

interface InboundShipment {
  delivery_id: string;
  status: string;
  sender_name: string;
  carrier_name: string;
  created_at: string;
  delivered_at: string | null;
  completed_at: string | null;
  items: Array<{ sku: string; qty: string; qty_received: string }>;
}

// ── Helpers ──────────────────────────────────────────────────────────────

const TABS = ['overview', 'inventory', 'rma', 'refunds'] as const;
type Tab = typeof TABS[number];

const TAB_CONFIG: Record<Tab, { label: string; icon: React.ElementType }> = {
  overview: { label: 'Overview', icon: BarChart3 },
  inventory: { label: 'Inventory', icon: Box },
  rma: { label: 'RMA Activity', icon: Package },
  refunds: { label: 'Refund Analytics', icon: DollarSign },
};

const STATUS_COLORS: Record<string, string> = {
  pending_review: '#f59e0b', approved: '#3b82f6', partially_approved: '#3b82f6',
  denied: '#ef4444', shipped: '#6366f1', received: '#a855f7',
  refunded: '#22c55e', closed: '#9ca3af', cancelled: '#9ca3af',
  new: '#9ca3af', accepting: '#f59e0b', ready_to_process: '#0ea5e9',
  processing: '#6366f1', processing_exception: '#ef4444', processed: '#3b82f6',
  put_away: '#a855f7', complete: '#22c55e',
};

const REASON_LABELS: Record<string, string> = {
  defective: 'Defective', wrong_item: 'Wrong Item', changed_mind: 'Changed Mind',
  doesnt_fit: "Doesn't Fit", not_as_described: 'Not As Described',
  too_small: 'Too Small', too_large: 'Too Large', arrived_late: 'Arrived Late', other: 'Other',
};

function StatCard({ label, value, sub, icon: Icon, color }: { label: string; value: string | number; sub?: string; icon: React.ElementType; color: string }) {
  return (
    <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-primary)' }}>
      <div className="flex items-center gap-2 mb-2">
        <Icon size={14} style={{ color }} />
        <span className="text-[11px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>{label}</span>
      </div>
      <p className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{value}</p>
      {sub && <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>{sub}</p>}
    </div>
  );
}

function BarSegment({ data, colors }: { data: Record<string, number>; colors: Record<string, string> }) {
  const total = Object.values(data).reduce((a, b) => a + b, 0);
  if (total === 0) return <div className="h-3 rounded-full" style={{ backgroundColor: 'var(--bg-tertiary)' }} />;
  return (
    <div className="flex rounded-full overflow-hidden h-3 gap-px">
      {Object.entries(data).filter(([, v]) => v > 0).map(([key, val]) => (
        <div
          key={key}
          title={`${key.replace(/_/g, ' ')}: ${val}`}
          style={{ width: `${(val / total) * 100}%`, backgroundColor: colors[key] || '#9ca3af', minWidth: 3 }}
        />
      ))}
    </div>
  );
}

function MiniChart({ data }: { data: Record<string, number> }) {
  const values = Object.values(data);
  const max = Math.max(...values, 1);
  return (
    <div className="flex items-end gap-[2px] h-16">
      {values.map((v, i) => (
        <div
          key={i}
          className="flex-1 rounded-t-sm transition-all"
          style={{ height: `${Math.max((v / max) * 100, 2)}%`, backgroundColor: v > 0 ? '#6366f1' : 'var(--bg-tertiary)' }}
          title={`${Object.keys(data)[i]}: ${v}`}
        />
      ))}
    </div>
  );
}

function SortableTable({ columns, rows, defaultSort }: {
  columns: Array<{ key: string; label: string; align?: string }>;
  rows: Array<Record<string, unknown>>;
  defaultSort?: string;
}) {
  const [sortKey, setSortKey] = useState(defaultSort || columns[0].key);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const sorted = [...rows].sort((a, b) => {
    const av = a[sortKey], bv = b[sortKey];
    if (typeof av === 'number' && typeof bv === 'number') return sortDir === 'asc' ? av - bv : bv - av;
    return sortDir === 'asc' ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
  });

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border-secondary)' }}>
            {columns.map((col) => (
              <th
                key={col.key}
                className="text-left px-3 py-2 text-[11px] font-semibold uppercase tracking-wider cursor-pointer select-none"
                style={{ color: 'var(--text-tertiary)', textAlign: (col.align as 'left' | 'right') || 'left' }}
                onClick={() => { if (sortKey === col.key) setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortKey(col.key); setSortDir('desc'); } }}
              >
                <span className="inline-flex items-center gap-1">
                  {col.label}
                  {sortKey === col.key && <ArrowUpDown size={10} />}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => (
            <tr key={i} style={{ borderBottom: '1px solid var(--border-secondary)' }}>
              {columns.map((col) => (
                <td key={col.key} className="px-3 py-2" style={{ textAlign: (col.align as 'left' | 'right') || 'left', color: 'var(--text-primary)' }}>
                  {row[col.key] as React.ReactNode}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────

export default function WarehouseDashboard() {
  const [tab, setTab] = useState<Tab>('overview');
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseInfo[]>([]);
  const [inbound, setInbound] = useState<InboundShipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [invSearch, setInvSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [analyticsRes, invRes, whRes, inbRes] = await Promise.all([
        fetch('/api/returns/rma?action=analytics').then(r => r.json()).catch(() => null),
        fetch('/api/returns/rma?action=inventory').then(r => r.json()).catch(() => ({ inventory: [] })),
        fetch('/api/returns/rma?action=warehouses').then(r => r.json()).catch(() => ({ warehouses: [] })),
        fetch('/api/returns/rma?action=inbound').then(r => r.json()).catch(() => ({ shipments: [] })),
      ]);
      if (analyticsRes && !analyticsRes.error) setAnalytics(analyticsRes as AnalyticsData);
      setInventory((invRes as { inventory: InventoryItem[] }).inventory ?? []);
      setWarehouses((whRes as { warehouses: WarehouseInfo[] }).warehouses ?? []);
      setInbound((inbRes as { shipments: InboundShipment[] }).shipments ?? []);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-10 w-64 rounded-lg" style={{ backgroundColor: 'var(--bg-tertiary)' }} />
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <div key={i} className="h-24 rounded-xl" style={{ backgroundColor: 'var(--bg-tertiary)' }} />)}
        </div>
      </div>
    );
  }

  const a = analytics;
  const filteredInv = inventory
    .filter(i => !invSearch || i.sku.toLowerCase().includes(invSearch.toLowerCase()))
    .sort((a, b) => b.qty_on_hand - a.qty_on_hand);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Warehouse size={20} style={{ color: 'var(--text-primary)' }} />
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
            Returns & Warehouse Intelligence
          </h2>
        </div>
        <button onClick={load} className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg" style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-lg" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
        {TABS.map(t => {
          const cfg = TAB_CONFIG[t];
          const Icon = cfg.icon;
          return (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-md transition-colors flex-1 justify-center"
              style={{
                backgroundColor: tab === t ? 'var(--bg-primary)' : 'transparent',
                color: tab === t ? 'var(--text-primary)' : 'var(--text-tertiary)',
                boxShadow: tab === t ? 'var(--shadow-sm)' : 'none',
              }}
            >
              <Icon size={13} /> {cfg.label}
            </button>
          );
        })}
      </div>

      {/* ═══ OVERVIEW TAB ═══ */}
      {tab === 'overview' && a && (
        <div className="space-y-5">
          {/* Top Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
            <StatCard label="Total Returns" value={a.returns.total} icon={Package} color="#6366f1" />
            <StatCard label="This Month" value={a.returns.thisMonth} icon={TrendingUp} color="#3b82f6" />
            <StatCard label="Approval Rate" value={`${a.returns.approvalRate}%`} icon={CheckCircle} color="#22c55e" />
            <StatCard label="Avg Refund" value={`$${a.returns.avgRefund.toFixed(0)}`} icon={DollarSign} color="#f59e0b" />
            <StatCard label="Total Refunded" value={`$${a.returns.totalRefunded.toFixed(0)}`} icon={DollarSign} color="#ef4444" />
            <StatCard label="Avg Processing" value={`${a.returns.avgProcessingHours.toFixed(0)}h`} icon={Clock} color="#a855f7" />
          </div>

          {/* Middle row: inventory + RMA stats */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Inventory Summary */}
            <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-primary)' }}>
              <div className="flex items-center gap-2 mb-3">
                <Box size={14} style={{ color: '#6366f1' }} />
                <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Warehouse Inventory</h3>
              </div>
              <div className="space-y-2">
                <div className="flex justify-between text-sm"><span style={{ color: 'var(--text-secondary)' }}>Total SKUs</span><span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{a.inventory.totalSkus}</span></div>
                <div className="flex justify-between text-sm"><span style={{ color: 'var(--text-secondary)' }}>On Hand</span><span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{a.inventory.totalOnHand.toLocaleString()}</span></div>
                <div className="flex justify-between text-sm"><span style={{ color: 'var(--text-secondary)' }}>Available</span><span className="font-semibold" style={{ color: '#22c55e' }}>{a.inventory.totalAvailable.toLocaleString()}</span></div>
                <div className="flex justify-between text-sm"><span style={{ color: 'var(--text-secondary)' }}>Allocated</span><span className="font-semibold" style={{ color: '#f59e0b' }}>{a.inventory.totalAllocated}</span></div>
                {a.inventory.lowStock.length > 0 && (
                  <div className="flex justify-between text-sm"><span style={{ color: '#ef4444' }}>Low Stock</span><span className="font-semibold" style={{ color: '#ef4444' }}>{a.inventory.lowStock.length} SKUs</span></div>
                )}
                {a.inventory.outOfStock.length > 0 && (
                  <div className="flex justify-between text-sm"><span style={{ color: '#ef4444' }}>Out of Stock</span><span className="font-semibold" style={{ color: '#ef4444' }}>{a.inventory.outOfStock.length} SKUs</span></div>
                )}
              </div>
            </div>

            {/* RMA Summary */}
            <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-primary)' }}>
              <div className="flex items-center gap-2 mb-3">
                <Package size={14} style={{ color: '#f59e0b' }} />
                <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>RMA Pipeline</h3>
              </div>
              <div className="space-y-2">
                <div className="flex justify-between text-sm"><span style={{ color: 'var(--text-secondary)' }}>Total RMAs</span><span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{a.rma.total}</span></div>
                <div className="flex justify-between text-sm"><span style={{ color: 'var(--text-secondary)' }}>Refunded</span><span className="font-semibold" style={{ color: '#22c55e' }}>{a.rma.refunded}</span></div>
                <div className="flex justify-between text-sm"><span style={{ color: 'var(--text-secondary)' }}>Pending</span><span className="font-semibold" style={{ color: '#f59e0b' }}>{a.rma.pending}</span></div>
                <div className="flex justify-between text-sm"><span style={{ color: 'var(--text-secondary)' }}>Errors</span><span className="font-semibold" style={{ color: a.rma.errors > 0 ? '#ef4444' : 'var(--text-tertiary)' }}>{a.rma.errors}</span></div>
                <div className="flex justify-between text-sm"><span style={{ color: 'var(--text-secondary)' }}>Avg Processing</span><span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{a.rma.avgProcessingDays}d</span></div>
              </div>
              <div className="mt-3">
                <BarSegment data={a.rma.byStatus} colors={STATUS_COLORS} />
              </div>
            </div>

            {/* Daily Returns Chart */}
            <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-primary)' }}>
              <div className="flex items-center gap-2 mb-3">
                <TrendingUp size={14} style={{ color: '#3b82f6' }} />
                <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Daily Returns (30d)</h3>
              </div>
              <MiniChart data={a.returns.dailyReturns} />
              <div className="flex justify-between mt-2 text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                <span>30 days ago</span><span>Today</span>
              </div>
            </div>
          </div>

          {/* Bottom row: reasons + exceptions + warehouses */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Return Reasons */}
            <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-primary)' }}>
              <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>Return Reasons</h3>
              <div className="space-y-2">
                {Object.entries(a.returns.byReason).sort((x, y) => y[1] - x[1]).map(([reason, count]) => {
                  const total = Object.values(a.returns.byReason).reduce((s, v) => s + v, 0);
                  return (
                    <div key={reason}>
                      <div className="flex justify-between text-xs mb-0.5">
                        <span style={{ color: 'var(--text-secondary)' }}>{REASON_LABELS[reason] || reason.replace(/_/g, ' ')}</span>
                        <span style={{ color: 'var(--text-primary)' }}>{count} ({total > 0 ? Math.round((count / total) * 100) : 0}%)</span>
                      </div>
                      <div className="h-1.5 rounded-full" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
                        <div className="h-full rounded-full" style={{ width: `${total > 0 ? (count / total) * 100 : 0}%`, backgroundColor: '#6366f1' }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Warehouse Exceptions */}
            <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-primary)' }}>
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle size={14} style={{ color: '#f59e0b' }} />
                <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Warehouse Exceptions</h3>
              </div>
              {Object.keys(a.rma.exceptionSummary).length === 0 ? (
                <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>No exceptions recorded</p>
              ) : (
                <div className="space-y-2">
                  {Object.entries(a.rma.exceptionSummary).sort((x, y) => y[1] - x[1]).map(([reason, count]) => (
                    <div key={reason} className="flex justify-between items-center text-sm">
                      <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{reason.replace(/_/g, ' ')}</span>
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: 'rgba(245,158,11,0.12)', color: '#f59e0b' }}>{count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Warehouses */}
            <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-primary)' }}>
              <div className="flex items-center gap-2 mb-3">
                <Warehouse size={14} style={{ color: '#a855f7' }} />
                <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Warehouses</h3>
              </div>
              <div className="space-y-3">
                {warehouses.map(w => (
                  <div key={w.warehouse_id} className="rounded-lg p-3" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-secondary)' }}>
                    <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{w.name}</p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                      {w.address.street1}, {w.address.city}, {w.address.region} {w.address.postcode}
                    </p>
                    <span className="inline-block mt-1 text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ backgroundColor: w.is_active ? 'rgba(34,197,94,0.12)' : 'rgba(156,163,175,0.12)', color: w.is_active ? '#22c55e' : '#9ca3af' }}>
                      {w.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Most Returned SKUs */}
          {a.rma.skuReturnFrequency.length > 0 && (
            <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-primary)' }}>
              <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>Most Returned SKUs</h3>
              <div className="flex flex-wrap gap-2">
                {a.rma.skuReturnFrequency.map(([sku, count]) => (
                  <span key={sku} className="inline-flex items-center gap-1.5 text-xs font-mono px-2.5 py-1 rounded-lg" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-secondary)', color: 'var(--text-primary)' }}>
                    {sku} <span className="font-sans font-semibold" style={{ color: '#ef4444' }}>{count}x</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══ INVENTORY TAB ═══ */}
      {tab === 'inventory' && (
        <div className="space-y-4">
          {/* Search */}
          <div className="flex items-center gap-3">
            <input
              type="text"
              placeholder="Search SKU..."
              value={invSearch}
              onChange={e => setInvSearch(e.target.value)}
              className="px-3 py-2 text-sm rounded-lg w-64"
              style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', color: 'var(--text-primary)' }}
            />
            <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{filteredInv.length} SKUs</span>
          </div>

          {/* Inventory alerts */}
          {a && (a.inventory.lowStock.length > 0 || a.inventory.outOfStock.length > 0) && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {a.inventory.outOfStock.length > 0 && (
                <div className="rounded-xl p-3" style={{ backgroundColor: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.15)' }}>
                  <div className="flex items-center gap-2 mb-2">
                    <XCircle size={14} style={{ color: '#ef4444' }} />
                    <span className="text-xs font-semibold" style={{ color: '#ef4444' }}>Out of Stock ({a.inventory.outOfStock.length})</span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {a.inventory.outOfStock.map(s => (
                      <span key={s.sku} className="text-[10px] font-mono px-2 py-0.5 rounded" style={{ backgroundColor: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>{s.sku}</span>
                    ))}
                  </div>
                </div>
              )}
              {a.inventory.lowStock.length > 0 && (
                <div className="rounded-xl p-3" style={{ backgroundColor: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.15)' }}>
                  <div className="flex items-center gap-2 mb-2">
                    <AlertTriangle size={14} style={{ color: '#f59e0b' }} />
                    <span className="text-xs font-semibold" style={{ color: '#f59e0b' }}>Low Stock ({a.inventory.lowStock.length})</span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {a.inventory.lowStock.map(s => (
                      <span key={s.sku} className="text-[10px] font-mono px-2 py-0.5 rounded" style={{ backgroundColor: 'rgba(245,158,11,0.1)', color: '#f59e0b' }}>{s.sku}: {s.available}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Inventory Table */}
          <div className="rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-primary)' }}>
            <SortableTable
              defaultSort="qty_on_hand"
              columns={[
                { key: 'sku', label: 'SKU' },
                { key: 'qty_on_hand', label: 'On Hand', align: 'right' },
                { key: 'qty_available', label: 'Available', align: 'right' },
                { key: 'qty_allocated', label: 'Allocated', align: 'right' },
                { key: 'qty_expected', label: 'Expected', align: 'right' },
                { key: 'qty_backordered', label: 'Backordered', align: 'right' },
                { key: 'status', label: 'Status' },
              ]}
              rows={filteredInv.map(i => ({
                sku: <span className="font-mono text-xs font-medium">{i.sku}</span>,
                qty_on_hand: i.qty_on_hand,
                qty_available: <span style={{ color: i.qty_available <= 0 ? '#ef4444' : i.qty_available <= 10 ? '#f59e0b' : '#22c55e' }}>{i.qty_available}</span>,
                qty_allocated: i.qty_allocated || <span style={{ color: 'var(--text-tertiary)' }}>0</span>,
                qty_expected: i.qty_expected || <span style={{ color: 'var(--text-tertiary)' }}>0</span>,
                qty_backordered: i.qty_backordered > 0 ? <span style={{ color: '#ef4444' }}>{i.qty_backordered}</span> : <span style={{ color: 'var(--text-tertiary)' }}>0</span>,
                status: i.qty_available <= 0 && i.qty_on_hand <= 0
                  ? <span className="text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ backgroundColor: 'rgba(239,68,68,0.12)', color: '#ef4444' }}>Out of stock</span>
                  : i.qty_available <= 10
                  ? <span className="text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ backgroundColor: 'rgba(245,158,11,0.12)', color: '#f59e0b' }}>Low stock</span>
                  : <span className="text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ backgroundColor: 'rgba(34,197,94,0.12)', color: '#22c55e' }}>In stock</span>,
              }))}
            />
          </div>

          {/* Inbound Shipments */}
          {inbound.length > 0 && (
            <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-primary)' }}>
              <div className="flex items-center gap-2 mb-3">
                <Truck size={14} style={{ color: '#3b82f6' }} />
                <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Inbound Shipments (ASN)</h3>
              </div>
              <div className="space-y-2">
                {inbound.map(s => (
                  <div key={s.delivery_id} className="rounded-lg p-3 flex items-start justify-between" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-secondary)' }}>
                    <div>
                      <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{s.sender_name}</p>
                      <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                        {s.carrier_name} &middot; {s.items?.length || 0} SKUs &middot; {s.items?.reduce((sum, i) => sum + parseFloat(i.qty || '0'), 0)} units
                      </p>
                    </div>
                    <span className="text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ backgroundColor: STATUS_COLORS[s.status] ? `${STATUS_COLORS[s.status]}20` : 'var(--bg-tertiary)', color: STATUS_COLORS[s.status] || 'var(--text-tertiary)' }}>
                      {s.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══ RMA ACTIVITY TAB ═══ */}
      {tab === 'rma' && a && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <StatCard label="Total RMAs" value={a.rma.total} icon={Package} color="#6366f1" />
            <StatCard label="Refunded" value={a.rma.refunded} icon={CheckCircle} color="#22c55e" />
            <StatCard label="Pending" value={a.rma.pending} icon={Clock} color="#f59e0b" />
            <StatCard label="Errors" value={a.rma.errors} icon={XCircle} color="#ef4444" />
            <StatCard label="Avg Processing" value={`${a.rma.avgProcessingDays}d`} icon={Clock} color="#a855f7" />
          </div>

          {/* RMA Status Breakdown */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-primary)' }}>
              <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>RMA Status Distribution</h3>
              <BarSegment data={a.rma.byStatus} colors={STATUS_COLORS} />
              <div className="mt-3 space-y-1.5">
                {Object.entries(a.rma.byStatus).sort((x, y) => y[1] - x[1]).map(([status, count]) => (
                  <div key={status} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: STATUS_COLORS[status] || '#9ca3af' }} />
                      <span style={{ color: 'var(--text-secondary)' }}>{status.replace(/_/g, ' ')}</span>
                    </div>
                    <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{count}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-primary)' }}>
              <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>Order Match Methods</h3>
              <div className="space-y-2">
                {Object.entries(a.rma.byMatchMethod).sort((x, y) => y[1] - x[1]).map(([method, count]) => {
                  const total = a.rma.total;
                  const color = method === 'order_number' ? '#22c55e' : method === 'none' ? '#ef4444' : '#6366f1';
                  return (
                    <div key={method}>
                      <div className="flex justify-between text-xs mb-0.5">
                        <span style={{ color: 'var(--text-secondary)' }}>{method.replace(/_/g, ' ')}</span>
                        <span style={{ color }}>{count} ({Math.round((count / total) * 100)}%)</span>
                      </div>
                      <div className="h-1.5 rounded-full" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
                        <div className="h-full rounded-full" style={{ width: `${(count / total) * 100}%`, backgroundColor: color }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Exceptions + Most Returned */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-primary)' }}>
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle size={14} style={{ color: '#f59e0b' }} />
                <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Warehouse Exceptions</h3>
              </div>
              {Object.keys(a.rma.exceptionSummary).length === 0 ? (
                <p className="text-xs py-4 text-center" style={{ color: 'var(--text-tertiary)' }}>No exceptions</p>
              ) : (
                <div className="space-y-2">
                  {Object.entries(a.rma.exceptionSummary).sort((x, y) => y[1] - x[1]).map(([reason, count]) => (
                    <div key={reason} className="flex items-center justify-between rounded-lg px-3 py-2" style={{ backgroundColor: 'rgba(245,158,11,0.04)', border: '1px solid rgba(245,158,11,0.1)' }}>
                      <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{reason.replace(/_/g, ' ')}</span>
                      <span className="text-xs font-bold" style={{ color: '#f59e0b' }}>{count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-primary)' }}>
              <div className="flex items-center gap-2 mb-3">
                <ArrowDown size={14} style={{ color: '#ef4444' }} />
                <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Most Returned SKUs</h3>
              </div>
              {a.rma.skuReturnFrequency.length === 0 ? (
                <p className="text-xs py-4 text-center" style={{ color: 'var(--text-tertiary)' }}>No data</p>
              ) : (
                <div className="space-y-1.5">
                  {a.rma.skuReturnFrequency.slice(0, 10).map(([sku, count]) => (
                    <div key={sku} className="flex items-center justify-between text-xs">
                      <span className="font-mono" style={{ color: 'var(--text-primary)' }}>{sku}</span>
                      <span className="font-semibold" style={{ color: '#ef4444' }}>{count} returns</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ═══ REFUND ANALYTICS TAB ═══ */}
      {tab === 'refunds' && a && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Total Refunded" value={`$${a.returns.totalRefunded.toFixed(2)}`} icon={DollarSign} color="#ef4444" />
            <StatCard label="Avg Refund" value={`$${a.returns.avgRefund.toFixed(2)}`} icon={DollarSign} color="#f59e0b" />
            <StatCard label="Approval Rate" value={`${a.returns.approvalRate}%`} icon={CheckCircle} color="#22c55e" />
            <StatCard label="Returns Total" value={a.returns.total} icon={Package} color="#6366f1" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Return Status Breakdown */}
            <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-primary)' }}>
              <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>Return Status</h3>
              <BarSegment data={a.returns.byStatus} colors={STATUS_COLORS} />
              <div className="mt-3 space-y-1.5">
                {Object.entries(a.returns.byStatus).sort((x, y) => y[1] - x[1]).map(([status, count]) => (
                  <div key={status} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: STATUS_COLORS[status] || '#9ca3af' }} />
                      <span style={{ color: 'var(--text-secondary)' }}>{status.replace(/_/g, ' ')}</span>
                    </div>
                    <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{count}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Return Reasons */}
            <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-primary)' }}>
              <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>Reasons Breakdown</h3>
              <div className="space-y-2">
                {Object.entries(a.returns.byReason).sort((x, y) => y[1] - x[1]).map(([reason, count]) => {
                  const total = Object.values(a.returns.byReason).reduce((s, v) => s + v, 0);
                  return (
                    <div key={reason}>
                      <div className="flex justify-between text-xs mb-0.5">
                        <span style={{ color: 'var(--text-secondary)' }}>{REASON_LABELS[reason] || reason}</span>
                        <span style={{ color: 'var(--text-primary)' }}>{count} ({total > 0 ? Math.round((count / total) * 100) : 0}%)</span>
                      </div>
                      <div className="h-1.5 rounded-full" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
                        <div className="h-full rounded-full" style={{ width: `${total > 0 ? (count / total) * 100 : 0}%`, backgroundColor: '#a855f7' }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Daily Trend */}
          <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-primary)' }}>
            <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>Daily Returns (30 days)</h3>
            <MiniChart data={a.returns.dailyReturns} />
            <div className="flex justify-between mt-2 text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
              <span>{Object.keys(a.returns.dailyReturns)[0]}</span>
              <span>{Object.keys(a.returns.dailyReturns).pop()}</span>
            </div>
          </div>
        </div>
      )}

      {/* No analytics data */}
      {!a && !loading && (
        <div className="rounded-xl p-12 text-center" style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-primary)' }}>
          <Warehouse size={32} className="mx-auto mb-3" style={{ color: 'var(--text-tertiary)' }} />
          <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>No analytics data available</p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>Make sure the backend is running and Red Stag is connected</p>
        </div>
      )}
    </div>
  );
}
