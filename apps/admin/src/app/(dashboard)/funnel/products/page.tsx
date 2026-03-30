'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Package, X, Trash2, Search, Loader2, ChevronRight,
  Image as ImageIcon, RefreshCw, Tag, Sparkles, Save,
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
  variants: Array<{ id: string; title: string; price: string; available: boolean; image: string }>;
}

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

interface TaggingStatus {
  total: number;
  tagged: number;
  untagged: number;
  lastTaggedAt: string | null;
  inProgress: boolean;
  progress?: { current: number; total: number; handle: string; title: string; status: string } | null;
}

// ── Constants ───────────────────────────────────────────────────────────────

const ACCENT = '#10b981';
const BASE = process.env.NEXT_PUBLIC_BACKEND_URL || '';

const ALL_MOOD_KEYS = [
  'golden-nook', 'layered-warmth', 'soft-modern', 'quiet-glow',
  'gilded-evening', 'deep-amber', 'foundry-glow', 'midnight-warmth',
];

const MOOD_LABELS: Record<string, string> = {
  'golden-nook': 'Golden Nook', 'layered-warmth': 'Layered Warmth',
  'soft-modern': 'Soft Modern', 'quiet-glow': 'Quiet Glow',
  'gilded-evening': 'Gilded Evening', 'deep-amber': 'Deep Amber',
  'foundry-glow': 'Foundry Glow', 'midnight-warmth': 'Midnight Warmth',
};

const MOOD_COLORS: Record<string, string> = {
  'golden-nook': '#c8a060', 'layered-warmth': '#d4956a',
  'soft-modern': '#8cb4c0', 'quiet-glow': '#c4b8a0',
  'gilded-evening': '#c8a040', 'deep-amber': '#7a5530',
  'foundry-glow': '#8a7060', 'midnight-warmth': '#6a3040',
};

const PRODUCT_TYPES = ['pendant', 'floor_lamp', 'table_lamp', 'wall_sconce', 'chandelier', 'ceiling_light', 'desk_lamp'];

// ── Main Page ───────────────────────────────────────────────────────────────

export default function ProductPoolsPage() {
  // Catalog
  const [catalog, setCatalog] = useState<CatalogProduct[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);

  // AI tagging
  const [taggingStatus, setTaggingStatus] = useState<TaggingStatus | null>(null);
  const [taggingStarting, setTaggingStarting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval>>(undefined);

  // Mood tags
  const [moodTags, setMoodTags] = useState<Record<string, MoodTag>>({});
  const [moodTagsLoaded, setMoodTagsLoaded] = useState(false);

  // Collections
  const [collections, setCollections] = useState<Record<string, CollectionData>>({});
  const [collectionsLoading, setCollectionsLoading] = useState(false);
  const [expandedCollection, setExpandedCollection] = useState<string | null>(null);

  // Product detail panel
  const [selectedProduct, setSelectedProduct] = useState<CatalogProduct | null>(null);
  const [editingScores, setEditingScores] = useState<Record<string, number> | null>(null);
  const [editingType, setEditingType] = useState<string>('');
  const [savingTag, setSavingTag] = useState(false);
  const [retagging, setRetagging] = useState(false);

  // Search
  const [search, setSearch] = useState('');

  // ── Data fetching ─────────────────────────────────────────────────

  useEffect(() => {
    const cached = localStorage.getItem('quiz_catalog');
    if (cached) {
      try { setCatalog(JSON.parse(cached).products || []); } catch { /* ignore */ }
    }
  }, []);

  const syncCatalog = useCallback(async () => {
    setCatalogLoading(true);
    try {
      const res = await fetch(`${BASE}/api/quiz/catalog`);
      if (!res.ok) throw new Error(`Sync failed`);
      const data = await res.json();
      setCatalog(data.products || []);
      localStorage.setItem('quiz_catalog', JSON.stringify(data));
    } catch (err) { console.error(err); }
    setCatalogLoading(false);
  }, []);

  const fetchTaggingStatus = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/api/quiz/batch-tag/status`);
      if (res.ok) setTaggingStatus(await res.json());
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchTaggingStatus(); }, [fetchTaggingStatus]);

  useEffect(() => {
    if (taggingStatus?.inProgress) {
      pollRef.current = setInterval(fetchTaggingStatus, 2000);
    } else {
      if (pollRef.current) clearInterval(pollRef.current);
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [taggingStatus?.inProgress, fetchTaggingStatus]);

  const fetchMoodTags = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/api/quiz/mood-tags`);
      if (!res.ok) return;
      const data = await res.json();
      const byHandle: Record<string, MoodTag> = {};
      for (const tag of (data.tags || [])) byHandle[tag.product_handle] = tag;
      setMoodTags(byHandle);
      setMoodTagsLoaded(true);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchMoodTags(); }, [fetchMoodTags]);

  const fetchCollections = useCallback(async () => {
    setCollectionsLoading(true);
    try {
      const cached = localStorage.getItem('quiz_collections');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed.synced_at && Date.now() - new Date(parsed.synced_at).getTime() < 3600000) {
          setCollections(parsed.collections || {});
          setCollectionsLoading(false);
          return;
        }
      }
      const res = await fetch(`${BASE}/api/quiz/collections`);
      if (!res.ok) throw new Error('Failed');
      const data = await res.json();
      setCollections(data.collections || {});
      localStorage.setItem('quiz_collections', JSON.stringify(data));
    } catch (err) { console.error(err); }
    setCollectionsLoading(false);
  }, []);

  useEffect(() => { fetchCollections(); }, [fetchCollections]);

  useEffect(() => {
    if (moodTagsLoaded && taggingStatus && !taggingStatus.inProgress) fetchMoodTags();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taggingStatus?.inProgress]);

  // ── Tag management ────────────────────────────────────────────────

  async function saveTagEdits(handle: string) {
    if (!editingScores) return;
    setSavingTag(true);
    try {
      const res = await fetch(`${BASE}/api/quiz/mood-tags/${handle}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mood_scores: editingScores, product_type: editingType || null }),
      });
      if (!res.ok) throw new Error('Failed');
      await fetchMoodTags();
    } catch (err) { console.error(err); }
    setSavingTag(false);
  }

  async function deleteTag(handle: string) {
    if (!confirm('Remove all mood tags from this product?')) return;
    try {
      await fetch(`${BASE}/api/quiz/mood-tags/${handle}`, { method: 'DELETE' });
      await fetchMoodTags();
      setSelectedProduct(null);
    } catch (err) { console.error(err); }
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
      if (!res.ok) throw new Error('Failed');
      await fetchMoodTags();
      const updated = await res.json();
      if (updated.mood_scores) {
        setEditingScores(updated.mood_scores);
        setEditingType(updated.product_type || '');
      }
    } catch (err) { console.error(err); }
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

  async function startBatchTagging(force = false) {
    setTaggingStarting(true);
    try {
      const res = await fetch(`${BASE}/api/quiz/batch-tag`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force }),
      });
      if (!res.ok) throw new Error('Failed');
      setTimeout(fetchTaggingStatus, 1000);
    } catch (err) { console.error(err); }
    setTaggingStarting(false);
  }

  // ── Derived data ──────────────────────────────────────────────────

  const collectionEntries = useMemo(() => {
    return Object.entries(collections).map(([handle, col]) => {
      const products = col.products.map(p => {
        const tag = moodTags[p.handle];
        const taggedMoods = tag?.mood_scores
          ? Object.entries(tag.mood_scores).filter(([, v]) => v >= 0.5).map(([k]) => k)
          : [];
        return { ...p, taggedMoods, tag };
      });
      // Filter by search
      const filtered = search
        ? products.filter(p => p.title.toLowerCase().includes(search.toLowerCase()) || p.handle.toLowerCase().includes(search.toLowerCase()))
        : products;
      return { handle, label: col.label, type: col.type, products: filtered, totalProducts: col.products.length };
    });
  }, [collections, moodTags, search]);

  // Summary stats
  const totalProducts = Object.values(collections).reduce((s, c) => s + c.products.length, 0);
  const totalTagged = Object.keys(moodTags).length;

  // ── Render ────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* ── Header + Actions ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Package size={20} style={{ color: ACCENT }} />
          <h2 style={{ fontSize: '20px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
            Product Catalog
          </h2>
          <span style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>
            {totalProducts > 0 && `${totalProducts} products · ${totalTagged} tagged`}
          </span>
        </div>
        <div style={{ display: 'flex', gap: '6px' }}>
          <button
            onClick={() => { localStorage.removeItem('quiz_collections'); fetchCollections(); }}
            disabled={collectionsLoading}
            style={{
              display: 'flex', alignItems: 'center', gap: '5px', padding: '7px 12px',
              fontSize: '12px', fontWeight: 500, color: 'var(--text-secondary)',
              backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-primary)',
              borderRadius: '7px', cursor: collectionsLoading ? 'not-allowed' : 'pointer',
            }}
          >
            <RefreshCw size={12} style={{ animation: collectionsLoading ? 'spin 1s linear infinite' : 'none' }} />
            Sync
          </button>
          {taggingStatus?.tagged ? (
            <button
              onClick={() => startBatchTagging(true)}
              disabled={taggingStatus?.inProgress || taggingStarting}
              style={{
                display: 'flex', alignItems: 'center', gap: '5px', padding: '7px 12px',
                fontSize: '12px', fontWeight: 500, color: 'var(--text-secondary)',
                backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-primary)',
                borderRadius: '7px', cursor: taggingStatus?.inProgress ? 'not-allowed' : 'pointer',
              }}
            >
              Re-tag All
            </button>
          ) : null}
          <button
            onClick={() => startBatchTagging(false)}
            disabled={taggingStatus?.inProgress || taggingStarting}
            style={{
              display: 'flex', alignItems: 'center', gap: '5px', padding: '7px 14px',
              fontSize: '12px', fontWeight: 600, color: '#fff',
              backgroundColor: taggingStatus?.inProgress ? '#6b7280' : ACCENT,
              border: 'none', borderRadius: '7px',
              cursor: taggingStatus?.inProgress ? 'not-allowed' : 'pointer',
            }}
          >
            {taggingStatus?.inProgress ? (
              <><Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> Tagging...</>
            ) : taggingStarting ? (
              <><Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> Starting...</>
            ) : (
              <><Sparkles size={12} /> {taggingStatus?.tagged ? 'Tag New' : 'Tag All'}</>
            )}
          </button>
        </div>
      </div>

      {/* ── Progress bar (only when tagging) ── */}
      {taggingStatus?.inProgress && (
        <div style={{
          padding: '10px 14px', backgroundColor: 'var(--bg-primary)',
          border: '1px solid var(--border-primary)', borderRadius: '8px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '6px' }}>
            <span>
              Processing {taggingStatus.progress?.current ?? 0}/{taggingStatus.progress?.total ?? taggingStatus.total}
              {taggingStatus.progress?.title && <span style={{ color: 'var(--text-tertiary)', marginLeft: '8px' }}>— {taggingStatus.progress.title}</span>}
            </span>
            <span style={{ color: ACCENT }}>{taggingStatus.tagged} done</span>
          </div>
          <div style={{ height: '3px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '2px', overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              width: `${taggingStatus.progress ? (taggingStatus.progress.current / taggingStatus.progress.total * 100) : 0}%`,
              backgroundColor: '#f59e0b', borderRadius: '2px', transition: 'width 500ms ease',
            }} />
          </div>
        </div>
      )}

      {/* ── Search ── */}
      {totalProducts > 0 && (
        <div style={{ position: 'relative' }}>
          <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search products..."
            style={{
              width: '100%', padding: '8px 12px 8px 32px', fontSize: '13px',
              borderRadius: '8px', border: '1px solid var(--border-primary)',
              backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)',
              outline: 'none', boxSizing: 'border-box',
            }}
          />
        </div>
      )}

      {/* ── Collections ── */}
      {collectionsLoading ? (
        <div style={{ padding: '48px 20px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '14px' }}>
          <Loader2 size={20} style={{ animation: 'spin 1s linear infinite', margin: '0 auto 8px', display: 'block' }} />
          Loading collections...
        </div>
      ) : totalProducts === 0 ? (
        <div style={{ padding: '64px 20px', textAlign: 'center', backgroundColor: 'var(--bg-primary)', border: '1px dashed var(--border-primary)', borderRadius: '10px' }}>
          <RefreshCw size={28} style={{ color: 'var(--text-tertiary)', margin: '0 auto 10px' }} />
          <p style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text-secondary)', margin: '0 0 4px' }}>
            No products loaded
          </p>
          <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', margin: '0 0 14px' }}>
            Sync your Shopify collections to get started
          </p>
          <button
            onClick={() => { localStorage.removeItem('quiz_collections'); fetchCollections(); }}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 18px',
              fontSize: '13px', fontWeight: 500, color: '#fff', backgroundColor: ACCENT,
              border: 'none', borderRadius: '7px', cursor: 'pointer',
            }}
          >
            <RefreshCw size={13} /> Sync Now
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {collectionEntries.map(({ handle, label, products, totalProducts: total }) => {
            const isExpanded = expandedCollection === handle;
            const taggedCount = products.filter(p => p.taggedMoods.length > 0).length;
            const displayProducts = isExpanded ? products : products.slice(0, 4);

            return (
              <div key={handle} style={{
                backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-primary)',
                borderRadius: '10px', overflow: 'hidden',
              }}>
                {/* Collection header */}
                <div
                  onClick={() => setExpandedCollection(isExpanded ? null : handle)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '10px',
                    padding: '12px 16px', cursor: 'pointer', userSelect: 'none',
                  }}
                >
                  <ChevronRight size={14} style={{
                    color: 'var(--text-tertiary)', transition: 'transform 150ms',
                    transform: isExpanded ? 'rotate(90deg)' : 'none', flexShrink: 0,
                  }} />
                  <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', flex: 1 }}>
                    {label}
                  </span>
                  <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                    {taggedCount}/{total} tagged
                  </span>
                </div>

                {/* Products grid */}
                <div style={{ padding: '0 16px 14px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '8px' }}>
                    {displayProducts.map((p) => (
                      <ProductCard
                        key={p.handle}
                        product={p}
                        taggedMoods={p.taggedMoods}
                        onClick={() => {
                          const cat = catalog.find(c => c.handle === p.handle);
                          if (cat) openProductDetail(cat);
                        }}
                      />
                    ))}
                  </div>
                  {!isExpanded && products.length > 4 && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setExpandedCollection(handle); }}
                      style={{
                        display: 'block', width: '100%', padding: '8px', marginTop: '8px',
                        fontSize: '12px', fontWeight: 500, color: ACCENT,
                        backgroundColor: 'transparent', border: `1px dashed ${ACCENT}40`,
                        borderRadius: '6px', cursor: 'pointer', textAlign: 'center',
                      }}
                    >
                      Show all {products.length} products
                    </button>
                  )}
                </div>
              </div>
            );
          })}
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

      <style>{`@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>
    </div>
  );
}

// ── Product Card ────────────────────────────────────────────────────────────

function ProductCard({
  product, taggedMoods, onClick,
}: {
  product: CollectionProduct;
  taggedMoods: string[];
  onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        cursor: 'pointer', border: '1px solid var(--border-primary)', borderRadius: '8px',
        overflow: 'hidden', transition: 'border-color 150ms', position: 'relative',
      }}
      onMouseOver={(e) => (e.currentTarget.style.borderColor = ACCENT)}
      onMouseOut={(e) => (e.currentTarget.style.borderColor = 'var(--border-primary)')}
    >
      {/* Mood dots */}
      {taggedMoods.length > 0 && (
        <div style={{ position: 'absolute', top: '6px', right: '6px', zIndex: 2, display: 'flex', gap: '2px' }}>
          {taggedMoods.slice(0, 4).map((k) => (
            <div key={k} title={MOOD_LABELS[k] || k} style={{
              width: '7px', height: '7px', borderRadius: '50%',
              backgroundColor: MOOD_COLORS[k] || '#999',
              border: '1px solid rgba(255,255,255,0.8)',
            }} />
          ))}
          {taggedMoods.length > 4 && (
            <span style={{ fontSize: '7px', color: '#fff', lineHeight: '7px' }}>+{taggedMoods.length - 4}</span>
          )}
        </div>
      )}

      {product.image ? (
        <img src={product.image} alt={product.title} style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', display: 'block' }} loading="lazy" />
      ) : (
        <div style={{ width: '100%', aspectRatio: '1', backgroundColor: 'var(--bg-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <ImageIcon size={18} style={{ color: 'var(--text-tertiary)' }} />
        </div>
      )}
      <div style={{ padding: '6px 8px' }}>
        <div style={{ fontSize: '11px', fontWeight: 500, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {product.title}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>{product.price}</span>
          {taggedMoods.length === 0 && (
            <span style={{ fontSize: '8px', color: 'var(--text-tertiary)', fontStyle: 'italic' }}>untagged</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Product Detail Panel (slide-over) ───────────────────────────────────────

function ProductDetailPanel({
  product, moodTag, editingScores, editingType, savingTag, retagging,
  onClose, onScoreChange, onTypeChange, onSave, onDelete, onRetag,
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
        width: '440px', maxWidth: '100vw', backgroundColor: 'var(--bg-primary)',
        borderLeft: '1px solid var(--border-primary)',
        display: 'flex', flexDirection: 'column', height: '100%',
        animation: 'slideIn 200ms ease-out',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 20px', borderBottom: '1px solid var(--border-primary)', flexShrink: 0,
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

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
          {/* Product info */}
          <div style={{ display: 'flex', gap: '14px', marginBottom: '16px' }}>
            {product.image ? (
              <img src={product.image} alt={product.title} style={{ width: '72px', height: '72px', objectFit: 'cover', borderRadius: '8px', flexShrink: 0 }} />
            ) : (
              <div style={{ width: '72px', height: '72px', borderRadius: '8px', backgroundColor: 'var(--bg-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <ImageIcon size={20} style={{ color: 'var(--text-tertiary)' }} />
              </div>
            )}
            <div>
              <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '2px' }}>{product.title}</div>
              <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginBottom: '2px' }}>{product.handle}</div>
              <div style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)' }}>{product.price}</div>
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
            <button
              onClick={onRetag}
              disabled={retagging}
              style={{
                display: 'flex', alignItems: 'center', gap: '5px',
                padding: '7px 14px', fontSize: '12px', fontWeight: 500,
                color: '#fff', backgroundColor: retagging ? '#9ca3af' : ACCENT,
                border: 'none', borderRadius: '7px', cursor: retagging ? 'not-allowed' : 'pointer',
              }}
            >
              {retagging ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <Sparkles size={12} />}
              {hasTag ? 'Re-tag' : 'Tag with AI'}
            </button>
            {hasTag && (
              <button
                onClick={onDelete}
                style={{
                  display: 'flex', alignItems: 'center', gap: '4px',
                  padding: '7px 12px', fontSize: '12px', fontWeight: 500,
                  color: '#ef4444', backgroundColor: 'rgba(239,68,68,0.06)',
                  border: '1px solid rgba(239,68,68,0.15)', borderRadius: '7px', cursor: 'pointer',
                }}
              >
                <Trash2 size={11} /> Remove
              </button>
            )}
          </div>

          {/* No tag state */}
          {!hasTag && !editingScores && (
            <div style={{
              padding: '20px', textAlign: 'center', border: '1px dashed var(--border-primary)',
              borderRadius: '8px', color: 'var(--text-tertiary)', fontSize: '12px',
            }}>
              <Tag size={20} style={{ margin: '0 auto 6px', display: 'block' }} />
              No mood tags — click &quot;Tag with AI&quot; to analyze
            </div>
          )}

          {/* Mood editor */}
          {(hasTag || editingScores) && (
            <div>
              {/* Product type */}
              <div style={{ marginBottom: '14px' }}>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Type
                </label>
                <select
                  value={editingType}
                  onChange={(e) => onTypeChange(e.target.value)}
                  style={{
                    padding: '6px 10px', fontSize: '12px', borderRadius: '6px',
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

              {/* Mood toggles */}
              <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Mood Tags
              </label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {ALL_MOOD_KEYS.map((key) => {
                  const isOn = (scores[key] ?? 0) >= 0.5;
                  const moodColor = MOOD_COLORS[key] || ACCENT;
                  return (
                    <div
                      key={key}
                      onClick={() => onScoreChange(key, isOn ? 0 : 1)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '10px',
                        padding: '7px 12px', borderRadius: '6px', cursor: 'pointer',
                        backgroundColor: isOn ? `${moodColor}10` : 'var(--bg-secondary)',
                        border: `1px solid ${isOn ? `${moodColor}40` : 'var(--border-primary)'}`,
                        transition: 'all 150ms',
                      }}
                    >
                      <div style={{ width: '7px', height: '7px', borderRadius: '50%', backgroundColor: moodColor, flexShrink: 0 }} />
                      <span style={{
                        fontSize: '12px', fontWeight: 500, flex: 1,
                        color: isOn ? 'var(--text-primary)' : 'var(--text-tertiary)',
                      }}>
                        {MOOD_LABELS[key] || key}
                      </span>
                      {/* Toggle */}
                      <div style={{
                        width: '32px', height: '18px', borderRadius: '9px',
                        backgroundColor: isOn ? moodColor : 'var(--bg-tertiary)',
                        position: 'relative', transition: 'background-color 150ms', flexShrink: 0,
                      }}>
                        <div style={{
                          width: '14px', height: '14px', borderRadius: '50%',
                          backgroundColor: '#fff', position: 'absolute', top: '2px',
                          left: isOn ? '16px' : '2px', transition: 'left 150ms',
                          boxShadow: '0 1px 2px rgba(0,0,0,0.15)',
                        }} />
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Tagged by info */}
              {moodTag && (
                <div style={{ marginTop: '14px', padding: '8px 10px', backgroundColor: 'var(--bg-secondary)', borderRadius: '6px', fontSize: '10px', color: 'var(--text-tertiary)' }}>
                  Tagged by AI · {moodTag.tagged_at && new Date(moodTag.tagged_at).toLocaleString()}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {(hasTag || editingScores) && (
          <div style={{
            display: 'flex', justifyContent: 'flex-end', gap: '8px',
            padding: '12px 20px', borderTop: '1px solid var(--border-primary)', flexShrink: 0,
          }}>
            <button
              onClick={onClose}
              style={{
                padding: '7px 14px', fontSize: '12px', fontWeight: 500,
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
                display: 'flex', alignItems: 'center', gap: '5px',
                padding: '7px 14px', fontSize: '12px', fontWeight: 600,
                color: '#fff', backgroundColor: savingTag ? '#9ca3af' : ACCENT,
                border: 'none', borderRadius: '7px',
                cursor: savingTag ? 'not-allowed' : 'pointer',
              }}
            >
              <Save size={12} />
              {savingTag ? 'Saving...' : 'Save'}
            </button>
          </div>
        )}
      </div>

      <style>{`@keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }`}</style>
    </div>
  );
}
