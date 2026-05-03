import { getReviews, getReviewSummary, getWidgetConfig, type ReviewSummary } from '../api/client';
import { defaultState, type SectionState, type SortKey } from '../state/store';
import { renderFilterRow } from './FilterRow';
import { renderReviewCard } from './ReviewCard';
import { renderComposer } from './ReviewComposer';
import { renderStatStrip } from './ReviewSummary';

export async function mountReviewSection(host: HTMLElement, handle: string): Promise<void> {
  host.classList.add('wbd-rv-section');
  host.innerHTML = '<div class="wbd-rv-loading">Loading reviews...</div>';

  let perPage = 10;
  let sort: SortKey = 'most_helpful';
  try {
    const config = await getWidgetConfig();
    perPage = config.reviews_per_page || perPage;
    sort = config.default_sort === 'newest' ? 'most_recent' : (config.default_sort as SortKey);
  } catch {
    /* Defaults are fine if config is unavailable. */
  }

  let state: SectionState = { ...defaultState(handle, perPage), sort };
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
  const composerWrap = document.createElement('div');

  host.innerHTML = '';
  host.append(stripWrap, filterWrap, listWrap, composerWrap);

  function renderStrip(): void {
    stripWrap.replaceChildren(
      renderStatStrip(summary, () => composerWrap.scrollIntoView({ behavior: 'smooth', block: 'start' })),
    );
  }

  function renderFilters(): void {
    filterWrap.replaceChildren(
      renderFilterRow(summary, state, (next) => {
        state = { ...state, ...next };
        void refresh();
      }),
    );
  }

  function renderComposerBlock(): void {
    composerWrap.replaceChildren(
      renderComposer(handle, () => {
        getReviewSummary(handle)
          .then((next) => {
            summary = next;
            renderStrip();
            renderFilters();
          })
          .catch(() => {});
      }),
    );
  }

  async function refresh(): Promise<void> {
    listWrap.innerHTML = '<div class="wbd-rv-loading">Loading...</div>';
    try {
      const response = await getReviews(handle, {
        page: state.page,
        perPage: state.perPage,
        sort: state.sort,
        rating: state.ratingFilter ?? undefined,
        verified: state.verifiedOnly || undefined,
      });

      const reviews = state.withPhotosOnly
        ? response.reviews.filter((review) => (review.media ?? []).length > 0)
        : response.reviews;

      if (reviews.length === 0) {
        listWrap.replaceChildren(emptyState());
      } else {
        listWrap.replaceChildren(
          ...reviews.map(renderReviewCard),
          renderPager(response.total, state.page, state.perPage, (page) => {
            state = { ...state, page };
            void refresh();
          }),
        );
      }
      renderFilters();
    } catch {
      listWrap.innerHTML = '<div class="wbd-rv-empty">Could not load reviews. Try again.</div>';
    }
  }

  renderStrip();
  renderFilters();
  renderComposerBlock();
  await refresh();
}

function emptyState(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'wbd-rv-empty';
  el.textContent = 'No reviews match this filter.';
  return el;
}

function renderPager(total: number, page: number, perPage: number, onGo: (page: number) => void): HTMLElement {
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const el = document.createElement('div');
  el.className = 'wbd-rv-pager';
  if (totalPages <= 1) return el;
  const start = (page - 1) * perPage + 1;
  const end = Math.min(total, page * perPage);
  el.innerHTML = `
    <span>Showing ${start}-${end} of ${total}</span>
    <span class="nav">
      <button type="button" data-prev ${page <= 1 ? 'disabled' : ''} aria-label="Previous page">&lsaquo;</button>
      <button type="button" data-next ${page >= totalPages ? 'disabled' : ''} aria-label="Next page">&rsaquo;</button>
    </span>
  `;
  el.querySelector<HTMLButtonElement>('[data-prev]')?.addEventListener('click', () => onGo(Math.max(1, page - 1)));
  el.querySelector<HTMLButtonElement>('[data-next]')?.addEventListener('click', () => onGo(Math.min(totalPages, page + 1)));
  return el;
}
