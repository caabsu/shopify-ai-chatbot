# Warm by Design — Review Widget Implementation Guide

**For: implementing AI agent**
**Date: 2026-05-03**
**Locked design: V3-C "The Quiet Column"** — see [docs/mocks/warm-review-spread-v3.html](../../mocks/warm-review-spread-v3.html)

---

## What you're building

A new widget bundle, `apps/widget-warm/src/reviews/`, that mirrors the existing `chatbot`, `contact`, and `returns` widgets in the same workspace. It serves the Warm by Design brand exclusively — single column list, ghost buttons, chip filters, mobile-first.

The backend review API already exists. Brand resolution already works (`X-Brand: warm-by-design` header). All you need to add is the widget bundle, build pipeline, and a brand-settings update so the system serves `/widget/warm/reviews.js` instead of the shared `/widget/review-widget.js`.

---

## Final file tree

```
apps/widget-warm/
├── src/
│   └── reviews/                        # NEW
│       ├── reviews.ts                  # Entry point
│       ├── api/
│       │   └── client.ts               # Brand-locked API client
│       ├── ui/
│       │   ├── ReviewSummary.ts        # Stat strip
│       │   ├── FilterRow.ts            # Chip filters + sort
│       │   ├── ReviewList.ts           # List + pager
│       │   ├── ReviewCard.ts           # Single review block
│       │   └── ReviewComposer.ts       # Write-a-review form
│       ├── state/
│       │   └── store.ts                # Page state, filters
│       └── styles/
│           └── reviews.css             # Lifted from V3-C mock
├── vite.reviews.config.ts              # NEW — mirrors vite.contact.config.ts
└── package.json                        # UPDATED — adds build:reviews script

apps/backend/src/index.ts               # No code change — express.static already serves /widget/warm
docs/migrations/005-warm-review-widget-url.sql   # NEW — flips the brand setting
```

---

## Step 1 — Brand widget URL migration

The brand's widget URL for `reviews` currently points at the shared bundle. Flip it to the warm-specific one.

### File: `docs/migrations/005-warm-review-widget-url.sql` (NEW)

```sql
-- Migration 005: Point Warm by Design reviews at brand-specific bundle
update brands
set settings = jsonb_set(
  settings,
  '{widgetUrls,reviews}',
  '"/widget/warm/reviews.js"'::jsonb,
  true
)
where slug = 'warm-by-design';
```

Run it via the Supabase MCP (`mcp__supabase__apply_migration` with name `005_warm_review_widget_url`) or paste into the SQL editor. Verify with:

```sql
select slug, settings->'widgetUrls'->>'reviews'
from brands
where slug = 'warm-by-design';
-- expect: /widget/warm/reviews.js
```

---

## Step 2 — Backend (no code changes needed)

The backend already does all of this:

- `/widget/warm/*` is served by `express.static(widgetWarmDir, ...)` in [apps/backend/src/index.ts](../../../apps/backend/src/index.ts) — once `dist/reviews.js` exists, it's served.
- All review endpoints (`GET /api/reviews/product/:handle`, `POST /api/reviews/submit`, etc.) already resolve brand via `X-Brand` header → `resolveBrandId` in [apps/backend/src/config/brand.ts](../../../apps/backend/src/config/brand.ts).
- Storage upload (`POST /api/reviews/upload`) already exists for photos.

**Verification only**: confirm these endpoints return data when called with `X-Brand: warm-by-design`:

```bash
curl -H "X-Brand: warm-by-design" "http://localhost:3001/api/reviews/widget/config"
curl -H "X-Brand: warm-by-design" "http://localhost:3001/api/reviews/product/ribbon/summary"
curl -H "X-Brand: warm-by-design" "http://localhost:3001/api/reviews/product/ribbon?page=1&per_page=10"
```

---

## Step 3 — Widget entry point

### File: `apps/widget-warm/src/reviews/reviews.ts` (NEW)

```ts
import { initBaseUrl } from './api/client';
import { mountReviewSection } from './ui/ReviewList';
import { mountInlineBadge } from './ui/ReviewSummary';
import './styles/reviews.css';

const FONT_ID = 'wbd-fonts';
const ICON_ID = 'wbd-icons';

function loadFonts() {
  if (!document.getElementById(FONT_ID)) {
    const fontLink = document.createElement('link');
    fontLink.id = FONT_ID;
    fontLink.rel = 'stylesheet';
    fontLink.href =
      'https://fonts.googleapis.com/css2?family=Instrument+Sans:ital,wght@0,400..700;1,400..700&display=swap';
    document.head.appendChild(fontLink);
  }
  if (!document.getElementById(ICON_ID)) {
    const iconLink = document.createElement('link');
    iconLink.id = ICON_ID;
    iconLink.rel = 'stylesheet';
    iconLink.href =
      'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200';
    document.head.appendChild(iconLink);
  }
}

async function init() {
  initBaseUrl();
  loadFonts();

  // 1. Inline rating badges — anywhere on the page
  //    <span data-wbd-review-badge data-product-handle="ribbon"></span>
  document
    .querySelectorAll<HTMLElement>('[data-wbd-review-badge][data-product-handle]')
    .forEach((el) => {
      const handle = el.dataset.productHandle;
      if (handle) mountInlineBadge(el, handle);
    });

  // 2. Full review section — typically once per PDP
  //    <div id="wbd-reviews" data-product-handle="ribbon"></div>
  const sections = document.querySelectorAll<HTMLElement>(
    '#wbd-reviews[data-product-handle], [data-wbd-reviews][data-product-handle]'
  );
  sections.forEach((el) => {
    const handle = el.dataset.productHandle!;
    mountReviewSection(el, handle);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
```

---

## Step 4 — API client

### File: `apps/widget-warm/src/reviews/api/client.ts` (NEW)

```ts
const BRAND_SLUG = 'warm-by-design';
let baseUrl = '';

export function initBaseUrl(): void {
  const scripts = document.querySelectorAll('script[src]');
  for (const script of Array.from(scripts)) {
    const src = (script as HTMLScriptElement).src || '';
    if (src.includes('/widget/warm/reviews.js')) {
      baseUrl = new URL(src).origin;
      return;
    }
  }
  // Fallback for local dev / playground
  baseUrl = window.location.origin;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Brand': BRAND_SLUG,
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data?.error) msg = data.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface ReviewMedia {
  id: string;
  url: string;
  media_type: 'image' | 'video';
  sort_order: number;
}

export interface ReviewReply {
  id: string;
  author_name: string;
  body: string;
  created_at: string;
}

export interface Review {
  id: string;
  rating: number;
  title: string | null;
  body: string;
  customer_name: string;
  customer_nickname: string | null;
  city: string | null;
  verified_purchase: boolean;
  helpful_count: number;
  submitted_at: string;
  published_at: string | null;
  media: ReviewMedia[];
  reply: ReviewReply | null;
}

export interface ReviewSummary {
  average_rating: number;
  total_count: number;
  verified_count: number;
  recommend_pct: number;
  with_photos_count: number;
  distribution: { rating: number; count: number; pct: number }[];
}

export interface WidgetConfig {
  reviews_per_page: number;
  default_sort: 'most_helpful' | 'most_recent' | 'highest' | 'lowest';
  show_verified_badge: boolean;
  show_incentivized_disclosure: boolean;
  incentivized_disclosure_text: string;
}

export interface ReviewsResponse {
  reviews: Review[];
  total: number;
  totalPages: number;
  page: number;
  perPage: number;
}

export interface SubmitReviewPayload {
  product_handle: string;
  customer_email: string;
  customer_name: string;
  rating: number;
  body: string;
  title?: string;
  city?: string;
  media_urls?: string[];
}

// ── Calls ──────────────────────────────────────────────────────────────────

export async function getWidgetConfig(): Promise<WidgetConfig> {
  return request<WidgetConfig>('/api/reviews/widget/config');
}

export async function getReviewSummary(handle: string): Promise<ReviewSummary> {
  return request<ReviewSummary>(`/api/reviews/product/${encodeURIComponent(handle)}/summary`);
}

export async function getReviews(
  handle: string,
  opts: { page?: number; perPage?: number; sort?: string; rating?: number; verified?: boolean } = {}
): Promise<ReviewsResponse> {
  const params = new URLSearchParams();
  if (opts.page) params.set('page', String(opts.page));
  if (opts.perPage) params.set('per_page', String(opts.perPage));
  if (opts.sort) params.set('sort', opts.sort);
  if (opts.rating) params.set('rating', String(opts.rating));
  if (opts.verified) params.set('verified', 'true');
  const qs = params.toString();
  return request<ReviewsResponse>(
    `/api/reviews/product/${encodeURIComponent(handle)}${qs ? `?${qs}` : ''}`
  );
}

export async function submitReview(payload: SubmitReviewPayload): Promise<Review> {
  return request<Review>('/api/reviews/submit', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function uploadMedia(file: File): Promise<{ url: string; path: string }> {
  const reader = new FileReader();
  const dataUrl: string = await new Promise((resolve, reject) => {
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  // Strip data:<mime>;base64, prefix
  const file_b64 = dataUrl.split(',')[1] ?? '';
  return request<{ url: string; path: string }>('/api/reviews/upload', {
    method: 'POST',
    body: JSON.stringify({
      file: file_b64,
      content_type: file.type,
      filename: file.name,
    }),
  });
}

export async function markHelpful(reviewId: string): Promise<{ helpful_count: number }> {
  return request<{ helpful_count: number }>(`/api/reviews/helpful/${reviewId}`, { method: 'POST' });
}

export async function reportReview(reviewId: string): Promise<{ report_count: number }> {
  return request<{ report_count: number }>(`/api/reviews/report/${reviewId}`, { method: 'POST' });
}
```

---

## Step 5 — UI components

These produce DOM nodes; no framework. Match the V3-C mock exactly. Lift the visible structure (classes, attributes, text) directly from [docs/mocks/warm-review-spread-v3.html](../../mocks/warm-review-spread-v3.html) section `.vc` (the populated scene under `id="vc"`).

### File: `apps/widget-warm/src/reviews/state/store.ts` (NEW)

```ts
export type SortKey = 'most_helpful' | 'most_recent' | 'highest' | 'lowest';

export interface SectionState {
  handle: string;
  page: number;
  perPage: number;
  sort: SortKey;
  ratingFilter: number | null; // null = all
  verifiedOnly: boolean;
  withPhotosOnly: boolean;
}

export function defaultState(handle: string, perPage = 10): SectionState {
  return {
    handle,
    page: 1,
    perPage,
    sort: 'most_helpful',
    ratingFilter: null,
    verifiedOnly: false,
    withPhotosOnly: false,
  };
}
```

### File: `apps/widget-warm/src/reviews/ui/ReviewSummary.ts` (NEW)

```ts
import { getReviewSummary, type ReviewSummary } from '../api/client';
import { starsHtml } from './stars';

export function renderStatStrip(summary: ReviewSummary, onWriteClick: () => void): HTMLElement {
  const el = document.createElement('div');
  el.className = 'wbd-rv-stat-strip';
  el.innerHTML = `
    <div class="wbd-rv-num">${summary.average_rating.toFixed(1)}<span class="of"> / 5</span></div>
    <span class="wbd-rv-stars wbd-rv-lg">${starsHtml(Math.round(summary.average_rating))}</span>
    <span class="wbd-rv-sep"></span>
    <div class="wbd-rv-meta"><b>${summary.total_count}</b> verified reviews</div>
    <span class="wbd-rv-sep"></span>
    <div class="wbd-rv-meta"><b>${summary.recommend_pct}%</b> recommend</div>
    <button type="button" class="wbd-rv-write">Write a review</button>
  `;
  el.querySelector<HTMLButtonElement>('.wbd-rv-write')?.addEventListener('click', onWriteClick);
  return el;
}

// Inline badge (PDP header position, replaces shared review-badge.ts)
export async function mountInlineBadge(host: HTMLElement, handle: string) {
  try {
    const summary = await getReviewSummary(handle);
    const rounded = Math.round(summary.average_rating);
    host.innerHTML = `
      <span class="wbd-rv-qrow" data-wbd-rv>
        <span class="wbd-rv-stars">${starsHtml(rounded)}</span>
        <span class="wbd-rv-score">
          <span>${summary.average_rating.toFixed(1)}</span>
          <span class="of">/ 5.0</span>
        </span>
        <span class="wbd-rv-pipe"></span>
        <a class="wbd-rv-read" href="#wbd-reviews">${summary.total_count} Reviews</a>
      </span>
    `;
  } catch {
    host.innerHTML = '';
  }
}
```

### File: `apps/widget-warm/src/reviews/ui/stars.ts` (NEW)

```ts
const STAR_PATH =
  'M12 2 L14.85 8.78 L22.18 9.27 L16.55 13.97 L18.31 21.13 L12 17.27 L5.69 21.13 L7.45 13.97 L1.82 9.27 L9.15 8.78 Z';

export function starsHtml(filled: number, total = 5): string {
  let html = '';
  for (let i = 1; i <= total; i++) {
    const cls = i <= filled ? '' : ' class="empty"';
    html += `<svg viewBox="0 0 24 24"${cls}><path fill="currentColor" d="${STAR_PATH}"/></svg>`;
  }
  return html;
}
```

### File: `apps/widget-warm/src/reviews/ui/FilterRow.ts` (NEW)

```ts
import type { ReviewSummary } from '../api/client';
import type { SectionState, SortKey } from '../state/store';

const SORT_LABELS: Record<SortKey, string> = {
  most_helpful: 'Most Helpful',
  most_recent: 'Most Recent',
  highest: 'Highest Rated',
  lowest: 'Lowest Rated',
};

export function renderFilterRow(
  summary: ReviewSummary,
  state: SectionState,
  onChange: (next: Partial<SectionState>) => void
): HTMLElement {
  const el = document.createElement('div');
  el.className = 'wbd-rv-chip-row';

  const ratingChip = (rating: number | null, label: string, count: number) => {
    const active =
      (rating === null && state.ratingFilter === null && !state.withPhotosOnly && !state.verifiedOnly) ||
      state.ratingFilter === rating;
    return `<a class="wbd-rv-chip${active ? ' on' : ''}" data-rating="${rating ?? ''}">${label} <span class="n">${count}</span></a>`;
  };

  el.innerHTML = `
    <span class="wbd-rv-chip-lbl">Filter</span>
    ${ratingChip(null, 'All', summary.total_count)}
    ${[5, 4, 3, 2, 1]
      .map((r) => {
        const d = summary.distribution.find((x) => x.rating === r);
        return d && d.count > 0 ? ratingChip(r, `${r} stars`, d.count) : '';
      })
      .join('')}
    <a class="wbd-rv-chip${state.withPhotosOnly ? ' on' : ''}" data-photos>With photos <span class="n">${summary.with_photos_count}</span></a>
    <a class="wbd-rv-chip${state.verifiedOnly ? ' on' : ''}" data-verified>Verified <span class="n">${summary.verified_count}</span></a>
    <span class="wbd-rv-chip-right">
      <span class="wbd-rv-sel" data-sort tabindex="0">
        <span class="wbd-rv-sel-lbl">Sort</span>
        <span class="wbd-rv-sel-v">${SORT_LABELS[state.sort]}</span>
      </span>
    </span>
  `;

  el.querySelectorAll<HTMLAnchorElement>('[data-rating]').forEach((chip) => {
    chip.addEventListener('click', (e) => {
      e.preventDefault();
      const raw = chip.dataset.rating;
      const rating = raw === '' ? null : Number(raw);
      onChange({ ratingFilter: rating, withPhotosOnly: false, verifiedOnly: false, page: 1 });
    });
  });
  el.querySelector<HTMLAnchorElement>('[data-photos]')?.addEventListener('click', (e) => {
    e.preventDefault();
    onChange({ withPhotosOnly: !state.withPhotosOnly, ratingFilter: null, page: 1 });
  });
  el.querySelector<HTMLAnchorElement>('[data-verified]')?.addEventListener('click', (e) => {
    e.preventDefault();
    onChange({ verifiedOnly: !state.verifiedOnly, ratingFilter: null, page: 1 });
  });
  el.querySelector<HTMLElement>('[data-sort]')?.addEventListener('click', () => {
    // Cycle through sorts (simple — replace with native <select> popover if you want)
    const order: SortKey[] = ['most_helpful', 'most_recent', 'highest', 'lowest'];
    const next = order[(order.indexOf(state.sort) + 1) % order.length];
    onChange({ sort: next, page: 1 });
  });

  return el;
}
```

### File: `apps/widget-warm/src/reviews/ui/ReviewCard.ts` (NEW)

```ts
import { type Review, markHelpful } from '../api/client';
import { starsHtml } from './stars';

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function renderReviewCard(review: Review): HTMLElement {
  const el = document.createElement('article');
  el.className = 'wbd-rv-review';
  el.innerHTML = `
    <div class="wbd-rv-row1">
      <span class="wbd-rv-stars">${starsHtml(review.rating)}</span>
      <span class="wbd-rv-name">${escapeHtml(review.customer_nickname ?? review.customer_name)}</span>
      ${review.verified_purchase ? '<span class="wbd-rv-v">Verified</span>' : ''}
      ${review.city ? `<span>${escapeHtml(review.city)}</span>` : ''}
      <span class="wbd-rv-when">${formatDate(review.submitted_at)}</span>
    </div>
    ${review.title ? `<h3 class="wbd-rv-ttl">${escapeHtml(review.title)}</h3>` : ''}
    <p>${escapeHtml(review.body).replace(/\n/g, '<br/>')}</p>
    ${
      review.media.length
        ? `<div class="wbd-rv-photos">${review.media
            .map(
              (m) =>
                `<a class="wbd-rv-ph" href="${escapeAttr(m.url)}" target="_blank" rel="noreferrer" style="background-image:url('${escapeAttr(m.url)}')"></a>`
            )
            .join('')}</div>`
        : ''
    }
    <div class="wbd-rv-foot">
      <a href="#" data-helpful><b>${review.helpful_count}</b>Helpful</a>
    </div>
  `;

  const helpfulLink = el.querySelector<HTMLAnchorElement>('[data-helpful]');
  helpfulLink?.addEventListener('click', async (e) => {
    e.preventDefault();
    if (helpfulLink.dataset.clicked) return;
    helpfulLink.dataset.clicked = '1';
    try {
      const r = await markHelpful(review.id);
      const b = helpfulLink.querySelector('b');
      if (b) b.textContent = String(r.helpful_count);
    } catch {
      delete helpfulLink.dataset.clicked;
    }
  });

  return el;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
function escapeAttr(s: string): string {
  return s.replace(/"/g, '&quot;');
}
```

### File: `apps/widget-warm/src/reviews/ui/ReviewList.ts` (NEW)

```ts
import { getReviews, getReviewSummary, type ReviewSummary } from '../api/client';
import { defaultState, type SectionState } from '../state/store';
import { renderStatStrip } from './ReviewSummary';
import { renderFilterRow } from './FilterRow';
import { renderReviewCard } from './ReviewCard';
import { renderComposer } from './ReviewComposer';

export async function mountReviewSection(host: HTMLElement, handle: string) {
  host.classList.add('wbd-rv-section');
  host.innerHTML = '<div class="wbd-rv-loading">Loading reviews…</div>';

  let state: SectionState = defaultState(handle);
  let summary: ReviewSummary;

  try {
    summary = await getReviewSummary(handle);
  } catch {
    host.innerHTML = '';
    return;
  }

  const stripWrap = document.createElement('div');
  const filterWrap = document.createElement('div');
  const listWrap = document.createElement('div');
  listWrap.className = 'wbd-rv-list';
  const pagerWrap = document.createElement('div');
  const composerWrap = document.createElement('div');

  host.innerHTML = '';
  host.append(stripWrap, filterWrap, listWrap, pagerWrap, composerWrap);

  const renderStrip = () => {
    stripWrap.replaceChildren(
      renderStatStrip(summary, () => composerWrap.scrollIntoView({ behavior: 'smooth' }))
    );
  };
  const renderFilters = () => {
    filterWrap.replaceChildren(
      renderFilterRow(summary, state, (next) => {
        state = { ...state, ...next };
        refresh();
      })
    );
  };
  const renderComposerBlock = () => {
    composerWrap.replaceChildren(
      renderComposer(handle, () => {
        // Optimistic refresh after submit
        getReviewSummary(handle)
          .then((s) => {
            summary = s;
            renderStrip();
            renderFilters();
          })
          .catch(() => {});
      })
    );
  };

  async function refresh() {
    listWrap.innerHTML = '<div class="wbd-rv-loading">Loading…</div>';
    try {
      const res = await getReviews(handle, {
        page: state.page,
        perPage: state.perPage,
        sort: state.sort,
        rating: state.ratingFilter ?? undefined,
        verified: state.verifiedOnly || undefined,
      });
      listWrap.replaceChildren(
        ...res.reviews.map(renderReviewCard),
        renderPager(res.total, state.page, state.perPage, (p) => {
          state = { ...state, page: p };
          refresh();
        })
      );
      renderFilters();
    } catch (err) {
      listWrap.innerHTML = `<div class="wbd-rv-empty">Couldn't load reviews. Try again.</div>`;
    }
  }

  function renderPager(total: number, page: number, perPage: number, onGo: (p: number) => void) {
    const totalPages = Math.max(1, Math.ceil(total / perPage));
    const el = document.createElement('div');
    el.className = 'wbd-rv-pager';
    if (totalPages <= 1) return el;
    const start = (page - 1) * perPage + 1;
    const end = Math.min(total, page * perPage);
    el.innerHTML = `
      <span>Showing ${start}–${end} of ${total}</span>
      <span class="nav">
        <button data-prev ${page <= 1 ? 'disabled' : ''}>←</button>
        <button data-next ${page >= totalPages ? 'disabled' : ''}>→</button>
      </span>
    `;
    el.querySelector<HTMLButtonElement>('[data-prev]')?.addEventListener('click', () =>
      onGo(Math.max(1, page - 1))
    );
    el.querySelector<HTMLButtonElement>('[data-next]')?.addEventListener('click', () =>
      onGo(Math.min(totalPages, page + 1))
    );
    return el;
  }

  renderStrip();
  renderComposerBlock();
  await refresh();
}
```

### File: `apps/widget-warm/src/reviews/ui/ReviewComposer.ts` (NEW)

```ts
import { submitReview, uploadMedia } from '../api/client';

export function renderComposer(handle: string, onSubmitted: () => void): HTMLElement {
  const el = document.createElement('div');
  el.className = 'wbd-rv-composer';
  el.innerHTML = `
    <div class="wbd-rv-composer-head">
      <div class="l">
        <span class="e">Write a review</span>
        <h3>Tell us how it lives in your space.</h3>
      </div>
      <div class="r">~ 2 minutes</div>
    </div>
    <div class="wbd-rv-composer-body">
      <div class="wbd-rv-row2">
        <div class="wbd-rv-field">
          <span class="lbl">Rating</span>
          <span class="wbd-rv-rater" data-rating="0" role="radiogroup">
            <svg data-v="1" viewBox="0 0 24 24"><path fill="currentColor" d="M12 2 L14.85 8.78 L22.18 9.27 L16.55 13.97 L18.31 21.13 L12 17.27 L5.69 21.13 L7.45 13.97 L1.82 9.27 L9.15 8.78 Z"/></svg>
            <svg data-v="2" viewBox="0 0 24 24"><path fill="currentColor" d="M12 2 L14.85 8.78 L22.18 9.27 L16.55 13.97 L18.31 21.13 L12 17.27 L5.69 21.13 L7.45 13.97 L1.82 9.27 L9.15 8.78 Z"/></svg>
            <svg data-v="3" viewBox="0 0 24 24"><path fill="currentColor" d="M12 2 L14.85 8.78 L22.18 9.27 L16.55 13.97 L18.31 21.13 L12 17.27 L5.69 21.13 L7.45 13.97 L1.82 9.27 L9.15 8.78 Z"/></svg>
            <svg data-v="4" viewBox="0 0 24 24"><path fill="currentColor" d="M12 2 L14.85 8.78 L22.18 9.27 L16.55 13.97 L18.31 21.13 L12 17.27 L5.69 21.13 L7.45 13.97 L1.82 9.27 L9.15 8.78 Z"/></svg>
            <svg data-v="5" viewBox="0 0 24 24"><path fill="currentColor" d="M12 2 L14.85 8.78 L22.18 9.27 L16.55 13.97 L18.31 21.13 L12 17.27 L5.69 21.13 L7.45 13.97 L1.82 9.27 L9.15 8.78 Z"/></svg>
          </span>
        </div>
        <div class="wbd-rv-field">
          <span class="lbl">Photos</span>
          <label class="wbd-rv-dropzone">
            <span data-dz-label>Drop photos or browse</span>
            <input type="file" data-files multiple accept="image/*" hidden />
          </label>
        </div>
      </div>
      <div class="wbd-rv-field">
        <span class="lbl">Headline</span>
        <input class="wbd-rv-input" data-title placeholder="A short, honest summary." />
      </div>
      <div class="wbd-rv-field">
        <span class="lbl">Review</span>
        <textarea class="wbd-rv-textarea" data-body required placeholder="What stood out? How does it feel in your home?"></textarea>
      </div>
      <div class="wbd-rv-row3">
        <div class="wbd-rv-field">
          <span class="lbl">Name</span>
          <input class="wbd-rv-input" data-name required placeholder="e.g. Marcus K." />
        </div>
        <div class="wbd-rv-field">
          <span class="lbl">City</span>
          <input class="wbd-rv-input" data-city placeholder="e.g. Chicago, IL" />
        </div>
        <div class="wbd-rv-field">
          <span class="lbl">Email</span>
          <input class="wbd-rv-input" data-email type="email" required placeholder="you@example.com" />
        </div>
      </div>
    </div>
    <div class="wbd-rv-composer-foot">
      <span class="note" data-status>Email is private. Not published.</span>
      <button class="wbd-rv-btn wbd-rv-btn-primary" data-submit>Submit</button>
    </div>
  `;

  // Star rater
  const rater = el.querySelector<HTMLElement>('.wbd-rv-rater')!;
  rater.querySelectorAll<SVGElement>('svg').forEach((svg) => {
    svg.addEventListener('click', () => {
      rater.dataset.rating = svg.dataset.v!;
    });
    svg.addEventListener('mouseenter', () => {
      rater.dataset.rating = svg.dataset.v!;
    });
  });

  // File label
  const fileInput = el.querySelector<HTMLInputElement>('[data-files]')!;
  const dzLabel = el.querySelector<HTMLElement>('[data-dz-label]')!;
  fileInput.addEventListener('change', () => {
    const n = fileInput.files?.length ?? 0;
    dzLabel.textContent = n === 0 ? 'Drop photos or browse' : `${n} photo${n === 1 ? '' : 's'} selected`;
  });

  // Submit
  const status = el.querySelector<HTMLElement>('[data-status]')!;
  const btn = el.querySelector<HTMLButtonElement>('[data-submit]')!;
  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    const rating = Number(rater.dataset.rating || '0');
    const title = (el.querySelector<HTMLInputElement>('[data-title]')!.value || '').trim();
    const body = (el.querySelector<HTMLTextAreaElement>('[data-body]')!.value || '').trim();
    const name = (el.querySelector<HTMLInputElement>('[data-name]')!.value || '').trim();
    const city = (el.querySelector<HTMLInputElement>('[data-city]')!.value || '').trim();
    const email = (el.querySelector<HTMLInputElement>('[data-email]')!.value || '').trim();

    if (!rating) return setStatus('Choose a rating to continue.');
    if (!body) return setStatus('Add a few words about how it lives.');
    if (!name) return setStatus('A first name + last initial is enough.');
    if (!email) return setStatus('We need an email to verify the review.');

    btn.disabled = true;
    btn.textContent = 'Submitting…';
    try {
      const media_urls: string[] = [];
      const files = Array.from(fileInput.files ?? []);
      for (const f of files.slice(0, 5)) {
        const up = await uploadMedia(f);
        media_urls.push(up.url);
      }
      await submitReview({
        product_handle: handle,
        customer_email: email,
        customer_name: name,
        rating,
        body,
        title: title || undefined,
        city: city || undefined,
        media_urls,
      });
      el.innerHTML = `<div class="wbd-rv-thanks">
        <h3>Thank you.</h3>
        <p>Your review is in — we'll publish it shortly.</p>
      </div>`;
      onSubmitted();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Submit';
      setStatus(err instanceof Error ? err.message : 'Something went wrong. Try again.');
    }
  });

  function setStatus(msg: string) {
    status.textContent = msg;
  }

  return el;
}

function handle(): string { return ''; } // (unused — handle is captured via param)
```

> **Backend note**: the existing `POST /api/reviews/submit` may not yet accept `city` and may not return a `city` field on the `Review` type. Two options:
> 1. **Recommended** — extend the backend [review.service.ts:submitReview](../../../apps/backend/src/services/review.service.ts) to accept `city` and store it in `reviews.metadata` jsonb (or add a `city` column via migration), and surface it in the public list response.
> 2. **Quickest** — drop `city` from the payload in `ReviewComposer.ts` and `Review` type until the backend supports it.
>
> Pick one explicitly. Don't ship a frontend that sends fields the backend silently drops.

---

## Step 6 — Styles

Lift everything inside `.vc` from [docs/mocks/warm-review-spread-v3.html](../../mocks/warm-review-spread-v3.html), prefix every class with `wbd-rv-`, and namespace the file. The mock's `.vc .stat-strip`, `.vc .chip-row`, `.vc .review`, `.composer`, etc. become `.wbd-rv-stat-strip`, `.wbd-rv-chip-row`, `.wbd-rv-review`, `.wbd-rv-composer`.

### File: `apps/widget-warm/src/reviews/styles/reviews.css` (NEW)

Skeleton — fill in the rules from the mock:

```css
/* Tokens — define under the host class so it's scoped */
.wbd-rv-section,
[data-wbd-review-badge] {
  --wbd-rv-cream: #F0EDE8;
  --wbd-rv-cream-90: rgba(240,237,232,0.88);
  --wbd-rv-cream-70: rgba(240,237,232,0.72);
  --wbd-rv-cream-55: rgba(240,237,232,0.55);
  --wbd-rv-cream-35: rgba(240,237,232,0.38);
  --wbd-rv-cream-20: rgba(240,237,232,0.18);
  --wbd-rv-amber: #F5BC70;
  --wbd-rv-amber-50: rgba(245,188,112,0.50);
  --wbd-rv-amber-30: rgba(245,188,112,0.28);
  --wbd-rv-hairline: rgba(245,188,112,0.10);
  --wbd-rv-hairline-strong: rgba(245,188,112,0.20);
  --wbd-rv-on-primary: #2B1C05;
  --wbd-rv-card-2: #18181A;
  --wbd-rv-font: "Instrument Sans", ui-sans-serif, system-ui, sans-serif;

  font-family: var(--wbd-rv-font);
  color: var(--wbd-rv-cream);
  -webkit-font-smoothing: antialiased;
  text-rendering: geometricPrecision;
}

/* … paste every `.vc *` rule from the mock here, replacing `.vc ` with `.wbd-rv-section ` and class names like `.stat-strip` → `.wbd-rv-stat-strip`, `.chip-row` → `.wbd-rv-chip-row`, `.review` → `.wbd-rv-review`, `.composer` → `.wbd-rv-composer`, `.btn` → `.wbd-rv-btn`, `.input` → `.wbd-rv-input`, `.textarea` → `.wbd-rv-textarea`, `.field` → `.wbd-rv-field`, `.row2/.row3` → `.wbd-rv-row2/.wbd-rv-row3`, `.rater` → `.wbd-rv-rater`, `.dropzone-mini` → `.wbd-rv-dropzone`, `.sel` → `.wbd-rv-sel`, `.chip` → `.wbd-rv-chip`, `.pager` → `.wbd-rv-pager`. Keep all the @media queries — do NOT skip the mobile rules. */

/* Inline badge — for use in the PDP header */
.wbd-rv-qrow {
  display: inline-flex; align-items: center; gap: 14px;
  vertical-align: middle;
}
.wbd-rv-qrow .wbd-rv-stars { color: var(--wbd-rv-amber); display: inline-flex; gap: 3px; }
.wbd-rv-qrow .wbd-rv-stars svg { fill: currentColor; width: 14px; height: 14px; }
.wbd-rv-qrow .wbd-rv-score {
  font-feature-settings: "tnum", "ss01";
  font-size: 14px; font-weight: 500; letter-spacing: -0.01em; color: var(--wbd-rv-cream);
  display: inline-flex; align-items: baseline; gap: 4px;
}
.wbd-rv-qrow .wbd-rv-score .of { color: var(--wbd-rv-cream-35); font-size: 11px; letter-spacing: 0.04em; }
.wbd-rv-qrow .wbd-rv-pipe { display: inline-block; width: 1px; height: 12px; background: var(--wbd-rv-amber-30); }
.wbd-rv-qrow .wbd-rv-read {
  font-size: 11px; letter-spacing: 0.22em; text-transform: uppercase;
  color: var(--wbd-rv-cream-70); text-decoration: none; position: relative;
  padding-bottom: 2px; transition: color .25s ease;
}
.wbd-rv-qrow .wbd-rv-read::after {
  content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 1px;
  background: var(--wbd-rv-amber); transform: scaleX(0); transform-origin: left;
  transition: transform .35s ease;
}
.wbd-rv-qrow .wbd-rv-read:hover { color: var(--wbd-rv-cream); }
.wbd-rv-qrow .wbd-rv-read:hover::after { transform: scaleX(1); }

/* Photos: bg-image not <img> so we can lazy-style */
.wbd-rv-photos .wbd-rv-ph {
  width: 76px; height: 76px;
  background-size: cover; background-position: center;
  display: block; cursor: pointer;
  transition: transform .25s ease;
}
.wbd-rv-photos .wbd-rv-ph:hover { transform: translateY(-2px); }

/* Loading / empty */
.wbd-rv-loading, .wbd-rv-empty {
  padding: 40px 0; text-align: center;
  color: var(--wbd-rv-cream-55); font-size: 13px;
  letter-spacing: 0.16em; text-transform: uppercase;
}

/* Thanks */
.wbd-rv-thanks { padding: 40px; text-align: center; }
.wbd-rv-thanks h3 { font-size: 24px; font-weight: 500; margin-bottom: 8px; }
.wbd-rv-thanks p { color: var(--wbd-rv-cream-70); font-size: 15px; }
```

**Don't skip the @media blocks from the mock** — the 720px breakpoint is what makes the mobile experience actually good (horizontal-scrolling chips, photo strip, 16px-input no-zoom, full-width submit, larger touch targets on the rater and pager).

---

## Step 7 — Vite config

### File: `apps/widget-warm/vite.reviews.config.ts` (NEW)

Mirror `vite.contact.config.ts` exactly, swapping the entry and output name:

```ts
import { defineConfig, type Plugin } from 'vite';
import { resolve } from 'path';

// Inline imported CSS so the bundle is a single self-contained IIFE
function cssInjectPlugin(): Plugin {
  let cssAccumulator = '';
  return {
    name: 'css-inject',
    transform(code, id) {
      if (id.endsWith('.css')) {
        cssAccumulator += code;
        return { code: 'export default ""', map: null };
      }
    },
    renderChunk(code) {
      if (!cssAccumulator) return null;
      const inject = `(function(){var s=document.createElement('style');s.setAttribute('data-wbd-rv','1');s.appendChild(document.createTextNode(${JSON.stringify(cssAccumulator)}));document.head.appendChild(s);})();`;
      return { code: inject + code, map: null };
    },
  };
}

export default defineConfig({
  plugins: [cssInjectPlugin()],
  build: {
    lib: {
      entry: resolve(__dirname, 'src/reviews/reviews.ts'),
      formats: ['iife'],
      name: 'WBDReviews',
      fileName: () => 'reviews.js',
    },
    outDir: 'dist',
    emptyOutDir: false,
    minify: 'esbuild',
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
});
```

> Verify the css-inject plugin matches the existing `vite.contact.config.ts` style — if that file uses a different mechanism, copy that one to keep consistency.

---

## Step 8 — package.json updates

### File: `apps/widget-warm/package.json` (UPDATED)

Add a `build:reviews` script and chain it into `build`:

```jsonc
{
  "scripts": {
    "build:chatbot": "vite build --config vite.chatbot.config.ts",
    "build:contact": "vite build --config vite.contact.config.ts",
    "build:returns": "vite build --config vite.returns.config.ts",
    "build:reviews": "vite build --config vite.reviews.config.ts",
    "build": "npm run build:chatbot && npm run build:returns && npm run build:contact && npm run build:reviews"
  }
}
```

(Keep whatever scripts already exist — only add the two reviews lines.)

---

## Step 9 — Theme integration (Shopify)

**Architecture**: Shopify holds nothing about reviews. The theme is three thin pieces:

1. **One global `<script>`** loaded once in `theme.liquid` — mounts everything that has the right `data-*` attributes.
2. **One snippet** for the inline rating row (rendered inside the product main / PDP header).
3. **One Section file** for the full review block (so the merchant can add, remove, reorder, or move it via the theme editor — exactly like any other content section).

Design, copy, configuration, sorting, pagination, validation, photo storage, moderation, reply suggestions — all backend / widget. The theme just provides mount points and the product handle.

### 9a — Global script (load once)

`layout/theme.liquid`, just before `</body>`:

```liquid
<script src="{{ 'https://api.warmbydesign.com' | append: '/widget/warm/reviews.js' }}" defer></script>
```

(Hostname depends on environment. Swap for `http://localhost:3001` in dev. The widget self-mounts on `DOMContentLoaded` for any `[data-wbd-review-badge]` and any `#wbd-reviews` / `[data-wbd-reviews]` it finds.)

### 9b — Inline rating snippet (PDP header)

`snippets/wbd-review-badge.liquid` (NEW):

```liquid
{%- comment -%}
  Renders the locked Quantified rating row. The widget script populates it.
  Usage:  {%- render 'wbd-review-badge', product: product -%}
{%- endcomment -%}
<span
  class="wbd-review-badge"
  data-wbd-review-badge
  data-product-handle="{{ product.handle }}"
></span>
```

Then call it from `sections/main-product.liquid` (or the equivalent in the warm-by-design theme), under the product title:

```liquid
<h1 class="product__title">{{ product.title }}</h1>
{%- render 'wbd-review-badge', product: product -%}
```

### 9c — Full review Section (bottom of PDP)

`sections/wbd-reviews.liquid` (NEW). This is a **Shopify Section** — once committed, it appears in the theme editor's "Add section" picker on the product template, and the merchant can drop it in, reorder it, or hide it without touching code.

```liquid
{%- comment -%}
  Section: Warm Reviews
  Renders a single mount node; the widget loaded in theme.liquid populates it.
{%- endcomment -%}

<section
  id="wbd-reviews"
  data-wbd-reviews
  data-product-handle="{{ product.handle }}"
  class="wbd-reviews-section"
  style="
    --wbd-rv-section-pad-block: {{ section.settings.padding_top | default: 96 }}px {{ section.settings.padding_bottom | default: 96 }}px;
    padding-block: var(--wbd-rv-section-pad-block);
    background: {{ section.settings.background | default: '#0E0E0E' }};
  "
>
  <div class="wbd-reviews-inner">
    {%- if section.settings.heading != blank -%}
      <h2 class="wbd-reviews-heading">{{ section.settings.heading }}</h2>
    {%- endif -%}
    {%- comment -%} The widget injects all content into this element {%- endcomment -%}
  </div>
</section>

<style>
  .wbd-reviews-section { color: #F0EDE8; }
  .wbd-reviews-inner { max-width: 1140px; margin: 0 auto; padding-inline: 24px; }
  .wbd-reviews-heading {
    font-family: "Instrument Sans", sans-serif;
    font-size: 32px; font-weight: 500; letter-spacing: -0.022em;
    margin: 0 0 32px 0; color: #F0EDE8;
  }
  @media (max-width: 720px) {
    .wbd-reviews-inner { padding-inline: 14px; }
    .wbd-reviews-heading { font-size: 24px; margin-bottom: 24px; }
  }
</style>

{% schema %}
{
  "name": "Warm Reviews",
  "tag": "section",
  "class": "wbd-reviews-shopify-section",
  "limit": 1,
  "enabled_on": { "templates": ["product"] },
  "settings": [
    {
      "type": "text",
      "id": "heading",
      "label": "Section heading",
      "default": "Reviews",
      "info": "Optional. Leave blank to hide. The widget brings its own internal stat strip."
    },
    {
      "type": "color",
      "id": "background",
      "label": "Background",
      "default": "#0E0E0E"
    },
    {
      "type": "range",
      "id": "padding_top",
      "label": "Top padding",
      "min": 0, "max": 200, "step": 8, "unit": "px",
      "default": 96
    },
    {
      "type": "range",
      "id": "padding_bottom",
      "label": "Bottom padding",
      "min": 0, "max": 200, "step": 8, "unit": "px",
      "default": 96
    }
  ],
  "presets": [
    { "name": "Warm Reviews" }
  ]
}
{% endschema %}
```

**Why it's a Section, not a snippet**:
- Merchant adds it on a per-template basis from the theme editor (no code).
- Can be moved up/down relative to other PDP content (image gallery, related products, FAQs).
- Can be removed without touching theme code.
- Has its own padding/background settings via the theme editor.
- `"limit": 1` prevents accidentally adding it twice.
- `"enabled_on.templates": ["product"]` means it only appears in the picker on PDP templates.

The Section gives the merchant 4 knobs (heading, background color, top/bottom padding). Everything else — fonts, weights, filter behavior, composer, copy, distribution rendering, mobile rules, validation messages — comes from the widget bundle and is updated by deploying the backend, not by editing the theme.

### 9d — Optional: review submission redirect handling

If the widget receives a `?review_token=<uuid>` query (from the post-purchase email), it auto-scrolls to `#wbd-reviews` and pre-fills the composer with the customer's email + name from the request record. No theme work needed; this is widget logic.

---

## Step 10 — Playground page

Add a route in [apps/backend/src/index.ts](../../../apps/backend/src/index.ts) next to the existing `/widget/warm/playground` for testing the review widget in isolation:

```ts
app.get('/widget/warm/playground-reviews', (_req, res) => {
  res.type('html').send(`<!doctype html>
<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Warm — Reviews Playground</title>
<style>body{margin:0;padding:48px 24px;background:#131313;color:#F0EDE8;font-family:"Instrument Sans",sans-serif;max-width:1140px;margin-inline:auto}h1{font-size:48px;font-weight:500;letter-spacing:-0.025em;margin-bottom:8px}h1 + p{color:#F5BC70;font-size:11px;letter-spacing:0.22em;text-transform:uppercase;margin-bottom:32px}.qrow{margin:18px 0 32px;display:block}</style>
</head><body>
  <p>Floor Lamp</p>
  <h1>Ribbon</h1>
  <span data-wbd-review-badge data-product-handle="ribbon" class="qrow"></span>
  <section id="wbd-reviews" data-product-handle="ribbon"></section>
  <script src="/widget/warm/reviews.js?v=${Date.now()}"></script>
</body></html>`);
});
```

---

## Verification checklist

After the implementing AI finishes, the user should run through this:

- [ ] `cd apps/widget-warm && npm run build:reviews` produces `dist/reviews.js` without errors
- [ ] `npm run build` (root) finishes without breaking the existing chatbot/contact/returns bundles
- [ ] Backend dev server serves `http://localhost:3001/widget/warm/reviews.js` (200 OK, JS body)
- [ ] Migration 005 ran: `select settings->'widgetUrls'->>'reviews' from brands where slug='warm-by-design'` returns `/widget/warm/reviews.js`
- [ ] `http://localhost:3001/widget/warm/playground-reviews` renders the full V3-C section with the locked Quantified inline badge in the header
- [ ] Stars are amber (not black) — if black, the `<use>` fallback issue isn't fixed; ensure `fill="currentColor"` is on the star path inside any `<symbol>` references
- [ ] Filter chips switch the list (rating, photos, verified)
- [ ] Sort cycles through all four options
- [ ] Pager moves between pages
- [ ] Photo thumbnails open in a new tab when clicked
- [ ] Composer star rater fills correctly on hover and click
- [ ] Submit creates a review in Supabase under `brand_id` of warm-by-design (verify with `select brand_id, customer_name, rating from reviews order by created_at desc limit 5`)
- [ ] Photo upload writes to `review-media` bucket and the URL appears in `review_media` table
- [ ] **Mobile**: at 375px viewport, chip row scrolls horizontally, photos scroll horizontally, all inputs are 16px (no iOS zoom), submit button is full-width, rater stars are 28px (touch-friendly)
- [ ] Inline `[data-wbd-review-badge]` shows the locked Quantified row and clicking jumps to `#wbd-reviews`

---

## Out-of-scope (intentionally)

- The shared review widget at `apps/widget/src/review-widget.ts` stays untouched — it still serves Outlight/Misu.
- Admin dashboard `apps/admin/src/app/(dashboard)/reviews/` doesn't need brand-aware widget previews for this work; the playground covers that.
- AI-generated review reply suggestions (`/admin/reviews/:id/suggest-reply`) already exist and are unrelated.
- Email templates (request, reminder, thank_you) already exist per-brand.

If any of these become in-scope later, scope them as separate work.
