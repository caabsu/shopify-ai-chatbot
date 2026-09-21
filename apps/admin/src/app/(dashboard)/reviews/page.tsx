'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Star,
  Search,
  ChevronLeft,
  ChevronRight,
  CheckSquare,
  Square,
  Camera,
  ShieldCheck,
  Sparkles,
  Send,
  Loader2,
  ChevronDown,
  ChevronUp,
  Trash2,
  Image,
  X,
  PencilLine,
  Save,
  Home,
  RotateCcw,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';
import { useBrand } from '@/components/brand-context';
import { StatusPill } from '@/components/ui/StatusPill';

interface ReviewMedia {
  id: string;
  url: string;
  media_type: string;
}

interface ReviewReply {
  id: string;
  author_name: string;
  body: string;
}

interface Review {
  id: string;
  product_id: string;
  shopify_product_id: string | null;
  customer_email: string;
  customer_name: string;
  customer_nickname: string | null;
  rating: number;
  title: string | null;
  body: string;
  status: 'published' | 'pending' | 'rejected' | 'archived';
  verified_purchase: boolean;
  incentivized: boolean;
  variant_title: string | null;
  source: string;
  featured: boolean;
  helpful_count: number;
  report_count: number;
  published_at: string | null;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
  brand_id: string;
  product_title: string | null;
  media_count: number;
  media?: ReviewMedia[];
  reply?: ReviewReply | null;
}

interface FilterCounts {
  all: number;
  published: number;
  pending: number;
  rejected: number;
  archived: number;
  with_photos: number;
  featured: number;
}

interface ReviewEditDraft {
  customer_name: string;
  customer_email: string;
  customer_nickname: string;
  rating: number;
  title: string;
  body: string;
  variant_title: string;
  status: Review['status'];
  featured: boolean;
  verified_purchase: boolean;
  incentivized: boolean;
  submitted_at: string;
}

// Human labels for review statuses. Colors come from the design tokens (StatusPill).
const REVIEW_LABELS: Record<string, string> = {
  published: 'Published',
  pending: 'Pending',
  rejected: 'Rejected',
  archived: 'Archived',
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

function toDateTimeLocal(dateStr: string | null): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function reviewToDraft(review: Review): ReviewEditDraft {
  return {
    customer_name: review.customer_name ?? '',
    customer_email: review.customer_email ?? '',
    customer_nickname: review.customer_nickname ?? '',
    rating: review.rating,
    title: review.title ?? '',
    body: review.body ?? '',
    variant_title: review.variant_title ?? '',
    status: review.status,
    featured: review.featured,
    verified_purchase: review.verified_purchase,
    incentivized: review.incentivized,
    submitted_at: toDateTimeLocal(review.submitted_at || review.created_at),
  };
}

function Stars({ rating, size = 14 }: { rating: number; size?: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          size={size}
          fill={i <= rating ? 'var(--color-star)' : 'none'}
          stroke={i <= rating ? 'var(--color-star)' : 'var(--text-tertiary)'}
          strokeWidth={1.5}
        />
      ))}
    </div>
  );
}

// ── Lightbox Component ──
function Lightbox({
  images,
  startIndex,
  onClose,
}: {
  images: { url: string; media_type: string }[];
  startIndex: number;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(startIndex);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') setIndex((i) => (i - 1 + images.length) % images.length);
      if (e.key === 'ArrowRight') setIndex((i) => (i + 1) % images.length);
    }
    document.addEventListener('keydown', handleKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = '';
    };
  }, [images.length, onClose]);

  const img = images[index];

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.85)' }}
      onClick={onClose}
    >
      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 text-white/80 hover:text-white transition-colors z-10"
      >
        <X size={28} />
      </button>

      {/* Counter */}
      {images.length > 1 && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 text-white/60 text-sm font-medium">
          {index + 1} / {images.length}
        </div>
      )}

      {/* Image */}
      <div onClick={(e) => e.stopPropagation()} className="relative max-w-[90vw] max-h-[90vh]">
        {img.media_type === 'video' ? (
          <video
            src={img.url}
            controls
            className="max-w-[90vw] max-h-[90vh] rounded-lg"
          />
        ) : (
          <img
            src={img.url}
            alt={`Review photo ${index + 1}`}
            className="max-w-[90vw] max-h-[90vh] rounded-lg object-contain"
          />
        )}
      </div>

      {/* Nav arrows */}
      {images.length > 1 && (
        <>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIndex((i) => (i - 1 + images.length) % images.length);
            }}
            className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center rounded-full text-white/70 hover:text-white hover:bg-white/10 transition-colors text-2xl"
          >
            &#8249;
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIndex((i) => (i + 1) % images.length);
            }}
            className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center rounded-full text-white/70 hover:text-white hover:bg-white/10 transition-colors text-2xl"
          >
            &#8250;
          </button>
        </>
      )}
    </div>
  );
}

export default function AllReviewsPage() {
  const { brandSlug } = useBrand();
  const [reviews, setReviews] = useState<Review[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);

  const [statusFilter, setStatusFilter] = useState('');
  const [ratingFilter, setRatingFilter] = useState('');
  const [productFilter, setProductFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [mediaFilter, setMediaFilter] = useState('');
  const [placementFilter, setPlacementFilter] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('newest');

  const [counts, setCounts] = useState<FilterCounts>({
    all: 0,
    published: 0,
    pending: 0,
    rejected: 0,
    archived: 0,
    with_photos: 0,
    featured: 0,
  });

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Reply state
  const [replyText, setReplyText] = useState('');
  const [replyAuthor, setReplyAuthor] = useState('');
  const [replySaving, setReplySaving] = useState(false);
  const [aiDrafting, setAiDrafting] = useState(false);

  // Review editing state
  const [editDraft, setEditDraft] = useState<ReviewEditDraft | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');
  const [editSaved, setEditSaved] = useState(false);

  const [bulkLoading, setBulkLoading] = useState(false);

  // Products for filter dropdown
  const [products, setProducts] = useState<{ id: string; title: string }[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/reviews/products');
        const data = await res.json();
        setProducts((data.products ?? data.items ?? []).map((p: Record<string, string>) => ({ id: p.id, title: p.title })));
      } catch { /* ignore */ }
    })();
  }, []);

  // Lightbox state
  const [lightboxImages, setLightboxImages] = useState<{ url: string; media_type: string }[] | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState(0);

  const perPage = 20;

  const loadCounts = useCallback(async () => {
    try {
      const res = await fetch('/api/reviews/stats');
      const data = await res.json();
      setCounts({
        all: data.all ?? 0,
        published: data.published ?? 0,
        pending: data.pending ?? 0,
        rejected: data.rejected ?? 0,
        archived: data.archived ?? 0,
        with_photos: data.with_photos ?? 0,
        featured: data.featured ?? 0,
      });
    } catch {
      // ignore
    }
  }, []);

  const loadReviews = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({
      page: String(page),
      per_page: String(perPage),
    });
    if (statusFilter) params.set('status', statusFilter);
    if (ratingFilter) params.set('rating', ratingFilter);
    if (productFilter) params.set('product_id', productFilter);
    if (sourceFilter) params.set('source', sourceFilter);
    if (mediaFilter) params.set('has_media', mediaFilter);
    if (placementFilter) params.set('featured', placementFilter);
    if (search) params.set('search', search);
    if (sort) params.set('sort', sort);

    try {
      const res = await fetch(`/api/reviews?${params}`);
      const data = await res.json();
      setReviews(data.items ?? []);
      setTotal(data.total ?? 0);
      setTotalPages(data.totalPages ?? 1);
    } catch {
      setReviews([]);
    }
    setLoading(false);
  }, [page, statusFilter, ratingFilter, productFilter, sourceFilter, mediaFilter, placementFilter, search, sort]);

  useEffect(() => {
    loadCounts();
  }, [loadCounts]);
  useEffect(() => {
    loadReviews();
  }, [loadReviews]);

  const viewFilters = [
    { key: '', label: 'All Reviews', count: counts.all },
    { key: 'published', label: 'Published', count: counts.published },
    { key: 'pending', label: 'Pending', count: counts.pending },
    { key: 'rejected', label: 'Rejected', count: counts.rejected },
    { key: 'archived', label: 'Archived', count: counts.archived },
  ];

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.size === reviews.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(reviews.map((r) => r.id)));
    }
  }

  async function bulkAction(action: 'publish' | 'reject' | 'archive' | 'delete' | 'feature' | 'unfeature') {
    if (selected.size === 0) return;
    setBulkLoading(true);
    try {
      await fetch('/api/reviews/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selected), action }),
      });
      setSelected(new Set());
      loadReviews();
      loadCounts();
    } catch {
      // ignore
    }
    setBulkLoading(false);
  }

  async function handleExpand(review: Review) {
    if (expandedId === review.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(review.id);
    setReplyText('');
    setReplyAuthor('');
    setEditDraft(reviewToDraft(review));
    setEditError('');
    setEditSaved(false);

    try {
      const res = await fetch(`/api/reviews/${review.id}`);
      if (res.ok) {
        const data = await res.json();
        const detail = data.review ?? data;
        setEditDraft(reviewToDraft({ ...review, ...detail }));
        setReviews((prev) =>
          prev.map((r) =>
            r.id === review.id
              ? { ...r, media: detail.media ?? [], reply: detail.reply ?? null }
              : r,
          ),
        );
        if (detail.reply) {
          setReplyText(detail.reply.body || '');
          setReplyAuthor(detail.reply.author_name || '');
        }
      }
    } catch {
      // ignore
    }
  }

  async function handleSaveReview(reviewId: string) {
    if (!editDraft) return;
    const submittedAt = new Date(editDraft.submitted_at);
    if (Number.isNaN(submittedAt.getTime())) {
      setEditError('Enter a valid submitted date.');
      return;
    }
    setEditSaving(true);
    setEditError('');
    setEditSaved(false);

    try {
      const res = await fetch(`/api/reviews/${reviewId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...editDraft,
          title: editDraft.title || null,
          customer_nickname: editDraft.customer_nickname || null,
          variant_title: editDraft.variant_title || null,
          submitted_at: submittedAt.toISOString(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Unable to save review');
      }

      const updated = data.review as Review;
      setReviews((prev) =>
        prev.map((review) => (
          review.id === reviewId
            ? { ...review, ...updated }
            : review
        )),
      );
      setEditDraft(reviewToDraft(updated));
      setEditSaved(true);
      void loadCounts();
    } catch (error) {
      setEditError(error instanceof Error ? error.message : 'Unable to save review');
    } finally {
      setEditSaving(false);
    }
  }

  function resetReviewDraft(review: Review) {
    setEditDraft(reviewToDraft(review));
    setEditError('');
    setEditSaved(false);
  }

  async function handleSaveReply(reviewId: string) {
    setReplySaving(true);
    try {
      const res = await fetch(`/api/reviews/${reviewId}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ author_name: replyAuthor, body: replyText }),
      });
      if (res.ok) {
        const data = await res.json();
        setReviews((prev) =>
          prev.map((r) =>
            r.id === reviewId
              ? { ...r, reply: data.reply ?? { author_name: replyAuthor, body: replyText, id: '' } }
              : r,
          ),
        );
      }
    } catch {
      // ignore
    }
    setReplySaving(false);
  }

  async function handleAiDraft(reviewId: string) {
    setAiDrafting(true);
    try {
      const res = await fetch(`/api/reviews/${reviewId}/reply`);
      const data = await res.json();
      if (data.draft) {
        setReplyText(data.draft);
      }
    } catch {
      // ignore
    }
    setAiDrafting(false);
  }

  async function handleQuickStatus(reviewId: string, newStatus: string) {
    try {
      await fetch(`/api/reviews/${reviewId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      loadReviews();
      loadCounts();
    } catch {
      // ignore
    }
  }

  function openLightbox(media: ReviewMedia[], startIdx: number) {
    setLightboxImages(media);
    setLightboxIndex(startIdx);
  }

  const inputStyle = {
    backgroundColor: 'var(--bg-secondary)',
    border: '1px solid var(--border-primary)',
    color: 'var(--text-primary)',
  } as React.CSSProperties;

  return (
    <div className="space-y-4">
      {/* Lightbox */}
      {lightboxImages && (
        <Lightbox
          images={lightboxImages}
          startIndex={lightboxIndex}
          onClose={() => setLightboxImages(null)}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Star size={20} style={{ color: 'var(--text-primary)' }} />
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
            All Reviews
          </h2>
          <span className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
            {total} {total === 1 ? 'review' : 'reviews'}
          </span>
          {brandSlug && (
            <span
              className="text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded-full"
              style={{
                color: 'var(--color-accent)',
                backgroundColor: 'color-mix(in srgb, var(--color-accent) 9%, transparent)',
              }}
            >
              {brandSlug.replace(/-/g, ' ')}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <select
            value={sort}
            onChange={(e) => {
              setSort(e.target.value);
              setPage(1);
            }}
            className="text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2"
            style={inputStyle}
          >
            <option value="newest">Newest First</option>
            <option value="oldest">Oldest First</option>
            <option value="highest">Highest Rated</option>
            <option value="lowest">Lowest Rated</option>
          </select>
          <div className="relative">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2"
              style={{ color: 'var(--text-tertiary)' }}
            />
            <input
              placeholder="Search reviews..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="pl-9 pr-3 py-2 text-sm rounded-lg w-64 focus:outline-none focus:ring-2"
              style={
                {
                  ...inputStyle,
                  '--tw-ring-color': 'var(--color-accent)',
                } as React.CSSProperties
              }
            />
          </div>
        </div>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div
          className="flex items-center gap-3 px-4 py-2.5 rounded-lg"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--color-accent) 8%, transparent)',
            border: '1px solid color-mix(in srgb, var(--color-accent) 20%, transparent)',
          }}
        >
          <span className="text-xs font-medium" style={{ color: 'var(--color-accent)' }}>
            {selected.size} selected
          </span>
          <div className="flex items-center gap-2 ml-auto">
            {(['publish', 'feature', 'unfeature', 'reject', 'archive', 'delete'] as const).map((action) => (
              <button
                key={action}
                onClick={() => bulkAction(action)}
                disabled={bulkLoading}
                className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                style={{
                  backgroundColor: action === 'delete' ? 'rgba(239,68,68,0.12)' : 'var(--bg-primary)',
                  color: action === 'delete' ? 'var(--color-danger)' : 'var(--text-secondary)',
                  border: '1px solid var(--border-primary)',
                }}
              >
                {action === 'delete' ? (
                  <span className="flex items-center gap-1">
                    <Trash2 size={11} /> Delete
                  </span>
                ) : action === 'feature' ? (
                  <span className="flex items-center gap-1">
                    <Home size={11} /> Add to homepage
                  </span>
                ) : action === 'unfeature' ? (
                  'Remove from homepage'
                ) : (
                  action.charAt(0).toUpperCase() + action.slice(1)
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Main layout: sidebar + list */}
      <div className="flex gap-4">
        {/* Filter Sidebar */}
        <div className="w-48 flex-shrink-0 space-y-5">
          {/* Views */}
          <div>
            <p
              className="text-[10px] font-semibold uppercase tracking-wider px-2 mb-2"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Views
            </p>
            <div className="space-y-0.5">
              {viewFilters.map((f) => {
                const active = statusFilter === f.key && !mediaFilter;
                return (
                  <button
                    key={f.key}
                    onClick={() => {
                      setStatusFilter(f.key);
                      setMediaFilter('');
                      setPage(1);
                    }}
                    className="w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-[13px] transition-colors"
                    style={{
                      backgroundColor: active
                        ? 'color-mix(in srgb, var(--color-accent) 10%, transparent)'
                        : 'transparent',
                      color: active ? 'var(--color-accent)' : 'var(--text-secondary)',
                      fontWeight: active ? 500 : 400,
                    }}
                  >
                    <span>{f.label}</span>
                    <span className="text-[11px] min-w-[20px] text-center" style={{ color: 'var(--text-tertiary)' }}>
                      {f.count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Storefront placement */}
          <div>
            <p
              className="text-[10px] font-semibold uppercase tracking-wider px-2 mb-2"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Storefront
            </p>
            <div className="space-y-0.5">
              <button
                onClick={() => {
                  setPlacementFilter(placementFilter === 'true' ? '' : 'true');
                  setPage(1);
                }}
                className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[13px] transition-colors"
                style={{
                  backgroundColor: placementFilter === 'true'
                    ? 'color-mix(in srgb, var(--color-accent) 10%, transparent)'
                    : 'transparent',
                  color: placementFilter === 'true' ? 'var(--color-accent)' : 'var(--text-secondary)',
                  fontWeight: placementFilter === 'true' ? 500 : 400,
                }}
              >
                <Home size={12} />
                <span>Homepage</span>
                <span className="text-[11px] ml-auto" style={{ color: 'var(--text-tertiary)' }}>
                  {counts.featured}
                </span>
              </button>
            </div>
          </div>

          {/* Media Filter */}
          <div>
            <p
              className="text-[10px] font-semibold uppercase tracking-wider px-2 mb-2"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Media
            </p>
            <div className="space-y-0.5">
              {[
                { key: '', label: 'All', icon: null },
                { key: '1', label: 'With Photos', icon: Image },
                { key: '0', label: 'Text Only', icon: null },
              ].map((f) => {
                const active = mediaFilter === f.key && f.key !== '';
                return (
                  <button
                    key={f.key || 'all-media'}
                    onClick={() => {
                      setMediaFilter(f.key);
                      setPage(1);
                    }}
                    className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[13px] transition-colors"
                    style={{
                      backgroundColor: active
                        ? 'color-mix(in srgb, var(--color-accent) 10%, transparent)'
                        : 'transparent',
                      color: active ? 'var(--color-accent)' : 'var(--text-secondary)',
                      fontWeight: active ? 500 : 400,
                    }}
                  >
                    {f.icon && <f.icon size={12} />}
                    <span>{f.label}</span>
                    {f.key === '1' && (
                      <span className="text-[11px] ml-auto" style={{ color: 'var(--text-tertiary)' }}>
                        {counts.with_photos}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Rating Filter */}
          <div>
            <p
              className="text-[10px] font-semibold uppercase tracking-wider px-2 mb-2"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Rating
            </p>
            <select
              value={ratingFilter}
              onChange={(e) => {
                setRatingFilter(e.target.value);
                setPage(1);
              }}
              className="w-full text-xs rounded-lg px-2 py-1.5 focus:outline-none"
              style={inputStyle}
            >
              <option value="">Any Rating</option>
              {[5, 4, 3, 2, 1].map((r) => (
                <option key={r} value={String(r)}>
                  {r} Star{r > 1 ? 's' : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Source Filter */}
          <div>
            <p
              className="text-[10px] font-semibold uppercase tracking-wider px-2 mb-2"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Source
            </p>
            <select
              value={sourceFilter}
              onChange={(e) => {
                setSourceFilter(e.target.value);
                setPage(1);
              }}
              className="w-full text-xs rounded-lg px-2 py-1.5 focus:outline-none"
              style={inputStyle}
            >
              <option value="">Any Source</option>
              <option value="organic">Organic</option>
              <option value="email_request">Email</option>
              <option value="import">Import</option>
              <option value="manual">Manual</option>
            </select>
          </div>

          {/* Product Filter */}
          <div>
            <p
              className="text-[10px] font-semibold uppercase tracking-wider px-2 mb-2"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Product
            </p>
            <select
              value={productFilter}
              onChange={(e) => {
                setProductFilter(e.target.value);
                setPage(1);
              }}
              className="w-full text-xs rounded-lg px-2 py-1.5 focus:outline-none"
              style={inputStyle}
            >
              <option value="">All Products</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Review List */}
        <div className="flex-1 min-w-0">
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
                <Loader2 size={20} className="animate-spin mx-auto mb-2" style={{ color: 'var(--text-tertiary)' }} />
                <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
                  Loading reviews...
                </p>
              </div>
            ) : reviews.length === 0 ? (
              <div className="p-12 text-center">
                <Star size={32} className="mx-auto mb-3" style={{ color: 'var(--text-tertiary)' }} />
                <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
                  No reviews found
                </p>
                <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
                  Try adjusting your filters
                </p>
              </div>
            ) : (
              <>
                {/* Select all header */}
                <div
                  className="flex items-center gap-3 px-4 py-2"
                  style={{ borderBottom: '1px solid var(--border-secondary)' }}
                >
                  <button onClick={toggleSelectAll} style={{ color: 'var(--text-tertiary)' }}>
                    {selected.size === reviews.length ? (
                      <CheckSquare size={16} />
                    ) : (
                      <Square size={16} />
                    )}
                  </button>
                  <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                    Select all
                  </span>
                </div>

                <div className="divide-y" style={{ borderColor: 'var(--border-secondary)' }}>
                  {reviews.map((review) => {
                    const isExpanded = expandedId === review.id;
                    const isSelected = selected.has(review.id);

                    return (
                      <div key={review.id}>
                        {/* Row */}
                        <div
                          className="flex items-start gap-3 px-4 py-3 transition-colors cursor-pointer"
                          style={{
                            backgroundColor: isExpanded
                              ? 'color-mix(in srgb, var(--color-accent) 4%, transparent)'
                              : 'transparent',
                          }}
                          onMouseEnter={(e) => {
                            if (!isExpanded)
                              e.currentTarget.style.backgroundColor = 'var(--bg-hover)';
                          }}
                          onMouseLeave={(e) => {
                            if (!isExpanded)
                              e.currentTarget.style.backgroundColor = 'transparent';
                          }}
                          onClick={() => handleExpand(review)}
                        >
                          {/* Checkbox */}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleSelect(review.id);
                            }}
                            className="pt-0.5 flex-shrink-0"
                            style={{ color: isSelected ? 'var(--color-accent)' : 'var(--text-tertiary)' }}
                          >
                            {isSelected ? <CheckSquare size={16} /> : <Square size={16} />}
                          </button>

                          {/* Left content */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span
                                className="text-sm font-medium truncate"
                                style={{ color: 'var(--text-primary)' }}
                              >
                                {review.customer_nickname || review.customer_name || 'Anonymous'}
                              </span>
                              {review.source && (
                                <span
                                  className="text-[9px] font-medium px-1.5 py-0.5 rounded-full uppercase"
                                  style={{
                                    backgroundColor: 'rgba(107,114,128,0.10)',
                                    color: 'var(--text-tertiary)',
                                  }}
                                >
                                  {review.source}
                                </span>
                              )}
                            </div>
                            <p className="text-xs mb-1 truncate" style={{ color: 'var(--text-secondary)' }}>
                              {review.product_title || 'Unknown Product'}
                              {review.variant_title && (
                                <span style={{ color: 'var(--text-tertiary)' }}> — {review.variant_title}</span>
                              )}
                            </p>
                            <Stars rating={review.rating} size={12} />
                          </div>

                          {/* Right side */}
                          <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                            <div className="flex items-center gap-1.5">
                              <StatusPill kind="review" value={review.status} label={REVIEW_LABELS[review.status]} />
                              {review.featured && (
                                <span
                                  className="text-[10px] font-medium px-1.5 py-0.5 rounded-full flex items-center gap-0.5"
                                  style={{
                                    backgroundColor: 'color-mix(in srgb, var(--color-accent) 12%, transparent)',
                                    color: 'var(--color-accent)',
                                  }}
                                  title="Displayed in homepage review integrations"
                                >
                                  <Home size={9} /> Homepage
                                </span>
                              )}
                              {review.verified_purchase && (
                                <span
                                  className="text-[10px] font-medium px-1.5 py-0.5 rounded-full flex items-center gap-0.5"
                                  style={{
                                    backgroundColor: 'rgba(59,130,246,0.12)',
                                    color: 'var(--color-info)',
                                  }}
                                >
                                  <ShieldCheck size={9} /> Verified
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              {review.media_count > 0 && (
                                <span
                                  className="flex items-center gap-0.5 text-[10px] font-medium"
                                  style={{ color: 'var(--color-source-ai)' }}
                                >
                                  <Camera size={10} /> {review.media_count}
                                </span>
                              )}
                              <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                                {timeAgo(review.submitted_at || review.created_at)}
                              </span>
                            </div>
                            <div className="pt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                              {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                            </div>
                          </div>
                        </div>

                        {/* Expanded content */}
                        {isExpanded && (
                          <div
                            className="px-4 pb-4 pt-0"
                            style={{
                              backgroundColor: 'color-mix(in srgb, var(--color-accent) 4%, transparent)',
                              borderTop: '1px solid var(--border-secondary)',
                            }}
                          >
                            <div className="pl-8 space-y-4 pt-3">
                              {/* Review editor */}
                              {editDraft && (
                                <div
                                  className="rounded-xl p-4 space-y-4"
                                  style={{
                                    backgroundColor: 'var(--bg-primary)',
                                    border: '1px solid var(--border-primary)',
                                  }}
                                >
                                  <div className="flex items-start justify-between gap-4">
                                    <div>
                                      <div className="flex items-center gap-2">
                                        <PencilLine size={13} style={{ color: 'var(--color-accent)' }} />
                                        <h4 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                                          Edit review
                                        </h4>
                                      </div>
                                      <p className="text-[11px] mt-1" style={{ color: 'var(--text-tertiary)' }}>
                                        Saved changes flow to product and homepage review widgets automatically.
                                      </p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <button
                                        type="button"
                                        onClick={() => resetReviewDraft(review)}
                                        disabled={editSaving}
                                        className="flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1.5 rounded-lg disabled:opacity-50"
                                        style={{ color: 'var(--text-secondary)', border: '1px solid var(--border-primary)' }}
                                      >
                                        <RotateCcw size={11} /> Reset
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleSaveReview(review.id)}
                                        disabled={
                                          editSaving
                                          || !editDraft.body.trim()
                                          || !editDraft.customer_name.trim()
                                          || !editDraft.customer_email.trim()
                                          || !editDraft.submitted_at
                                        }
                                        className="flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-lg text-white disabled:opacity-50"
                                        style={{ backgroundColor: 'var(--color-accent)' }}
                                      >
                                        {editSaving ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
                                        {editSaving ? 'Saving' : 'Save review'}
                                      </button>
                                    </div>
                                  </div>

                                  {editError && (
                                    <div
                                      className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs"
                                      style={{ color: 'var(--color-danger)', backgroundColor: 'rgba(239,68,68,0.08)' }}
                                    >
                                      <AlertCircle size={13} /> {editError}
                                    </div>
                                  )}
                                  {editSaved && (
                                    <div
                                      className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs"
                                      style={{ color: 'var(--color-success)', backgroundColor: 'rgba(34,197,94,0.08)' }}
                                    >
                                      <CheckCircle2 size={13} /> Review saved and storefront data refreshed.
                                    </div>
                                  )}

                                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                                    <label className="space-y-1.5">
                                      <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                                        Customer name
                                      </span>
                                      <input
                                        value={editDraft.customer_name}
                                        onChange={(event) => setEditDraft({ ...editDraft, customer_name: event.target.value })}
                                        className="w-full text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2"
                                        style={inputStyle}
                                      />
                                    </label>
                                    <label className="space-y-1.5">
                                      <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                                        Public display name
                                      </span>
                                      <input
                                        value={editDraft.customer_nickname}
                                        onChange={(event) => setEditDraft({ ...editDraft, customer_nickname: event.target.value })}
                                        placeholder="Uses customer name when blank"
                                        className="w-full text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2"
                                        style={inputStyle}
                                      />
                                    </label>
                                    <label className="space-y-1.5">
                                      <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                                        Customer email
                                      </span>
                                      <input
                                        type="email"
                                        value={editDraft.customer_email}
                                        onChange={(event) => setEditDraft({ ...editDraft, customer_email: event.target.value })}
                                        className="w-full text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2"
                                        style={inputStyle}
                                      />
                                    </label>
                                    <label className="space-y-1.5">
                                      <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                                        Submitted
                                      </span>
                                      <input
                                        type="datetime-local"
                                        value={editDraft.submitted_at}
                                        onChange={(event) => setEditDraft({ ...editDraft, submitted_at: event.target.value })}
                                        className="w-full text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2"
                                        style={inputStyle}
                                      />
                                    </label>
                                  </div>

                                  <div className="space-y-1.5">
                                    <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                                      Rating
                                    </span>
                                    <div className="flex items-center gap-1" role="radiogroup" aria-label="Review rating">
                                      {[1, 2, 3, 4, 5].map((rating) => (
                                        <button
                                          key={rating}
                                          type="button"
                                          role="radio"
                                          aria-checked={editDraft.rating === rating}
                                          onClick={() => setEditDraft({ ...editDraft, rating })}
                                          className="p-1 rounded transition-transform hover:scale-110"
                                          aria-label={`${rating} star${rating === 1 ? '' : 's'}`}
                                        >
                                          <Star
                                            size={22}
                                            fill={rating <= editDraft.rating ? 'var(--color-star)' : 'none'}
                                            stroke={rating <= editDraft.rating ? 'var(--color-star)' : 'var(--text-tertiary)'}
                                          />
                                        </button>
                                      ))}
                                    </div>
                                  </div>

                                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                                    <label className="space-y-1.5">
                                      <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                                        Review title
                                      </span>
                                      <input
                                        value={editDraft.title}
                                        onChange={(event) => setEditDraft({ ...editDraft, title: event.target.value })}
                                        placeholder="Optional"
                                        className="w-full text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2"
                                        style={inputStyle}
                                      />
                                    </label>
                                    <label className="space-y-1.5">
                                      <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                                        Product variant
                                      </span>
                                      <input
                                        value={editDraft.variant_title}
                                        onChange={(event) => setEditDraft({ ...editDraft, variant_title: event.target.value })}
                                        placeholder="Optional"
                                        className="w-full text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2"
                                        style={inputStyle}
                                      />
                                    </label>
                                  </div>

                                  <label className="block space-y-1.5">
                                    <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                                      Review text
                                    </span>
                                    <textarea
                                      value={editDraft.body}
                                      onChange={(event) => setEditDraft({ ...editDraft, body: event.target.value })}
                                      rows={5}
                                      className="w-full text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 resize-y"
                                      style={inputStyle}
                                    />
                                  </label>

                                  <div
                                    className="grid grid-cols-1 xl:grid-cols-[minmax(180px,0.7fr)_1fr] gap-4 rounded-lg p-3"
                                    style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-secondary)' }}
                                  >
                                    <label className="space-y-1.5">
                                      <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                                        Publication status
                                      </span>
                                      <select
                                        value={editDraft.status}
                                        onChange={(event) => {
                                          const status = event.target.value as Review['status'];
                                          setEditDraft({
                                            ...editDraft,
                                            status,
                                            featured: status === 'published' ? editDraft.featured : false,
                                          });
                                        }}
                                        className="w-full text-sm rounded-lg px-3 py-2 focus:outline-none"
                                        style={inputStyle}
                                      >
                                        <option value="published">Published</option>
                                        <option value="pending">Pending</option>
                                        <option value="rejected">Rejected</option>
                                        <option value="archived">Archived</option>
                                      </select>
                                    </label>
                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                                      {[
                                        {
                                          key: 'featured',
                                          label: 'Show on homepage',
                                          description: 'Includes this review in brand homepage integrations.',
                                          disabled: editDraft.status !== 'published',
                                        },
                                        {
                                          key: 'verified_purchase',
                                          label: 'Verified purchase',
                                          description: 'Shows the verified badge on storefront widgets.',
                                          disabled: false,
                                        },
                                        {
                                          key: 'incentivized',
                                          label: 'Incentivized',
                                          description: 'Shows the configured incentive disclosure.',
                                          disabled: false,
                                        },
                                      ].map((option) => (
                                        <label
                                          key={option.key}
                                          className="flex items-start gap-2 rounded-lg p-2.5"
                                          style={{
                                            backgroundColor: 'var(--bg-primary)',
                                            border: '1px solid var(--border-secondary)',
                                            opacity: option.disabled ? 0.55 : 1,
                                          }}
                                        >
                                          <input
                                            type="checkbox"
                                            checked={Boolean(editDraft[option.key as keyof ReviewEditDraft])}
                                            disabled={option.disabled}
                                            onChange={(event) => setEditDraft({
                                              ...editDraft,
                                              [option.key]: event.target.checked,
                                            })}
                                            className="mt-0.5"
                                            style={{ accentColor: 'var(--color-accent)' }}
                                          />
                                          <span>
                                            <span className="block text-[11px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                                              {option.label}
                                            </span>
                                            <span className="block text-[10px] leading-snug mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                                              {option.description}
                                            </span>
                                          </span>
                                        </label>
                                      ))}
                                    </div>
                                  </div>
                                </div>
                              )}

                              {/* Media gallery — clickable for lightbox */}
                              {review.media && review.media.length > 0 && (
                                <div>
                                  <p className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-tertiary)' }}>
                                    Photos ({review.media.length})
                                  </p>
                                  <div className="flex gap-2 flex-wrap">
                                    {review.media.map((m, i) => (
                                      <button
                                        key={m.id || i}
                                        onClick={() => openLightbox(review.media!, i)}
                                        className="block w-24 h-24 rounded-lg overflow-hidden transition-transform hover:scale-105 cursor-zoom-in"
                                        style={{ border: '1px solid var(--border-primary)' }}
                                      >
                                        {m.media_type === 'video' ? (
                                          <video
                                            src={m.url}
                                            className="w-full h-full object-cover"
                                          />
                                        ) : (
                                          <img
                                            src={m.url}
                                            alt={`Review photo ${i + 1}`}
                                            className="w-full h-full object-cover"
                                          />
                                        )}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* Quick actions */}
                              <div className="flex items-center gap-2">
                                {review.status !== 'published' && (
                                  <button
                                    onClick={() => handleQuickStatus(review.id, 'published')}
                                    className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
                                    style={{
                                      backgroundColor: 'rgba(34,197,94,0.12)',
                                      color: 'var(--color-success)',
                                      border: '1px solid rgba(34,197,94,0.2)',
                                    }}
                                  >
                                    Publish
                                  </button>
                                )}
                                {review.status !== 'rejected' && (
                                  <button
                                    onClick={() => handleQuickStatus(review.id, 'rejected')}
                                    className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
                                    style={{
                                      backgroundColor: 'rgba(239,68,68,0.12)',
                                      color: 'var(--color-danger)',
                                      border: '1px solid rgba(239,68,68,0.2)',
                                    }}
                                  >
                                    Reject
                                  </button>
                                )}
                                {review.status !== 'archived' && (
                                  <button
                                    onClick={() => handleQuickStatus(review.id, 'archived')}
                                    className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
                                    style={{
                                      backgroundColor: 'rgba(107,114,128,0.12)',
                                      color: '#6b7880',
                                      border: '1px solid rgba(107,114,128,0.2)',
                                    }}
                                  >
                                    Archive
                                  </button>
                                )}
                              </div>

                              {/* Reply editor */}
                              <div
                                className="rounded-lg p-4 space-y-3"
                                style={{
                                  backgroundColor: 'var(--bg-primary)',
                                  border: '1px solid var(--border-primary)',
                                }}
                              >
                                <div className="flex items-center justify-between">
                                  <h5 className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
                                    Reply
                                  </h5>
                                  <button
                                    onClick={() => handleAiDraft(review.id)}
                                    disabled={aiDrafting}
                                    className="flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-lg transition-colors"
                                    style={{
                                      backgroundColor: 'rgba(168,85,247,0.10)',
                                      color: 'var(--color-source-ai)',
                                      border: '1px solid rgba(168,85,247,0.2)',
                                    }}
                                  >
                                    {aiDrafting ? (
                                      <Loader2 size={10} className="animate-spin" />
                                    ) : (
                                      <Sparkles size={10} />
                                    )}
                                    AI Draft
                                  </button>
                                </div>
                                <textarea
                                  value={replyText}
                                  onChange={(e) => setReplyText(e.target.value)}
                                  rows={3}
                                  placeholder="Write a reply to this review..."
                                  className="w-full text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 resize-y"
                                  style={{
                                    backgroundColor: 'var(--bg-secondary)',
                                    border: '1px solid var(--border-primary)',
                                    color: 'var(--text-primary)',
                                  }}
                                />
                                <div className="flex items-center gap-3">
                                  <input
                                    type="text"
                                    value={replyAuthor}
                                    onChange={(e) => setReplyAuthor(e.target.value)}
                                    placeholder="Author name"
                                    className="text-xs rounded-lg px-3 py-1.5 w-48 focus:outline-none focus:ring-2"
                                    style={{
                                      backgroundColor: 'var(--bg-secondary)',
                                      border: '1px solid var(--border-primary)',
                                      color: 'var(--text-primary)',
                                    }}
                                  />
                                  <button
                                    onClick={() => handleSaveReply(review.id)}
                                    disabled={replySaving || !replyText.trim()}
                                    className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg text-white disabled:opacity-50 ml-auto"
                                    style={{ backgroundColor: 'var(--color-accent)' }}
                                  >
                                    {replySaving ? (
                                      <Loader2 size={12} className="animate-spin" />
                                    ) : (
                                      <Send size={12} />
                                    )}
                                    Save Reply
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                Page {page} of {totalPages} ({total} reviews)
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage(Math.max(1, page - 1))}
                  disabled={page === 1}
                  className="p-2 rounded-lg transition-colors disabled:opacity-30"
                  style={{
                    backgroundColor: 'var(--bg-primary)',
                    border: '1px solid var(--border-primary)',
                    color: 'var(--text-secondary)',
                  }}
                >
                  <ChevronLeft size={14} />
                </button>
                <button
                  onClick={() => setPage(Math.min(totalPages, page + 1))}
                  disabled={page === totalPages}
                  className="p-2 rounded-lg transition-colors disabled:opacity-30"
                  style={{
                    backgroundColor: 'var(--bg-primary)',
                    border: '1px solid var(--border-primary)',
                    color: 'var(--text-secondary)',
                  }}
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
