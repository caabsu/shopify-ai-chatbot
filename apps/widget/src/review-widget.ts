/**
 * Outlight Review Widget — Customer-facing product review display + submission.
 * Embeddable on any Shopify product page.
 *
 * Usage:
 *   <div id="outlight-reviews" data-product-handle="product-slug"></div>
 *   <script src="https://your-backend/widget/review-widget.js" data-brand="misu"></script>
 *
 * Or for email-based review submission pages:
 *   <div id="review-form-root" data-token="abc123" data-product-handle="product-slug"></div>
 *   <script src="https://your-backend/widget/review-widget.js"></script>
 */

import './styles/review-widget.css';

// ── Types (matching actual API response format) ─────────────────────────────

interface ReviewLineItem {
  product_id: string;
  shopify_product_id: string;
  shopify_variant_id: string;
  product_title: string;
  variant_title: string | null;
  sku: string | null;
  image_url: string | null;
  quantity: number;
  price: string;
  handle: string;
}

interface ItemReviewState {
  rating: number;
  hoverRating: number;
  title: string;
  body: string;
  photos: { file: File; preview: string; isVideo: boolean }[];
  expanded: boolean;
  submitted: boolean;
  submitting: boolean;
  error: string | null;
}

interface RatingDistribution {
  stars: number;
  count: number;
}

interface ReviewSummary {
  average_rating: number;
  total_count: number;
  verified_count: number;
  distribution: RatingDistribution[];
}

interface ReviewMedia {
  id: string;
  url: string;
  media_type: string;
  sort_order: number;
}

interface ReviewReply {
  id: string;
  author_name: string;
  body: string;
  published: boolean;
}

interface Review {
  id: string;
  product_id: string;
  shopify_product_id: string;
  customer_email: string;
  customer_name: string;
  customer_nickname: string;
  rating: number;
  title: string | null;
  body: string;
  status: string;
  verified_purchase: boolean;
  incentivized: boolean;
  variant_title: string | null;
  source: string;
  featured: boolean;
  helpful_count: number;
  published_at: string;
  submitted_at: string;
  created_at: string;
  media: ReviewMedia[];
  reply: ReviewReply | null;
}

interface ReviewsResponse {
  reviews: Review[];
  total: number;
  page: number;
  totalPages: number;
}

interface DesignConfig {
  starColor?: string;
  textColor?: string;
  headingColor?: string;
  backgroundColor?: string;
  headerText?: string;
  buttonText?: string;
  layout?: string;
  showVerifiedBadge?: boolean;
  showVariant?: boolean;
  showDate?: boolean;
  showPhotos?: boolean;
  fontSize?: string;
  headingFontFamily?: string;
  bodyFontFamily?: string;
}

interface WidgetConfig {
  widget_design?: DesignConfig;
}

interface WidgetState {
  loading: boolean;
  error: string | null;
  summary: ReviewSummary | null;
  reviews: Review[];
  page: number;
  perPage: number;
  totalPages: number;
  totalReviews: number;
  loadingMore: boolean;
  formOpen: boolean;
  formSubmitting: boolean;
  formSuccess: boolean;
  formError: string | null;
  formRating: number;
  formHoverRating: number;
  formPhotos: { file: File; preview: string; isVideo: boolean }[];
  formPhotoUrls: string[];
  formUploading: boolean;
  activeSort: string;
  activeRatingFilters: Set<number>;
  activeMediaFilter: boolean;
  filterDropdownOpen: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getScriptInfo(): { backendUrl: string; brandSlug: string } {
  const scripts = document.querySelectorAll('script[src]');
  let backendUrl = '';
  let brandSlug = '';

  for (const script of scripts) {
    const el = script as HTMLScriptElement;
    if (el.src.includes('review-widget')) {
      try {
        backendUrl = new URL(el.src).origin;
      } catch { /* ignore */ }
      brandSlug = el.getAttribute('data-brand') || '';
      break;
    }
  }

  return { backendUrl: backendUrl || 'http://localhost:3001', brandSlug };
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    const month = d.getMonth() + 1;
    const day = d.getDate();
    const year = d.getFullYear();
    return `${month}/${day.toString().padStart(2, '0')}/${year}`;
  } catch {
    return dateStr;
  }
}

function createEl<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  textContent?: string,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (textContent !== undefined) el.textContent = textContent;
  return el;
}

function buildPageNumbers(current: number, total: number): (number | string)[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: (number | string)[] = [];
  pages.push(1);
  if (current > 3) pages.push('...');
  for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) {
    pages.push(i);
  }
  if (current < total - 2) pages.push('...');
  pages.push(total);
  return pages;
}

// ── SVG Stars ───────────────────────────────────────────────────────────────

function createStarSvg(fill: 'full' | 'half' | 'empty', color: string, size: number): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.classList.add('orw-star-icon');

  const starPath = 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z';

  if (fill === 'full') {
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', starPath);
    path.setAttribute('fill', color);
    path.setAttribute('stroke', color);
    path.setAttribute('stroke-width', '1');
    svg.appendChild(path);
  } else if (fill === 'half') {
    const defs = document.createElementNS(ns, 'defs');
    const clipId = 'orw-half-' + Math.random().toString(36).slice(2, 8);
    const clip = document.createElementNS(ns, 'clipPath');
    clip.setAttribute('id', clipId);
    const rect = document.createElementNS(ns, 'rect');
    rect.setAttribute('x', '0');
    rect.setAttribute('y', '0');
    rect.setAttribute('width', '12');
    rect.setAttribute('height', '24');
    clip.appendChild(rect);
    defs.appendChild(clip);
    svg.appendChild(defs);

    const filledPath = document.createElementNS(ns, 'path');
    filledPath.setAttribute('d', starPath);
    filledPath.setAttribute('fill', color);
    filledPath.setAttribute('stroke', color);
    filledPath.setAttribute('stroke-width', '1');
    filledPath.setAttribute('clip-path', `url(#${clipId})`);
    svg.appendChild(filledPath);

    const emptyPath = document.createElementNS(ns, 'path');
    emptyPath.setAttribute('d', starPath);
    emptyPath.setAttribute('fill', 'none');
    emptyPath.setAttribute('stroke', color);
    emptyPath.setAttribute('stroke-width', '1');
    svg.appendChild(emptyPath);
  } else {
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', starPath);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', color);
    path.setAttribute('stroke-width', '1');
    path.setAttribute('opacity', '0.35');
    svg.appendChild(path);
  }

  return svg;
}

function renderStars(rating: number, color: string, size: number): HTMLDivElement {
  const container = createEl('div', 'orw-stars');
  const fullStars = Math.floor(rating);
  const hasHalf = rating - fullStars >= 0.25 && rating - fullStars < 0.75;
  const extraFull = rating - fullStars >= 0.75;
  const totalFull = extraFull ? fullStars + 1 : fullStars;

  for (let i = 0; i < 5; i++) {
    if (i < totalFull) {
      container.appendChild(createStarSvg('full', color, size));
    } else if (i === totalFull && hasHalf) {
      container.appendChild(createStarSvg('half', color, size));
    } else {
      container.appendChild(createStarSvg('empty', color, size));
    }
  }
  return container;
}

// ── Rendering Functions ─────────────────────────────────────────────────────

function renderFilterBar(
  summary: ReviewSummary,
  state: WidgetState,
  onSortChange: (sort: string) => void,
  onRatingToggle: (rating: number) => void,
  onMediaFilter: (active: boolean) => void,
  onClearFilters: () => void,
): HTMLElement {
  const bar = createEl('div', 'orw-toolbar');

  // Left side: review count
  const countLabel = createEl('span', 'orw-toolbar-count');
  const hasFilter = state.activeRatingFilters.size > 0 || state.activeMediaFilter;
  countLabel.textContent = hasFilter
    ? `Filtered — ${summary.total_count} total reviews`
    : `${summary.total_count} reviews`;
  bar.appendChild(countLabel);

  // Right side: Filter + Sort buttons
  const controls = createEl('div', 'orw-toolbar-controls');

  // ── Filter Button + Dropdown ──
  const filterWrap = createEl('div', 'orw-filter-wrap');

  const activeCount = state.activeRatingFilters.size + (state.activeMediaFilter ? 1 : 0);
  const filterBtn = createEl('button', 'orw-toolbar-btn');
  filterBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>`;
  const filterLabel = document.createTextNode(activeCount > 0 ? ` Filter (${activeCount})` : ' Filter');
  filterBtn.appendChild(filterLabel);
  if (activeCount > 0) filterBtn.classList.add('orw-toolbar-btn--active');

  const dropdown = createEl('div', 'orw-filter-dropdown');

  // Dropdown header
  const ddHeader = createEl('div', 'orw-filter-dd-header');
  const ddTitle = createEl('span', 'orw-filter-dd-title', 'Filter Reviews');
  ddHeader.appendChild(ddTitle);
  if (hasFilter) {
    const clearBtn = createEl('button', 'orw-filter-dd-clear', 'Clear all');
    clearBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      onClearFilters();
    });
    ddHeader.appendChild(clearBtn);
  }
  dropdown.appendChild(ddHeader);

  // Media section
  const mediaSection = createEl('div', 'orw-filter-dd-section');
  const mediaLabel = createEl('div', 'orw-filter-dd-label', 'MEDIA');
  mediaSection.appendChild(mediaLabel);

  const mediaBtn = createEl('button', `orw-filter-dd-option${state.activeMediaFilter ? ' orw-filter-dd-option--active' : ''}`);
  mediaBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg> With Photos`;
  mediaBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    onMediaFilter(!state.activeMediaFilter);
  });
  mediaSection.appendChild(mediaBtn);
  dropdown.appendChild(mediaSection);

  // Rating section
  const ratingSection = createEl('div', 'orw-filter-dd-section');
  const ratingLabel = createEl('div', 'orw-filter-dd-label', 'RATING');
  ratingSection.appendChild(ratingLabel);

  const ratingGrid = createEl('div', 'orw-filter-dd-ratings');
  for (let s = 5; s >= 1; s--) {
    const isActive = state.activeRatingFilters.has(s);
    const rBtn = createEl('button', `orw-filter-dd-rating${isActive ? ' orw-filter-dd-rating--active' : ''}`);
    const starsWrap = createEl('span', 'orw-filter-dd-rating-stars');
    for (let i = 1; i <= 5; i++) {
      starsWrap.appendChild(createStarSvg(
        i <= s ? 'full' : 'empty',
        isActive ? '#ffffff' : '#C5A059',
        12,
      ));
    }
    rBtn.appendChild(starsWrap);
    const dist = summary.distribution?.find(d => d.stars === s);
    const distCount = dist?.count ?? 0;
    const countSpan = createEl('span', 'orw-filter-dd-rating-count', `(${distCount})`);
    rBtn.appendChild(countSpan);
    rBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      onRatingToggle(s);
    });
    ratingGrid.appendChild(rBtn);
  }
  ratingSection.appendChild(ratingGrid);
  dropdown.appendChild(ratingSection);

  filterWrap.appendChild(filterBtn);
  filterWrap.appendChild(dropdown);

  // Open dropdown from state
  if (state.filterDropdownOpen) {
    dropdown.classList.add('orw-filter-dropdown--open');
  }

  // Toggle dropdown on click
  filterBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    state.filterDropdownOpen = !state.filterDropdownOpen;
    dropdown.classList.toggle('orw-filter-dropdown--open');
    if (state.filterDropdownOpen) {
      const closeOnClick = (ev: MouseEvent) => {
        if (!filterWrap.contains(ev.target as Node)) {
          state.filterDropdownOpen = false;
          dropdown.classList.remove('orw-filter-dropdown--open');
          document.removeEventListener('click', closeOnClick);
        }
      };
      setTimeout(() => document.addEventListener('click', closeOnClick), 0);
    }
  });

  controls.appendChild(filterWrap);

  // ── Sort Dropdown ──
  const sortSelect = createEl('select', 'orw-toolbar-sort') as HTMLSelectElement;
  const sortOptions = [
    { value: 'newest', label: 'Newest' },
    { value: 'oldest', label: 'Oldest' },
    { value: 'highest', label: 'Highest Rated' },
    { value: 'lowest', label: 'Lowest Rated' },
    { value: 'most_helpful', label: 'Most Helpful' },
  ];
  for (const opt of sortOptions) {
    const option = createEl('option');
    option.value = opt.value;
    option.textContent = opt.label;
    if (opt.value === state.activeSort) option.selected = true;
    sortSelect.appendChild(option);
  }
  sortSelect.addEventListener('change', () => {
    onSortChange(sortSelect.value);
  });
  controls.appendChild(sortSelect);

  bar.appendChild(controls);

  return bar;
}

function renderHeader(
  summary: ReviewSummary,
  design: DesignConfig,
  onWriteReview: () => void,
): HTMLElement {
  const header = createEl('div', 'orw-header');

  const title = createEl('div', 'orw-header-title');
  title.textContent = design.headerText || 'Customer Reviews';
  header.appendChild(title);

  const ratingRow = createEl('div', 'orw-header-rating');
  const stars = renderStars(summary.average_rating, design.starColor || '#C5A059', 24);
  stars.classList.add('orw-header-stars');
  ratingRow.appendChild(stars);

  const ratingNum = createEl('span', 'orw-header-rating-number');
  ratingNum.textContent = summary.average_rating.toFixed(1);
  ratingRow.appendChild(ratingNum);
  header.appendChild(ratingRow);

  const count = createEl('div', 'orw-header-count');
  count.textContent = `Based on ${summary.total_count} review${summary.total_count !== 1 ? 's' : ''}`;
  header.appendChild(count);

  const btn = createEl('button', 'orw-header-btn');
  btn.textContent = design.buttonText || 'Write a Review';
  btn.addEventListener('click', onWriteReview);
  header.appendChild(btn);

  return header;
}

function renderReviewCard(
  review: Review,
  design: DesignConfig,
  onPhotoClick: (images: string[], index: number) => void,
): HTMLElement {
  const card = createEl('div', 'orw-card');

  // Header row: name + verified dot + date
  const cardHeader = createEl('div', 'orw-card-header');

  const name = createEl('span', 'orw-card-name');
  name.textContent = review.customer_nickname || review.customer_name || 'Anonymous';
  cardHeader.appendChild(name);

  if (review.verified_purchase && design.showVerifiedBadge !== false) {
    const dot = createEl('span', 'orw-card-verified');
    cardHeader.appendChild(dot);
  }

  if (design.showDate !== false) {
    const date = createEl('span', 'orw-card-date');
    date.textContent = formatDate(review.submitted_at || review.published_at || review.created_at);
    cardHeader.appendChild(date);
  }

  card.appendChild(cardHeader);

  // Stars
  const starsRow = createEl('div', 'orw-card-stars');
  starsRow.appendChild(renderStars(review.rating, design.starColor || '#C5A059', 14));
  card.appendChild(starsRow);

  // Body text (wrapped in quotes via CSS ::before/::after)
  const body = createEl('div', 'orw-card-body');
  body.textContent = review.body;
  card.appendChild(body);

  // Photo thumbnails
  if (design.showPhotos !== false && review.media && review.media.length > 0) {
    const imageMedia = review.media.filter(m => m.media_type === 'image');
    if (imageMedia.length > 0) {
      const photosRow = createEl('div', 'orw-card-photos');
      const imageUrls = imageMedia.map(m => m.url);
      imageMedia.forEach((media, idx) => {
        const thumb = createEl('div', 'orw-card-photo');
        const img = createEl('img');
        img.src = media.url;
        img.alt = `Review photo ${idx + 1}`;
        img.loading = 'lazy';
        thumb.appendChild(img);
        thumb.addEventListener('click', () => onPhotoClick(imageUrls, idx));
        photosRow.appendChild(thumb);
      });
      card.appendChild(photosRow);
    }
  }

  // Variant label
  if (design.showVariant !== false && review.variant_title) {
    const variant = createEl('div', 'orw-card-variant');
    const labelSpan = createEl('span', 'orw-card-variant-label', 'ITEM:  ');
    variant.appendChild(labelSpan);
    const valueSpan = createEl('span');
    valueSpan.textContent = review.variant_title;
    variant.appendChild(valueSpan);
    card.appendChild(variant);
  }

  // Owner reply
  if (review.reply && review.reply.body && review.reply.published) {
    const replyDiv = createEl('div', 'orw-card-reply');
    const replyLabel = createEl('div', 'orw-card-reply-label');
    replyLabel.textContent = review.reply.author_name || 'Store Owner';
    replyDiv.appendChild(replyLabel);
    const replyBody = createEl('div', 'orw-card-reply-body');
    replyBody.textContent = review.reply.body;
    replyDiv.appendChild(replyBody);
    card.appendChild(replyDiv);
  }

  return card;
}

function renderLightbox(
  images: string[],
  startIndex: number,
  onClose: () => void,
): HTMLElement {
  let currentIndex = startIndex;

  const overlay = createEl('div', 'orw-lightbox');

  const img = createEl('img', 'orw-lightbox-img');
  img.src = images[currentIndex];
  img.alt = `Review photo ${currentIndex + 1}`;
  overlay.appendChild(img);

  // Close button
  const closeBtn = createEl('button', 'orw-lightbox-close');
  closeBtn.innerHTML = '&times;';
  closeBtn.addEventListener('click', onClose);
  overlay.appendChild(closeBtn);

  // Counter
  const counter = createEl('div', 'orw-lightbox-counter');

  function updateView(): void {
    img.src = images[currentIndex];
    img.alt = `Review photo ${currentIndex + 1}`;
    counter.textContent = `${currentIndex + 1} / ${images.length}`;
  }

  if (images.length > 1) {
    const prevBtn = createEl('button', 'orw-lightbox-nav orw-lightbox-prev');
    prevBtn.innerHTML = '&#8249;';
    prevBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      currentIndex = (currentIndex - 1 + images.length) % images.length;
      updateView();
    });
    overlay.appendChild(prevBtn);

    const nextBtn = createEl('button', 'orw-lightbox-nav orw-lightbox-next');
    nextBtn.innerHTML = '&#8250;';
    nextBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      currentIndex = (currentIndex + 1) % images.length;
      updateView();
    });
    overlay.appendChild(nextBtn);

    counter.textContent = `${currentIndex + 1} / ${images.length}`;
    overlay.appendChild(counter);
  }

  // Close on overlay click (not on image)
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) onClose();
  });

  // Keyboard navigation
  function handleKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') onClose();
    if (e.key === 'ArrowLeft' && images.length > 1) {
      currentIndex = (currentIndex - 1 + images.length) % images.length;
      updateView();
    }
    if (e.key === 'ArrowRight' && images.length > 1) {
      currentIndex = (currentIndex + 1) % images.length;
      updateView();
    }
  }
  document.addEventListener('keydown', handleKey);

  // Store cleanup ref
  (overlay as unknown as Record<string, () => void>)._cleanup = () => {
    document.removeEventListener('keydown', handleKey);
  };

  return overlay;
}

function renderReviewForm(
  handle: string,
  design: DesignConfig,
  backendUrl: string,
  brandSlug: string,
  state: WidgetState,
  onClose: () => void,
  onSuccess: () => void,
  token?: string,
  prefill?: { name?: string; email?: string },
): HTMLElement {
  const brandParam = brandSlug ? `?brand=${brandSlug}` : '';
  const isInline = !!token;

  const wrapper = isInline ? createEl('div', 'orw-inline-form') : createEl('div', 'orw-modal');

  const form = createEl('div', 'orw-form');

  if (!isInline) {
    const closeBtn = createEl('button', 'orw-form-close');
    closeBtn.innerHTML = '&times;';
    closeBtn.addEventListener('click', onClose);
    form.appendChild(closeBtn);
  }

  // Success state
  if (state.formSuccess) {
    const success = createEl('div', 'orw-form-success');

    const iconWrap = createEl('div', 'orw-form-success-icon');
    iconWrap.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
    success.appendChild(iconWrap);

    const sTitle = createEl('div', 'orw-form-success-title', 'Thank You!');
    success.appendChild(sTitle);

    const sText = createEl('div', 'orw-form-success-text', 'Your review has been submitted and will appear shortly after moderation.');
    success.appendChild(sText);

    form.appendChild(success);
    wrapper.appendChild(form);

    if (!isInline) {
      wrapper.addEventListener('click', (e) => {
        if (e.target === wrapper) onClose();
      });
    }
    return wrapper;
  }

  const formTitle = createEl('div', 'orw-form-title', 'Write a Review');
  form.appendChild(formTitle);

  // Star rating picker — updates SVGs in-place, no DOM rebuild
  const starField = createEl('div', 'orw-form-field');
  const starLabel = createEl('label', 'orw-form-label');
  starLabel.innerHTML = 'Rating <span class="orw-form-required">*</span>';
  starField.appendChild(starLabel);

  const starPicker = createEl('div', 'orw-star-picker');
  const starColor = design.starColor || '#C5A059';
  const starBtns: HTMLElement[] = [];

  function updateStarDisplay(): void {
    const displayRating = state.formHoverRating || state.formRating;
    starBtns.forEach((btn, idx) => {
      const filled = idx + 1 <= displayRating;
      const svg = btn.querySelector('svg');
      if (svg) {
        btn.replaceChild(createStarSvg(filled ? 'full' : 'empty', starColor, 28), svg);
      }
    });
  }

  for (let i = 1; i <= 5; i++) {
    const starBtn = createEl('span', 'orw-star-picker-star');
    starBtn.style.cursor = 'pointer';
    const displayRating = state.formHoverRating || state.formRating;
    starBtn.appendChild(createStarSvg(i <= displayRating ? 'full' : 'empty', starColor, 28));
    starBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      state.formRating = i;
      state.formError = null;
      updateStarDisplay();
    });
    starBtn.addEventListener('mouseenter', () => {
      state.formHoverRating = i;
      updateStarDisplay();
    });
    starBtn.addEventListener('mouseleave', () => {
      state.formHoverRating = 0;
      updateStarDisplay();
    });
    starBtns.push(starBtn);
    starPicker.appendChild(starBtn);
  }
  starField.appendChild(starPicker);
  form.appendChild(starField);

  // Title (optional)
  const titleField = createEl('div', 'orw-form-field');
  const titleLabel = createEl('label', 'orw-form-label', 'Review Title');
  titleField.appendChild(titleLabel);
  const titleInput = createEl('input', 'orw-form-input') as HTMLInputElement;
  titleInput.type = 'text';
  titleInput.placeholder = 'Summarize your experience';
  titleInput.id = 'orw-form-title';
  titleField.appendChild(titleInput);
  form.appendChild(titleField);

  // Body (required)
  const bodyField = createEl('div', 'orw-form-field');
  const bodyLabel = createEl('label', 'orw-form-label');
  bodyLabel.innerHTML = 'Your Review <span class="orw-form-required">*</span>';
  bodyField.appendChild(bodyLabel);
  const bodyTextarea = createEl('textarea', 'orw-form-textarea') as HTMLTextAreaElement;
  bodyTextarea.placeholder = 'Share your experience with this product...';
  bodyTextarea.id = 'orw-form-body';
  bodyField.appendChild(bodyTextarea);
  form.appendChild(bodyField);

  // Photo upload
  const photoField = createEl('div', 'orw-form-field');
  const photoLabel = createEl('label', 'orw-form-label', 'Photos & Videos (optional)');
  photoField.appendChild(photoLabel);

  const uploadArea = createEl('div', 'orw-photo-upload');
  uploadArea.innerHTML = `
    <div class="orw-photo-upload-icon">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="17 8 12 3 7 8"/>
        <line x1="12" y1="3" x2="12" y2="15"/>
      </svg>
    </div>
    <div class="orw-photo-upload-text">Drop files here or click to upload</div>
    <div class="orw-photo-upload-hint">Max 5 files — JPEG, PNG, WebP, or MP4</div>
  `;

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime';
  fileInput.multiple = true;
  fileInput.style.display = 'none';

  function handleFiles(files: FileList | File[]): void {
    const remaining = 5 - state.formPhotos.length;
    const toAdd = Array.from(files).slice(0, remaining);
    for (const file of toAdd) {
      const isVideo = file.type.startsWith('video/');
      if (!file.type.startsWith('image/') && !isVideo) continue;
      const preview = URL.createObjectURL(file);
      state.formPhotos.push({ file, preview, isVideo });
    }
    rerenderForm();
  }

  fileInput.addEventListener('change', () => {
    if (fileInput.files) handleFiles(fileInput.files);
    fileInput.value = '';
  });

  uploadArea.addEventListener('click', () => {
    if (state.formPhotos.length < 5) fileInput.click();
  });

  uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.classList.add('orw-drag-over');
  });
  uploadArea.addEventListener('dragleave', () => {
    uploadArea.classList.remove('orw-drag-over');
  });
  uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.classList.remove('orw-drag-over');
    if (e.dataTransfer?.files) handleFiles(e.dataTransfer.files);
  });

  photoField.appendChild(uploadArea);

  // Photo previews
  if (state.formPhotos.length > 0) {
    const previews = createEl('div', 'orw-photo-previews');
    state.formPhotos.forEach((photo, idx) => {
      const pv = createEl('div', 'orw-photo-preview');
      if (photo.isVideo) {
        const vid = createEl('video');
        vid.src = photo.preview;
        vid.muted = true;
        (vid as HTMLVideoElement).preload = 'metadata';
        pv.appendChild(vid);
      } else {
        const img = createEl('img');
        img.src = photo.preview;
        img.alt = `Upload ${idx + 1}`;
        pv.appendChild(img);
      }

      const removeBtn = createEl('button', 'orw-photo-preview-remove');
      removeBtn.innerHTML = '&times;';
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        URL.revokeObjectURL(photo.preview);
        state.formPhotos.splice(idx, 1);
        rerenderForm();
      });
      pv.appendChild(removeBtn);
      previews.appendChild(pv);
    });
    photoField.appendChild(previews);
  }

  form.appendChild(photoField);

  // Name + Email — hidden when pre-filled from token
  const hasPrefillName = !!(prefill?.name);
  const hasPrefillEmail = !!(prefill?.email);

  const nameInput = createEl('input', 'orw-form-input') as HTMLInputElement;
  nameInput.type = 'text';
  nameInput.id = 'orw-form-name';
  if (hasPrefillName) {
    nameInput.type = 'hidden';
    nameInput.value = prefill!.name!;
  } else {
    nameInput.placeholder = 'John D.';
  }

  const emailInput = createEl('input', 'orw-form-input') as HTMLInputElement;
  emailInput.id = 'orw-form-email';
  if (hasPrefillEmail) {
    emailInput.type = 'hidden';
    emailInput.value = prefill!.email!;
  } else {
    emailInput.type = 'email';
    emailInput.placeholder = 'you@email.com';
  }

  if (hasPrefillName && hasPrefillEmail) {
    // Both pre-filled — just add hidden inputs, no visible row
    form.appendChild(nameInput);
    form.appendChild(emailInput);
  } else {
    const nameEmailRow = createEl('div', 'orw-form-row');

    if (!hasPrefillName) {
      const nameField = createEl('div', 'orw-form-field');
      const nameLabel = createEl('label', 'orw-form-label');
      nameLabel.innerHTML = 'Your Name <span class="orw-form-required">*</span>';
      nameField.appendChild(nameLabel);
      nameField.appendChild(nameInput);
      nameEmailRow.appendChild(nameField);
    } else {
      form.appendChild(nameInput);
    }

    if (!hasPrefillEmail) {
      const emailField = createEl('div', 'orw-form-field');
      const emailLabel = createEl('label', 'orw-form-label');
      emailLabel.innerHTML = 'Email <span class="orw-form-required">*</span>';
      emailField.appendChild(emailLabel);
      emailField.appendChild(emailInput);
      nameEmailRow.appendChild(emailField);
    } else {
      form.appendChild(emailInput);
    }

    if (nameEmailRow.children.length > 0) {
      form.appendChild(nameEmailRow);
    }
  }

  // Error container for in-place error updates
  const errorContainer = createEl('div', 'orw-form-error');
  errorContainer.style.display = state.formError ? '' : 'none';
  errorContainer.textContent = state.formError || '';
  form.insertBefore(errorContainer, form.querySelector('.orw-form-field'));

  function showError(msg: string): void {
    state.formError = msg;
    errorContainer.textContent = msg;
    errorContainer.style.display = '';
  }

  function clearError(): void {
    state.formError = null;
    errorContainer.style.display = 'none';
    errorContainer.textContent = '';
  }

  // Submit button
  const submitBtn = createEl('button', 'orw-form-submit');
  submitBtn.textContent = state.formSubmitting ? 'Submitting...' : 'Submit Review';
  submitBtn.disabled = state.formSubmitting;
  submitBtn.addEventListener('click', async () => {
    const nameVal = (form.querySelector('#orw-form-name') as HTMLInputElement)?.value?.trim();
    const emailVal = (form.querySelector('#orw-form-email') as HTMLInputElement)?.value?.trim();
    const titleVal = (form.querySelector('#orw-form-title') as HTMLInputElement)?.value?.trim();
    const bodyVal = (form.querySelector('#orw-form-body') as HTMLTextAreaElement)?.value?.trim();

    // Validation — show errors in-place, no DOM rebuild
    if (!state.formRating) {
      showError('Please select a star rating.');
      return;
    }
    if (!bodyVal) {
      showError('Please write your review.');
      return;
    }
    if (!nameVal) {
      showError('Please enter your name.');
      return;
    }
    if (!emailVal || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailVal)) {
      showError('Please enter a valid email address.');
      return;
    }

    clearError();
    state.formSubmitting = true;
    submitBtn.textContent = 'Submitting...';
    submitBtn.disabled = true;

    try {
      // Upload media first
      const photoUrls: string[] = [];
      for (const photo of state.formPhotos) {
        try {
          const reader = new FileReader();
          const base64 = await new Promise<string>((resolve, reject) => {
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(photo.file);
          });

          // Strip data URL prefix to get raw base64
          const rawBase64 = base64.replace(/^data:[^;]+;base64,/, '');

          const res = await fetch(`${backendUrl}/api/reviews/upload${brandParam}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file: rawBase64, content_type: photo.file.type }),
          });
          if (res.ok) {
            const data = await res.json();
            if (data.url) photoUrls.push(data.url);
          }
        } catch {
          // Skip failed upload
        }
      }

      // Submit review
      const payload: Record<string, unknown> = {
        product_handle: handle,
        rating: state.formRating,
        title: titleVal || null,
        body: bodyVal,
        customer_name: nameVal,
        customer_email: emailVal,
        media_urls: photoUrls,
      };

      if (token) {
        payload.token = token;
      }

      const res = await fetch(`${backendUrl}/api/reviews/submit${brandParam}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: 'Submission failed' }));
        state.formSubmitting = false;
        submitBtn.textContent = 'Submit Review';
        submitBtn.disabled = false;
        showError(errData.error || 'Failed to submit review. Please try again.');
        return;
      }

      // Clean up photo previews
      state.formPhotos.forEach(p => URL.revokeObjectURL(p.preview));
      state.formPhotos = [];
      state.formPhotoUrls = [];
      state.formSubmitting = false;
      state.formSuccess = true;
      rerenderForm();

      // Notify parent to refresh reviews
      setTimeout(onSuccess, 2000);
    } catch {
      state.formSubmitting = false;
      submitBtn.textContent = 'Submit Review';
      submitBtn.disabled = false;
      showError('Network error. Please check your connection and try again.');
    }
  });

  form.appendChild(submitBtn);
  wrapper.appendChild(form);

  // Close modal on background click
  if (!isInline) {
    wrapper.addEventListener('click', (e) => {
      if (e.target === wrapper) onClose();
    });
  }

  // Store rerender fn for star picker updates etc
  let formContainer: HTMLElement | null = null;

  function rerenderForm(): void {
    const parent = formContainer || wrapper.parentElement;
    if (!parent) return;
    const newForm = renderReviewForm(handle, design, backendUrl, brandSlug, state, onClose, onSuccess, token, prefill);
    // Preserve input values before swap
    const oldTitle = (wrapper.querySelector('#orw-form-title') as HTMLInputElement)?.value;
    const oldBody = (wrapper.querySelector('#orw-form-body') as HTMLTextAreaElement)?.value;
    const oldName = (wrapper.querySelector('#orw-form-name') as HTMLInputElement)?.value;
    const oldEmail = (wrapper.querySelector('#orw-form-email') as HTMLInputElement)?.value;

    wrapper.replaceWith(newForm);

    // Restore input values
    const newTitle = newForm.querySelector('#orw-form-title') as HTMLInputElement;
    const newBody = newForm.querySelector('#orw-form-body') as HTMLTextAreaElement;
    const newName = newForm.querySelector('#orw-form-name') as HTMLInputElement;
    const newEmail = newForm.querySelector('#orw-form-email') as HTMLInputElement;
    if (newTitle && oldTitle !== undefined) newTitle.value = oldTitle;
    if (newBody && oldBody !== undefined) newBody.value = oldBody;
    if (newName && oldName !== undefined) newName.value = oldName;
    if (newEmail && oldEmail !== undefined) newEmail.value = oldEmail;
  }

  (wrapper as unknown as Record<string, () => void>)._rerender = rerenderForm;
  formContainer = wrapper.parentElement;

  return wrapper;
}

// ── Multi-Item Review Form (for orders with multiple products/variants) ─────

function renderMultiItemForm(
  lineItems: ReviewLineItem[],
  design: DesignConfig,
  backendUrl: string,
  brandSlug: string,
  token: string,
  prefill: { name?: string; email?: string },
): HTMLElement {
  const brandParam = brandSlug ? `?brand=${brandSlug}` : '';
  const starColor = design.starColor || '#C5A059';

  // Per-item state
  const itemStates: ItemReviewState[] = lineItems.map((_, idx) => ({
    rating: 0,
    hoverRating: 0,
    title: '',
    body: '',
    photos: [],
    expanded: idx === 0,
    submitted: false,
    submitting: false,
    error: null,
  }));

  let allDone = false;
  let globalError: string | null = null;
  let submittingAll = false;

  const container = createEl('div', 'orw-multi-form');

  function render(): void {
    container.innerHTML = '';

    // All-done success state
    if (allDone) {
      const success = createEl('div', 'orw-form-success');
      const iconWrap = createEl('div', 'orw-form-success-icon');
      iconWrap.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
      success.appendChild(iconWrap);
      success.appendChild(createEl('div', 'orw-form-success-title', 'Thank You!'));
      success.appendChild(createEl('div', 'orw-form-success-text', 'Your reviews have been submitted and will appear shortly after moderation.'));
      container.appendChild(success);
      return;
    }

    const header = createEl('div', 'orw-multi-header');
    const completedCount = itemStates.filter(s => s.submitted).length;
    header.appendChild(createEl('div', 'orw-multi-title', `Review Your Order`));
    header.appendChild(createEl('div', 'orw-multi-subtitle', `${completedCount} of ${lineItems.length} items reviewed`));

    // Progress bar
    const progressWrap = createEl('div', 'orw-multi-progress');
    const progressBar = createEl('div', 'orw-multi-progress-bar');
    progressBar.style.width = `${(completedCount / lineItems.length) * 100}%`;
    progressWrap.appendChild(progressBar);
    header.appendChild(progressWrap);
    container.appendChild(header);

    if (globalError) {
      const errEl = createEl('div', 'orw-form-error', globalError);
      errEl.style.display = '';
      container.appendChild(errEl);
    }

    // Item cards
    lineItems.forEach((item, idx) => {
      const state = itemStates[idx];
      const card = createEl('div', 'orw-item-card');
      if (state.submitted) card.classList.add('orw-item-submitted');
      if (state.expanded && !state.submitted) card.classList.add('orw-item-expanded');

      // Card header — always visible, clickable to expand/collapse
      const cardHeader = createEl('div', 'orw-item-header');
      cardHeader.style.cursor = 'pointer';

      // Product image
      if (item.image_url) {
        const img = createEl('img', 'orw-item-image');
        img.src = item.image_url;
        img.alt = item.product_title;
        cardHeader.appendChild(img);
      }

      // Product info
      const info = createEl('div', 'orw-item-info');
      info.appendChild(createEl('div', 'orw-item-name', item.product_title));
      if (item.variant_title && item.variant_title !== 'Default Title') {
        info.appendChild(createEl('div', 'orw-item-variant', item.variant_title));
      }
      cardHeader.appendChild(info);

      // Status indicator
      if (state.submitted) {
        const badge = createEl('div', 'orw-item-badge orw-item-badge-done');
        badge.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg> Submitted';
        cardHeader.appendChild(badge);
      } else {
        // Mini star display in collapsed state
        const miniStars = createEl('div', 'orw-item-mini-stars');
        for (let i = 1; i <= 5; i++) {
          miniStars.appendChild(createStarSvg(i <= state.rating ? 'full' : 'empty', starColor, 16));
        }
        cardHeader.appendChild(miniStars);
      }

      cardHeader.addEventListener('click', () => {
        if (state.submitted) return;
        state.expanded = !state.expanded;
        render();
      });
      card.appendChild(cardHeader);

      // Expandable form body
      if (state.expanded && !state.submitted) {
        const body = createEl('div', 'orw-item-body');

        // Error
        if (state.error) {
          const errEl = createEl('div', 'orw-form-error', state.error);
          errEl.style.display = '';
          body.appendChild(errEl);
        }

        // Star picker
        const starField = createEl('div', 'orw-form-field');
        const starLabel = createEl('label', 'orw-form-label');
        starLabel.innerHTML = 'Rating <span class="orw-form-required">*</span>';
        starField.appendChild(starLabel);

        const starPicker = createEl('div', 'orw-star-picker');
        const starBtns: HTMLElement[] = [];

        function updateItemStars(): void {
          const displayRating = state.hoverRating || state.rating;
          starBtns.forEach((btn, si) => {
            const svg = btn.querySelector('svg');
            if (svg) btn.replaceChild(createStarSvg((si + 1) <= displayRating ? 'full' : 'empty', starColor, 28), svg);
          });
        }

        for (let i = 1; i <= 5; i++) {
          const starBtn = createEl('span', 'orw-star-picker-star');
          starBtn.style.cursor = 'pointer';
          const displayRating = state.hoverRating || state.rating;
          starBtn.appendChild(createStarSvg(i <= displayRating ? 'full' : 'empty', starColor, 28));
          starBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            state.rating = i;
            state.error = null;
            updateItemStars();
          });
          starBtn.addEventListener('mouseenter', () => { state.hoverRating = i; updateItemStars(); });
          starBtn.addEventListener('mouseleave', () => { state.hoverRating = 0; updateItemStars(); });
          starBtns.push(starBtn);
          starPicker.appendChild(starBtn);
        }
        starField.appendChild(starPicker);
        body.appendChild(starField);

        // Title
        const titleField = createEl('div', 'orw-form-field');
        titleField.appendChild(createEl('label', 'orw-form-label', 'Review Title'));
        const titleInput = createEl('input', 'orw-form-input') as HTMLInputElement;
        titleInput.type = 'text';
        titleInput.placeholder = 'Summarize your experience';
        titleInput.value = state.title;
        titleInput.addEventListener('input', () => { state.title = titleInput.value; });
        titleField.appendChild(titleInput);
        body.appendChild(titleField);

        // Body
        const bodyField = createEl('div', 'orw-form-field');
        const bodyLabel = createEl('label', 'orw-form-label');
        bodyLabel.innerHTML = 'Your Review <span class="orw-form-required">*</span>';
        bodyField.appendChild(bodyLabel);
        const bodyTextarea = createEl('textarea', 'orw-form-textarea') as HTMLTextAreaElement;
        bodyTextarea.placeholder = 'Share your experience with this product...';
        bodyTextarea.value = state.body;
        bodyTextarea.addEventListener('input', () => { state.body = bodyTextarea.value; });
        bodyField.appendChild(bodyTextarea);
        body.appendChild(bodyField);

        // Photo upload
        const photoField = createEl('div', 'orw-form-field');
        photoField.appendChild(createEl('label', 'orw-form-label', 'Photos & Videos (optional)'));

        const uploadArea = createEl('div', 'orw-photo-upload');
        uploadArea.innerHTML = `
          <div class="orw-photo-upload-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/>
              <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
          </div>
          <div class="orw-photo-upload-text">Drop files here or click to upload</div>
          <div class="orw-photo-upload-hint">Max 5 files — JPEG, PNG, WebP, or MP4</div>
        `;

        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime';
        fileInput.multiple = true;
        fileInput.style.display = 'none';

        fileInput.addEventListener('change', () => {
          if (fileInput.files) {
            const remaining = 5 - state.photos.length;
            const toAdd = Array.from(fileInput.files).slice(0, remaining);
            for (const file of toAdd) {
              if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) continue;
              state.photos.push({ file, preview: URL.createObjectURL(file), isVideo: file.type.startsWith('video/') });
            }
            render();
          }
          fileInput.value = '';
        });

        uploadArea.addEventListener('click', () => { if (state.photos.length < 5) fileInput.click(); });
        uploadArea.addEventListener('dragover', (e) => { e.preventDefault(); uploadArea.classList.add('orw-drag-over'); });
        uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('orw-drag-over'));
        uploadArea.addEventListener('drop', (e) => {
          e.preventDefault();
          uploadArea.classList.remove('orw-drag-over');
          if (e.dataTransfer?.files) {
            const remaining = 5 - state.photos.length;
            const toAdd = Array.from(e.dataTransfer.files).slice(0, remaining);
            for (const file of toAdd) {
              if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) continue;
              state.photos.push({ file, preview: URL.createObjectURL(file), isVideo: file.type.startsWith('video/') });
            }
            render();
          }
        });

        photoField.appendChild(uploadArea);

        if (state.photos.length > 0) {
          const previews = createEl('div', 'orw-photo-previews');
          state.photos.forEach((photo, pi) => {
            const pv = createEl('div', 'orw-photo-preview');
            if (photo.isVideo) {
              const vid = createEl('video');
              vid.src = photo.preview;
              vid.muted = true;
              (vid as HTMLVideoElement).preload = 'metadata';
              pv.appendChild(vid);
            } else {
              const img = createEl('img');
              img.src = photo.preview;
              img.alt = `Upload ${pi + 1}`;
              pv.appendChild(img);
            }
            const removeBtn = createEl('button', 'orw-photo-preview-remove');
            removeBtn.innerHTML = '&times;';
            removeBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              URL.revokeObjectURL(photo.preview);
              state.photos.splice(pi, 1);
              render();
            });
            pv.appendChild(removeBtn);
            previews.appendChild(pv);
          });
          photoField.appendChild(previews);
        }

        body.appendChild(photoField);
        card.appendChild(body);
      }

      container.appendChild(card);
    });

    // Submit All button
    const hasAnyFilled = itemStates.some(s => !s.submitted && s.rating > 0 && s.body.trim());
    const allSubmitted = itemStates.every(s => s.submitted);
    if (!allSubmitted) {
      const actions = createEl('div', 'orw-multi-actions');
      const submitAllBtn = createEl('button', 'orw-form-submit');
      const filledCount = itemStates.filter(s => !s.submitted && s.rating > 0 && s.body.trim()).length;
      submitAllBtn.textContent = submittingAll
        ? 'Submitting...'
        : filledCount > 1
          ? `Submit ${filledCount} Reviews`
          : 'Submit Review';
      submitAllBtn.disabled = !hasAnyFilled || submittingAll;
      submitAllBtn.addEventListener('click', () => submitAllReviews());
      actions.appendChild(submitAllBtn);

      const skipBtn = createEl('button', 'orw-multi-skip');
      skipBtn.textContent = 'Skip remaining items';
      skipBtn.addEventListener('click', () => {
        allDone = true;
        render();
      });
      if (completedCount > 0) actions.appendChild(skipBtn);
      container.appendChild(actions);
    }
  }

  async function submitAllReviews(): Promise<void> {
    const toSubmit = itemStates
      .map((s, i) => ({ state: s, item: lineItems[i], index: i }))
      .filter(x => !x.state.submitted && x.state.rating > 0 && x.state.body.trim());

    if (toSubmit.length === 0) return;

    // Validate
    for (const { state: s, index: i } of toSubmit) {
      if (!s.rating) {
        s.error = 'Please select a star rating.';
        s.expanded = true;
        render();
        return;
      }
      if (!s.body.trim()) {
        s.error = 'Please write your review.';
        s.expanded = true;
        render();
        return;
      }
      s.error = null;
    }

    submittingAll = true;
    globalError = null;
    render();

    for (const { state: s, item } of toSubmit) {
      s.submitting = true;

      try {
        // Upload photos
        const photoUrls: string[] = [];
        for (const photo of s.photos) {
          try {
            const base64 = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result as string);
              reader.onerror = reject;
              reader.readAsDataURL(photo.file);
            });
            const rawBase64 = base64.replace(/^data:[^;]+;base64,/, '');
            const res = await fetch(`${backendUrl}/api/reviews/upload${brandParam}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ file: rawBase64, content_type: photo.file.type }),
            });
            if (res.ok) {
              const data = await res.json();
              if (data.url) photoUrls.push(data.url);
            }
          } catch { /* skip failed upload */ }
        }

        const payload: Record<string, unknown> = {
          product_handle: item.handle,
          rating: s.rating,
          title: s.title.trim() || null,
          body: s.body.trim(),
          customer_name: prefill.name || '',
          customer_email: prefill.email || '',
          media_urls: photoUrls,
          token,
          variant_id: item.shopify_variant_id || null,
          sku: item.sku || null,
        };

        const res = await fetch(`${backendUrl}/api/reviews/submit${brandParam}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({ error: 'Submission failed' }));
          s.error = errData.error || 'Failed to submit. Please try again.';
          s.submitting = false;
          submittingAll = false;
          render();
          return;
        }

        // Success for this item
        s.photos.forEach(p => URL.revokeObjectURL(p.preview));
        s.photos = [];
        s.submitted = true;
        s.submitting = false;
      } catch {
        s.error = 'Network error. Please try again.';
        s.submitting = false;
        submittingAll = false;
        render();
        return;
      }
    }

    submittingAll = false;
    // Check if all done
    if (itemStates.every(s => s.submitted)) {
      allDone = true;
    }
    render();
  }

  render();
  return container;
}

// ── Main Widget ─────────────────────────────────────────────────────────────

function createReviewWidget(
  container: HTMLElement,
  handle: string,
  backendUrl: string,
  brandSlug: string,
  config: WidgetConfig,
): void {
  const design: DesignConfig = config.widget_design || {};
  const brandParam = brandSlug ? `?brand=${brandSlug}` : '';

  const state: WidgetState = {
    loading: true,
    error: null,
    summary: null,
    reviews: [],
    page: 1,
    perPage: 10,
    totalPages: 0,
    totalReviews: 0,
    loadingMore: false,
    formOpen: false,
    formSubmitting: false,
    formSuccess: false,
    formError: null,
    formRating: 0,
    formHoverRating: 0,
    formPhotos: [],
    formPhotoUrls: [],
    formUploading: false,
    activeSort: 'newest',
    activeRatingFilters: new Set<number>(),
    activeMediaFilter: false,
    filterDropdownOpen: false,
  };

  // Apply CSS custom properties
  function applyDesign(d: DesignConfig): void {
    container.style.setProperty('--orw-star', d.starColor || '#C5A059');
    container.style.setProperty('--orw-text', d.textColor || '#2D3338');
    container.style.setProperty('--orw-heading', d.headingColor || '#C5A059');
    container.style.setProperty('--orw-bg', d.backgroundColor || '#ffffff');
  }

  applyDesign(design);

  function showLightbox(images: string[], startIndex: number): void {
    const lb = renderLightbox(images, startIndex, () => {
      const cleanup = (lb as unknown as Record<string, () => void>)._cleanup;
      if (cleanup) cleanup();
      lb.remove();
    });
    document.body.appendChild(lb);
  }

  function openForm(): void {
    state.formOpen = true;
    state.formSuccess = false;
    state.formError = null;
    state.formRating = 0;
    state.formHoverRating = 0;
    state.formPhotos.forEach(p => URL.revokeObjectURL(p.preview));
    state.formPhotos = [];
    state.formPhotoUrls = [];
    state.formSubmitting = false;

    const formEl = renderReviewForm(
      handle,
      design,
      backendUrl,
      brandSlug,
      state,
      closeForm,
      () => {
        closeForm();
        fetchAll();
      },
    );
    document.body.appendChild(formEl);

    function handleEsc(e: KeyboardEvent): void {
      if (e.key === 'Escape' && state.formOpen) closeForm();
    }
    document.addEventListener('keydown', handleEsc);
    (formEl as unknown as Record<string, () => void>)._escCleanup = () => {
      document.removeEventListener('keydown', handleEsc);
    };
  }

  function closeForm(): void {
    state.formOpen = false;
    state.formPhotos.forEach(p => URL.revokeObjectURL(p.preview));
    state.formPhotos = [];
    const modal = document.querySelector('.orw-modal');
    if (modal) {
      const escCleanup = (modal as unknown as Record<string, () => void>)._escCleanup;
      if (escCleanup) escCleanup();
      modal.remove();
    }
  }

  function render(): void {
    container.innerHTML = '';
    const wrap = createEl('div', 'orw-container');

    if (state.loading) {
      const loading = createEl('div', 'orw-loading');
      const spinner = createEl('div', 'orw-spinner');
      loading.appendChild(spinner);
      wrap.appendChild(loading);
      container.appendChild(wrap);
      return;
    }

    if (state.error) {
      const err = createEl('div', 'orw-error');
      err.textContent = state.error;
      wrap.appendChild(err);
      container.appendChild(wrap);
      return;
    }

    // If no reviews yet
    if (!state.summary || state.summary.total_count === 0) {
      const emptyHeader = createEl('div', 'orw-header');
      const emptyTitle = createEl('div', 'orw-header-title');
      emptyTitle.textContent = design.headerText || 'Customer Reviews';
      emptyHeader.appendChild(emptyTitle);

      const emptyStars = renderStars(0, design.starColor || '#C5A059', 24);
      emptyStars.classList.add('orw-header-stars');
      const emptyRating = createEl('div', 'orw-header-rating');
      emptyRating.appendChild(emptyStars);
      emptyHeader.appendChild(emptyRating);

      const emptyCount = createEl('div', 'orw-header-count', 'No reviews yet');
      emptyHeader.appendChild(emptyCount);

      const emptyBtn = createEl('button', 'orw-header-btn', 'Be the First to Review');
      emptyBtn.addEventListener('click', openForm);
      emptyHeader.appendChild(emptyBtn);

      wrap.appendChild(emptyHeader);

      const emptyBody = createEl('div', 'orw-empty');
      const emptyText = createEl('div', 'orw-empty-text', 'Share your experience with this product!');
      emptyBody.appendChild(emptyText);
      wrap.appendChild(emptyBody);

      container.appendChild(wrap);

      // Post loaded event
      window.parent.postMessage({ type: 'orw:loaded', data: { total: 0, average: 0 } }, '*');
      return;
    }

    // Header with summary
    const header = renderHeader(state.summary, design, openForm);
    wrap.appendChild(header);

    // Filter/Sort bar
    const filterBar = renderFilterBar(
      state.summary,
      state,
      (sort: string) => {
        state.activeSort = sort;
        state.filterDropdownOpen = false;
        fetchAll();
      },
      (rating: number) => {
        if (state.activeRatingFilters.has(rating)) {
          state.activeRatingFilters.delete(rating);
        } else {
          state.activeRatingFilters.add(rating);
        }
        ensureFullLoadThenRender();
      },
      (active: boolean) => {
        state.activeMediaFilter = active;
        ensureFullLoadThenRender();
      },
      () => {
        state.activeRatingFilters.clear();
        state.activeMediaFilter = false;
        ensureFullLoadThenRender();
      },
    );
    wrap.appendChild(filterBar);

    // Apply client-side filters and sorting
    let displayReviews = [...state.reviews];

    // Always sort media-first — reviews with images/videos bubble to top,
    // then apply the active sort as a tiebreaker within each group
    displayReviews.sort((a, b) => {
      const aHas = a.media && a.media.length > 0 ? 1 : 0;
      const bHas = b.media && b.media.length > 0 ? 1 : 0;
      if (bHas !== aHas) return bHas - aHas;
      if (state.activeSort === 'oldest') {
        return new Date(a.submitted_at || a.created_at).getTime() - new Date(b.submitted_at || b.created_at).getTime();
      }
      if (state.activeSort === 'highest') return b.rating - a.rating;
      if (state.activeSort === 'lowest') return a.rating - b.rating;
      if (state.activeSort === 'most_helpful') return b.helpful_count - a.helpful_count;
      // Default: newest
      return new Date(b.submitted_at || b.created_at).getTime() - new Date(a.submitted_at || a.created_at).getTime();
    });

    if (state.activeRatingFilters.size > 0) {
      displayReviews = displayReviews.filter(r => state.activeRatingFilters.has(r.rating));
    }
    if (state.activeMediaFilter) {
      displayReviews = displayReviews.filter(r => r.media && r.media.length > 0);
    }

    // Client-side pagination
    const totalFiltered = displayReviews.length;
    const clientTotalPages = Math.ceil(totalFiltered / state.perPage);
    const clientPage = Math.min(state.page, clientTotalPages || 1);
    const pageStart = (clientPage - 1) * state.perPage;
    const pageReviews = displayReviews.slice(pageStart, pageStart + state.perPage);

    // Review cards grid
    if (pageReviews.length > 0) {
      const grid = createEl('div', 'orw-reviews-grid');
      pageReviews.forEach((review) => {
        const card = renderReviewCard(review, design, showLightbox);
        grid.appendChild(card);
      });
      wrap.appendChild(grid);
    }

    // Pagination controls
    if (clientTotalPages > 1) {
      const pager = createEl('div', 'orw-pagination');

      // Previous button
      const prevBtn = createEl('button', 'orw-page-btn');
      prevBtn.innerHTML = '&#8249;';
      prevBtn.disabled = clientPage <= 1;
      prevBtn.addEventListener('click', () => { state.page = clientPage - 1; render(); container.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
      pager.appendChild(prevBtn);

      // Page numbers
      const pages = buildPageNumbers(clientPage, clientTotalPages);
      for (const p of pages) {
        if (p === '...') {
          const dots = createEl('span', 'orw-page-dots', '...');
          pager.appendChild(dots);
        } else {
          const num = p as number;
          const pageBtn = createEl('button', `orw-page-num${num === clientPage ? ' orw-page-num--active' : ''}`);
          pageBtn.textContent = String(num);
          pageBtn.addEventListener('click', () => { state.page = num; render(); container.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
          pager.appendChild(pageBtn);
        }
      }

      // Next button
      const nextBtn = createEl('button', 'orw-page-btn');
      nextBtn.innerHTML = '&#8250;';
      nextBtn.disabled = clientPage >= clientTotalPages;
      nextBtn.addEventListener('click', () => { state.page = clientPage + 1; render(); container.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
      pager.appendChild(nextBtn);

      wrap.appendChild(pager);
    }

    container.appendChild(wrap);

    // Post loaded event
    window.parent.postMessage({
      type: 'orw:loaded',
      data: {
        total: state.summary.total_count,
        average: state.summary.average_rating,
      },
    }, '*');
  }

  let fullLoaded = false;

  async function ensureFullLoadThenRender(): Promise<void> {
    // Re-render immediately so dropdown stays open and filters apply
    render();

    // If we haven't loaded the full set yet, fetch in background
    const hasFilter = state.activeRatingFilters.size > 0 || state.activeMediaFilter;
    if (hasFilter && !fullLoaded && state.totalReviews > state.reviews.length) {
      let url = `${backendUrl}/api/reviews/product/${encodeURIComponent(handle)}?page=1&per_page=100&sort=${state.activeSort}`;
      if (brandParam) url += '&' + brandParam.slice(1);
      try {
        const res = await fetch(url);
        if (res.ok) {
          const data: ReviewsResponse = await res.json();
          state.reviews = data.reviews || [];
          state.page = data.page || 1;
          state.totalPages = data.totalPages || 0;
          state.totalReviews = data.total || 0;
          fullLoaded = true;
          render();
        }
      } catch { /* ignore */ }
    }
  }

  async function fetchAll(): Promise<void> {
    fullLoaded = false;
    state.loading = true;
    state.error = null;
    state.page = 1;
    state.reviews = [];
    render();

    try {
      // Always fetch all reviews so client-side media-first sort and filters work correctly
      let reviewUrl = `${backendUrl}/api/reviews/product/${encodeURIComponent(handle)}?page=1&per_page=200&sort=${state.activeSort}`;
      if (brandParam) {
        reviewUrl += '&' + brandParam.slice(1);
      }

      const [summaryRes, reviewsRes] = await Promise.all([
        fetch(`${backendUrl}/api/reviews/product/${encodeURIComponent(handle)}/summary${brandParam}`),
        fetch(reviewUrl),
      ]);

      if (summaryRes.ok) {
        state.summary = await summaryRes.json();
      } else {
        state.summary = { average_rating: 0, total_count: 0, verified_count: 0, distribution: [] };
      }

      if (reviewsRes.ok) {
        const data: ReviewsResponse = await reviewsRes.json();
        state.reviews = data.reviews || [];
        state.page = data.page || 1;
        state.totalPages = data.totalPages || 0;
        state.totalReviews = data.total || 0;
      } else {
        state.reviews = [];
      }

      state.loading = false;

      // Expose reviews data for V20 carousel section
      (window as any).outlightReviews = { reviews: state.reviews, summary: state.summary };
      window.dispatchEvent(new CustomEvent('outlight-reviews-loaded'));

      render();
    } catch {
      state.loading = false;
      state.error = 'Unable to load reviews. Please try again later.';
      render();
    }
  }

  async function goToPage(p: number): Promise<void> {
    if (p < 1 || p > state.totalPages || p === state.page) return;
    state.loading = true;
    state.page = p;
    render();

    try {
      let url = `${backendUrl}/api/reviews/product/${encodeURIComponent(handle)}?page=${p}&per_page=${state.perPage}&sort=${state.activeSort}`;
      if (brandParam) url += '&' + brandParam.slice(1);
      const res = await fetch(url);
      if (res.ok) {
        const data: ReviewsResponse = await res.json();
        state.reviews = data.reviews || [];
        state.page = data.page || p;
        state.totalPages = data.totalPages || state.totalPages;
        state.totalReviews = data.total || state.totalReviews;
      }
      state.loading = false;
      render();
      // Scroll to top of widget
      container.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch {
      state.loading = false;
      render();
    }
  }

  async function loadMore(): Promise<void> {
    if (state.loadingMore || state.page >= state.totalPages) return;

    state.loadingMore = true;
    const btn = container.querySelector('.orw-load-more') as HTMLButtonElement | null;
    if (btn) {
      btn.textContent = 'Loading...';
      btn.disabled = true;
    }

    const nextPage = state.page + 1;
    try {
      let loadMoreUrl = `${backendUrl}/api/reviews/product/${encodeURIComponent(handle)}?page=${nextPage}&per_page=${state.perPage}&sort=${state.activeSort}`;
      if (brandParam) {
        loadMoreUrl += '&' + brandParam.slice(1);
      }
      const res = await fetch(loadMoreUrl);

      if (res.ok) {
        const data: ReviewsResponse = await res.json();
        state.reviews = state.reviews.concat(data.reviews || []);
        state.page = data.page || nextPage;
        state.totalPages = data.totalPages || state.totalPages;
      }

      state.loadingMore = false;
      render();
    } catch {
      state.loadingMore = false;
      if (btn) {
        btn.textContent = 'Load More';
        btn.disabled = false;
      }
    }
  }

  // Start fetching
  fetchAll();

  // Listen for live design updates (admin playground)
  window.addEventListener('message', (event) => {
    if (event.data?.type === 'orw:design_update' && event.data.design) {
      Object.assign(design, event.data.design);
      applyDesign(design);
      render();
    }
  });
}

// ── Init ─────────────────────────────────────────────────────────────────────

async function init(): Promise<void> {
  const { backendUrl, brandSlug } = getScriptInfo();
  const brandParam = brandSlug ? `?brand=${brandSlug}` : '';
  const brandHeader: Record<string, string> = brandSlug ? { 'X-Brand': brandSlug } : {};

  // Check for email review form page first
  const formRoot = document.getElementById('review-form-root');
  if (formRoot) {
    const token = formRoot.getAttribute('data-token') || '';
    const handle = formRoot.getAttribute('data-product-handle') || '';
    const prefillName = formRoot.getAttribute('data-customer-name') || '';
    const prefillEmail = formRoot.getAttribute('data-customer-email') || '';
    const productTitle = formRoot.getAttribute('data-product-title') || '';

    let config: WidgetConfig = {};
    try {
      const res = await fetch(`${backendUrl}/api/reviews/widget/config${brandParam}`, {
        headers: brandHeader,
      });
      if (res.ok) config = await res.json();
    } catch { /* use defaults */ }

    const design: DesignConfig = config.widget_design || {};

    // Apply CSS variables
    formRoot.style.setProperty('--orw-star', design.starColor || '#C5A059');
    formRoot.style.setProperty('--orw-text', design.textColor || '#2D3338');
    formRoot.style.setProperty('--orw-heading', design.headingColor || '#C5A059');
    formRoot.style.setProperty('--orw-bg', design.backgroundColor || '#ffffff');

    // Check for multi-item line_items data
    const lineItemsRaw = formRoot.getAttribute('data-line-items');
    let lineItems: ReviewLineItem[] = [];
    try {
      if (lineItemsRaw) lineItems = JSON.parse(lineItemsRaw);
    } catch { /* ignore parse errors */ }

    const prefillData = { name: prefillName || undefined, email: prefillEmail || undefined };

    // Multi-item form when there are 2+ line items
    if (lineItems.length > 1) {
      const heading = document.createElement('div');
      heading.style.cssText = 'max-width:700px;margin:40px auto 0;padding:0 20px;text-align:center;';
      heading.innerHTML = `<h1 style="font-family:${design.headingFontFamily || 'Manrope'},sans-serif;color:${design.headingColor || '#C5A059'};font-size:20px;font-weight:600;margin-bottom:4px;">Review Your Order (${lineItems.length} items)</h1><p style="color:${design.textColor || '#666'};font-size:14px;">Review one or all of the items in your order</p>`;
      formRoot.parentElement?.insertBefore(heading, formRoot);

      const multiForm = renderMultiItemForm(lineItems, design, backendUrl, brandSlug, token, prefillData as { name?: string; email?: string });
      formRoot.appendChild(multiForm);
      return;
    }

    // Single-item form (original behavior)
    if (productTitle) {
      const heading = document.createElement('div');
      heading.style.cssText = 'max-width:600px;margin:40px auto 0;padding:0 20px;text-align:center;';
      heading.innerHTML = `<h1 style="font-family:${design.headingFontFamily || 'Manrope'},sans-serif;color:${design.headingColor || '#C5A059'};font-size:20px;font-weight:600;margin-bottom:4px;">How was your ${productTitle}?</h1><p style="color:${design.textColor || '#666'};font-size:14px;">We'd love to hear your thoughts</p>`;
      formRoot.parentElement?.insertBefore(heading, formRoot);
    }

    const state: WidgetState = {
      loading: false,
      error: null,
      summary: null,
      reviews: [],
      page: 1,
      perPage: 10,
      totalPages: 0,
      totalReviews: 0,
      loadingMore: false,
      formOpen: true,
      formSubmitting: false,
      formSuccess: false,
      formError: null,
      formRating: 0,
      formHoverRating: 0,
      formPhotos: [],
      formPhotoUrls: [],
      formUploading: false,
      activeSort: 'newest',
      activeRatingFilters: new Set<number>(),
      activeMediaFilter: false,
      filterDropdownOpen: false,
    };

    // For single-item with line_items data, pass variant info
    const singleLineItem = lineItems.length === 1 ? lineItems[0] : null;
    const effectiveHandle = singleLineItem?.handle || handle;

    const formEl = renderReviewForm(
      effectiveHandle,
      design,
      backendUrl,
      brandSlug,
      state,
      () => {},
      () => {},
      token,
      prefillData as { name?: string; email?: string },
    );
    formRoot.appendChild(formEl);

    return;
  }

  // Main widget: find container
  const container = document.getElementById('outlight-reviews')
    || document.querySelector('[data-outlight-reviews]') as HTMLElement | null;

  if (!container) return;

  const handle = container.getAttribute('data-product-handle') || '';
  if (!handle) {
    container.innerHTML = '<div class="orw-error">Missing data-product-handle attribute.</div>';
    return;
  }

  // Fetch config
  let config: WidgetConfig = {};
  try {
    const res = await fetch(`${backendUrl}/api/reviews/widget/config${brandParam}`, {
      headers: brandHeader,
    });
    if (res.ok) config = await res.json();
  } catch { /* use defaults */ }

  createReviewWidget(container, handle, backendUrl, brandSlug, config);
}

// ── Bootstrap ────────────────────────────────────────────────────────────────

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
