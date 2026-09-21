/**
 * Outlight V20 — Full-Bleed Photo Review Carousel (hosted widget)
 *
 * Usage in Shopify Liquid section:
 *   <div id="outlight-v20-carousel"
 *     data-heading="AVEN FLOOR LAMP"
 *     data-accent="#C5A059"
 *     data-max-cards="12"
 *     data-no-photo-bg="#f4f0eb">
 *   </div>
 *   <script src="https://your-backend/widget/v20-carousel.js" defer></script>
 *
 * Uses product review data when installed on a product page. On homepages it
 * fetches the brand-wide featured feed directly, so no companion widget or
 * hard-coded review content is required.
 */

import './styles/v20-carousel.css';

// ── Types ──────────────────────────────────────────────────────────

interface ReviewMedia {
  url: string;
  media_type?: string;
}

interface Review {
  customer_nickname?: string;
  customer_name?: string;
  reviewer_name?: string;
  author?: string;
  name?: string;
  body?: string;
  review_text?: string;
  content?: string;
  text?: string;
  rating?: number;
  score?: number;
  verified_purchase?: boolean;
  verified?: boolean;
  published_at?: string;
  submitted_at?: string;
  created_at?: string;
  date?: string;
  variant_title?: string;
  variant?: string;
  helpful_count?: number;
  helpful?: number;
  media?: ReviewMedia[];
  images?: (string | ReviewMedia)[];
  photos?: (string | ReviewMedia)[];
}

interface ReviewData {
  reviews?: Review[];
  data?: Review[];
  results?: Review[];
  summary?: { average_rating: number; total_count: number };
  selection?: 'featured' | 'published';
}

declare global {
  interface Window {
    outlightReviews?: ReviewData;
  }
}

// ── Helpers ────────────────────────────────────────────────────────

interface IntegrationInfo {
  backendUrl: string;
  brandSlug: string;
  productHandle: string;
  limit: number;
  refreshSeconds: number;
}

function getIntegrationInfo(container: HTMLElement): IntegrationInfo {
  const script = Array.from(document.querySelectorAll<HTMLScriptElement>('script[src]'))
    .find((candidate) => candidate.src.includes('/widget/v20-carousel.js'));
  const productReviewRoot = document.querySelector<HTMLElement>(
    '#outlight-reviews[data-product-handle], [data-outlight-reviews][data-product-handle]',
  );
  const productHandle = container.dataset.productHandle
    || productReviewRoot?.dataset.productHandle
    || '';
  const backendUrl = container.dataset.apiBase
    || script?.dataset.apiBase
    || (script?.src ? new URL(script.src).origin : window.location.origin);
  const brandSlug = container.dataset.brand || script?.dataset.brand || '';
  const limit = Math.max(1, Math.min(Number(container.dataset.maxCards) || 12, 50));
  const refreshSeconds = Math.max(0, Number(container.dataset.refreshSeconds) || 60);

  return { backendUrl, brandSlug, productHandle, limit, refreshSeconds };
}

async function fetchReviewData(info: IntegrationInfo): Promise<ReviewData> {
  const headers: Record<string, string> = {};
  const brandParam = info.brandSlug ? `brand=${encodeURIComponent(info.brandSlug)}` : '';
  if (info.brandSlug) headers['X-Brand'] = info.brandSlug;

  if (!info.productHandle) {
    const params = new URLSearchParams();
    params.set('limit', String(info.limit));
    if (info.brandSlug) params.set('brand', info.brandSlug);
    const response = await fetch(`${info.backendUrl}/api/reviews/featured?${params}`, {
      headers,
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`Homepage review request failed (${response.status})`);
    return response.json() as Promise<ReviewData>;
  }

  const brandSuffix = brandParam ? `&${brandParam}` : '';
  const encodedHandle = encodeURIComponent(info.productHandle);
  const [reviewsResponse, summaryResponse] = await Promise.all([
    fetch(
      `${info.backendUrl}/api/reviews/product/${encodedHandle}?page=1&per_page=${info.limit}&sort=newest${brandSuffix}`,
      { headers, cache: 'no-store' },
    ),
    fetch(
      `${info.backendUrl}/api/reviews/product/${encodedHandle}/summary${brandParam ? `?${brandParam}` : ''}`,
      { headers, cache: 'no-store' },
    ),
  ]);

  if (!reviewsResponse.ok || !summaryResponse.ok) {
    throw new Error('Product review request failed');
  }

  const [reviewsData, summary] = await Promise.all([
    reviewsResponse.json() as Promise<{ reviews?: Review[] }>,
    summaryResponse.json() as Promise<{ average_rating: number; total_count: number }>,
  ]);
  return { reviews: reviewsData.reviews ?? [], summary };
}

function esc(str: string): string {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function starSVG(filled: boolean, color: string, size: number): string {
  const fill = filled ? color : 'none';
  const opacity = filled ? '1' : '0.35';
  const stroke = filled ? color : color;
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" fill="${fill}" stroke="${stroke}" stroke-width="1" opacity="${opacity}"/></svg>`;
}

function starsHTML(rating: number, color: string, size: number): string {
  const full = Math.floor(rating);
  const extra = rating - full >= 0.75 ? 1 : 0;
  const total = full + extra;
  let h = '';
  for (let i = 0; i < 5; i++) h += starSVG(i < total, color, size);
  return h;
}

function formatDate(d: string): string {
  try {
    const dt = new Date(d);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${months[dt.getMonth()]} ${dt.getDate()}, ${dt.getFullYear()}`;
  } catch {
    return d;
  }
}

function thumbSVG(): string {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>';
}

function chevronSVG(dir: 'left' | 'right'): string {
  const path = dir === 'left' ? 'M15 18l-6-6 6-6' : 'M9 18l6-6-6-6';
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="${path}"/></svg>`;
}

// ── Extract first image URL ────────────────────────────────────────

function getImageUrl(r: Review): string {
  const mediaArr = r.media || r.images || r.photos || [];
  if (mediaArr.length === 0) return '';
  const first = mediaArr[0];
  const url = typeof first === 'string' ? first : ((first as ReviewMedia).url || '');
  if ((first as ReviewMedia).media_type && (first as ReviewMedia).media_type !== 'image') return '';
  return url;
}

// ── Lightbox ───────────────────────────────────────────────────────

function openLightbox(src: string): void {
  const overlay = document.createElement('div');
  overlay.className = 'v20-lightbox';
  overlay.innerHTML = `<button class="v20-lightbox-close">&times;</button><img src="${src}" alt="Review photo">`;
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || (e.target as HTMLElement).classList.contains('v20-lightbox-close')) {
      overlay.remove();
    }
  });
  overlay.querySelector('.v20-lightbox-close')!.addEventListener('click', () => overlay.remove());
  const handler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      overlay.remove();
      document.removeEventListener('keydown', handler);
    }
  };
  document.addEventListener('keydown', handler);
  document.body.appendChild(overlay);
}

// ── Render ─────────────────────────────────────────────────────────

function render(container: HTMLElement, data: ReviewData): void {
  const accent = container.getAttribute('data-accent') || '#C5A059';
  const heading = container.getAttribute('data-heading') || '';
  const maxCards = parseInt(container.getAttribute('data-max-cards') || '12', 10);
  const noPhotoBg = container.getAttribute('data-no-photo-bg') || '#f4f0eb';

  // Set CSS vars
  container.style.setProperty('--v20-accent', accent);
  container.style.setProperty('--v20-warm', noPhotoBg);

  // Normalize reviews
  let reviews: Review[] = [];
  let summary = data.summary || null;
  if (data.reviews) reviews = data.reviews;
  else if (Array.isArray(data)) reviews = data as unknown as Review[];
  else if (data.data) reviews = data.data;
  else if (data.results) reviews = data.results;

  if (!reviews.length) {
    container.innerHTML = `
      <div class="v20-empty">
        <span class="v20-empty-kicker">Customer stories</span>
        <p>${esc(container.dataset.emptyText || 'Published reviews will appear here soon.')}</p>
      </div>
    `;
    return;
  }

  // Sort: photos first
  reviews = reviews.slice().sort((a, b) => {
    const aHas = getImageUrl(a) ? 1 : 0;
    const bHas = getImageUrl(b) ? 1 : 0;
    return bHas - aHas;
  });
  reviews = reviews.slice(0, maxCards);

  // Compute rating
  let avgRating = 0;
  let totalCount = reviews.length;
  if (summary) {
    avgRating = summary.average_rating;
    totalCount = summary.total_count || totalCount;
  } else {
    let sum = 0;
    for (const r of reviews) sum += (r.rating || r.score || 0);
    avgRating = reviews.length ? sum / reviews.length : 0;
  }

  // Build HTML
  let html = '';

  // Header
  html += '<div class="v20-header">';
  if (heading) html += `<div class="v20-header-label">${esc(heading)}</div>`;
  html += '<div class="v20-header-row">';
  html += `<span class="v20-header-num">${avgRating.toFixed(1)}</span>`;
  html += `<span class="v20-header-stars">${starsHTML(avgRating, accent, 16)}</span>`;
  html += `<span class="v20-header-count">${totalCount} reviews</span>`;
  html += '</div></div>';

  // Carousel wrap
  html += '<div class="v20-carousel-wrap">';

  // Arrows (desktop only)
  html += `<button class="v20-arrow v20-arrow--prev" disabled aria-label="Previous">${chevronSVG('left')}</button>`;
  html += `<button class="v20-arrow v20-arrow--next" aria-label="Next">${chevronSVG('right')}</button>`;

  // Track
  html += '<div class="v20-carousel">';

  for (const r of reviews) {
    const name = r.customer_nickname || r.customer_name || r.reviewer_name || r.author || r.name || 'Anonymous';
    const body = r.body || r.review_text || r.content || r.text || '';
    const rating = r.rating || r.score || 5;
    const verified = r.verified_purchase || r.verified || false;
    const date = r.published_at || r.submitted_at || r.created_at || r.date || '';
    const variant = r.variant_title || r.variant || '';
    const helpful = r.helpful_count || r.helpful || 0;
    const imgUrl = getImageUrl(r);
    const hasPhoto = !!imgUrl;

    html += `<div class="v20-card${hasPhoto ? '' : ' v20-no-photo'}"${hasPhoto ? ` data-img="${esc(imgUrl)}"` : ''}>`;

    if (hasPhoto) {
      html += `<div class="v20-card-bg"><img src="${imgUrl}" alt="" loading="lazy"></div>`;
      html += '<div class="v20-card-grad"></div>';
    }

    html += '<div class="v20-card-content">';
    html += `<div class="v20-stars">${starsHTML(rating, hasPhoto ? '#fff' : accent, 11)}</div>`;
    html += `<div class="v20-card-name">${esc(name)}${verified ? ' <span class="v20-vf">verified</span>' : ''}</div>`;
    if (date) html += `<div class="v20-card-date">${formatDate(date)}</div>`;
    html += `<p class="v20-card-snippet">${esc(body)}</p>`;

    // Expand footer (desktop hover only, hidden on mobile via CSS)
    html += '<div class="v20-card-full"><div class="v20-card-full-foot">';
    html += variant ? `<span class="v20-card-full-item">${esc(variant)}</span>` : '<span class="v20-card-full-item"></span>';
    html += `<button class="v20-helpful">${thumbSVG()} ${helpful}</button>`;
    html += '</div></div>';

    html += '</div></div>';
  }

  html += '</div>'; // .v20-carousel

  // Scroll indicator dots (mobile)
  html += '<div class="v20-dots">';
  for (let i = 0; i < reviews.length; i++) {
    html += `<span class="v20-dot${i === 0 ? ' v20-dot--active' : ''}"></span>`;
  }
  html += '</div>';

  html += '</div>'; // .v20-carousel-wrap

  // "Read all reviews" CTA
  html += '<div class="v20-cta-wrap">';
  html += '<button class="v20-read-all">Read all reviews &darr;</button>';
  html += '</div>';

  container.innerHTML = html;

  // ── Wire up interactions ────────────────────────────────────────

  const track = container.querySelector('.v20-carousel') as HTMLElement;
  const prevBtn = container.querySelector('.v20-arrow--prev') as HTMLButtonElement;
  const nextBtn = container.querySelector('.v20-arrow--next') as HTMLButtonElement;
  const dots = container.querySelectorAll('.v20-dot');
  const readAllBtn = container.querySelector('.v20-read-all') as HTMLButtonElement;

  // Lightbox
  container.querySelectorAll<HTMLElement>('.v20-card[data-img]').forEach((card) => {
    card.addEventListener('click', () => {
      const src = card.getAttribute('data-img');
      if (src) openLightbox(src);
    });
  });

  // Arrow nav
  function getScrollAmount(): number {
    const firstCard = track.querySelector('.v20-card') as HTMLElement | null;
    return firstCard ? firstCard.offsetWidth + 14 : 334;
  }

  function updateArrows(): void {
    const sl = track.scrollLeft;
    const maxScroll = track.scrollWidth - track.clientWidth;
    prevBtn.disabled = sl <= 2;
    nextBtn.disabled = sl >= maxScroll - 2;
  }

  function updateDots(): void {
    const cards = track.querySelectorAll('.v20-card');
    if (!cards.length) return;
    const trackRect = track.getBoundingClientRect();
    const center = trackRect.left + trackRect.width / 2;
    let closestIdx = 0;
    let closestDist = Infinity;
    cards.forEach((card, idx) => {
      const rect = card.getBoundingClientRect();
      const cardCenter = rect.left + rect.width / 2;
      const dist = Math.abs(cardCenter - center);
      if (dist < closestDist) {
        closestDist = dist;
        closestIdx = idx;
      }
    });
    dots.forEach((dot, idx) => {
      dot.classList.toggle('v20-dot--active', idx === closestIdx);
    });
  }

  prevBtn.addEventListener('click', () => {
    track.scrollBy({ left: -getScrollAmount(), behavior: 'smooth' });
  });
  nextBtn.addEventListener('click', () => {
    track.scrollBy({ left: getScrollAmount(), behavior: 'smooth' });
  });
  track.addEventListener('scroll', () => {
    updateArrows();
    updateDots();
  });
  updateArrows();

  // "Read all reviews" → scroll to #outlight-reviews
  readAllBtn.addEventListener('click', () => {
    const reviewsSection = document.getElementById('outlight-reviews')
      || document.querySelector('[data-outlight-reviews]');
    if (reviewsSection) {
      reviewsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    const reviewsUrl = container.dataset.reviewsUrl;
    if (reviewsUrl) window.location.assign(reviewsUrl);
  });
  if (
    !document.getElementById('outlight-reviews')
    && !document.querySelector('[data-outlight-reviews]')
    && !container.dataset.reviewsUrl
  ) {
    readAllBtn.closest('.v20-cta-wrap')?.remove();
  }
}

// ── Init ───────────────────────────────────────────────────────────

function renderSkeleton(container: HTMLElement): void {
  container.classList.add('v20-section');
  let html = '<div class="v20-header"><div class="v20-skel-bar w40" style="height:14px;margin-bottom:12px"></div><div class="v20-skel-bar w60" style="height:36px"></div></div>';
  html += '<div class="v20-carousel-wrap"><div class="v20-carousel v20-skeleton">';
  for (let i = 0; i < 5; i++) {
    html += '<div class="v20-card"><div class="v20-card-content" style="position:relative;padding:28px">';
    html += '<div class="v20-skel-bar w40"></div><div class="v20-skel-bar w60"></div>';
    html += '<div class="v20-skel-bar w80"></div><div class="v20-skel-bar w40"></div>';
    html += '</div></div>';
  }
  html += '</div></div>';
  container.innerHTML = html;
}

async function init(): Promise<void> {
  const container = document.getElementById('outlight-v20-carousel');
  if (!container) return;
  const info = getIntegrationInfo(container);

  if (info.productHandle && window.outlightReviews) {
    render(container, window.outlightReviews);
  } else {
    renderSkeleton(container);
  }

  const refresh = async () => {
    try {
      const data = await fetchReviewData(info);
      render(container, data);
    } catch (error) {
      if (info.productHandle && window.outlightReviews) {
        render(container, window.outlightReviews);
        return;
      }
      console.error('[review-carousel] Unable to refresh reviews:', error);
      container.innerHTML = `
        <div class="v20-empty v20-empty--error">
          <span class="v20-empty-kicker">Customer stories</span>
          <p>Reviews are temporarily unavailable.</p>
        </div>
      `;
    }
  };

  await refresh();

  if (info.productHandle) {
    window.addEventListener('outlight-reviews-loaded', () => {
      if (window.outlightReviews) render(container, window.outlightReviews);
    });
  }

  if (info.refreshSeconds > 0) {
    window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, info.refreshSeconds * 1000);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => void init());
} else {
  void init();
}
