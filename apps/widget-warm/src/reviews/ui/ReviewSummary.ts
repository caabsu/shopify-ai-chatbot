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
    <button type="button" class="wbd-rv-btn-link wbd-rv-write">Write a review</button>
  `;
  el.querySelector<HTMLButtonElement>('.wbd-rv-write')?.addEventListener('click', onWriteClick);
  return el;
}

export async function mountInlineBadge(host: HTMLElement, handle: string): Promise<void> {
  try {
    const summary = await getReviewSummary(handle);
    if (!summary.total_count) {
      host.innerHTML = `
        <span class="wbd-rv-qrow" data-wbd-rv>
          <span class="wbd-rv-stars">${starsHtml(5)}</span>
          <a class="wbd-rv-read" href="#wbd-reviews">Write a review</a>
        </span>
      `;
      return;
    }

    host.innerHTML = `
      <span class="wbd-rv-qrow" data-wbd-rv>
        <span class="wbd-rv-stars">${starsHtml(Math.round(summary.average_rating))}</span>
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

