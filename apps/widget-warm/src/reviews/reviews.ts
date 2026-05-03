import { initBaseUrl } from './api/client';
import { mountReviewSection } from './ui/ReviewList';
import { mountInlineBadge } from './ui/ReviewSummary';
import './styles/reviews.css';

const FONT_ID = 'wbd-fonts';
const ICON_ID = 'wbd-icons';

function loadFonts(): void {
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

async function init(): Promise<void> {
  initBaseUrl();
  loadFonts();

  document
    .querySelectorAll<HTMLElement>('[data-wbd-review-badge][data-product-handle]')
    .forEach((el) => {
      const handle = el.dataset.productHandle;
      if (handle) void mountInlineBadge(el, handle);
    });

  document
    .querySelectorAll<HTMLElement>('#wbd-reviews[data-product-handle], [data-wbd-reviews][data-product-handle]')
    .forEach((el) => {
      const handle = el.dataset.productHandle;
      if (handle) void mountReviewSection(el, handle);
    });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => void init());
} else {
  void init();
}

