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
  Sparkles,
  Save,
  RotateCcw,
  Layers,
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
    group: 'Style Profile — Soft Track',
    subtitle: 'Warm, approachable, cozy variations',
    keys: [
      { key: 'golden-nook', label: 'Golden Nook' },
      { key: 'layered-warmth', label: 'Layered Warmth' },
      { key: 'soft-modern', label: 'Soft Modern' },
      { key: 'quiet-glow', label: 'Quiet Glow' },
    ],
  },
  {
    group: 'Style Profile — Dramatic Track',
    subtitle: 'Warm with more depth and contrast',
    keys: [
      { key: 'gilded-evening', label: 'Gilded Evening' },
      { key: 'deep-amber', label: 'Deep Amber' },
      { key: 'foundry-glow', label: 'Foundry Glow' },
      { key: 'midnight-warmth', label: 'Midnight Warmth' },
    ],
  },
];

// ── Main Page ───────────────────────────────────────────────────────────────

interface MoodTag {
  id: string;
  product_handle: string;
  product_title: string;
  product_image_url: string | null;
  product_type: string | null;
  mood_scores: Record<string, number>;
  tagged_at: string;
  tagged_by?: string;
}

interface CollectionProduct {
  handle: string;
  title: string;
  image: string;
  price: string;
  bestSellerRank: number;
}

interface CollectionData {
  label: string;
  type: string;
  products: CollectionProduct[];
}

const INDOOR_COLLECTION_HANDLES = [
  'floor-table-lamps', 'desk-lamp', 'indoor-wall-lights', 'chandeliers', 'pendant-lights',
];

const MOOD_COLORS: Record<string, string> = {
  'golden-nook': '#c8a060',
  'layered-warmth': '#d4956a',
  'soft-modern': '#8cb4c0',
  'quiet-glow': '#c4b8a0',
  'gilded-evening': '#c8a040',
  'deep-amber': '#7a5530',
  'foundry-glow': '#8a7060',
  'midnight-warmth': '#6a3040',
};

interface TaggingStatus {
  total: number;
  tagged: number;
  untagged: number;
  lastTaggedAt: string | null;
  inProgress: boolean;
  progress?: { current: number; total: number; handle: string; title: string; status: string } | null;
}

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

  // Mood tagging state
  const [taggingStatus, setTaggingStatus] = useState<TaggingStatus | null>(null);
  const [taggingStarting, setTaggingStarting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval>>(undefined);

  // Mood tags loaded from DB (keyed by product handle)
  const [moodTags, setMoodTags] = useState<Record<string, MoodTag>>({});
  const [moodTagsLoaded, setMoodTagsLoaded] = useState(false);

  // Product detail panel
  const [selectedProduct, setSelectedProduct] = useState<CatalogProduct | null>(null);
  const [editingScores, setEditingScores] = useState<Record<string, number> | null>(null);
  const [editingType, setEditingType] = useState<string>('');
  const [savingTag, setSavingTag] = useState(false);
  const [retagging, setRetagging] = useState(false);

  // Collection view mode
  const [catalogViewMode, setCatalogViewMode] = useState<'all' | 'collections'>('collections');

  // Shopify collections (best-selling sorted)
  const [collections, setCollections] = useState<Record<string, CollectionData>>({});
  const [collectionsLoading, setCollectionsLoading] = useState(false);
  const [allIndoorHandles, setAllIndoorHandles] = useState<Set<string>>(new Set());

  // Expanded collection (shows all products in a collection)
  const [expandedCollection, setExpandedCollection] = useState<string | null>(null);

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

  // ── Mood tagging ──────────────────────────────────────────────────

  const fetchTaggingStatus = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/api/quiz/batch-tag/status`);
      if (res.ok) setTaggingStatus(await res.json());
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchTaggingStatus(); }, [fetchTaggingStatus]);

  // Poll while tagging is in progress
  useEffect(() => {
    if (taggingStatus?.inProgress) {
      pollRef.current = setInterval(fetchTaggingStatus, 2000);
    } else {
      if (pollRef.current) clearInterval(pollRef.current);
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [taggingStatus?.inProgress, fetchTaggingStatus]);

  // ── Load mood tags ──────────────────────────────────────────────
  const fetchMoodTags = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/api/quiz/mood-tags`);
      if (!res.ok) return;
      const data = await res.json();
      const byHandle: Record<string, MoodTag> = {};
      for (const tag of (data.tags || [])) {
        byHandle[tag.product_handle] = tag;
      }
      setMoodTags(byHandle);
      setMoodTagsLoaded(true);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchMoodTags(); }, [fetchMoodTags]);

  // ── Load Shopify collections (best-selling sorted) ─────��───
  const fetchCollections = useCallback(async () => {
    setCollectionsLoading(true);
    try {
      // Check localStorage cache first
      const cached = localStorage.getItem('quiz_collections');
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          // Use cache if less than 1 hour old
          if (parsed.synced_at && Date.now() - new Date(parsed.synced_at).getTime() < 3600000) {
            setCollections(parsed.collections || {});
            setAllIndoorHandles(new Set(parsed.allHandles || []));
            setCollectionsLoading(false);
            return;
          }
        } catch { /* ignore */ }
      }
      const res = await fetch(`${BASE}/api/quiz/collections`);
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      const data = await res.json();
      setCollections(data.collections || {});
      setAllIndoorHandles(new Set(data.allHandles || []));
      localStorage.setItem('quiz_collections', JSON.stringify(data));
    } catch (err) {
      console.error('Failed to load collections:', err);
    }
    setCollectionsLoading(false);
  }, []);

  useEffect(() => { fetchCollections(); }, [fetchCollections]);

  // Re-fetch mood tags when tagging completes
  useEffect(() => {
    if (moodTagsLoaded && taggingStatus && !taggingStatus.inProgress) {
      fetchMoodTags();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taggingStatus?.inProgress]);

  // ── Tag management functions ──────────────────────────────────
  async function saveTagEdits(handle: string) {
    if (!editingScores) return;
    setSavingTag(true);
    try {
      const res = await fetch(`${BASE}/api/quiz/mood-tags/${handle}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mood_scores: editingScores, product_type: editingType || null }),
      });
      if (!res.ok) throw new Error('Failed to save');
      await fetchMoodTags();
    } catch (err) {
      console.error('Failed to save tag:', err);
    }
    setSavingTag(false);
  }

  async function deleteTag(handle: string) {
    if (!confirm('Remove all mood tags from this product?')) return;
    try {
      const res = await fetch(`${BASE}/api/quiz/mood-tags/${handle}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete');
      await fetchMoodTags();
      setSelectedProduct(null);
    } catch (err) {
      console.error('Failed to delete tag:', err);
    }
  }

  async function retagProduct(handle: string) {
    setRetagging(true);
    try {
      const product = catalog.find(p => p.handle === handle);
      const res = await fetch(`${BASE}/api/quiz/tag-product/${handle}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: product?.title || handle, image_url: product?.image || '' }),
      });
      if (!res.ok) throw new Error('Failed to re-tag');
      await fetchMoodTags();
      // Refresh editing state
      const updated = await res.json();
      if (updated.mood_scores) {
        setEditingScores(updated.mood_scores);
        setEditingType(updated.product_type || '');
      }
    } catch (err) {
      console.error('Failed to re-tag:', err);
    }
    setRetagging(false);
  }

  function openProductDetail(product: CatalogProduct) {
    setSelectedProduct(product);
    const tag = moodTags[product.handle];
    if (tag) {
      setEditingScores({ ...tag.mood_scores });
      setEditingType(tag.product_type || '');
    } else {
      setEditingScores(null);
      setEditingType('');
    }
  }

  function getTopMood(handle: string): { key: string; score: number } | null {
    const tag = moodTags[handle];
    if (!tag?.mood_scores) return null;
    let topKey = '';
    let topScore = 0;
    for (const [k, v] of Object.entries(tag.mood_scores)) {
      if (v > topScore) { topKey = k; topScore = v; }
    }
    return topKey ? { key: topKey, score: topScore } : null;
  }

  // Get best-selling products for a mood+collection combo (tagged Yes for this mood)
  function getMoodCollectionProducts(moodKey: string, collectionHandle: string, limit = 4): Array<CollectionProduct & { moodScore: number }> {
    const col = collections[collectionHandle];
    if (!col) return [];
    // Products are already sorted by best-selling rank from Shopify
    // Binary: score >= 0.5 = Yes (tagged for this mood)
    return col.products
      .map(p => {
        const tag = moodTags[p.handle];
        const score = tag?.mood_scores?.[moodKey] ?? 0;
        return { ...p, moodScore: score };
      })
      .filter(p => p.moodScore >= 0.5)
      .slice(0, limit);
  }

  // Get ALL products in a collection with their tag status
  function getCollectionAllProducts(collectionHandle: string): Array<CollectionProduct & { taggedMoods: string[] }> {
    const col = collections[collectionHandle];
    if (!col) return [];
    return col.products.map(p => {
      const tag = moodTags[p.handle];
      const taggedMoods = tag?.mood_scores
        ? Object.entries(tag.mood_scores).filter(([, v]) => v >= 0.5).map(([k]) => k)
        : [];
      return { ...p, taggedMoods };
    });
  }

  async function startBatchTagging(force = false) {
    setTaggingStarting(true);
    try {
      const res = await fetch(`${BASE}/api/quiz/batch-tag`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force }),
      });
      if (!res.ok) throw new Error('Failed to start');
      // Start polling
      setTimeout(fetchTaggingStatus, 1000);
    } catch (err) {
      console.error('Failed to start batch tagging:', err);
    }
    setTaggingStarting(false);
  }

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

  // Filter catalog to only indoor products
  const indoorCatalog = useMemo(() => {
    if (allIndoorHandles.size === 0) return filteredCatalog;
    return filteredCatalog.filter(p => allIndoorHandles.has(p.handle));
  }, [filteredCatalog, allIndoorHandles]);

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

      {/* ═══════ AI CATEGORIZATION CARD ═══════ */}
      <div style={{
        backgroundColor: 'var(--bg-primary)',
        border: '1px solid var(--border-primary)',
        borderRadius: '12px',
        padding: '20px',
        marginBottom: '16px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Tag size={18} style={{ color: ACCENT }} />
            <div>
              <h3 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>AI Product Categorization</h3>
              <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', margin: '2px 0 0' }}>
                Analyze product images with AI to assign mood scores for each style vibe
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            {taggingStatus?.tagged ? (
              <button
                onClick={() => startBatchTagging(true)}
                disabled={taggingStatus?.inProgress || taggingStarting}
                style={{
                  padding: '8px 16px',
                  fontSize: '12px',
                  fontWeight: 500,
                  color: 'var(--text-secondary)',
                  backgroundColor: 'var(--bg-secondary)',
                  border: '1px solid var(--border-primary)',
                  borderRadius: '8px',
                  cursor: taggingStatus?.inProgress ? 'not-allowed' : 'pointer',
                }}
              >
                Re-categorize All
              </button>
            ) : null}
            <button
              onClick={() => startBatchTagging(false)}
              disabled={taggingStatus?.inProgress || taggingStarting}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 20px',
                fontSize: '12px',
                fontWeight: 600,
                color: '#fff',
                backgroundColor: taggingStatus?.inProgress ? '#6b7280' : ACCENT,
                border: 'none',
                borderRadius: '8px',
                cursor: taggingStatus?.inProgress ? 'not-allowed' : 'pointer',
              }}
            >
              {taggingStatus?.inProgress ? (
                <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Categorizing...</>
              ) : taggingStarting ? (
                <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Starting...</>
              ) : (
                <>{taggingStatus?.tagged ? 'Categorize New' : 'Categorize All Products'}</>
              )}
            </button>
          </div>
        </div>

        {/* Status bar */}
        {taggingStatus && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
              <span><strong style={{ color: 'var(--text-primary)' }}>{taggingStatus.tagged}</strong> / {taggingStatus.total} tagged</span>
              {taggingStatus.lastTaggedAt && (
                <span>Last run: {new Date(taggingStatus.lastTaggedAt).toLocaleDateString()}</span>
              )}
              {taggingStatus.inProgress && taggingStatus.progress && (
                <span style={{ color: ACCENT }}>
                  Processing {taggingStatus.progress.current}/{taggingStatus.progress.total}: {taggingStatus.progress.title}
                </span>
              )}
            </div>
            {taggingStatus.total > 0 && (
              <div style={{ height: '4px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '2px', overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  width: `${taggingStatus.inProgress && taggingStatus.progress
                    ? (taggingStatus.progress.current / taggingStatus.progress.total * 100)
                    : (taggingStatus.tagged / taggingStatus.total * 100)}%`,
                  backgroundColor: taggingStatus.inProgress ? '#f59e0b' : ACCENT,
                  borderRadius: '2px',
                  transition: 'width 500ms ease',
                }} />
              </div>
            )}
          </div>
        )}
      </div>
      <style>{`@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>

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
            <div style={{ display: 'flex', gap: '6px' }}>
              <button
                onClick={() => { localStorage.removeItem('quiz_collections'); fetchCollections(); }}
                disabled={collectionsLoading}
                style={{
                  display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 14px',
                  fontSize: '12px', fontWeight: 500,
                  color: collectionsLoading ? '#9ca3af' : 'var(--text-secondary)',
                  backgroundColor: 'var(--bg-secondary)',
                  border: '1px solid var(--border-primary)', borderRadius: '7px',
                  cursor: collectionsLoading ? 'not-allowed' : 'pointer',
                }}
              >
                <Layers size={13} style={{ animation: collectionsLoading ? 'spin 1s linear infinite' : 'none' }} />
                {collectionsLoading ? 'Loading...' : 'Refresh Collections'}
              </button>
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
                    onClick={() => setCatalogViewMode('collections')}
                    title="By Collection"
                    style={{
                      padding: '5px 8px', border: 'none', borderRadius: '5px', cursor: 'pointer',
                      backgroundColor: catalogViewMode === 'collections' ? 'var(--bg-primary)' : 'transparent',
                      color: catalogViewMode === 'collections' ? 'var(--text-primary)' : 'var(--text-tertiary)',
                    }}
                  >
                    <Layers size={14} />
                  </button>
                  <button
                    onClick={() => { setCatalogViewMode('all'); setCatalogView('grid'); }}
                    title="Grid View"
                    style={{
                      padding: '5px 8px', border: 'none', borderRadius: '5px', cursor: 'pointer',
                      backgroundColor: catalogViewMode === 'all' && catalogView === 'grid' ? 'var(--bg-primary)' : 'transparent',
                      color: catalogViewMode === 'all' && catalogView === 'grid' ? 'var(--text-primary)' : 'var(--text-tertiary)',
                    }}
                  >
                    <LayoutGrid size={14} />
                  </button>
                  <button
                    onClick={() => { setCatalogViewMode('all'); setCatalogView('list'); }}
                    title="List View"
                    style={{
                      padding: '5px 8px', border: 'none', borderRadius: '5px', cursor: 'pointer',
                      backgroundColor: catalogViewMode === 'all' && catalogView === 'list' ? 'var(--bg-primary)' : 'transparent',
                      color: catalogViewMode === 'all' && catalogView === 'list' ? 'var(--text-primary)' : 'var(--text-tertiary)',
                    }}
                  >
                    <List size={14} />
                  </button>
                </div>
                <span style={{ fontSize: '12px', color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>
                  {catalogViewMode === 'all' ? `${indoorCatalog.length} indoor` : `${Object.values(collections).reduce((s, c) => s + c.products.length, 0)} products`}
                </span>
              </div>

              {/* ── Collections View (by mood → by collection type → 4 best-selling) ── */}
              {catalogViewMode === 'collections' && !catalogSearch && !catalogTypeFilter ? (
                collectionsLoading ? (
                  <div style={{ padding: '48px 20px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '14px' }}>
                    <Loader2 size={20} style={{ animation: 'spin 1s linear infinite', margin: '0 auto 8px', display: 'block' }} />
                    Loading collections...
                  </div>
                ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
                  {VARIATION_GROUPS.map((group) => (
                    <div key={group.group}>
                      <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>
                        {group.group}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginBottom: '16px' }}>{group.subtitle}</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                        {group.keys.map(({ key, label }) => {
                          const moodColor = MOOD_COLORS[key] || ACCENT;
                          return (
                            <div key={key} style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-primary)', borderRadius: '10px', overflow: 'hidden' }}>
                              {/* Mood header with color accent */}
                              <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border-primary)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                  <div style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: moodColor, flexShrink: 0 }} />
                                  <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>{label}</span>
                                  <span style={{ fontSize: '10px', fontWeight: 500, padding: '2px 8px', borderRadius: '4px', backgroundColor: `${moodColor}18`, color: moodColor }}>{key}</span>
                                </div>
                              </div>

                              {/* Collection rows */}
                              <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                {INDOOR_COLLECTION_HANDLES.map((colHandle) => {
                                  const col = collections[colHandle];
                                  if (!col) return null;
                                  const products = getMoodCollectionProducts(key, colHandle);
                                  const expandKey = `${key}__${colHandle}`;
                                  const isExpanded = expandedCollection === expandKey;
                                  const allProducts = isExpanded ? getCollectionAllProducts(colHandle) : [];
                                  return (
                                    <div key={colHandle}>
                                      <div
                                        onClick={() => setExpandedCollection(isExpanded ? null : expandKey)}
                                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px', cursor: 'pointer', userSelect: 'none' }}
                                      >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                          <ChevronRight size={12} style={{
                                            color: 'var(--text-tertiary)', transition: 'transform 150ms',
                                            transform: isExpanded ? 'rotate(90deg)' : 'none',
                                          }} />
                                          <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>{col.label}</span>
                                          <span style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>({col.products.length})</span>
                                        </div>
                                        <span style={{ fontSize: '10px', color: isExpanded ? moodColor : 'var(--text-tertiary)' }}>
                                          {isExpanded ? 'showing all' : products.length > 0 ? `${products.length} tagged` : 'no matches'}
                                        </span>
                                      </div>
                                      {!isExpanded ? (
                                        products.length > 0 ? (
                                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px' }}>
                                            {products.map((p, idx) => (
                                              <CollectionProductCard
                                                key={p.handle}
                                                product={p}
                                                rank={idx + 1}
                                                moodKey={key}
                                                moodColor={moodColor}
                                                moodTag={moodTags[p.handle]}
                                                onSelect={() => {
                                                  const cat = catalog.find(c => c.handle === p.handle);
                                                  if (cat) openProductDetail(cat);
                                                }}
                                              />
                                            ))}
                                          </div>
                                        ) : (
                                          <div style={{ padding: '12px', textAlign: 'center', fontSize: '11px', color: 'var(--text-tertiary)', border: '1px dashed var(--border-primary)', borderRadius: '6px' }}>
                                            No products tagged for this mood — run AI categorization
                                          </div>
                                        )
                                      ) : (
                                        /* Expanded: show ALL products in this collection */
                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '8px' }}>
                                          {allProducts.map((p, idx) => {
                                            const isTaggedForMood = p.taggedMoods.includes(key);
                                            return (
                                              <div
                                                key={p.handle}
                                                onClick={() => {
                                                  const cat = catalog.find(c => c.handle === p.handle);
                                                  if (cat) openProductDetail(cat);
                                                }}
                                                style={{
                                                  cursor: 'pointer', border: `1px solid ${isTaggedForMood ? `${moodColor}60` : 'var(--border-primary)'}`,
                                                  borderRadius: '6px', overflow: 'hidden', transition: 'border-color 150ms',
                                                  opacity: isTaggedForMood ? 1 : 0.6, position: 'relative',
                                                }}
                                                onMouseOver={(e) => { e.currentTarget.style.borderColor = moodColor; e.currentTarget.style.opacity = '1'; }}
                                                onMouseOut={(e) => { e.currentTarget.style.borderColor = isTaggedForMood ? `${moodColor}60` : 'var(--border-primary)'; e.currentTarget.style.opacity = isTaggedForMood ? '1' : '0.6'; }}
                                              >
                                                {/* Rank badge */}
                                                <div style={{
                                                  position: 'absolute', top: '4px', left: '4px', zIndex: 2,
                                                  width: '16px', height: '16px', borderRadius: '50%',
                                                  backgroundColor: idx < 2 ? '#f59e0b' : 'rgba(0,0,0,0.4)',
                                                  color: '#fff', fontSize: '8px', fontWeight: 700,
                                                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                }}>
                                                  {idx + 1}
                                                </div>
                                                {/* Tagged badge */}
                                                {isTaggedForMood && (
                                                  <div style={{
                                                    position: 'absolute', top: '4px', right: '4px', zIndex: 2,
                                                    padding: '1px 5px', borderRadius: '3px', fontSize: '7px', fontWeight: 700,
                                                    backgroundColor: moodColor, color: '#fff', textTransform: 'uppercase',
                                                  }}>
                                                    Yes
                                                  </div>
                                                )}
                                                {p.image ? (
                                                  <img src={p.image} alt={p.title} style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', display: 'block' }} loading="lazy" />
                                                ) : (
                                                  <div style={{ width: '100%', aspectRatio: '1', backgroundColor: 'var(--bg-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                    <ImageIcon size={16} style={{ color: 'var(--text-tertiary)' }} />
                                                  </div>
                                                )}
                                                <div style={{ padding: '5px 7px' }}>
                                                  <div style={{ fontSize: '10px', fontWeight: 500, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: '2px' }}>
                                                    {p.title}
                                                  </div>
                                                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                                    <span style={{ fontSize: '9px', color: 'var(--text-tertiary)' }}>{p.price}</span>
                                                    {p.taggedMoods.length > 0 && (
                                                      <div style={{ display: 'flex', gap: '2px' }}>
                                                        {p.taggedMoods.slice(0, 3).map(mk => (
                                                          <div key={mk} title={MOOD_LABELS[mk] || mk} style={{
                                                            width: '6px', height: '6px', borderRadius: '50%',
                                                            backgroundColor: MOOD_COLORS[mk] || '#999',
                                                          }} />
                                                        ))}
                                                      </div>
                                                    )}
                                                  </div>
                                                </div>
                                              </div>
                                            );
                                          })}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
                )
              ) : catalogView === 'grid' ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '12px' }}>
                  {indoorCatalog.map((p) => (
                    <CatalogCard key={p.handle} product={p} moodTag={moodTags[p.handle]} onSelect={() => openProductDetail(p)} />
                  ))}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {indoorCatalog.map((p) => (
                    <CatalogRow key={p.handle} product={p} moodTag={moodTags[p.handle]} onSelect={() => openProductDetail(p)} />
                  ))}
                </div>
              )}

              {/* ── Product Detail Panel ── */}
              {selectedProduct && (
                <ProductDetailPanel
                  product={selectedProduct}
                  moodTag={moodTags[selectedProduct.handle] || null}
                  editingScores={editingScores}
                  editingType={editingType}
                  savingTag={savingTag}
                  retagging={retagging}
                  onClose={() => setSelectedProduct(null)}
                  onScoreChange={(key, val) => setEditingScores(prev => prev ? { ...prev, [key]: val } : { [key]: val })}
                  onTypeChange={setEditingType}
                  onSave={() => saveTagEdits(selectedProduct.handle)}
                  onDelete={() => deleteTag(selectedProduct.handle)}
                  onRetag={() => retagProduct(selectedProduct.handle)}
                />
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

// ── Collection Product Card (used in mood×collection grid) ──────────────────

function CollectionProductCard({
  product, rank, moodKey, moodColor, moodTag, onSelect,
}: {
  product: CollectionProduct & { moodScore: number };
  rank: number;
  moodKey: string;
  moodColor: string;
  moodTag?: MoodTag;
  onSelect: () => void;
}) {
  // Get all moods this product is tagged Yes for (score >= 0.5)
  const taggedMoods = moodTag
    ? Object.entries(moodTag.mood_scores).filter(([, v]) => v >= 0.5).map(([k]) => k)
    : [];

  return (
    <div
      onClick={onSelect}
      style={{
        cursor: 'pointer', border: '1px solid var(--border-primary)', borderRadius: '8px',
        overflow: 'hidden', transition: 'border-color 150ms', position: 'relative',
      }}
      onMouseOver={(e) => (e.currentTarget.style.borderColor = moodColor)}
      onMouseOut={(e) => (e.currentTarget.style.borderColor = 'var(--border-primary)')}
    >
      {/* Best-seller rank badge */}
      <div style={{
        position: 'absolute', top: '6px', left: '6px', zIndex: 2,
        width: '20px', height: '20px', borderRadius: '50%',
        backgroundColor: rank <= 2 ? '#f59e0b' : 'rgba(0,0,0,0.5)',
        color: '#fff', fontSize: '10px', fontWeight: 700,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {rank}
      </div>

      {/* Tag status dots */}
      {taggedMoods.length > 0 && (
        <div style={{
          position: 'absolute', top: '6px', right: '6px', zIndex: 2,
          display: 'flex', gap: '2px',
        }}>
          {taggedMoods.slice(0, 4).map((k) => (
            <div
              key={k}
              title={MOOD_LABELS[k] || k}
              style={{
                width: '8px', height: '8px', borderRadius: '50%',
                backgroundColor: k === moodKey ? moodColor : (MOOD_COLORS[k] || '#999'),
                border: '1.5px solid rgba(255,255,255,0.8)',
              }}
            />
          ))}
        </div>
      )}

      {product.image ? (
        <img src={product.image} alt={product.title} style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', display: 'block' }} loading="lazy" />
      ) : (
        <div style={{ width: '100%', aspectRatio: '1', backgroundColor: 'var(--bg-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <ImageIcon size={20} style={{ color: 'var(--text-tertiary)' }} />
        </div>
      )}
      <div style={{ padding: '8px 10px' }}>
        <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: '2px' }}>
          {product.title}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '3px' }}>
          <span style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>{product.price}</span>
        </div>
        {/* Mood tag chips - Yes-tagged moods only */}
        {taggedMoods.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px', marginTop: '2px' }}>
            {taggedMoods.slice(0, 3).map((k) => (
              <span key={k} style={{
                fontSize: '8px', fontWeight: 600, padding: '1px 5px', borderRadius: '3px',
                backgroundColor: k === moodKey ? `${moodColor}20` : 'var(--bg-tertiary)',
                color: k === moodKey ? moodColor : 'var(--text-tertiary)',
                textTransform: 'uppercase', letterSpacing: '0.02em',
              }}>
                {(MOOD_LABELS[k] || k).split(' ')[0]}
              </span>
            ))}
            {taggedMoods.length > 3 && (
              <span style={{ fontSize: '8px', color: 'var(--text-tertiary)', padding: '1px 3px' }}>
                +{taggedMoods.length - 3}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Catalog Card (all-products grid view) ───────────────────────────────────

function CatalogCard({ product, moodTag, onSelect }: { product: CatalogProduct; moodTag?: MoodTag; onSelect: () => void }) {
  return (
    <div
      onClick={onSelect}
      style={{
        backgroundColor: 'var(--bg-primary)',
        border: '1px solid var(--border-primary)',
        borderRadius: '8px',
        overflow: 'hidden',
        cursor: 'pointer',
        transition: 'border-color 150ms',
      }}
      onMouseOver={(e) => (e.currentTarget.style.borderColor = '#10b981')}
      onMouseOut={(e) => (e.currentTarget.style.borderColor = 'var(--border-primary)')}
    >
      <div style={{ position: 'relative' }}>
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
        {/* Tag indicator */}
        {moodTag && (
          <div style={{
            position: 'absolute', top: '6px', right: '6px',
            display: 'flex', alignItems: 'center', gap: '3px',
            padding: '2px 7px', borderRadius: '4px',
            backgroundColor: 'rgba(16,185,129,0.9)', color: '#fff',
            fontSize: '9px', fontWeight: 600,
          }}>
            <Tag size={9} /> Tagged
          </div>
        )}
      </div>
      <div style={{ padding: '10px 12px' }}>
        <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: '2px' }}>
          {product.title}
        </div>
        <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginBottom: '4px' }}>
          {product.price}{product.price !== product.maxPrice ? ` – ${product.maxPrice}` : ''}
        </div>
        {/* Mood tags - binary Yes chips */}
        {moodTag?.mood_scores && (() => {
          const moods = Object.entries(moodTag.mood_scores)
            .filter(([, v]) => v >= 0.5)
            .map(([k]) => k)
            .slice(0, 3);
          return moods.length > 0 ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', marginBottom: '4px' }}>
              {moods.map((k) => (
                <span key={k} style={{
                  fontSize: '8px', fontWeight: 600, padding: '2px 6px', borderRadius: '3px',
                  backgroundColor: `${MOOD_COLORS[k] || '#999'}20`,
                  color: MOOD_COLORS[k] || '#999',
                  display: 'flex', alignItems: 'center', gap: '3px',
                }}>
                  <span style={{ width: '5px', height: '5px', borderRadius: '50%', backgroundColor: MOOD_COLORS[k] || '#999' }} />
                  {MOOD_LABELS[k] || k}
                </span>
              ))}
            </div>
          ) : null;
        })()}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>
            {product.handle}
          </span>
          {moodTag?.product_type && (
            <span style={{
              fontSize: '9px', fontWeight: 500, padding: '2px 6px', borderRadius: '3px',
              backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-tertiary)',
              textTransform: 'uppercase', letterSpacing: '0.03em',
            }}>
              {moodTag.product_type}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Catalog Row (list view) ─────────────────────────────────────────────────

function CatalogRow({ product, moodTag, onSelect }: { product: CatalogProduct; moodTag?: MoodTag; onSelect: () => void }) {
  return (
    <div
      onClick={onSelect}
      style={{
        display: 'flex', alignItems: 'center', gap: '10px',
        padding: '8px 12px', backgroundColor: 'var(--bg-primary)',
        border: '1px solid var(--border-primary)', borderRadius: '7px',
        cursor: 'pointer', transition: 'border-color 150ms',
      }}
      onMouseOver={(e) => (e.currentTarget.style.borderColor = '#10b981')}
      onMouseOut={(e) => (e.currentTarget.style.borderColor = 'var(--border-primary)')}
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
      {/* Mood chips - binary Yes tags */}
      <div style={{ display: 'flex', gap: '3px', flexShrink: 0 }}>
        {moodTag?.mood_scores ? (() => {
          const moods = Object.entries(moodTag.mood_scores)
            .filter(([, v]) => v >= 0.5)
            .map(([k]) => k)
            .slice(0, 3);
          return moods.length > 0 ? moods.map((k) => (
            <span key={k} style={{
              fontSize: '9px', fontWeight: 600, padding: '2px 7px', borderRadius: '4px',
              backgroundColor: `${MOOD_COLORS[k] || '#999'}18`,
              color: MOOD_COLORS[k] || '#999', whiteSpace: 'nowrap',
              display: 'flex', alignItems: 'center', gap: '3px',
            }}>
              <span style={{ width: '5px', height: '5px', borderRadius: '50%', backgroundColor: MOOD_COLORS[k] || '#999' }} />
              {MOOD_LABELS[k] || k}
            </span>
          )) : <Circle size={13} style={{ color: 'var(--border-primary)' }} />;
        })() : <Circle size={13} style={{ color: 'var(--border-primary)' }} />}
      </div>
      <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
        {product.price}
      </span>
    </div>
  );
}

// ── Product Detail Panel (slide-over) ───────────────────────────────────────

const ALL_MOOD_KEYS = [
  'golden-nook', 'layered-warmth', 'soft-modern', 'quiet-glow',
  'gilded-evening', 'deep-amber', 'foundry-glow', 'midnight-warmth',
];

const MOOD_LABELS: Record<string, string> = {
  'golden-nook': 'Golden Nook',
  'layered-warmth': 'Layered Warmth',
  'soft-modern': 'Soft Modern',
  'quiet-glow': 'Quiet Glow',
  'gilded-evening': 'Gilded Evening',
  'deep-amber': 'Deep Amber',
  'foundry-glow': 'Foundry Glow',
  'midnight-warmth': 'Midnight Warmth',
};

const PRODUCT_TYPES = ['pendant', 'floor_lamp', 'table_lamp', 'wall_sconce', 'chandelier', 'ceiling_light', 'desk_lamp'];

function ProductDetailPanel({
  product,
  moodTag,
  editingScores,
  editingType,
  savingTag,
  retagging,
  onClose,
  onScoreChange,
  onTypeChange,
  onSave,
  onDelete,
  onRetag,
}: {
  product: CatalogProduct;
  moodTag: MoodTag | null;
  editingScores: Record<string, number> | null;
  editingType: string;
  savingTag: boolean;
  retagging: boolean;
  onClose: () => void;
  onScoreChange: (key: string, val: number) => void;
  onTypeChange: (val: string) => void;
  onSave: () => void;
  onDelete: () => void;
  onRetag: () => void;
}) {
  const hasTag = !!moodTag;
  const scores = editingScores || {};

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000, display: 'flex',
        justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        width: '480px', maxWidth: '100vw', backgroundColor: 'var(--bg-primary)',
        borderLeft: '1px solid var(--border-primary)',
        display: 'flex', flexDirection: 'column', height: '100%',
        animation: 'slideIn 200ms ease-out',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 20px', borderBottom: '1px solid var(--border-primary)', flexShrink: 0,
        }}>
          <h3 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
            Product Tags
          </h3>
          <button onClick={onClose} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: '28px', height: '28px', borderRadius: '6px', border: 'none',
            cursor: 'pointer', color: 'var(--text-tertiary)', backgroundColor: 'var(--bg-secondary)',
          }}>
            <X size={16} />
          </button>
        </div>

        {/* Body - scrollable */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
          {/* Product info */}
          <div style={{ display: 'flex', gap: '14px', marginBottom: '20px' }}>
            {product.image ? (
              <img src={product.image} alt={product.title} style={{ width: '80px', height: '80px', objectFit: 'cover', borderRadius: '8px', flexShrink: 0 }} />
            ) : (
              <div style={{ width: '80px', height: '80px', borderRadius: '8px', backgroundColor: 'var(--bg-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <ImageIcon size={24} style={{ color: 'var(--text-tertiary)' }} />
              </div>
            )}
            <div>
              <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>{product.title}</div>
              <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '2px' }}>{product.handle}</div>
              <div style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)' }}>{product.price}</div>
            </div>
          </div>

          {/* Actions row */}
          <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
            <button
              onClick={onRetag}
              disabled={retagging}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '7px 14px', fontSize: '12px', fontWeight: 500,
                color: '#fff', backgroundColor: retagging ? '#9ca3af' : '#10b981',
                border: 'none', borderRadius: '7px', cursor: retagging ? 'not-allowed' : 'pointer',
              }}
            >
              {retagging ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Sparkles size={13} />}
              {hasTag ? 'Re-tag with AI' : 'Tag with AI'}
            </button>
            {hasTag && (
              <button
                onClick={onDelete}
                style={{
                  display: 'flex', alignItems: 'center', gap: '4px',
                  padding: '7px 14px', fontSize: '12px', fontWeight: 500,
                  color: '#ef4444', backgroundColor: 'rgba(239,68,68,0.06)',
                  border: '1px solid rgba(239,68,68,0.15)', borderRadius: '7px', cursor: 'pointer',
                }}
              >
                <Trash2 size={12} /> Remove Tags
              </button>
            )}
          </div>

          {/* Tag status */}
          {!hasTag && !editingScores && (
            <div style={{
              padding: '24px', textAlign: 'center', border: '1px dashed var(--border-primary)',
              borderRadius: '10px', color: 'var(--text-tertiary)', fontSize: '13px',
            }}>
              <Tag size={24} style={{ color: 'var(--text-tertiary)', margin: '0 auto 8px', display: 'block' }} />
              This product has no mood tags yet.<br />
              Click &quot;Tag with AI&quot; to analyze its image.
            </div>
          )}

          {/* Mood scores editor */}
          {(hasTag || editingScores) && (
            <div>
              {/* Product type */}
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Product Type
                </label>
                <select
                  value={editingType}
                  onChange={(e) => onTypeChange(e.target.value)}
                  style={{
                    padding: '7px 12px', fontSize: '13px', borderRadius: '7px',
                    border: '1px solid var(--border-primary)', backgroundColor: 'var(--bg-secondary)',
                    color: 'var(--text-primary)', outline: 'none', cursor: 'pointer', width: '100%',
                  }}
                >
                  <option value="">Unclassified</option>
                  {PRODUCT_TYPES.map((t) => (
                    <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
                  ))}
                </select>
              </div>

              {/* Mood tags - Yes/No toggles */}
              <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Mood Tags
              </label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {ALL_MOOD_KEYS.map((key) => {
                  const isOn = (scores[key] ?? 0) >= 0.5;
                  const moodColor = MOOD_COLORS[key] || '#10b981';
                  return (
                    <div
                      key={key}
                      onClick={() => onScoreChange(key, isOn ? 0 : 1)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '10px',
                        padding: '8px 12px', borderRadius: '7px', cursor: 'pointer',
                        backgroundColor: isOn ? `${moodColor}10` : 'var(--bg-secondary)',
                        border: `1px solid ${isOn ? `${moodColor}40` : 'var(--border-primary)'}`,
                        transition: 'all 150ms',
                      }}
                    >
                      <div style={{
                        width: '8px', height: '8px', borderRadius: '50%',
                        backgroundColor: moodColor, flexShrink: 0,
                      }} />
                      <span style={{
                        fontSize: '13px', fontWeight: 500, flex: 1,
                        color: isOn ? 'var(--text-primary)' : 'var(--text-tertiary)',
                      }}>
                        {MOOD_LABELS[key] || key}
                      </span>
                      {/* Toggle switch */}
                      <div style={{
                        width: '36px', height: '20px', borderRadius: '10px',
                        backgroundColor: isOn ? moodColor : 'var(--bg-tertiary)',
                        position: 'relative', transition: 'background-color 150ms', flexShrink: 0,
                      }}>
                        <div style={{
                          width: '16px', height: '16px', borderRadius: '50%',
                          backgroundColor: '#fff', position: 'absolute', top: '2px',
                          left: isOn ? '18px' : '2px',
                          transition: 'left 150ms',
                          boxShadow: '0 1px 2px rgba(0,0,0,0.15)',
                        }} />
                      </div>
                      <span style={{
                        fontSize: '11px', fontWeight: 600, minWidth: '24px', textAlign: 'right',
                        color: isOn ? moodColor : 'var(--text-tertiary)',
                      }}>
                        {isOn ? 'Yes' : 'No'}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Tagged by info */}
              {moodTag && (
                <div style={{ marginTop: '16px', padding: '10px 12px', backgroundColor: 'var(--bg-secondary)', borderRadius: '7px', fontSize: '11px', color: 'var(--text-tertiary)' }}>
                  Tagged by: <strong style={{ color: 'var(--text-secondary)' }}>{moodTag.tagged_at ? 'AI' : 'manual'}</strong>
                  {moodTag.tagged_at && <> · {new Date(moodTag.tagged_at).toLocaleString()}</>}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {(hasTag || editingScores) && (
          <div style={{
            display: 'flex', justifyContent: 'flex-end', gap: '8px',
            padding: '14px 20px', borderTop: '1px solid var(--border-primary)', flexShrink: 0,
          }}>
            <button
              onClick={onClose}
              style={{
                padding: '8px 16px', fontSize: '12px', fontWeight: 500,
                color: 'var(--text-secondary)', backgroundColor: 'var(--bg-secondary)',
                border: '1px solid var(--border-primary)', borderRadius: '7px', cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              onClick={onSave}
              disabled={savingTag}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '8px 16px', fontSize: '12px', fontWeight: 600,
                color: '#fff',
                backgroundColor: savingTag ? '#9ca3af' : '#10b981',
                border: 'none', borderRadius: '7px',
                cursor: savingTag ? 'not-allowed' : 'pointer',
              }}
            >
              <Save size={13} />
              {savingTag ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        )}
      </div>

      <style>{`
        @keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }
      `}</style>
    </div>
  );
}
