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

// ── Types ────────────────────────────────────────────────────────────────────

interface ReviewSummary {
  average_rating: number;
  total_reviews: number;
  rating_distribution: Record<string, number>;
}

interface ReviewPhoto {
  url: string;
  alt?: string;
}

interface OwnerReply {
  body: string;
  created_at: string;
}

interface Review {
  id: string;
  author_name: string;
  rating: number;
  title?: string;
  body: string;
  verified: boolean;
  created_at: string;
  photos: ReviewPhoto[];
  variant_label?: string;
  owner_reply?: OwnerReply | null;
}

interface ReviewsResponse {
  reviews: Review[];
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
}

interface WidgetConfig {
  design?: DesignConfig;
}

interface DesignConfig {
  starColor?: string;
  headingColor?: string;
  textColor?: string;
  mutedColor?: string;
  verifiedColor?: string;
  backgroundColor?: string;
  dividerColor?: string;
  replyBackground?: string;
  fontFamily?: string;
  headingFontFamily?: string;
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
  formPhotos: { file: File; preview: string }[];
  formPhotoUrls: string[];
  formUploading: boolean;
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
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
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
    // Define clip for half
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

    // Filled half
    const filledPath = document.createElementNS(ns, 'path');
    filledPath.setAttribute('d', starPath);
    filledPath.setAttribute('fill', color);
    filledPath.setAttribute('stroke', color);
    filledPath.setAttribute('stroke-width', '1');
    filledPath.setAttribute('clip-path', `url(#${clipId})`);
    svg.appendChild(filledPath);

    // Empty outline
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

function renderHeader(
  summary: ReviewSummary,
  design: DesignConfig,
  onWriteReview: () => void,
): HTMLElement {
  const header = createEl('div', 'orw-header');

  const title = createEl('div', 'orw-header-title', 'Customer Reviews');
  header.appendChild(title);

  const ratingRow = createEl('div', 'orw-header-rating');
  const stars = renderStars(summary.average_rating, design.starColor || '#C4A265', 28);
  stars.classList.add('orw-header-stars');
  const ratingNum = createEl('span', 'orw-header-rating-number');
  ratingNum.textContent = summary.average_rating.toFixed(1);
  ratingRow.appendChild(stars);
  ratingRow.appendChild(ratingNum);
  header.appendChild(ratingRow);

  const count = createEl('div', 'orw-header-count');
  count.textContent = `Based on ${summary.total_reviews} verified review${summary.total_reviews !== 1 ? 's' : ''}`;
  header.appendChild(count);

  const btn = createEl('button', 'orw-header-btn', 'Write a Review');
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

  // Header row: name + verified + date
  const cardHeader = createEl('div', 'orw-card-header');

  const name = createEl('span', 'orw-card-name');
  name.textContent = review.author_name;
  cardHeader.appendChild(name);

  if (review.verified) {
    const dot = createEl('span', 'orw-card-verified');
    cardHeader.appendChild(dot);
    const vLabel = createEl('span', 'orw-card-verified-label', 'Verified');
    cardHeader.appendChild(vLabel);
  }

  const date = createEl('span', 'orw-card-date');
  date.textContent = formatDate(review.created_at);
  cardHeader.appendChild(date);

  card.appendChild(cardHeader);

  // Stars
  const starsRow = createEl('div', 'orw-card-stars');
  starsRow.appendChild(renderStars(review.rating, design.starColor || '#C4A265', 16));
  card.appendChild(starsRow);

  // Body text
  const body = createEl('div', 'orw-card-body');
  body.textContent = review.body;
  card.appendChild(body);

  // Photo thumbnails
  if (review.photos && review.photos.length > 0) {
    const photosRow = createEl('div', 'orw-card-photos');
    const imageUrls = review.photos.map(p => p.url);
    review.photos.forEach((photo, idx) => {
      const thumb = createEl('div', 'orw-card-photo');
      const img = createEl('img');
      img.src = photo.url;
      img.alt = photo.alt || `Review photo ${idx + 1}`;
      img.loading = 'lazy';
      thumb.appendChild(img);
      thumb.addEventListener('click', () => onPhotoClick(imageUrls, idx));
      photosRow.appendChild(thumb);
    });
    card.appendChild(photosRow);
  }

  // Variant label
  if (review.variant_label) {
    const variant = createEl('div', 'orw-card-variant');
    variant.textContent = `ITEM: ${review.variant_label}`;
    card.appendChild(variant);
  }

  // Owner reply
  if (review.owner_reply && review.owner_reply.body) {
    const reply = createEl('div', 'orw-card-reply');
    const replyLabel = createEl('div', 'orw-card-reply-label', 'Store Reply');
    reply.appendChild(replyLabel);
    const replyBody = createEl('div', 'orw-card-reply-body');
    replyBody.textContent = review.owner_reply.body;
    reply.appendChild(replyBody);
    card.appendChild(reply);
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
  const isInline = !!token; // inline form on email submission page

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
  const starColor = design.starColor || '#C4A265';
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
  const photoLabel = createEl('label', 'orw-form-label', 'Photos (optional)');
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
    <div class="orw-photo-upload-text">Drop photos here or click to upload</div>
    <div class="orw-photo-upload-hint">Max 5 photos, JPEG/PNG/WebP</div>
  `;

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/jpeg,image/png,image/webp';
  fileInput.multiple = true;
  fileInput.style.display = 'none';

  function handleFiles(files: FileList | File[]): void {
    const remaining = 5 - state.formPhotos.length;
    const toAdd = Array.from(files).slice(0, remaining);
    for (const file of toAdd) {
      if (!file.type.startsWith('image/')) continue;
      const preview = URL.createObjectURL(file);
      state.formPhotos.push({ file, preview });
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
      const img = createEl('img');
      img.src = photo.preview;
      img.alt = `Upload ${idx + 1}`;
      pv.appendChild(img);

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
      // Upload photos first
      const photoUrls: string[] = [];
      for (const photo of state.formPhotos) {
        try {
          const reader = new FileReader();
          const base64 = await new Promise<string>((resolve, reject) => {
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(photo.file);
          });

          const res = await fetch(`${backendUrl}/api/reviews/upload${brandParam}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image: base64, filename: photo.file.name }),
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

  // Attach rerender to wrapper for external access
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
  const design: DesignConfig = config.design || {};
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
  };

  // Apply CSS custom properties
  function applyDesign(d: DesignConfig): void {
    container.style.setProperty('--orw-star', d.starColor || '#C4A265');
    container.style.setProperty('--orw-text', d.textColor || '#333333');
    container.style.setProperty('--orw-muted', d.mutedColor || '#999999');
    container.style.setProperty('--orw-verified', d.verifiedColor || '#22c55e');
    container.style.setProperty('--orw-bg', d.backgroundColor || '#ffffff');
    container.style.setProperty('--orw-divider', d.dividerColor || '#eeeeee');
    container.style.setProperty('--orw-reply-bg', d.replyBackground || '#f9f9f9');
    container.style.setProperty('--orw-font', d.fontFamily || 'inherit');
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
        // Refresh reviews
        fetchAll();
      },
    );
    document.body.appendChild(formEl);

    // Close on Escape
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
    if (!state.summary || state.summary.total_reviews === 0) {
      const emptyHeader = createEl('div', 'orw-header');
      const emptyTitle = createEl('div', 'orw-header-title', 'Customer Reviews');
      emptyHeader.appendChild(emptyTitle);

      const emptyStars = renderStars(0, design.starColor || '#C4A265', 28);
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
      return;
    }

    // Header with summary
    const header = renderHeader(state.summary, design, openForm);
    wrap.appendChild(header);

    // Review cards grid
    if (state.reviews.length > 0) {
      const grid = createEl('div', 'orw-reviews-grid');
      state.reviews.forEach((review) => {
        const card = renderReviewCard(review, design, showLightbox);
        grid.appendChild(card);
      });
      wrap.appendChild(grid);
    }

    // Load More button
    if (state.page < state.totalPages) {
      const loadMoreWrap = createEl('div', 'orw-load-more-wrap');
      const loadMoreBtn = createEl('button', 'orw-load-more');
      loadMoreBtn.textContent = state.loadingMore ? 'Loading...' : 'Load More';
      loadMoreBtn.disabled = state.loadingMore;
      loadMoreBtn.addEventListener('click', loadMore);
      loadMoreWrap.appendChild(loadMoreBtn);
      wrap.appendChild(loadMoreWrap);
    }

    container.appendChild(wrap);
  }

  async function fetchAll(): Promise<void> {
    state.loading = true;
    state.error = null;
    state.page = 1;
    state.reviews = [];
    render();

    try {
      const [summaryRes, reviewsRes] = await Promise.all([
        fetch(`${backendUrl}/api/reviews/product/${encodeURIComponent(handle)}/summary${brandParam}`),
        fetch(`${backendUrl}/api/reviews/product/${encodeURIComponent(handle)}?page=1&per_page=${state.perPage}${brandParam ? '&' + brandParam.slice(1) : ''}`),
      ]);

      if (summaryRes.ok) {
        state.summary = await summaryRes.json();
      } else {
        state.summary = { average_rating: 0, total_reviews: 0, rating_distribution: {} };
      }

      if (reviewsRes.ok) {
        const data: ReviewsResponse = await reviewsRes.json();
        state.reviews = data.reviews || [];
        state.page = data.page || 1;
        state.totalPages = data.total_pages || 0;
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

  async function loadMore(): Promise<void> {
    if (state.loadingMore || state.page >= state.totalPages) return;

    state.loadingMore = true;
    // Update button text without full re-render
    const btn = container.querySelector('.orw-load-more') as HTMLButtonElement | null;
    if (btn) {
      btn.textContent = 'Loading...';
      btn.disabled = true;
    }

    const nextPage = state.page + 1;
    try {
      const res = await fetch(
        `${backendUrl}/api/reviews/product/${encodeURIComponent(handle)}?page=${nextPage}&per_page=${state.perPage}${brandParam ? '&' + brandParam.slice(1) : ''}`,
      );

      if (res.ok) {
        const data: ReviewsResponse = await res.json();
        state.reviews = state.reviews.concat(data.reviews || []);
        state.page = data.page || nextPage;
        state.totalPages = data.total_pages || state.totalPages;
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

    // Fetch config
    let config: WidgetConfig = {};
    try {
      const res = await fetch(`${backendUrl}/api/reviews/widget/config${brandParam}`, {
        headers: brandHeader,
      });
      if (res.ok) config = await res.json();
    } catch { /* use defaults */ }

    const design: DesignConfig = config.design || {};

    // Apply CSS variables
    formRoot.style.setProperty('--orw-star', design.starColor || '#C4A265');
    formRoot.style.setProperty('--orw-text', design.textColor || '#333333');
    formRoot.style.setProperty('--orw-muted', design.mutedColor || '#999999');
    formRoot.style.setProperty('--orw-verified', design.verifiedColor || '#22c55e');
    formRoot.style.setProperty('--orw-bg', design.backgroundColor || '#ffffff');
    formRoot.style.setProperty('--orw-divider', design.dividerColor || '#eeeeee');
    formRoot.style.setProperty('--orw-reply-bg', design.replyBackground || '#f9f9f9');
    formRoot.style.setProperty('--orw-font', design.fontFamily || 'inherit');

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
    };

    const formEl = renderReviewForm(
      handle,
      design,
      backendUrl,
      brandSlug,
      state,
      () => {}, // no close for inline
      () => {
        // Redirect or show thank you
      },
      token,
    );
    formRoot.appendChild(formEl);
    return;
  }

  // Main widget: find container
  const container = document.getElementById('outlight-reviews')
    || document.querySelector('[data-outlight-reviews]') as HTMLElement | null;

  if (!container) return; // No container found, do nothing

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
