/**
 * Outlight Review Badge — Small star rating + review count.
 * Embeddable inline on product cards or product pages.
 *
 * Usage:
 *   <div class="outlight-review-badge" data-product-handle="aven"></div>
 *   <script src="https://your-backend/widget/review-badge.js" data-brand="misu"></script>
 *
 * Renders: ★★★★★  27 Reviews
 * Clicking scrolls to #outlight-reviews if present on the page.
 */

const STAR_COLOR = '#C5A059';
const STAR_SIZE = 14;

function getScriptInfo(): { backendUrl: string; brandSlug: string } {
  const scripts = document.querySelectorAll('script[src]');
  let backendUrl = '';
  let brandSlug = '';
  for (const script of scripts) {
    const el = script as HTMLScriptElement;
    if (el.src.includes('review-badge')) {
      try { backendUrl = new URL(el.src).origin; } catch { /* ignore */ }
      brandSlug = el.getAttribute('data-brand') || '';
      break;
    }
  }
  return { backendUrl: backendUrl || 'http://localhost:3001', brandSlug };
}

function createStarSvg(fill: 'full' | 'half' | 'empty', size: number): string {
  const path = 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z';
  if (fill === 'full') {
    return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" style="flex-shrink:0"><path d="${path}" fill="${STAR_COLOR}" stroke="${STAR_COLOR}" stroke-width="1"/></svg>`;
  }
  if (fill === 'half') {
    const id = 'orbh' + Math.random().toString(36).slice(2, 6);
    return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" style="flex-shrink:0"><defs><clipPath id="${id}"><rect x="0" y="0" width="12" height="24"/></clipPath></defs><path d="${path}" fill="${STAR_COLOR}" stroke="${STAR_COLOR}" stroke-width="1" clip-path="url(#${id})"/><path d="${path}" fill="none" stroke="${STAR_COLOR}" stroke-width="1"/></svg>`;
  }
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" style="flex-shrink:0"><path d="${path}" fill="none" stroke="${STAR_COLOR}" stroke-width="1" opacity="0.35"/></svg>`;
}

function renderStars(rating: number): string {
  const full = Math.floor(rating);
  const hasHalf = rating - full >= 0.25 && rating - full < 0.75;
  const extra = rating - full >= 0.75;
  const totalFull = extra ? full + 1 : full;
  let html = '';
  for (let i = 0; i < 5; i++) {
    if (i < totalFull) html += createStarSvg('full', STAR_SIZE);
    else if (i === totalFull && hasHalf) html += createStarSvg('half', STAR_SIZE);
    else html += createStarSvg('empty', STAR_SIZE);
  }
  return html;
}

function injectStyles(): void {
  if (document.getElementById('orb-styles')) return;
  const style = document.createElement('style');
  style.id = 'orb-styles';
  style.textContent = `
.orb-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  text-decoration: none;
  transition: opacity 0.15s;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  line-height: 1;
}
.orb-badge:hover { opacity: 0.75; }
.orb-stars {
  display: inline-flex;
  align-items: center;
  gap: 1px;
}
.orb-count {
  font-size: 13px;
  font-weight: 400;
  color: #6B7280;
  white-space: nowrap;
}
`;
  document.head.appendChild(style);
}

async function init(): Promise<void> {
  injectStyles();

  const { backendUrl, brandSlug } = getScriptInfo();
  const brandParam = brandSlug ? `?brand=${brandSlug}` : '';

  const badges = document.querySelectorAll('.outlight-review-badge, [data-outlight-badge]');
  if (badges.length === 0) return;

  // Batch fetch summaries for all unique handles
  const handleSet = new Set<string>();
  badges.forEach((el) => {
    const handle = el.getAttribute('data-product-handle');
    if (handle) handleSet.add(handle);
  });

  const summaries: Record<string, { average_rating: number; total_count: number }> = {};

  await Promise.all(
    Array.from(handleSet).map(async (handle) => {
      try {
        const res = await fetch(`${backendUrl}/api/reviews/product/${encodeURIComponent(handle)}/summary${brandParam}`);
        if (res.ok) {
          summaries[handle] = await res.json();
        }
      } catch { /* ignore */ }
    }),
  );

  badges.forEach((el) => {
    const handle = el.getAttribute('data-product-handle');
    if (!handle) return;

    const summary = summaries[handle];
    if (!summary || summary.total_count === 0) {
      // No reviews — hide badge
      (el as HTMLElement).style.display = 'none';
      return;
    }

    const badge = document.createElement('a');
    badge.className = 'orb-badge';
    badge.href = '#outlight-reviews';

    const stars = document.createElement('span');
    stars.className = 'orb-stars';
    stars.innerHTML = renderStars(summary.average_rating);
    badge.appendChild(stars);

    const count = document.createElement('span');
    count.className = 'orb-count';
    count.textContent = `${summary.total_count} Review${summary.total_count !== 1 ? 's' : ''}`;
    badge.appendChild(count);

    badge.addEventListener('click', (e) => {
      const target = document.getElementById('outlight-reviews');
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });

    el.innerHTML = '';
    el.appendChild(badge);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
