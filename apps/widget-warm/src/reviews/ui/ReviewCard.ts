import { type Review, markHelpful } from '../api/client';
import { starsHtml } from './stars';

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function renderReviewCard(review: Review): HTMLElement {
  const media = review.media ?? [];
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
    <p>${escapeHtml(review.body).replace(/\n/g, '<br>')}</p>
    ${
      media.length
        ? `<div class="wbd-rv-photos">${media
            .map(
              (m) =>
                `<a class="wbd-rv-ph" href="${escapeAttr(m.url)}" target="_blank" rel="noreferrer" style="background-image:url('${escapeAttr(m.url)}')"></a>`,
            )
            .join('')}</div>`
        : ''
    }
    <div class="wbd-rv-foot">
      <a href="#" data-helpful><b>${review.helpful_count}</b>Helpful</a>
    </div>
  `;

  const helpful = el.querySelector<HTMLAnchorElement>('[data-helpful]');
  helpful?.addEventListener('click', async (event) => {
    event.preventDefault();
    if (helpful.dataset.clicked) return;
    helpful.dataset.clicked = '1';
    try {
      const result = await markHelpful(review.id);
      const count = helpful.querySelector('b');
      if (count) count.textContent = String(result.helpful_count);
    } catch {
      delete helpful.dataset.clicked;
    }
  });

  return el;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!
  ));
}

function escapeAttr(value: string): string {
  return value.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

