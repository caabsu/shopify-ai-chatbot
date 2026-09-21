import { getHomepageReviews, type Review } from '../api/client';
import { starsHtml } from './stars';
import { openLightbox } from './Lightbox';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!
  ));
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

function firstImage(review: Review): string | null {
  return review.media?.find((media) => media.media_type === 'image')?.url ?? null;
}

function reviewCard(review: Review): string {
  const image = firstImage(review);
  const name = review.customer_nickname || review.customer_name || 'Anonymous';
  const date = formatDate(review.published_at || review.submitted_at);
  const product = review.product;

  return `
    <article class="wbd-rv-home-card${image ? ' has-image' : ''}" data-review-id="${escapeHtml(review.id)}">
      ${image ? `<button type="button" class="wbd-rv-home-image" data-home-image="${escapeHtml(image)}" aria-label="Open review photo"><img src="${escapeHtml(image)}" alt="" loading="lazy"></button>` : ''}
      <div class="wbd-rv-home-copy">
        <div class="wbd-rv-home-stars">${starsHtml(review.rating)}</div>
        ${review.title ? `<h3>${escapeHtml(review.title)}</h3>` : ''}
        <blockquote>${escapeHtml(review.body)}</blockquote>
        <div class="wbd-rv-home-meta">
          <span class="wbd-rv-home-name">${escapeHtml(name)}</span>
          ${review.verified_purchase ? '<span class="wbd-rv-home-verified">Verified</span>' : ''}
          ${date ? `<span>${date}</span>` : ''}
        </div>
        ${product ? `<a class="wbd-rv-home-product" href="/products/${encodeURIComponent(product.handle)}">${escapeHtml(product.title)} <span aria-hidden="true">↗</span></a>` : ''}
      </div>
    </article>
  `;
}

function wireInteractions(root: HTMLElement): void {
  root.querySelectorAll<HTMLButtonElement>('[data-home-image]').forEach((button) => {
    button.addEventListener('click', () => {
      const src = button.dataset.homeImage;
      if (src) openLightbox({ images: [src], startIndex: 0, alt: 'Review photo' });
    });
  });

  const track = root.querySelector<HTMLElement>('[data-wbd-home-track]');
  root.querySelector<HTMLButtonElement>('[data-wbd-home-prev]')?.addEventListener('click', () => {
    track?.scrollBy({ left: -(track.clientWidth * 0.82), behavior: 'smooth' });
  });
  root.querySelector<HTMLButtonElement>('[data-wbd-home-next]')?.addEventListener('click', () => {
    track?.scrollBy({ left: track.clientWidth * 0.82, behavior: 'smooth' });
  });
}

export async function mountHomepageReviews(root: HTMLElement): Promise<void> {
  if (root.dataset.wbdHomeMounted === 'true') return;
  root.dataset.wbdHomeMounted = 'true';
  root.classList.add('wbd-rv-home');

  const limit = Math.max(1, Math.min(Number(root.dataset.limit) || 8, 24));
  const heading = root.dataset.heading || 'Warmth, lived in';
  const eyebrow = root.dataset.eyebrow || 'From the community';
  const reviewsUrl = root.dataset.reviewsUrl || '';
  const refreshSeconds = Math.max(0, Number(root.dataset.refreshSeconds) || 60);

  root.innerHTML = '<div class="wbd-rv-home-loading" aria-label="Loading customer reviews"></div>';

  const refresh = async () => {
    try {
      const data = await getHomepageReviews(limit);
      if (data.reviews.length === 0) {
        root.innerHTML = `
          <div class="wbd-rv-home-empty">
            <span>${escapeHtml(eyebrow)}</span>
            <p>Customer stories will glow here soon.</p>
          </div>
        `;
        return;
      }

      root.innerHTML = `
        <header class="wbd-rv-home-head">
          <div>
            <span class="wbd-rv-home-eyebrow">${escapeHtml(eyebrow)}</span>
            <h2>${escapeHtml(heading)}</h2>
          </div>
          <div class="wbd-rv-home-summary" aria-label="${data.summary.average_rating} out of 5 from ${data.summary.total_count} reviews">
            <span class="wbd-rv-home-score">${data.summary.average_rating.toFixed(1)}</span>
            <span>${starsHtml(data.summary.average_rating)}</span>
            <small>${data.summary.total_count} reviews</small>
          </div>
        </header>
        <div class="wbd-rv-home-rail">
          <button type="button" class="wbd-rv-home-arrow prev" data-wbd-home-prev aria-label="Previous reviews">‹</button>
          <div class="wbd-rv-home-track" data-wbd-home-track>
            ${data.reviews.map(reviewCard).join('')}
          </div>
          <button type="button" class="wbd-rv-home-arrow next" data-wbd-home-next aria-label="Next reviews">›</button>
        </div>
        ${reviewsUrl ? `<a class="wbd-rv-home-all" href="${escapeHtml(reviewsUrl)}">Read every review <span aria-hidden="true">→</span></a>` : ''}
      `;
      wireInteractions(root);
    } catch (error) {
      console.error('[wbd-reviews] Unable to load homepage reviews:', error);
      root.innerHTML = `
        <div class="wbd-rv-home-empty">
          <span>${escapeHtml(eyebrow)}</span>
          <p>Customer stories are temporarily unavailable.</p>
        </div>
      `;
    }
  };

  await refresh();

  if (refreshSeconds > 0) {
    window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, refreshSeconds * 1000);
  }
}
