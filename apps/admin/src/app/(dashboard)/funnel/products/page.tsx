'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Package,
  Plus,
  X,
  Trash2,
  Pencil,
  Check,
  Search,
  Loader2,
  ChevronDown,
  ChevronRight,
  Image as ImageIcon,
  RefreshCw,
  GripVertical,
  Tag,
  Filter,
  CheckCircle2,
  Circle,
  LayoutGrid,
  List,
  ArrowRight,
} from 'lucide-react';

// ── Types ───────────────────────────────────────────────────────────────────

interface CatalogProduct {
  id: string;
  handle: string;
  title: string;
  status: string;
  productType: string;
  tags: string[];
  image: string;
  price: string;
  maxPrice: string;
  currency: string;
  variants: Array<{
    id: string;
    title: string;
    price: string;
    available: boolean;
    image: string;
  }>;
}

interface ProductPool {
  id: string;
  name: string;
  description: string;
  profile_keys: string[];
  product_handles: string[];
  priority: number;
  enabled: boolean;
}

// ── Constants ───────────────────────────────────────────────────────────────

const ACCENT = '#10b981';
const BASE = process.env.NEXT_PUBLIC_BACKEND_URL || '';

const VARIATION_GROUPS = [
  {
    group: 'The Reveal',
    subtitle: 'Mood-based recommendations',
    keys: [
      { key: 'cozy-warm', label: 'Cozy & Warm' },
      { key: 'bright-open', label: 'Bright & Open' },
      { key: 'moody-dramatic', label: 'Moody & Dramatic' },
      { key: 'soft-editorial', label: 'Soft & Editorial' },
    ],
  },
  {
    group: 'Style Profile — Soft Track',
    subtitle: 'For users who chose Soft & Cozy',
    keys: [
      { key: 'rustic-warm', label: 'Rustic Warm' },
      { key: 'bohemian-layered', label: 'Bohemian Layered' },
      { key: 'modern-cozy', label: 'Modern Cozy' },
      { key: 'japandi-warm', label: 'Japandi Warm' },
    ],
  },
  {
    group: 'Style Profile — Dramatic Track',
    subtitle: 'For users who chose Dramatic & Moody',
    keys: [
      { key: 'art-deco-warm', label: 'Art Deco Warm' },
      { key: 'dark-luxe', label: 'Dark Luxe' },
      { key: 'warm-industrial', label: 'Warm Industrial' },
      { key: 'moody-maximalist', label: 'Moody Maximalist' },
    ],
  },
];

// ── Main Page ───────────────────────────────────────────────────────────────

export default function ProductPoolsPage() {
  const [tab, setTab] = useState<'catalog' | 'pools'>('catalog');

  // Catalog state
  const [catalog, setCatalog] = useState<CatalogProduct[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogSyncedAt, setCatalogSyncedAt] = useState<string | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogSearch, setCatalogSearch] = useState('');
  const [catalogTypeFilter, setCatalogTypeFilter] = useState('');
  const [catalogView, setCatalogView] = useState<'grid' | 'list'>('grid');

  // Pool state
  const [pools, setPools] = useState<ProductPool[]>([]);
  const [poolsLoading, setPoolsLoading] = useState(true);
  const [poolError, setPoolError] = useState<string | null>(null);
  const [expandedPool, setExpandedPool] = useState<string | null>(null);

  // Pool creation/edit modal
  const [showModal, setShowModal] = useState(false);
  const [editingPool, setEditingPool] = useState<ProductPool | null>(null);
  const [saving, setSaving] = useState(false);

  // Form state
  const [formName, setFormName] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formPriority, setFormPriority] = useState(0);
  const [formEnabled, setFormEnabled] = useState(true);
  const [formProfileKeys, setFormProfileKeys] = useState<string[]>([]);
  const [formHandles, setFormHandles] = useState<string[]>([]);
  const [modalSearch, setModalSearch] = useState('');
  const [modalTypeFilter, setModalTypeFilter] = useState('');

  // ── Load catalog from localStorage cache first, then sync ─────────

  useEffect(() => {
    const cached = localStorage.getItem('quiz_catalog');
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        setCatalog(parsed.products || []);
        setCatalogSyncedAt(parsed.synced_at || null);
      } catch { /* ignore */ }
    }
  }, []);

  const syncCatalog = useCallback(async () => {
    setCatalogLoading(true);
    setCatalogError(null);
    try {
      const res = await fetch(`${BASE}/api/quiz/catalog`);
      if (!res.ok) throw new Error(`Sync failed (${res.status})`);
      const data = await res.json();
      setCatalog(data.products || []);
      setCatalogSyncedAt(data.synced_at || new Date().toISOString());
      localStorage.setItem('quiz_catalog', JSON.stringify(data));
    } catch (err) {
      setCatalogError(err instanceof Error ? err.message : 'Failed to sync catalog');
    }
    setCatalogLoading(false);
  }, []);

  // ── Load pools ────────────────────────────────────────────────────

  const loadPools = useCallback(async () => {
    setPoolsLoading(true);
    setPoolError(null);
    try {
      const res = await fetch(`${BASE}/api/quiz/product-pools`);
      if (!res.ok) throw new Error(`Failed to load pools (${res.status})`);
      const data = await res.json();
      const raw = Array.isArray(data) ? data : data.pools || [];
      // Normalize product_handles in case backend returns strings
      setPools(raw.map((p: ProductPool) => ({
        ...p,
        product_handles: Array.isArray(p.product_handles)
          ? p.product_handles
          : typeof p.product_handles === 'string'
            ? (() => { try { return JSON.parse(p.product_handles); } catch { return []; } })()
            : [],
        profile_keys: Array.isArray(p.profile_keys) ? p.profile_keys : [],
      })));
    } catch (err) {
      setPoolError(err instanceof Error ? err.message : 'Failed to load pools');
    }
    setPoolsLoading(false);
  }, []);

  useEffect(() => { loadPools(); }, [loadPools]);

  // ── Filtered catalog ──────────────────────────────────────────────

  const productTypes = useMemo(() => {
    const types = new Set(catalog.map((p) => p.productType).filter(Boolean));
    return Array.from(types).sort();
  }, [catalog]);

  const filteredCatalog = useMemo(() => {
    let items = catalog;
    if (catalogSearch) {
      const q = catalogSearch.toLowerCase();
      items = items.filter(
        (p) =>
          p.title.toLowerCase().includes(q) ||
          p.handle.toLowerCase().includes(q) ||
          p.tags.some((t) => t.toLowerCase().includes(q))
      );
    }
    if (catalogTypeFilter) {
      items = items.filter((p) => p.productType === catalogTypeFilter);
    }
    return items;
  }, [catalog, catalogSearch, catalogTypeFilter]);

  // Modal filtered catalog
  const modalFilteredCatalog = useMemo(() => {
    let items = catalog;
    if (modalSearch) {
      const q = modalSearch.toLowerCase();
      items = items.filter(
        (p) =>
          p.title.toLowerCase().includes(q) ||
          p.handle.toLowerCase().includes(q) ||
          p.tags.some((t) => t.toLowerCase().includes(q))
      );
    }
    if (modalTypeFilter) {
      items = items.filter((p) => p.productType === modalTypeFilter);
    }
    return items;
  }, [catalog, modalSearch, modalTypeFilter]);

  // ── Pool CRUD ─────────────────────────────────────────────────────

  function openCreate() {
    setEditingPool(null);
    setFormName('');
    setFormDesc('');
    setFormPriority(0);
    setFormEnabled(true);
    setFormProfileKeys([]);
    setFormHandles([]);
    setModalSearch('');
    setModalTypeFilter('');
    setShowModal(true);
  }

  function openEdit(pool: ProductPool) {
    setEditingPool(pool);
    setFormName(pool.name);
    setFormDesc(pool.description || '');
    setFormPriority(pool.priority);
    setFormEnabled(pool.enabled);
    setFormProfileKeys(pool.profile_keys || []);
    setFormHandles(pool.product_handles || []);
    setModalSearch('');
    setModalTypeFilter('');
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
    setEditingPool(null);
  }

  function toggleProfileKey(key: string) {
    setFormProfileKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  }

  function toggleProduct(handle: string) {
    setFormHandles((prev) =>
      prev.includes(handle) ? prev.filter((h) => h !== handle) : [...prev, handle]
    );
  }

  async function handleSave() {
    setSaving(true);
    setPoolError(null);
    const payload = {
      name: formName.trim(),
      description: formDesc.trim(),
      profile_keys: formProfileKeys,
      product_handles: formHandles,
      priority: formPriority,
      enabled: formEnabled,
    };
    try {
      const url = editingPool
        ? `${BASE}/api/quiz/product-pools/${editingPool.id}`
        : `${BASE}/api/quiz/product-pools`;
      const res = await fetch(url, {
        method: editingPool ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`Failed to save pool (${res.status})`);
      closeModal();
      await loadPools();
    } catch (err) {
      setPoolError(err instanceof Error ? err.message : 'Failed to save pool');
    }
    setSaving(false);
  }

  async function handleDelete(poolId: string) {
    if (!confirm('Delete this product pool?')) return;
    try {
      const res = await fetch(`${BASE}/api/quiz/product-pools/${poolId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`Failed to delete (${res.status})`);
      await loadPools();
    } catch (err) {
      setPoolError(err instanceof Error ? err.message : 'Failed to delete pool');
    }
  }

  async function handleToggle(pool: ProductPool) {
    try {
      await fetch(`${BASE}/api/quiz/product-pools/${pool.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !pool.enabled }),
      });
      await loadPools();
    } catch { /* silent */ }
  }

  // ── Helpers ───────────────────────────────────────────────────────

  function getProduct(handle: string): CatalogProduct | undefined {
    return catalog.find((p) => p.handle === handle);
  }

  function getPoolsForKey(key: string): ProductPool[] {
    return pools.filter(
      (p) => p.enabled && (p.profile_keys.length === 0 || p.profile_keys.includes(key))
    );
  }

  // ── Render ────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Package size={20} style={{ color: ACCENT }} />
          <h2 style={{ fontSize: '20px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
            Product Pools
          </h2>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0', borderBottom: '1px solid var(--border-primary)', marginBottom: '20px' }}>
        {(['catalog', 'pools'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '10px 20px',
              fontSize: '13px',
              fontWeight: tab === t ? 600 : 400,
              color: tab === t ? ACCENT : 'var(--text-secondary)',
              backgroundColor: 'transparent',
              border: 'none',
              borderBottom: tab === t ? `2px solid ${ACCENT}` : '2px solid transparent',
              cursor: 'pointer',
              textTransform: 'capitalize',
              marginBottom: '-1px',
            }}
          >
            {t === 'catalog' ? `Catalog ${catalog.length > 0 ? `(${catalog.length})` : ''}` : `Pools ${pools.length > 0 ? `(${pools.length})` : ''}`}
          </button>
        ))}
      </div>

      {/* ═══════ CATALOG TAB ═══════ */}
      {tab === 'catalog' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Sync bar */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-primary)', borderRadius: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                {catalog.length > 0 ? (
                  <>
                    <strong>{catalog.length}</strong> products synced
                    {catalogSyncedAt && (
                      <span style={{ color: 'var(--text-tertiary)', marginLeft: '8px' }}>
                        Last sync: {new Date(catalogSyncedAt).toLocaleString()}
                      </span>
                    )}
                  </>
                ) : (
                  'No products synced yet — pull your Shopify catalog to get started'
                )}
              </span>
            </div>
            <button
              onClick={syncCatalog}
              disabled={catalogLoading}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 14px',
                fontSize: '12px', fontWeight: 500, color: '#fff',
                backgroundColor: catalogLoading ? '#9ca3af' : ACCENT,
                border: 'none', borderRadius: '7px', cursor: catalogLoading ? 'not-allowed' : 'pointer',
              }}
            >
              <RefreshCw size={13} style={{ animation: catalogLoading ? 'spin 1s linear infinite' : 'none' }} />
              {catalogLoading ? 'Syncing...' : catalog.length > 0 ? 'Re-sync' : 'Sync from Shopify'}
            </button>
          </div>

          {catalogError && (
            <div style={{ padding: '10px 16px', borderRadius: '8px', fontSize: '13px', backgroundColor: 'rgba(239,68,68,0.08)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)' }}>
              {catalogError}
            </div>
          )}

          {catalog.length > 0 && (
            <>
              {/* Search + filters */}
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <div style={{ position: 'relative', flex: 1 }}>
                  <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
                  <input
                    value={catalogSearch}
                    onChange={(e) => setCatalogSearch(e.target.value)}
                    placeholder="Search products by name, handle, or tag..."
                    style={{
                      width: '100%', padding: '8px 12px 8px 32px', fontSize: '13px',
                      borderRadius: '8px', border: '1px solid var(--border-primary)',
                      backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)',
                      outline: 'none', boxSizing: 'border-box',
                    }}
                  />
                </div>
                <select
                  value={catalogTypeFilter}
                  onChange={(e) => setCatalogTypeFilter(e.target.value)}
                  style={{
                    padding: '8px 12px', fontSize: '13px', borderRadius: '8px',
                    border: '1px solid var(--border-primary)', backgroundColor: 'var(--bg-secondary)',
                    color: 'var(--text-primary)', outline: 'none', cursor: 'pointer',
                  }}
                >
                  <option value="">All Types</option>
                  {productTypes.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
                <div style={{ display: 'flex', gap: '2px', padding: '2px', backgroundColor: 'var(--bg-secondary)', borderRadius: '7px', border: '1px solid var(--border-primary)' }}>
                  <button
                    onClick={() => setCatalogView('grid')}
                    style={{
                      padding: '5px 8px', border: 'none', borderRadius: '5px', cursor: 'pointer',
                      backgroundColor: catalogView === 'grid' ? 'var(--bg-primary)' : 'transparent',
                      color: catalogView === 'grid' ? 'var(--text-primary)' : 'var(--text-tertiary)',
                    }}
                  >
                    <LayoutGrid size={14} />
                  </button>
                  <button
                    onClick={() => setCatalogView('list')}
                    style={{
                      padding: '5px 8px', border: 'none', borderRadius: '5px', cursor: 'pointer',
                      backgroundColor: catalogView === 'list' ? 'var(--bg-primary)' : 'transparent',
                      color: catalogView === 'list' ? 'var(--text-primary)' : 'var(--text-tertiary)',
                    }}
                  >
                    <List size={14} />
                  </button>
                </div>
                <span style={{ fontSize: '12px', color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>
                  {filteredCatalog.length} shown
                </span>
              </div>

              {/* Product grid/list */}
              {catalogView === 'grid' ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '12px' }}>
                  {filteredCatalog.map((p) => (
                    <CatalogCard key={p.handle} product={p} />
                  ))}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {filteredCatalog.map((p) => (
                    <CatalogRow key={p.handle} product={p} />
                  ))}
                </div>
              )}
            </>
          )}

          {catalog.length === 0 && !catalogLoading && (
            <div style={{ padding: '80px 20px', textAlign: 'center', backgroundColor: 'var(--bg-primary)', border: '1px dashed var(--border-primary)', borderRadius: '12px' }}>
              <RefreshCw size={32} style={{ color: 'var(--text-tertiary)', margin: '0 auto 12px' }} />
              <p style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text-secondary)', margin: '0 0 4px' }}>
                Sync your Shopify catalog
              </p>
              <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', margin: '0 0 16px' }}>
                Pull all products to browse and create pools
              </p>
              <button
                onClick={syncCatalog}
                disabled={catalogLoading}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '9px 20px',
                  fontSize: '13px', fontWeight: 500, color: '#fff', backgroundColor: ACCENT,
                  border: 'none', borderRadius: '8px', cursor: 'pointer',
                }}
              >
                <RefreshCw size={14} /> Sync Now
              </button>
            </div>
          )}
        </div>
      )}

      {/* ═══════ POOLS TAB ═══════ */}
      {tab === 'pools' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Top actions */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '13px', color: 'var(--text-tertiary)' }}>
              {pools.length} pool{pools.length !== 1 ? 's' : ''} — assign product groups to quiz result variations
            </span>
            <button
              onClick={openCreate}
              disabled={catalog.length === 0}
              title={catalog.length === 0 ? 'Sync your catalog first' : undefined}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px',
                fontSize: '13px', fontWeight: 500, color: '#fff',
                backgroundColor: catalog.length === 0 ? '#9ca3af' : ACCENT,
                border: 'none', borderRadius: '8px',
                cursor: catalog.length === 0 ? 'not-allowed' : 'pointer',
              }}
            >
              <Plus size={14} /> New Pool
            </button>
          </div>

          {poolError && (
            <div style={{ padding: '10px 16px', borderRadius: '8px', fontSize: '13px', backgroundColor: 'rgba(239,68,68,0.08)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)' }}>
              {poolError}
            </div>
          )}

          {poolsLoading ? (
            <div style={{ padding: '64px 20px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '14px' }}>
              Loading pools...
            </div>
          ) : pools.length === 0 ? (
            <div style={{ padding: '64px 20px', textAlign: 'center', backgroundColor: 'var(--bg-primary)', border: '1px dashed var(--border-primary)', borderRadius: '12px' }}>
              <Package size={32} style={{ color: 'var(--text-tertiary)', margin: '0 auto 12px' }} />
              <p style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text-secondary)', margin: '0 0 4px' }}>No product pools yet</p>
              <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', margin: 0 }}>
                {catalog.length === 0 ? 'Sync your catalog first, then create pools' : 'Create a pool to map quiz profiles to products'}
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {pools.map((pool) => {
                const isExpanded = expandedPool === pool.id;
                const poolProducts = pool.product_handles
                  .map((h) => getProduct(h))
                  .filter(Boolean) as CatalogProduct[];

                return (
                  <div
                    key={pool.id}
                    style={{
                      backgroundColor: 'var(--bg-primary)',
                      border: '1px solid var(--border-primary)',
                      borderRadius: '10px',
                      opacity: pool.enabled ? 1 : 0.55,
                      overflow: 'hidden',
                    }}
                  >
                    {/* Pool header */}
                    <div
                      style={{
                        padding: '14px 16px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        cursor: 'pointer',
                      }}
                      onClick={() => setExpandedPool(isExpanded ? null : pool.id)}
                    >
                      <ChevronRight
                        size={15}
                        style={{
                          color: 'var(--text-tertiary)',
                          transition: 'transform 150ms',
                          transform: isExpanded ? 'rotate(90deg)' : 'none',
                          flexShrink: 0,
                        }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                            {pool.name}
                          </h3>
                          <span style={{ fontSize: '10px', color: 'var(--text-tertiary)', backgroundColor: 'var(--bg-tertiary)', padding: '2px 6px', borderRadius: '4px' }}>
                            P{pool.priority}
                          </span>
                          <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                            {pool.product_handles.length} product{pool.product_handles.length !== 1 ? 's' : ''}
                          </span>
                        </div>
                        {pool.description && (
                          <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {pool.description}
                          </p>
                        )}
                      </div>

                      {/* Profile key chips */}
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', maxWidth: '300px' }}>
                        {(pool.profile_keys || []).map((key) => (
                          <span
                            key={key}
                            style={{
                              fontSize: '10px', fontWeight: 500, padding: '2px 8px',
                              borderRadius: '9999px', backgroundColor: `${ACCENT}15`,
                              color: ACCENT, whiteSpace: 'nowrap',
                            }}
                          >
                            {key}
                          </span>
                        ))}
                        {(!pool.profile_keys || pool.profile_keys.length === 0) && (
                          <span style={{ fontSize: '10px', color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
                            all variations
                          </span>
                        )}
                      </div>

                      {/* Actions (stop propagation) */}
                      <div
                        style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          onClick={() => handleToggle(pool)}
                          style={{
                            width: '34px', height: '18px', borderRadius: '9px', border: 'none',
                            cursor: 'pointer', position: 'relative',
                            backgroundColor: pool.enabled ? ACCENT : 'var(--border-primary)',
                            transition: 'background-color 200ms',
                          }}
                        >
                          <div style={{
                            position: 'absolute', top: '2px',
                            left: pool.enabled ? '17px' : '2px',
                            width: '14px', height: '14px', borderRadius: '50%',
                            backgroundColor: '#fff', transition: 'left 200ms',
                            boxShadow: '0 1px 2px rgba(0,0,0,0.15)',
                          }} />
                        </button>
                        <button
                          onClick={() => openEdit(pool)}
                          style={{
                            display: 'flex', alignItems: 'center', gap: '4px',
                            padding: '4px 10px', fontSize: '11px', fontWeight: 500,
                            color: 'var(--text-secondary)', backgroundColor: 'var(--bg-secondary)',
                            border: '1px solid var(--border-primary)', borderRadius: '6px', cursor: 'pointer',
                          }}
                        >
                          <Pencil size={10} /> Edit
                        </button>
                        <button
                          onClick={() => handleDelete(pool.id)}
                          style={{
                            display: 'flex', alignItems: 'center', padding: '4px 7px',
                            fontSize: '11px', color: '#ef4444',
                            backgroundColor: 'rgba(239,68,68,0.06)',
                            border: '1px solid rgba(239,68,68,0.15)',
                            borderRadius: '6px', cursor: 'pointer',
                          }}
                        >
                          <Trash2 size={10} />
                        </button>
                      </div>
                    </div>

                    {/* Expanded: show products */}
                    {isExpanded && (
                      <div style={{ borderTop: '1px solid var(--border-primary)', padding: '14px 16px', backgroundColor: 'var(--bg-secondary)' }}>
                        {poolProducts.length > 0 ? (
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '8px' }}>
                            {poolProducts.map((p) => (
                              <div
                                key={p.handle}
                                style={{
                                  display: 'flex', alignItems: 'center', gap: '8px',
                                  padding: '6px 10px', backgroundColor: 'var(--bg-primary)',
                                  border: '1px solid var(--border-primary)', borderRadius: '7px',
                                }}
                              >
                                {p.image ? (
                                  <img src={p.image} alt="" style={{ width: '36px', height: '36px', objectFit: 'cover', borderRadius: '4px', flexShrink: 0 }} />
                                ) : (
                                  <div style={{ width: '36px', height: '36px', borderRadius: '4px', backgroundColor: 'var(--bg-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                    <ImageIcon size={12} style={{ color: 'var(--text-tertiary)' }} />
                                  </div>
                                )}
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {p.title}
                                  </div>
                                  <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                                    {p.price}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>
                            {pool.product_handles.length > 0
                              ? `${pool.product_handles.length} handles (sync catalog to see previews): ${pool.product_handles.join(', ')}`
                              : 'No products in this pool'}
                          </div>
                        )}

                        {/* Assigned variations */}
                        {pool.profile_keys && pool.profile_keys.length > 0 && (
                          <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid var(--border-primary)' }}>
                            <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>
                              Assigned to variations
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                              {pool.profile_keys.map((k) => (
                                <span key={k} style={{
                                  fontSize: '11px', padding: '3px 10px', borderRadius: '9999px',
                                  backgroundColor: `${ACCENT}12`, color: ACCENT, fontWeight: 500,
                                }}>
                                  {k}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* ── Variation Coverage Map ── */}
          {pools.length > 0 && (
            <div style={{ marginTop: '8px' }}>
              <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Tag size={14} style={{ color: ACCENT }} />
                Variation Coverage
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {VARIATION_GROUPS.map((group) => (
                  <div key={group.group} style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-primary)', borderRadius: '10px', padding: '14px 16px' }}>
                    <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>
                      {group.group}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginBottom: '10px' }}>{group.subtitle}</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {group.keys.map(({ key, label }) => {
                        const assignedPools = getPoolsForKey(key);
                        const totalProducts = assignedPools.reduce((sum, p) => sum + p.product_handles.length, 0);
                        return (
                          <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            {totalProducts > 0 ? (
                              <CheckCircle2 size={14} style={{ color: ACCENT, flexShrink: 0 }} />
                            ) : (
                              <Circle size={14} style={{ color: 'var(--border-primary)', flexShrink: 0 }} />
                            )}
                            <span style={{ fontSize: '13px', color: 'var(--text-primary)', fontWeight: 500, minWidth: '140px' }}>
                              {label}
                            </span>
                            {assignedPools.length > 0 ? (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: 1 }}>
                                {assignedPools.map((p) => (
                                  <span key={p.id} style={{ fontSize: '10px', padding: '2px 8px', borderRadius: '9999px', backgroundColor: `${ACCENT}10`, color: ACCENT, fontWeight: 500 }}>
                                    {p.name} ({p.product_handles.length})
                                  </span>
                                ))}
                                <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginLeft: 'auto' }}>
                                  {totalProducts} product{totalProducts !== 1 ? 's' : ''}
                                </span>
                              </div>
                            ) : (
                              <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
                                No pool assigned
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══════ CREATE/EDIT MODAL ═══════ */}
      {showModal && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 1000, display: 'flex',
            alignItems: 'flex-start', justifyContent: 'center',
            backgroundColor: 'rgba(0,0,0,0.5)', paddingTop: '24px',
            overflowY: 'auto',
          }}
          onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}
        >
          <div style={{
            width: '100%', maxWidth: '860px', backgroundColor: 'var(--bg-primary)',
            border: '1px solid var(--border-primary)', borderRadius: '14px',
            margin: '0 16px 40px', display: 'flex', flexDirection: 'column',
            maxHeight: 'calc(100vh - 64px)',
          }}>
            {/* Modal header */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '18px 24px', borderBottom: '1px solid var(--border-primary)', flexShrink: 0,
            }}>
              <h3 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                {editingPool ? 'Edit Pool' : 'Create Pool'}
              </h3>
              <button
                onClick={closeModal}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: '28px', height: '28px', borderRadius: '6px', border: 'none',
                  cursor: 'pointer', color: 'var(--text-tertiary)', backgroundColor: 'var(--bg-secondary)',
                }}
              >
                <X size={16} />
              </button>
            </div>

            {/* Modal body — scrollable */}
            <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                {/* Name + Priority + Enabled */}
                <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end' }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '5px' }}>Pool Name</label>
                    <input
                      value={formName}
                      onChange={(e) => setFormName(e.target.value)}
                      placeholder="e.g. Cozy Pendant Collection"
                      style={{
                        width: '100%', padding: '8px 12px', fontSize: '13px',
                        borderRadius: '7px', border: '1px solid var(--border-primary)',
                        backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)',
                        outline: 'none', boxSizing: 'border-box',
                      }}
                    />
                  </div>
                  <div style={{ width: '70px' }}>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '5px' }}>Priority</label>
                    <input
                      type="number"
                      value={formPriority}
                      onChange={(e) => setFormPriority(parseInt(e.target.value) || 0)}
                      style={{
                        width: '100%', padding: '8px 12px', fontSize: '13px',
                        borderRadius: '7px', border: '1px solid var(--border-primary)',
                        backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)',
                        outline: 'none', boxSizing: 'border-box',
                      }}
                    />
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 0', fontSize: '13px', color: 'var(--text-secondary)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                    <input type="checkbox" checked={formEnabled} onChange={(e) => setFormEnabled(e.target.checked)} style={{ accentColor: ACCENT }} />
                    Enabled
                  </label>
                </div>

                {/* Description */}
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '5px' }}>Description</label>
                  <input
                    value={formDesc}
                    onChange={(e) => setFormDesc(e.target.value)}
                    placeholder="Brief description..."
                    style={{
                      width: '100%', padding: '8px 12px', fontSize: '13px',
                      borderRadius: '7px', border: '1px solid var(--border-primary)',
                      backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)',
                      outline: 'none', boxSizing: 'border-box',
                    }}
                  />
                </div>

                {/* Assign to Variations */}
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px' }}>
                    Assign to Variations
                    <span style={{ fontWeight: 400, color: 'var(--text-tertiary)', marginLeft: '6px' }}>
                      (leave empty to match all)
                    </span>
                  </label>
                  {VARIATION_GROUPS.map((group) => (
                    <div key={group.group} style={{ marginBottom: '8px' }}>
                      <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '5px' }}>
                        {group.group}
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                        {group.keys.map(({ key, label }) => {
                          const active = formProfileKeys.includes(key);
                          return (
                            <button
                              key={key}
                              onClick={() => toggleProfileKey(key)}
                              style={{
                                padding: '4px 12px', fontSize: '12px',
                                fontWeight: active ? 600 : 400,
                                color: active ? '#fff' : 'var(--text-secondary)',
                                backgroundColor: active ? ACCENT : 'var(--bg-secondary)',
                                border: `1px solid ${active ? ACCENT : 'var(--border-primary)'}`,
                                borderRadius: '6px', cursor: 'pointer', transition: 'all 120ms',
                              }}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Product Selection from Catalog */}
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px' }}>
                    Products
                    <span style={{ fontWeight: 400, color: 'var(--text-tertiary)', marginLeft: '6px' }}>
                      ({formHandles.length} selected)
                    </span>
                  </label>

                  {/* Selected products strip */}
                  {formHandles.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '12px', padding: '10px', backgroundColor: `${ACCENT}08`, borderRadius: '8px', border: `1px solid ${ACCENT}20` }}>
                      {formHandles.map((handle) => {
                        const p = getProduct(handle);
                        return (
                          <div
                            key={handle}
                            style={{
                              display: 'flex', alignItems: 'center', gap: '6px',
                              padding: '3px 6px 3px 3px', backgroundColor: 'var(--bg-primary)',
                              border: '1px solid var(--border-primary)', borderRadius: '6px',
                            }}
                          >
                            {p?.image ? (
                              <img src={p.image} alt="" style={{ width: '24px', height: '24px', objectFit: 'cover', borderRadius: '3px' }} />
                            ) : (
                              <div style={{ width: '24px', height: '24px', borderRadius: '3px', backgroundColor: 'var(--bg-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <ImageIcon size={10} style={{ color: 'var(--text-tertiary)' }} />
                              </div>
                            )}
                            <span style={{ fontSize: '11px', fontWeight: 500, color: 'var(--text-primary)', maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {p?.title || handle}
                            </span>
                            <button
                              onClick={() => toggleProduct(handle)}
                              style={{
                                display: 'flex', padding: '2px', border: 'none', cursor: 'pointer',
                                color: '#ef4444', backgroundColor: 'transparent', borderRadius: '3px',
                              }}
                            >
                              <X size={11} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Catalog search */}
                  <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                    <div style={{ position: 'relative', flex: 1 }}>
                      <Search size={13} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
                      <input
                        value={modalSearch}
                        onChange={(e) => setModalSearch(e.target.value)}
                        placeholder="Filter catalog..."
                        style={{
                          width: '100%', padding: '7px 12px 7px 30px', fontSize: '12px',
                          borderRadius: '7px', border: '1px solid var(--border-primary)',
                          backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)',
                          outline: 'none', boxSizing: 'border-box',
                        }}
                      />
                    </div>
                    <select
                      value={modalTypeFilter}
                      onChange={(e) => setModalTypeFilter(e.target.value)}
                      style={{
                        padding: '7px 10px', fontSize: '12px', borderRadius: '7px',
                        border: '1px solid var(--border-primary)', backgroundColor: 'var(--bg-secondary)',
                        color: 'var(--text-primary)', outline: 'none', cursor: 'pointer',
                      }}
                    >
                      <option value="">All Types</option>
                      {productTypes.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </div>

                  {/* Catalog grid for selection */}
                  {catalog.length === 0 ? (
                    <div style={{ padding: '24px', textAlign: 'center', fontSize: '12px', color: 'var(--text-tertiary)', border: '1px dashed var(--border-primary)', borderRadius: '8px' }}>
                      Sync your catalog first to select products
                    </div>
                  ) : (
                    <div style={{
                      maxHeight: '320px', overflowY: 'auto', border: '1px solid var(--border-primary)',
                      borderRadius: '8px', backgroundColor: 'var(--bg-secondary)',
                    }}>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '6px', padding: '8px' }}>
                        {modalFilteredCatalog.map((p) => {
                          const selected = formHandles.includes(p.handle);
                          return (
                            <div
                              key={p.handle}
                              onClick={() => toggleProduct(p.handle)}
                              style={{
                                cursor: 'pointer', borderRadius: '6px', overflow: 'hidden',
                                border: selected ? `2px solid ${ACCENT}` : '2px solid transparent',
                                backgroundColor: 'var(--bg-primary)',
                                transition: 'border-color 120ms',
                                position: 'relative',
                              }}
                            >
                              {selected && (
                                <div style={{
                                  position: 'absolute', top: '4px', right: '4px', zIndex: 2,
                                  width: '18px', height: '18px', borderRadius: '50%',
                                  backgroundColor: ACCENT, display: 'flex',
                                  alignItems: 'center', justifyContent: 'center',
                                }}>
                                  <Check size={11} style={{ color: '#fff' }} />
                                </div>
                              )}
                              {p.image ? (
                                <img
                                  src={p.image}
                                  alt=""
                                  style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', display: 'block' }}
                                />
                              ) : (
                                <div style={{
                                  width: '100%', aspectRatio: '1',
                                  backgroundColor: 'var(--bg-tertiary)',
                                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                                }}>
                                  <ImageIcon size={20} style={{ color: 'var(--text-tertiary)' }} />
                                </div>
                              )}
                              <div style={{ padding: '6px 8px' }}>
                                <div style={{ fontSize: '11px', fontWeight: 500, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {p.title}
                                </div>
                                <div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>
                                  {p.price}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Modal footer */}
            <div style={{
              display: 'flex', justifyContent: 'flex-end', gap: '8px',
              padding: '14px 24px', borderTop: '1px solid var(--border-primary)', flexShrink: 0,
            }}>
              <button
                onClick={closeModal}
                style={{
                  padding: '8px 16px', fontSize: '13px', fontWeight: 500,
                  color: 'var(--text-secondary)', backgroundColor: 'var(--bg-secondary)',
                  border: '1px solid var(--border-primary)', borderRadius: '7px', cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !formName.trim()}
                style={{
                  display: 'flex', alignItems: 'center', gap: '6px',
                  padding: '8px 16px', fontSize: '13px', fontWeight: 500,
                  color: '#fff',
                  backgroundColor: saving || !formName.trim() ? '#9ca3af' : ACCENT,
                  border: 'none', borderRadius: '7px',
                  cursor: saving || !formName.trim() ? 'not-allowed' : 'pointer',
                }}
              >
                <Check size={14} />
                {saving ? 'Saving...' : editingPool ? 'Update Pool' : 'Create Pool'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Spin keyframe */}
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ── Catalog Card (grid view) ────────────────────────────────────────────────

function CatalogCard({ product }: { product: CatalogProduct }) {
  const [showVariants, setShowVariants] = useState(false);

  return (
    <div
      style={{
        backgroundColor: 'var(--bg-primary)',
        border: '1px solid var(--border-primary)',
        borderRadius: '8px',
        overflow: 'hidden',
      }}
    >
      {product.image ? (
        <img
          src={product.image}
          alt={product.title}
          style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', display: 'block' }}
          loading="lazy"
        />
      ) : (
        <div style={{
          width: '100%', aspectRatio: '1', backgroundColor: 'var(--bg-tertiary)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <ImageIcon size={24} style={{ color: 'var(--text-tertiary)' }} />
        </div>
      )}
      <div style={{ padding: '10px 12px' }}>
        <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: '2px' }}>
          {product.title}
        </div>
        <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginBottom: '4px' }}>
          {product.price}{product.price !== product.maxPrice ? ` – ${product.maxPrice}` : ''}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>
            {product.handle}
          </span>
          {product.variants.length > 1 && (
            <button
              onClick={() => setShowVariants(!showVariants)}
              style={{
                fontSize: '10px', color: '#10b981', backgroundColor: 'transparent',
                border: 'none', cursor: 'pointer', padding: '0',
              }}
            >
              {product.variants.length} variant{product.variants.length !== 1 ? 's' : ''}
            </button>
          )}
        </div>
        {product.productType && (
          <span style={{
            display: 'inline-block', marginTop: '4px', fontSize: '9px', fontWeight: 500,
            padding: '2px 6px', borderRadius: '3px',
            backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-tertiary)',
            textTransform: 'uppercase', letterSpacing: '0.03em',
          }}>
            {product.productType}
          </span>
        )}
      </div>
      {showVariants && (
        <div style={{ borderTop: '1px solid var(--border-primary)', padding: '8px 12px', backgroundColor: 'var(--bg-secondary)' }}>
          {product.variants.map((v) => (
            <div key={v.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '3px 0', fontSize: '11px' }}>
              <span style={{ color: 'var(--text-secondary)' }}>{v.title}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ color: 'var(--text-tertiary)' }}>{v.price}</span>
                <span style={{
                  width: '6px', height: '6px', borderRadius: '50%',
                  backgroundColor: v.available ? '#10b981' : '#ef4444',
                }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Catalog Row (list view) ─────────────────────────────────────────────────

function CatalogRow({ product }: { product: CatalogProduct }) {
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: '10px',
        padding: '8px 12px', backgroundColor: 'var(--bg-primary)',
        border: '1px solid var(--border-primary)', borderRadius: '7px',
      }}
    >
      {product.image ? (
        <img src={product.image} alt="" style={{ width: '40px', height: '40px', objectFit: 'cover', borderRadius: '4px', flexShrink: 0 }} />
      ) : (
        <div style={{ width: '40px', height: '40px', borderRadius: '4px', backgroundColor: 'var(--bg-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <ImageIcon size={14} style={{ color: 'var(--text-tertiary)' }} />
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {product.title}
        </div>
        <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
          {product.handle}
        </div>
      </div>
      {product.productType && (
        <span style={{
          fontSize: '10px', fontWeight: 500, padding: '2px 8px', borderRadius: '4px',
          backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-tertiary)',
          textTransform: 'uppercase', letterSpacing: '0.03em', whiteSpace: 'nowrap',
        }}>
          {product.productType}
        </span>
      )}
      <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
        {product.price}{product.price !== product.maxPrice ? ` – ${product.maxPrice}` : ''}
      </span>
      <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>
        {product.variants.length} variant{product.variants.length !== 1 ? 's' : ''}
      </span>
    </div>
  );
}
