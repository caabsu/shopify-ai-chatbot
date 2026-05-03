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
  onChange: (next: Partial<SectionState>) => void,
): HTMLElement {
  const el = document.createElement('div');
  el.className = 'wbd-rv-chip-row';

  const ratingChip = (rating: number | null, label: string, count: number) => {
    const active =
      (rating === null && state.ratingFilter === null && !state.withPhotosOnly && !state.verifiedOnly) ||
      state.ratingFilter === rating;
    return `<a href="#" class="wbd-rv-chip${active ? ' on' : ''}" data-rating="${rating ?? ''}">${label} <span class="n">${count}</span></a>`;
  };

  el.innerHTML = `
    <span class="wbd-rv-chip-lbl">Filter</span>
    ${ratingChip(null, 'All', summary.total_count)}
    ${[5, 4, 3, 2, 1]
      .map((rating) => {
        const d = summary.distribution.find((x) => x.rating === rating);
        return d && d.count > 0 ? ratingChip(rating, `${rating} stars`, d.count) : '';
      })
      .join('')}
    <a href="#" class="wbd-rv-chip${state.withPhotosOnly ? ' on' : ''}" data-photos>With photos <span class="n">${summary.with_photos_count}</span></a>
    <a href="#" class="wbd-rv-chip${state.verifiedOnly ? ' on' : ''}" data-verified>Verified <span class="n">${summary.verified_count}</span></a>
    <span class="wbd-rv-chip-right">
      <button type="button" class="wbd-rv-sel" data-sort>
        <span class="wbd-rv-sel-lbl">Sort</span>
        <span class="wbd-rv-sel-v">${SORT_LABELS[state.sort]}</span>
      </button>
    </span>
  `;

  el.querySelectorAll<HTMLAnchorElement>('[data-rating]').forEach((chip) => {
    chip.addEventListener('click', (event) => {
      event.preventDefault();
      const raw = chip.dataset.rating;
      const rating = raw === '' ? null : Number(raw);
      onChange({ ratingFilter: rating, withPhotosOnly: false, verifiedOnly: false, page: 1 });
    });
  });

  el.querySelector<HTMLAnchorElement>('[data-photos]')?.addEventListener('click', (event) => {
    event.preventDefault();
    onChange({ withPhotosOnly: !state.withPhotosOnly, ratingFilter: null, page: 1 });
  });

  el.querySelector<HTMLAnchorElement>('[data-verified]')?.addEventListener('click', (event) => {
    event.preventDefault();
    onChange({ verifiedOnly: !state.verifiedOnly, ratingFilter: null, page: 1 });
  });

  el.querySelector<HTMLButtonElement>('[data-sort]')?.addEventListener('click', () => {
    const order: SortKey[] = ['most_helpful', 'most_recent', 'highest', 'lowest'];
    const next = order[(order.indexOf(state.sort) + 1) % order.length];
    onChange({ sort: next, page: 1 });
  });

  return el;
}

