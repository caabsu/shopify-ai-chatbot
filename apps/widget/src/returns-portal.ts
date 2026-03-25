/**
 * Returns Portal Widget — Customer-facing return request form.
 * Embeddable on any Shopify "Returns" or "Contact Us" page.
 *
 * Usage:
 *   <div id="returns-portal"></div>
 *   <script src="https://your-backend/widget/returns-portal.js" data-brand="misu"></script>
 *
 * Flow:
 *   1. Customer enters order number + email
 *   2. Widget looks up order and shows eligible items
 *   3. Customer selects items, provides reason + optional photos
 *   4. Submits return request → gets confirmation with reference ID
 */

import './styles/returns-portal.css';

// ── Types ────────────────────────────────────────────────────────────────────

interface BrandDesign {
  primaryColor: string;
  backgroundColor: string;
  borderRadius: string;
  fontSize: string;
  fontFamily?: string;
  headingFontFamily?: string;
  buttonTextLookup?: string;
  buttonTextContinue?: string;
  buttonTextSubmit?: string;
  stepLabels?: string[];
  successTitle?: string;
  successMessage?: string;
  successButtonText?: string;
}

interface PortalConfig {
  settings: {
    return_window_days: number;
    require_photos: boolean;
    require_photos_for_reasons: string[];
    available_reasons: string[];
    reason_labels: Record<string, string>;
    available_resolutions: string[];
    portal_title: string;
    portal_description: string;
    restocking_fee_percent: number;
    restocking_fee_exempt_reasons: string[];
    collect_dimensions_for_reasons: string[];
    provide_prepaid_label_for_reasons: string[];
    dimension_collection_enabled: boolean;
  } | null;
  design: BrandDesign | null;
}

declare global {
  interface Window {
    __SRP_DEBUG?: boolean;
  }
}

interface OrderItem {
  id: string;
  title: string;
  variantTitle?: string;
  quantity: number;
  price: string;
  image?: string;
  eligible: boolean;
  eligibility_reason?: string;
}

interface OrderInfo {
  id: string;
  name: string;
  createdAt: string;
  financialStatus: string;
  fulfillmentStatus: string;
}

interface SelectedItem {
  lineItemId: string;
  title: string;
  variantTitle?: string;
  quantity: number;
  reason: string;
  notes?: string;
  photoUrls: string[];
  resolutionType: 'return' | 'exchange';
  exchangeVariant?: string;
  packageDimensions?: { length: string; width: string; height: string; weight: string };
}

type Step = 'lookup' | 'select_items' | 'confirm' | 'success';

interface PortalState {
  step: Step;
  loading: boolean;
  error: string | null;
  // Lookup
  orderNumber: string;
  email: string;
  // Order data
  order: OrderInfo | null;
  items: OrderItem[];
  // Selection
  selectedItems: Map<string, SelectedItem>;
  uploadingFor: string | null; // item id currently uploading for
  // Result
  referenceId: string | null;
  resultStatus: string | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getScriptInfo(): { backendUrl: string; brandSlug: string; noHeader: boolean } {
  const scripts = document.querySelectorAll('script[src]');
  let backendUrl = '';
  let brandSlug = '';
  let noHeader = false;

  for (const script of scripts) {
    const el = script as HTMLScriptElement;
    if (el.src.includes('returns-portal')) {
      try {
        backendUrl = new URL(el.src).origin;
      } catch { /* ignore */ }
      brandSlug = el.getAttribute('data-brand') || '';
      noHeader = el.hasAttribute('data-no-header');
      break;
    }
  }

  return { backendUrl: backendUrl || 'http://localhost:3001', brandSlug, noHeader };
}

function escapeHtml(text: string): string {
  const el = document.createElement('span');
  el.textContent = text;
  return el.innerHTML;
}

const DEFAULT_RETURN_REASONS = [
  { value: 'defective', label: 'Defective / Damaged' },
  { value: 'wrong_item', label: 'Wrong Item Received' },
  { value: 'not_as_described', label: 'Not as Described' },
  { value: 'changed_mind', label: 'Changed My Mind' },
  { value: 'too_small', label: 'Too Small' },
  { value: 'too_large', label: 'Too Large' },
  { value: 'other', label: 'Other' },
];

function debugPost(type: string, data?: Record<string, unknown>): void {
  if (window.__SRP_DEBUG && window.parent !== window) {
    window.parent.postMessage({ type: `srp:${type}`, data }, '*');
  }
}

// ── SVG Icons ────────────────────────────────────────────────────────────────

const ICONS = {
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>',
  checkCircle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
  arrowLeft: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M19 12H5"/><polyline points="12 19 5 12 12 5"/></svg>',
  upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
  schedule: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
};

// ── Portal Renderer ──────────────────────────────────────────────────────────

function createPortal(container: HTMLElement, backendUrl: string, brandSlug: string, design: BrandDesign, portalConfig: PortalConfig | null, noHeader: boolean): void {
  const returnReasons = portalConfig?.settings?.available_reasons
    ? portalConfig.settings.available_reasons.map((slug) => ({
        value: slug,
        label: portalConfig.settings!.reason_labels[slug] || slug.replace(/_/g, ' '),
      }))
    : DEFAULT_RETURN_REASONS;

  const portalTitle = portalConfig?.settings?.portal_title || 'Start a Return';
  const portalDescription = portalConfig?.settings?.portal_description || 'We make returns and exchanges simple. Enter your order details to get started.';
  const btnTextLookup = design.buttonTextLookup || 'Find My Order';
  const btnTextContinue = design.buttonTextContinue || 'Continue to Review';
  const btnTextSubmit = design.buttonTextSubmit || 'Submit Return Request';
  const stepLabelsList = design.stepLabels || ['Find Order', 'Select Items', 'Confirm'];
  const successTitle = design.successTitle || 'Return Request Submitted';
  const successMessage = design.successMessage || 'Your return request has been received.';
  const successBtnText = design.successButtonText || 'Continue Shopping';
  const returnWindowDays = portalConfig?.settings?.return_window_days || 30;

  const availableResolutions = portalConfig?.settings?.available_resolutions || ['refund', 'store_credit', 'exchange'];
  const hasExchangeOption = availableResolutions.includes('exchange');
  const requirePhotosForReasons = portalConfig?.settings?.require_photos_for_reasons || [];
  const dimensionCollectionEnabled = portalConfig?.settings?.dimension_collection_enabled ?? false;
  const collectDimensionsForReasons = portalConfig?.settings?.collect_dimensions_for_reasons || [];

  debugPost('config_loaded', { settings: portalConfig?.settings || null });
  const state: PortalState = {
    step: 'lookup',
    loading: false,
    error: null,
    orderNumber: '',
    email: '',
    order: null,
    items: [],
    selectedItems: new Map(),
    uploadingFor: null,
    referenceId: null,
    resultStatus: null,
  };

  const brandParam = brandSlug ? `?brand=${brandSlug}` : '';

  // ── Step title map ──
  function getStepTitle(): string {
    if (state.step === 'lookup') return portalTitle;
    if (state.step === 'select_items') return 'Select Items';
    if (state.step === 'confirm') return 'Review & Submit';
    return '';
  }

  function getStepSubtitle(): string {
    if (state.step === 'lookup') return portalDescription;
    if (state.step === 'select_items') return 'Choose the items you\'d like to return or exchange.';
    if (state.step === 'confirm') return 'Please review your return details before submitting.';
    return '';
  }

  // ── Progress Bar ──
  function progressHtml(): string {
    const steps: Array<{ num: number; label: string; key: Step }> = [
      { num: 1, label: stepLabelsList[0] || 'Find Order', key: 'lookup' },
      { num: 2, label: stepLabelsList[1] || 'Select Items', key: 'select_items' },
      { num: 3, label: stepLabelsList[2] || 'Confirm', key: 'confirm' },
    ];
    const stepOrder: Step[] = ['lookup', 'select_items', 'confirm', 'success'];
    const currentIdx = stepOrder.indexOf(state.step);

    return `<div class="srp-progress">${steps.map((s, i) => {
      const isDone = currentIdx > stepOrder.indexOf(s.key);
      const isActive = state.step === s.key;
      const cls = isDone ? 'srp-progress__step--done' : isActive ? 'srp-progress__step--active' : '';
      const line = i < steps.length - 1
        ? `<div class="srp-progress__line${isDone ? ' srp-progress__line--done' : ''}"></div>`
        : '';
      const dotContent = isDone ? ICONS.check : `${s.num}`;
      return `<div class="srp-progress__step ${cls}">
        <div class="srp-progress__dot">${dotContent}</div>
        <span class="srp-progress__label">${s.label}</span>
      </div>${line}`;
    }).join('')}</div>`;
  }

  // ── Main Render ──
  function render(): void {
    if (state.step === 'success') {
      renderSuccess();
      return;
    }

    let content = '';
    if (state.step === 'lookup') content = renderLookup();
    else if (state.step === 'select_items') content = renderSelectItems();
    else if (state.step === 'confirm') content = renderConfirm();

    const headerHtml = noHeader ? '' : `
        <div class="srp-header">
          <div class="srp-eyebrow">Returns & Exchanges</div>
          <h2 class="srp-title">${escapeHtml(getStepTitle())}</h2>
          <p class="srp-subtitle">${escapeHtml(getStepSubtitle())}</p>
        </div>`;

    container.innerHTML = `
      <div class="srp-wrap">
        ${headerHtml}
        ${progressHtml()}
        <div class="srp-divider"></div>
        ${state.error ? `<div class="srp-error">${escapeHtml(state.error)}</div>` : ''}
        ${content}
      </div>`;

    bindEvents();
  }

  // ── Step 1: Find Order ──
  function renderLookup(): string {
    return `
      <div class="srp-row">
        <div class="srp-field">
          <label class="srp-label">Order Number <span class="srp-required">*</span></label>
          <input class="srp-input" id="srp-order" placeholder="#1001" value="${escapeHtml(state.orderNumber)}" />
        </div>
        <div class="srp-field">
          <label class="srp-label">Email Address <span class="srp-required">*</span></label>
          <input class="srp-input" id="srp-email" type="email" placeholder="you@email.com" value="${escapeHtml(state.email)}" />
        </div>
      </div>
      <button class="srp-btn srp-btn--primary" id="srp-lookup" ${state.loading ? 'disabled' : ''}>
        ${state.loading ? 'Looking up order...' : escapeHtml(btnTextLookup)}
      </button>
      <div class="srp-policy">
        <div class="srp-policy__icon">${ICONS.info}</div>
        <div class="srp-policy__text"><strong>${returnWindowDays}-Day Return Policy</strong> — Items must be in original condition with tags attached. Sale items and gift cards are final sale.</div>
      </div>`;
  }

  // ── Step 2: Select Items ──
  function renderSelectItems(): string {
    const order = state.order!;
    const orderDate = new Date(order.createdAt).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    });

    const itemsHtml = state.items.map((item) => {
      const isSelected = state.selectedItems.has(item.id);
      const selected = state.selectedItems.get(item.id);
      const cls = !item.eligible
        ? 'srp-item srp-item--ineligible'
        : isSelected
          ? 'srp-item srp-item--selected'
          : 'srp-item';

      const checkSvg = isSelected ? ICONS.check : '';

      // Image or placeholder
      const imageHtml = item.image
        ? `<img class="srp-item__image" src="${escapeHtml(item.image)}" alt="${escapeHtml(item.title)}" />`
        : `<div class="srp-item__image srp-item__image--placeholder">${ICONS.image}</div>`;

      let reasonSection = '';
      if (isSelected && selected) {
        const photoRequired = selected.reason && requirePhotosForReasons.includes(selected.reason);
        const hasPhotos = selected.photoUrls.length > 0;
        const isUploading = state.uploadingFor === item.id;

        // Resolution toggle (Return vs Exchange)
        const resolutionToggle = hasExchangeOption ? `
          <div class="srp-resolution-toggle">
            <button type="button" class="srp-resolution-btn ${selected.resolutionType === 'return' ? 'srp-resolution-btn--active' : ''}" data-resolution="${item.id}" data-type="return">Return</button>
            <button type="button" class="srp-resolution-btn ${selected.resolutionType === 'exchange' ? 'srp-resolution-btn--active' : ''}" data-resolution="${item.id}" data-type="exchange">Exchange</button>
          </div>
          ${selected.resolutionType === 'exchange' ? `
            <input class="srp-input srp-exchange-input" data-exchange-variant="${item.id}" placeholder="Preferred size/color/variant for exchange" value="${escapeHtml(selected.exchangeVariant || '')}" />
          ` : ''}` : '';

        // Photo upload section
        const photoThumbs = selected.photoUrls.map((url, idx) => `
          <div class="srp-upload-thumb">
            <img src="${escapeHtml(url)}" alt="Upload ${idx + 1}" />
            <button type="button" class="srp-upload-thumb__remove" data-remove-photo="${item.id}" data-photo-idx="${idx}">&times;</button>
          </div>`).join('');

        const uploadSection = `
          <div class="srp-upload-area">
            <span class="srp-upload-label">
              Photos${photoRequired ? '<span class="srp-upload-required">(required for this reason)</span>' : ' (optional)'}
            </span>
            ${photoThumbs ? `<div class="srp-upload-previews">${photoThumbs}</div>` : ''}
            <button type="button" class="srp-upload-btn ${isUploading ? 'srp-upload-btn--uploading' : ''}" data-upload-photo="${item.id}" ${isUploading ? 'disabled' : ''}>
              ${ICONS.upload}
              ${isUploading ? 'Uploading...' : 'Upload Photo'}
            </button>
          </div>`;

        // Package dimensions section
        const showDimensions = dimensionCollectionEnabled && selected.reason && collectDimensionsForReasons.includes(selected.reason);
        const dims = selected.packageDimensions || { length: '', width: '', height: '', weight: '' };
        const dimensionSection = showDimensions ? `
          <div class="srp-dimensions" style="margin-top:8px;padding:10px 12px;border-radius:6px;border:1px solid rgba(197,160,89,0.2);background:rgba(197,160,89,0.04);">
            <span class="srp-upload-label" style="display:block;margin-bottom:2px;">Package Dimensions <span class="srp-required">*</span></span>
            <span style="display:block;font-size:0.62rem;font-weight:300;color:rgba(45,51,56,0.5);margin-bottom:8px;">Used to generate a prepaid return label upon approval</span>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:6px;">
              <div>
                <label style="display:block;font-size:10px;color:var(--srp-text-secondary,#666);margin-bottom:2px;">Length (in)</label>
                <input class="srp-input" type="number" step="0.1" min="0" data-dim-field="${item.id}" data-dim-key="length" value="${escapeHtml(dims.length)}" placeholder="0" style="padding:6px 8px;font-size:13px;" />
              </div>
              <div>
                <label style="display:block;font-size:10px;color:var(--srp-text-secondary,#666);margin-bottom:2px;">Width (in)</label>
                <input class="srp-input" type="number" step="0.1" min="0" data-dim-field="${item.id}" data-dim-key="width" value="${escapeHtml(dims.width)}" placeholder="0" style="padding:6px 8px;font-size:13px;" />
              </div>
              <div>
                <label style="display:block;font-size:10px;color:var(--srp-text-secondary,#666);margin-bottom:2px;">Height (in)</label>
                <input class="srp-input" type="number" step="0.1" min="0" data-dim-field="${item.id}" data-dim-key="height" value="${escapeHtml(dims.height)}" placeholder="0" style="padding:6px 8px;font-size:13px;" />
              </div>
              <div>
                <label style="display:block;font-size:10px;color:var(--srp-text-secondary,#666);margin-bottom:2px;">Weight (lbs)</label>
                <input class="srp-input" type="number" step="0.1" min="0" data-dim-field="${item.id}" data-dim-key="weight" value="${escapeHtml(dims.weight)}" placeholder="0" style="padding:6px 8px;font-size:13px;" />
              </div>
            </div>
          </div>` : '';

        reasonSection = `
          <div class="srp-item-reason">
            ${resolutionToggle}
            <label class="srp-label" style="margin-top:8px;">Reason <span class="srp-required">*</span></label>
            <select class="srp-select srp-reason-select" data-item-id="${item.id}">
              <option value="">Select a reason...</option>
              ${returnReasons.map(r => `<option value="${r.value}" ${selected.reason === r.value ? 'selected' : ''}>${r.label}</option>`).join('')}
            </select>
            <textarea class="srp-textarea" data-item-notes="${item.id}" placeholder="Additional details (optional)" rows="2">${escapeHtml(selected.notes || '')}</textarea>
            ${uploadSection}
            ${dimensionSection}
          </div>`;
      }

      return `
        <div class="${cls}" data-item-toggle="${item.eligible ? item.id : ''}">
          <div class="srp-item__check">${checkSvg}</div>
          ${imageHtml}
          <div class="srp-item__info">
            <div class="srp-item__row">
              <div>
                <div class="srp-item__title">${escapeHtml(item.title)}</div>
                ${item.variantTitle ? `<div class="srp-item__variant">${escapeHtml(item.variantTitle)}</div>` : ''}
                <div class="srp-item__meta">
                  <span>Qty: ${item.quantity}</span>
                </div>
              </div>
              <div class="srp-item__price">${item.price}</div>
            </div>
            ${!item.eligible ? `<div class="srp-item__ineligible-reason">${escapeHtml(item.eligibility_reason || 'Not eligible for return')}</div>` : ''}
            ${reasonSection}
          </div>
        </div>`;
    }).join('');

    const hasSelection = state.selectedItems.size > 0;
    const allValid = Array.from(state.selectedItems.values()).every(si => {
      if (!si.reason) return false;
      // Check photo requirement
      if (requirePhotosForReasons.includes(si.reason) && si.photoUrls.length === 0) return false;
      // Check exchange variant
      if (si.resolutionType === 'exchange' && !si.exchangeVariant?.trim()) return false;
      return true;
    });

    return `
      <button class="srp-back" id="srp-back-lookup">
        ← Back
      </button>
      <div class="srp-order-bar">
        <span class="srp-order-bar__left">Order ${escapeHtml(order.name)}</span>
        <span class="srp-order-bar__right">${orderDate} · ${escapeHtml(order.fulfillmentStatus || 'Processing')}</span>
      </div>
      <div class="srp-section-label">Select items to return or exchange</div>
      <div class="srp-items">${itemsHtml}</div>
      <button class="srp-btn srp-btn--primary" id="srp-continue" ${!hasSelection || !allValid ? 'disabled' : ''}>
        ${escapeHtml(btnTextContinue)}
      </button>`;
  }

  // ── Step 3: Confirm ──
  function renderConfirm(): string {
    const order = state.order!;
    const items = Array.from(state.selectedItems.values());

    // Calculate estimated refund with restocking fee
    const feePercent = portalConfig?.settings?.restocking_fee_percent ?? 20;
    const exemptReasons = portalConfig?.settings?.restocking_fee_exempt_reasons ?? ['defective', 'wrong_item', 'not_as_described'];

    let subtotal = 0;
    let totalFee = 0;
    for (const item of items) {
      const orig = state.items.find(i => i.id === item.lineItemId);
      if (!orig) continue;
      const price = parseFloat(orig.price.replace(/[^0-9.]/g, ''));
      if (isNaN(price)) continue;
      const lineTotal = price * item.quantity;
      subtotal += lineTotal;
      // Exempt reasons get full refund, others get restocking fee
      if (!exemptReasons.includes(item.reason)) {
        totalFee += lineTotal * (feePercent / 100);
      }
    }
    const totalRefund = subtotal - totalFee;

    const itemsHtml = items.map(item => {
      const reasonLabel = returnReasons.find(r => r.value === item.reason)?.label || item.reason;
      const resLabel = item.resolutionType === 'exchange' ? 'Exchange' : 'Return';
      const exchangeInfo = item.resolutionType === 'exchange' && item.exchangeVariant
        ? ` → ${escapeHtml(item.exchangeVariant)}`
        : '';
      const photoCount = item.photoUrls.length > 0 ? ` · ${item.photoUrls.length} photo(s)` : '';
      return `
        <div class="srp-summary-item">
          <div>
            <div class="srp-summary-item__name">${escapeHtml(item.title)}${item.variantTitle ? ` — ${escapeHtml(item.variantTitle)}` : ''}<span class="srp-summary-item__badge">${escapeHtml(resLabel)}</span></div>
            <div class="srp-summary-item__reason">${escapeHtml(reasonLabel)}${exchangeInfo}${item.notes ? ` — ${escapeHtml(item.notes)}` : ''}${photoCount}</div>
          </div>
          <div class="srp-summary-item__qty">x${item.quantity}</div>
        </div>`;
    }).join('');

    return `
      <button class="srp-back" id="srp-back-items">
        ← Back
      </button>
      <div class="srp-summary-card">
        <div class="srp-summary-card__label">Return Summary</div>
        ${itemsHtml}
      </div>
      <div class="srp-refund-card">
        <div class="srp-refund-row">
          <span class="srp-refund-row__label">Item Total</span>
          <span class="srp-refund-row__value">$${subtotal.toFixed(2)}</span>
        </div>
        ${totalFee > 0 ? `
        <div class="srp-refund-row">
          <span class="srp-refund-row__label">Restocking Fee (${feePercent}%)</span>
          <span class="srp-refund-row__value" style="color:#dc2626;">−$${totalFee.toFixed(2)}</span>
        </div>` : ''}
        <div class="srp-refund-row">
          <span class="srp-refund-row__label">Estimated Refund</span>
          <span class="srp-refund-row__value srp-refund-row__value--large">$${totalRefund.toFixed(2)}</span>
        </div>
        <div class="srp-refund-row">
          <span class="srp-refund-row__label">Refund Method</span>
          <span class="srp-refund-row__value">Original payment method</span>
        </div>
        <div class="srp-refund-row">
          <span class="srp-refund-row__label">Return Shipping</span>
          <span class="srp-refund-row__value srp-refund-row__value--gold">Free</span>
        </div>
      </div>
      ${totalFee > 0 ? `
      <div class="srp-notice" style="border-color:rgba(197,160,89,0.2);">
        <div class="srp-notice__icon">${ICONS.info}</div>
        <div class="srp-notice__text">A ${feePercent}% restocking fee applies to items returned for reasons other than damage, defect, or wrong item received.</div>
      </div>` : ''}
      <div class="srp-notice">
        <div class="srp-notice__icon">${ICONS.schedule}</div>
        <div class="srp-notice__text">Refunds are typically processed within 5–10 business days after we receive your return.</div>
      </div>
      <button class="srp-btn srp-btn--dark" id="srp-submit" ${state.loading ? 'disabled' : ''}>
        ${state.loading ? 'Submitting...' : escapeHtml(btnTextSubmit)}
      </button>`;
  }

  // ── Success ──
  function renderSuccess(): void {
    const refId = state.referenceId || '';
    const shortRef = refId.slice(0, 8).toUpperCase();
    const statusLabel = state.resultStatus === 'approved'
      ? 'Approved'
      : state.resultStatus === 'denied'
        ? 'Denied'
        : 'Under Review';

    // Calculate refund from selected items with restocking fee
    const feePercent = portalConfig?.settings?.restocking_fee_percent ?? 20;
    const exemptReasons = portalConfig?.settings?.restocking_fee_exempt_reasons ?? ['defective', 'wrong_item', 'not_as_described'];
    let subtotal = 0;
    let totalFee = 0;
    for (const item of Array.from(state.selectedItems.values())) {
      const orig = state.items.find(i => i.id === item.lineItemId);
      if (!orig) continue;
      const price = parseFloat(orig.price.replace(/[^0-9.]/g, ''));
      if (isNaN(price)) continue;
      const lineTotal = price * item.quantity;
      subtotal += lineTotal;
      if (!exemptReasons.includes(item.reason)) {
        totalFee += lineTotal * (feePercent / 100);
      }
    }
    const totalRefund = subtotal - totalFee;

    container.innerHTML = `
      <div class="srp-wrap">
        <div class="srp-success">
          <div class="srp-success__icon-row">
            <div class="srp-success__icon-line"></div>
            <div class="srp-success__icon">${ICONS.checkCircle}</div>
            <div class="srp-success__icon-line"></div>
          </div>
          <div class="srp-success__title">${escapeHtml(successTitle)}</div>
          <div class="srp-success__subtitle">
            ${escapeHtml(successMessage)} A prepaid shipping label has been sent to <strong>${escapeHtml(state.email)}</strong>.
          </div>
          <div class="srp-success__details">
            <div class="srp-success__detail-row">
              <span class="srp-success__detail-label">Return ID</span>
              <span class="srp-success__detail-value">#${escapeHtml(shortRef)}</span>
            </div>
            <div class="srp-success__detail-row">
              <span class="srp-success__detail-label">Status</span>
              <span class="srp-success__detail-value">${escapeHtml(statusLabel)}</span>
            </div>
            <div class="srp-success__detail-row">
              <span class="srp-success__detail-label">Refund Amount</span>
              <span class="srp-success__detail-value">$${totalRefund.toFixed(2)}</span>
            </div>
            <div class="srp-success__detail-row">
              <span class="srp-success__detail-label">Estimated Refund</span>
              <span class="srp-success__detail-value">5–10 business days</span>
            </div>
          </div>
          <div class="srp-success__buttons">
            <button class="srp-btn srp-btn--dark" id="srp-new">${escapeHtml(successBtnText)}</button>
            <button class="srp-btn srp-btn--outline" id="srp-track">Track Return</button>
          </div>
        </div>
      </div>`;

    container.querySelector('#srp-new')?.addEventListener('click', () => {
      state.step = 'lookup';
      state.order = null;
      state.items = [];
      state.selectedItems = new Map();
      state.uploadingFor = null;
      state.orderNumber = '';
      state.email = '';
      state.referenceId = null;
      state.resultStatus = null;
      state.error = null;
      render();
    });

    container.querySelector('#srp-track')?.addEventListener('click', () => {
      // Track return — could navigate or open a tracking view in future
      // For now, just scroll to top or do nothing
    });
  }

  // ── Event Binding ──
  function bindEvents(): void {
    // Lookup step
    const lookupBtn = container.querySelector('#srp-lookup');
    lookupBtn?.addEventListener('click', handleLookup);

    const orderInput = container.querySelector('#srp-order') as HTMLInputElement | null;
    const emailInput = container.querySelector('#srp-email') as HTMLInputElement | null;
    orderInput?.addEventListener('input', () => { state.orderNumber = orderInput.value; });
    emailInput?.addEventListener('input', () => { state.email = emailInput.value; });

    // Allow Enter to submit lookup
    [orderInput, emailInput].forEach(el => {
      el?.addEventListener('keydown', (e) => {
        if ((e as KeyboardEvent).key === 'Enter') handleLookup();
      });
    });

    // Select items step
    container.querySelector('#srp-back-lookup')?.addEventListener('click', () => {
      state.step = 'lookup';
      state.error = null;
      render();
    });

    // Item toggles
    container.querySelectorAll('[data-item-toggle]').forEach(el => {
      const itemId = (el as HTMLElement).dataset.itemToggle;
      if (!itemId) return;
      el.addEventListener('click', (e) => {
        // Don't toggle if clicking inside reason section
        const target = e.target as HTMLElement;
        if (target.closest('.srp-item-reason')) return;

        if (state.selectedItems.has(itemId)) {
          state.selectedItems.delete(itemId);
        } else {
          const item = state.items.find(i => i.id === itemId);
          if (item) {
            state.selectedItems.set(itemId, {
              lineItemId: itemId,
              title: item.title,
              variantTitle: item.variantTitle,
              quantity: item.quantity,
              reason: '',
              photoUrls: [],
              resolutionType: 'return',
            });
          }
        }
        render();
      });
    });

    // Reason selects
    container.querySelectorAll('.srp-reason-select').forEach(el => {
      el.addEventListener('change', (e) => {
        const select = e.target as HTMLSelectElement;
        const itemId = select.dataset.itemId!;
        const selected = state.selectedItems.get(itemId);
        if (selected) {
          selected.reason = select.value;
          // Re-render to show/hide photo requirement
          render();
        }
      });
    });

    // Notes textareas
    container.querySelectorAll('[data-item-notes]').forEach(el => {
      el.addEventListener('input', (e) => {
        const textarea = e.target as HTMLTextAreaElement;
        const itemId = textarea.dataset.itemNotes!;
        const selected = state.selectedItems.get(itemId);
        if (selected) selected.notes = textarea.value;
      });
    });

    // Resolution toggle buttons
    container.querySelectorAll('[data-resolution]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const btn = e.currentTarget as HTMLElement;
        const itemId = btn.dataset.resolution!;
        const type = btn.dataset.type as 'return' | 'exchange';
        const selected = state.selectedItems.get(itemId);
        if (selected) {
          selected.resolutionType = type;
          if (type !== 'exchange') selected.exchangeVariant = undefined;
          render();
        }
      });
    });

    // Exchange variant inputs
    container.querySelectorAll('[data-exchange-variant]').forEach(el => {
      el.addEventListener('click', (e) => e.stopPropagation());
      el.addEventListener('input', (e) => {
        const input = e.target as HTMLInputElement;
        const itemId = input.dataset.exchangeVariant!;
        const selected = state.selectedItems.get(itemId);
        if (selected) {
          selected.exchangeVariant = input.value;
          updateContinueButton();
        }
      });
    });

    // Photo upload buttons
    container.querySelectorAll('[data-upload-photo]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const btn = e.currentTarget as HTMLElement;
        const itemId = btn.dataset.uploadPhoto!;
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'image/jpeg,image/png,image/webp,image/gif';
        fileInput.multiple = true;
        fileInput.onchange = async () => {
          const files = fileInput.files;
          if (!files || files.length === 0) return;
          state.uploadingFor = itemId;
          render();

          for (const file of Array.from(files)) {
            try {
              const res = await fetch(`${backendUrl}/api/returns/upload${brandParam}`, {
                method: 'POST',
                headers: { 'Content-Type': file.type },
                body: file,
              });
              if (res.ok) {
                const data = await res.json();
                const selected = state.selectedItems.get(itemId);
                if (selected && data.url) {
                  selected.photoUrls.push(data.url);
                }
              }
            } catch {
              // silently skip failed uploads
            }
          }

          state.uploadingFor = null;
          render();
        };
        fileInput.click();
      });
    });

    // Photo remove buttons
    container.querySelectorAll('[data-remove-photo]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const btn = e.currentTarget as HTMLElement;
        const itemId = btn.dataset.removePhoto!;
        const idx = parseInt(btn.dataset.photoIdx || '0', 10);
        const selected = state.selectedItems.get(itemId);
        if (selected) {
          selected.photoUrls.splice(idx, 1);
          render();
        }
      });
    });

    // Dimension inputs
    container.querySelectorAll('[data-dim-field]').forEach(el => {
      el.addEventListener('click', (e) => e.stopPropagation());
      el.addEventListener('input', (e) => {
        const input = e.target as HTMLInputElement;
        const itemId = input.dataset.dimField!;
        const key = input.dataset.dimKey as 'length' | 'width' | 'height' | 'weight';
        const selected = state.selectedItems.get(itemId);
        if (selected) {
          if (!selected.packageDimensions) {
            selected.packageDimensions = { length: '', width: '', height: '', weight: '' };
          }
          selected.packageDimensions[key] = input.value;
        }
      });
    });

    // Continue button
    container.querySelector('#srp-continue')?.addEventListener('click', () => {
      const allValid = Array.from(state.selectedItems.values()).every(si => {
        if (!si.reason) return false;
        if (requirePhotosForReasons.includes(si.reason) && si.photoUrls.length === 0) return false;
        if (si.resolutionType === 'exchange' && !si.exchangeVariant?.trim()) return false;
        return true;
      });
      if (!allValid) {
        state.error = 'Please complete all required fields for each item.';
        render();
        return;
      }
      state.step = 'confirm';
      state.error = null;
      debugPost('step_change', { step: 'confirm' });
      render();
    });

    // Confirm step
    container.querySelector('#srp-back-items')?.addEventListener('click', () => {
      state.step = 'select_items';
      state.error = null;
      render();
    });

    container.querySelector('#srp-submit')?.addEventListener('click', handleSubmit);
  }

  function updateContinueButton(): void {
    const btn = container.querySelector('#srp-continue') as HTMLButtonElement | null;
    if (!btn) return;
    const hasSelection = state.selectedItems.size > 0;
    const allValid = Array.from(state.selectedItems.values()).every(si => {
      if (!si.reason) return false;
      if (requirePhotosForReasons.includes(si.reason) && si.photoUrls.length === 0) return false;
      if (si.resolutionType === 'exchange' && !si.exchangeVariant?.trim()) return false;
      return true;
    });
    btn.disabled = !hasSelection || !allValid;
  }

  async function handleLookup(): Promise<void> {
    const orderNum = state.orderNumber.trim().replace(/^#/, '');
    const email = state.email.trim();

    if (!orderNum || !email) {
      state.error = 'Please enter both your order number and email address.';
      render();
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      state.error = 'Please enter a valid email address.';
      render();
      return;
    }

    state.loading = true;
    state.error = null;
    render();

    // Debug mode: use mock data, skip real API
    if (window.__SRP_DEBUG) {
      state.order = {
        id: 'gid://shopify/Order/mock-001',
        name: `#${orderNum || '1042'}`,
        createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
        financialStatus: 'PAID',
        fulfillmentStatus: 'FULFILLED',
      };
      state.items = [
        { id: 'mock-li-1', title: 'Classic Crew-Neck Tee', variantTitle: 'Black / M', quantity: 1, price: '$34.99', image: '', eligible: true },
        { id: 'mock-li-2', title: 'Slim Joggers', variantTitle: 'Navy / L', quantity: 1, price: '$64.99', image: '', eligible: true },
        { id: 'mock-li-3', title: 'Limited Edition Cap', quantity: 1, price: '$24.99', image: '', eligible: false, eligibility_reason: 'Final sale item — not eligible for return' },
      ];
      state.selectedItems = new Map();
      state.step = 'select_items';
      state.loading = false;

      debugPost('order_loaded', {
        order_name: state.order.name,
        item_count: state.items.length,
        eligible_count: state.items.filter((i) => i.eligible).length,
        mock: true,
      });
      debugPost('step_change', { step: 'select_items' });
      render();
      return;
    }

    try {
      const res = await fetch(
        `${backendUrl}/api/returns/lookup?order_number=${encodeURIComponent(orderNum)}&email=${encodeURIComponent(email)}${brandParam ? '&' + brandParam.slice(1) : ''}`,
      );

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Order not found' }));
        state.error = data.error || 'Order not found. Please check your order number and email.';
        state.loading = false;
        render();
        return;
      }

      const data = await res.json();
      state.order = data.order;
      state.items = data.items || [];
      state.selectedItems = new Map();
      state.step = 'select_items';
      state.loading = false;

      debugPost('order_loaded', {
        order_name: data.order?.name,
        item_count: state.items.length,
        eligible_count: state.items.filter((i: OrderItem) => i.eligible).length,
      });
      debugPost('step_change', { step: 'select_items' });

      if (state.items.length === 0) {
        state.error = 'No items found in this order.';
        state.step = 'lookup';
      } else if (!state.items.some(i => i.eligible)) {
        state.error = 'This order is not yet eligible for return. If your order hasn\u0027t shipped yet, you can reach out to our support team via the chat for assistance with changes or cancellations.';
        state.step = 'lookup';
      }

      render();
    } catch {
      state.error = 'Network error. Please check your connection and try again.';
      state.loading = false;
      render();
    }
  }

  async function handleSubmit(): Promise<void> {
    state.loading = true;
    state.error = null;
    render();

    // Debug mode: mock submission result
    if (window.__SRP_DEBUG) {
      const mockRefId = 'dbg-' + Math.random().toString(36).slice(2, 10);
      state.referenceId = mockRefId;
      state.resultStatus = 'approved';
      state.step = 'success';
      state.loading = false;

      debugPost('submit_result', {
        status: 'approved',
        ref_id: mockRefId,
        mock: true,
        ai_recommendation: { decision: 'approve', confidence: 0.92, reasoning: 'Debug mock — auto-approved', suggested_resolution: 'refund' },
      });
      debugPost('step_change', { step: 'success' });
      render();
      return;
    }

    const items = Array.from(state.selectedItems.values()).map(si => ({
      line_item_id: si.lineItemId,
      product_title: si.title,
      variant_title: si.variantTitle || null,
      quantity: si.quantity,
      reason: si.reason,
      customer_note: si.notes || null,
      photo_urls: si.photoUrls.length > 0 ? si.photoUrls : null,
      resolution_type: si.resolutionType === 'exchange' ? 'exchange' : null,
      exchange_variant: si.resolutionType === 'exchange' ? si.exchangeVariant || null : null,
    }));

    // Determine overall resolution type
    const hasExchange = items.some(i => i.resolution_type === 'exchange');
    const allExchange = items.every(i => i.resolution_type === 'exchange');

    // Collect package dimensions from items that have them
    const allSelectedItems = Array.from(state.selectedItems.values());
    const firstDims = allSelectedItems.find(si => si.packageDimensions && (si.packageDimensions.length || si.packageDimensions.width || si.packageDimensions.height || si.packageDimensions.weight));
    const packageDimensions = firstDims?.packageDimensions ? {
      length: parseFloat(firstDims.packageDimensions.length) || 0,
      width: parseFloat(firstDims.packageDimensions.width) || 0,
      height: parseFloat(firstDims.packageDimensions.height) || 0,
      weight: parseFloat(firstDims.packageDimensions.weight) || 0,
    } : null;

    try {
      const res = await fetch(`${backendUrl}/api/returns/submit${brandParam}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_id: state.order!.id,
          order_number: state.order!.name,
          customer_email: state.email.trim(),
          customer_name: null,
          resolution_type: allExchange ? 'exchange' : hasExchange ? 'exchange' : null,
          items,
          package_dimensions: packageDimensions,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        state.error = data.error || 'Failed to submit return request. Please try again.';
        state.loading = false;
        render();
        return;
      }

      state.referenceId = data.return_request?.id || '';
      state.resultStatus = data.status || 'pending_review';
      state.step = 'success';
      state.loading = false;

      debugPost('submit_result', {
        status: data.status,
        ref_id: state.referenceId,
        ai_recommendation: data.return_request?.ai_recommendation || null,
      });
      debugPost('step_change', { step: 'success' });

      render();
    } catch {
      state.error = 'Network error. Please check your connection and try again.';
      state.loading = false;
      render();
    }
  }

  render();

  // Listen for live design updates from parent (admin Portal Design page)
  window.addEventListener('message', (event) => {
    if (event.data?.type === 'srp:design_update' && event.data.design) {
      const newDesign: BrandDesign = { ...design, ...event.data.design };
      Object.assign(design, newDesign);
      render();
    }
  });
}

// ── Init ─────────────────────────────────────────────────────────────────────

async function init(): Promise<void> {
  const { backendUrl, brandSlug, noHeader } = getScriptInfo();

  // Check for inlined config (from playground HTML) to avoid network round-trip
  const inlinedConfig = (window as unknown as Record<string, unknown>).__SRP_CONFIG as {
    widgetDesign?: Partial<BrandDesign>;
    portalConfig?: PortalConfig;
  } | undefined;

  // Start with defaults
  let design: BrandDesign = {
    primaryColor: '#C5A059',
    backgroundColor: '#F9F9FB',
    borderRadius: 'sharp',
    fontSize: 'medium',
  };

  let portalConfig: PortalConfig | null = null;

  // If inlined config is available, use it immediately — no fetch needed
  if (inlinedConfig) {
    if (inlinedConfig.widgetDesign) {
      design = { ...design, ...inlinedConfig.widgetDesign };
    }
    if (inlinedConfig.portalConfig) {
      portalConfig = inlinedConfig.portalConfig;
      if (portalConfig?.design) {
        design = { ...design, ...portalConfig.design };
      }
    }
  }

  debugPost('step_change', { step: 'lookup' });

  // Find or create container
  const container = document.getElementById('returns-portal') || (() => {
    const el = document.createElement('div');
    el.id = 'returns-portal';
    document.body.appendChild(el);
    return el;
  })();

  // Render immediately with current config (defaults or inlined)
  createPortal(container, backendUrl, brandSlug, design, portalConfig, noHeader);

  // If no inlined config, fetch in background and re-render with updated config
  if (!inlinedConfig) {
    const brandParam = brandSlug ? '?brand=' + brandSlug : '';
    Promise.all([
      fetch(`${backendUrl}/api/widget/config${brandParam}`).catch(() => null),
      fetch(`${backendUrl}/api/returns/portal-config${brandParam}`).catch(() => null),
    ]).then(async ([widgetRes, portalRes]) => {
      let updated = false;

      if (widgetRes?.ok) {
        try {
          const data = await widgetRes.json();
          if (data.design) {
            Object.assign(design, data.design);
            updated = true;
          }
        } catch { /* ignore */ }
      }

      if (portalRes?.ok) {
        try {
          portalConfig = await portalRes.json();
          if (portalConfig?.design) {
            Object.assign(design, portalConfig.design);
            updated = true;
          }
        } catch { /* ignore */ }
      }

      if (updated) {
        // Re-render with fetched config
        container.innerHTML = '';
        createPortal(container, backendUrl, brandSlug, design, portalConfig, noHeader);
      }
    }).catch(() => { /* use defaults */ });
  }
}

// Expose init globally so the playground debug toggle can re-init
(window as unknown as Record<string, unknown>).init = init;

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
// build trigger 1774332247
