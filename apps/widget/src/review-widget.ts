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

  // Error
  if (state.formError) {
    const errDiv = createEl('div', 'orw-form-error');
    errDiv.textContent = state.formError;
    form.appendChild(errDiv);
  }

  // Star rating picker
  const starField = createEl('div', 'orw-form-field');
  const starLabel = createEl('label', 'orw-form-label');
  starLabel.innerHTML = 'Rating <span class="orw-form-required">*</span>';
  starField.appendChild(starLabel);

  const starPicker = createEl('div', 'orw-star-picker');
  const starColor = design.starColor || '#C5A059';
  for (let i = 1; i <= 5; i++) {
    const starBtn = createEl('span', 'orw-star-picker-star');
    const displayRating = state.formHoverRating || state.formRating;
    starBtn.appendChild(createStarSvg(i <= displayRating ? 'full' : 'empty', starColor, 28));
    starBtn.addEventListener('click', () => {
      state.formRating = i;
      rerenderForm();
    });
    starBtn.addEventListener('mouseenter', () => {
      state.formHoverRating = i;
      rerenderForm();
    });
    starBtn.addEventListener('mouseleave', () => {
      state.formHoverRating = 0;
      rerenderForm();
    });
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

  // Name + Email row
  const nameEmailRow = createEl('div', 'orw-form-row');

  const nameField = createEl('div', 'orw-form-field');
  const nameLabel = createEl('label', 'orw-form-label');
  nameLabel.innerHTML = 'Your Name <span class="orw-form-required">*</span>';
  nameField.appendChild(nameLabel);
  const nameInput = createEl('input', 'orw-form-input') as HTMLInputElement;
  nameInput.type = 'text';
  nameInput.placeholder = 'John D.';
  nameInput.id = 'orw-form-name';
  nameField.appendChild(nameInput);
  nameEmailRow.appendChild(nameField);

  const emailField = createEl('div', 'orw-form-field');
  const emailLabel = createEl('label', 'orw-form-label');
  emailLabel.innerHTML = 'Email <span class="orw-form-required">*</span>';
  emailField.appendChild(emailLabel);
  const emailInput = createEl('input', 'orw-form-input') as HTMLInputElement;
  emailInput.type = 'email';
  emailInput.placeholder = 'you@email.com';
  emailInput.id = 'orw-form-email';
  emailField.appendChild(emailInput);
  nameEmailRow.appendChild(emailField);

  form.appendChild(nameEmailRow);

  // Submit button
  const submitBtn = createEl('button', 'orw-form-submit');
  submitBtn.textContent = state.formSubmitting ? 'Submitting...' : 'Submit Review';
  submitBtn.disabled = state.formSubmitting;
  submitBtn.addEventListener('click', async () => {
    const nameVal = (form.querySelector('#orw-form-name') as HTMLInputElement)?.value?.trim();
    const emailVal = (form.querySelector('#orw-form-email') as HTMLInputElement)?.value?.trim();
    const titleVal = (form.querySelector('#orw-form-title') as HTMLInputElement)?.value?.trim();
    const bodyVal = (form.querySelector('#orw-form-body') as HTMLTextAreaElement)?.value?.trim();

    // Validation
    if (!state.formRating) {
      state.formError = 'Please select a star rating.';
      rerenderForm();
      return;
    }
    if (!bodyVal) {
      state.formError = 'Please write your review.';
      rerenderForm();
      return;
    }
    if (!nameVal) {
      state.formError = 'Please enter your name.';
      rerenderForm();
      return;
    }
    if (!emailVal || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailVal)) {
      state.formError = 'Please enter a valid email address.';
      rerenderForm();
      return;
    }

    state.formError = null;
    state.formSubmitting = true;
    rerenderForm();

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
        author_name: nameVal,
        author_email: emailVal,
        photos: photoUrls,
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
        state.formError = errData.error || 'Failed to submit review. Please try again.';
        state.formSubmitting = false;
        rerenderForm();
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
      state.formError = 'Network error. Please check your connection and try again.';
      state.formSubmitting = false;
      rerenderForm();
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
    const newForm = renderReviewForm(handle, design, backendUrl, brandSlug, state, onClose, onSuccess, token);
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

    // Apply client-side filters (media is always client-side, rating client-side for multi-select)
    let displayReviews = state.reviews;
    if (state.activeRatingFilters.size > 0) {
      displayReviews = displayReviews.filter(r => state.activeRatingFilters.has(r.rating));
    }
    if (state.activeMediaFilter) {
      displayReviews = displayReviews.filter(r => r.media && r.media.length > 0);
    }

    // Review cards grid
    if (displayReviews.length > 0) {
      const grid = createEl('div', 'orw-reviews-grid');
      displayReviews.forEach((review) => {
        const card = renderReviewCard(review, design, showLightbox);
        grid.appendChild(card);
      });
      wrap.appendChild(grid);
    }

    // Pagination controls
    if (state.totalPages > 1) {
      const pager = createEl('div', 'orw-pagination');

      // Previous button
      const prevBtn = createEl('button', 'orw-page-btn');
      prevBtn.innerHTML = '&#8249;';
      prevBtn.disabled = state.page <= 1;
      prevBtn.addEventListener('click', () => goToPage(state.page - 1));
      pager.appendChild(prevBtn);

      // Page numbers
      const pages = buildPageNumbers(state.page, state.totalPages);
      for (const p of pages) {
        if (p === '...') {
          const dots = createEl('span', 'orw-page-dots', '...');
          pager.appendChild(dots);
        } else {
          const num = p as number;
          const pageBtn = createEl('button', `orw-page-num${num === state.page ? ' orw-page-num--active' : ''}`);
          pageBtn.textContent = String(num);
          pageBtn.addEventListener('click', () => goToPage(num));
          pager.appendChild(pageBtn);
        }
      }

      // Next button
      const nextBtn = createEl('button', 'orw-page-btn');
      nextBtn.innerHTML = '&#8250;';
      nextBtn.disabled = state.page >= state.totalPages;
      nextBtn.addEventListener('click', () => goToPage(state.page + 1));
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
      const hasClientFilter = state.activeMediaFilter || state.activeRatingFilters.size > 0;
      const fetchPerPage = hasClientFilter ? 100 : state.perPage;
      let reviewUrl = `${backendUrl}/api/reviews/product/${encodeURIComponent(handle)}?page=1&per_page=${fetchPerPage}&sort=${state.activeSort}`;
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

    const formEl = renderReviewForm(
      handle,
      design,
      backendUrl,
      brandSlug,
      state,
      () => {},
      () => {},
      token,
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
