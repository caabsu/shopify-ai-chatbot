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

function radiusValue(r: string): string {
  if (r === 'sharp') return '4px';
  if (r === 'pill') return '24px';
  return '12px';
}

function fontSizeBase(f: string): string {
  if (f === 'small') return '13px';
  if (f === 'large') return '16px';
  return '14px';
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function isLightColor(hex: string): boolean {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 128;
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

// ── Styles ───────────────────────────────────────────────────────────────────

function buildStyles(d: BrandDesign): string {
  const radius = radiusValue(d.borderRadius);
  const baseFontSize = fontSizeBase(d.fontSize);
  const primary = d.primaryColor;
  const bg = d.backgroundColor;
  const bodyFont = d.fontFamily || "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
  const headingFont = d.headingFontFamily || bodyFont;
  const btnTextColor = isLightColor(primary) ? '#1a1a1a' : '#ffffff';
  const inputBorder = isLightColor(bg) ? '#d1d5db' : '#4a4a4a';
  const inputBg = isLightColor(bg) ? '#ffffff' : hexToRgba('#ffffff', 0.08);
  const textColor = isLightColor(bg) ? '#1a1a1a' : '#f5f5f5';
  const subtextColor = isLightColor(bg) ? '#6b7280' : '#a0a0a0';
  const labelColor = isLightColor(bg) ? '#374151' : '#d1d5db';
  const focusRing = hexToRgba(primary, 0.2);
  const cardBorder = isLightColor(bg) ? '#e5e7eb' : '#3a3a3a';

  return `
.srp-wrap {
  max-width: 100%;
  margin: 0 auto;
  font-family: ${bodyFont} !important;
  font-size: ${baseFontSize} !important;
  color: ${textColor};
  line-height: 1.55;
}
.srp-wrap *, .srp-wrap *::before, .srp-wrap *::after { box-sizing: border-box; margin: 0; padding: 0; }

/* ── Header ── */
.srp-header { margin-bottom: 1.75rem; }
.srp-title {
  font-family: ${headingFont} !important;
  font-size: 1.65rem !important;
  font-weight: 700 !important;
  color: ${textColor};
  margin-bottom: 0.4rem;
  letter-spacing: -0.01em;
}
.srp-subtitle {
  font-size: 0.92em;
  color: ${subtextColor};
}

/* ── Steps indicator ── */
.srp-steps {
  display: flex;
  align-items: center;
  gap: 0;
  margin-bottom: 2rem;
}
.srp-step {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.8em;
  color: ${subtextColor};
  font-weight: 500;
}
.srp-step--active { color: ${primary}; font-weight: 600; }
.srp-step--done { color: ${primary}; }
.srp-step__num {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.8em;
  font-weight: 700;
  border: 2px solid ${cardBorder};
  color: ${subtextColor};
  flex-shrink: 0;
}
.srp-step--active .srp-step__num {
  background: ${primary};
  color: ${btnTextColor};
  border-color: ${primary};
}
.srp-step--done .srp-step__num {
  background: ${primary};
  color: ${btnTextColor};
  border-color: ${primary};
}
.srp-step__line {
  flex: 1;
  height: 2px;
  background: ${cardBorder};
  margin: 0 12px;
}
.srp-step--done + .srp-step__line,
.srp-step__line--done { background: ${primary}; }

/* ── Form fields ── */
.srp-field { margin-bottom: 1.1rem; }
.srp-label {
  display: block;
  font-size: 0.85em !important;
  font-weight: 600 !important;
  margin-bottom: 0.35rem;
  color: ${labelColor};
}
.srp-required { color: ${primary}; margin-left: 2px; }
.srp-input, .srp-select, .srp-textarea {
  width: 100%;
  padding: 0.65rem 0.85rem;
  font-size: 0.92em !important;
  font-family: ${bodyFont} !important;
  border: 1.5px solid ${inputBorder} !important;
  border-radius: ${radius} !important;
  background: ${inputBg} !important;
  color: ${textColor} !important;
  text-transform: none !important;
  transition: border-color 0.2s, box-shadow 0.2s;
}
.srp-input::placeholder, .srp-textarea::placeholder {
  color: ${subtextColor};
  opacity: 0.7;
}
.srp-input:focus, .srp-select:focus, .srp-textarea:focus {
  outline: none;
  border-color: ${primary};
  box-shadow: 0 0 0 3px ${focusRing};
}
.srp-textarea { resize: vertical; min-height: 80px; }
.srp-row { display: flex; gap: 1rem; }
.srp-row .srp-field { flex: 1; }
@media (max-width: 480px) {
  .srp-row { flex-direction: column; gap: 0; }
}

/* ── Buttons ── */
.srp-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0.7rem 1.5rem;
  font-size: 0.92em !important;
  font-weight: 600 !important;
  font-family: ${headingFont} !important;
  border: none;
  border-radius: ${radius} !important;
  cursor: pointer;
  transition: opacity 0.2s, transform 0.1s;
  letter-spacing: 0.01em;
  text-transform: none !important;
}
.srp-btn:hover { opacity: 0.9; }
.srp-btn:active { transform: scale(0.99); }
.srp-btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
.srp-btn--primary {
  background: ${primary} !important;
  color: ${btnTextColor} !important;
  width: 100%;
}
.srp-btn--secondary {
  background: transparent !important;
  color: ${primary} !important;
  border: 1.5px solid ${primary} !important;
}
.srp-btn--secondary:hover {
  background: ${hexToRgba(primary, 0.08)};
}

/* ── Item cards ── */
.srp-items { display: flex; flex-direction: column; gap: 12px; margin-bottom: 1.5rem; }
.srp-item {
  display: flex;
  gap: 14px;
  padding: 14px;
  border: 1.5px solid ${cardBorder};
  border-radius: ${radius};
  transition: border-color 0.2s, background 0.2s;
}
.srp-item--selected {
  border-color: ${primary};
  background: ${hexToRgba(primary, 0.04)};
}
.srp-item--ineligible {
  opacity: 0.5;
}
.srp-item__check {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  border: 2px solid ${inputBorder};
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
  margin-top: 2px;
}
.srp-item--selected .srp-item__check {
  background: ${primary};
  border-color: ${primary};
}
.srp-item--ineligible .srp-item__check {
  cursor: not-allowed;
}
.srp-item__check svg { width: 14px; height: 14px; color: ${btnTextColor}; }
.srp-item__info { flex: 1; min-width: 0; }
.srp-item__title {
  font-weight: 600;
  font-size: 0.95em;
  margin-bottom: 2px;
}
.srp-item__variant {
  font-size: 0.82em;
  color: ${subtextColor};
}
.srp-item__meta {
  display: flex;
  gap: 12px;
  font-size: 0.82em;
  color: ${subtextColor};
  margin-top: 4px;
}
.srp-item__ineligible-reason {
  font-size: 0.8em;
  color: #dc2626;
  margin-top: 4px;
}

/* ── Item reason (collapsible) ── */
.srp-item-reason {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid ${cardBorder};
}
.srp-item-reason .srp-select,
.srp-item-reason .srp-textarea {
  margin-top: 6px;
}

/* ── Error ── */
.srp-error {
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #991b1b;
  padding: 0.7rem 1rem;
  border-radius: ${radius};
  font-size: 0.85em;
  margin-bottom: 1rem;
}

/* ── Order summary card ── */
.srp-order-card {
  padding: 14px 16px;
  background: ${hexToRgba(primary, 0.05)};
  border: 1px solid ${hexToRgba(primary, 0.15)};
  border-radius: ${radius};
  margin-bottom: 1.5rem;
  font-size: 0.9em;
}
.srp-order-card__title {
  font-weight: 700;
  margin-bottom: 4px;
}
.srp-order-card__detail {
  color: ${subtextColor};
  font-size: 0.88em;
}

/* ── Success ── */
.srp-success {
  text-align: center;
  padding: 2.5rem 2rem;
  background: ${hexToRgba(primary, 0.06)};
  border: 1.5px solid ${hexToRgba(primary, 0.15)};
  border-radius: ${radius};
}
.srp-success-icon {
  width: 56px;
  height: 56px;
  margin: 0 auto 1rem;
  background: ${primary};
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}
.srp-success-icon svg { width: 28px; height: 28px; color: ${btnTextColor}; }
.srp-success-title {
  font-family: ${headingFont};
  font-size: 1.3rem;
  font-weight: 700;
  color: ${textColor};
  margin-bottom: 0.5rem;
}
.srp-success-text {
  font-size: 0.92em;
  color: ${subtextColor};
  line-height: 1.6;
  margin-bottom: 0.3rem;
}
.srp-success-ref {
  font-weight: 700;
  color: ${primary};
  font-size: 1.1em;
}
.srp-success-status {
  display: inline-block;
  margin-top: 12px;
  padding: 4px 12px;
  border-radius: 999px;
  font-size: 0.8em;
  font-weight: 600;
  background: ${hexToRgba(primary, 0.12)};
  color: ${primary};
}

/* ── Confirm summary ── */
.srp-confirm-items { margin-bottom: 1.5rem; }
.srp-confirm-item {
  display: flex;
  justify-content: space-between;
  padding: 10px 0;
  border-bottom: 1px solid ${cardBorder};
  font-size: 0.9em;
}
.srp-confirm-item:last-child { border-bottom: none; }
.srp-confirm-item__reason {
  font-size: 0.82em;
  color: ${subtextColor};
}

/* ── Resolution toggle ── */
.srp-resolution-toggle {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}
.srp-resolution-btn {
  flex: 1;
  padding: 6px 10px;
  font-size: 0.82em;
  font-weight: 600;
  border: 1.5px solid ${cardBorder};
  border-radius: ${radius};
  background: transparent;
  color: ${subtextColor};
  cursor: pointer;
  transition: all 0.15s;
  text-align: center;
}
.srp-resolution-btn--active {
  border-color: ${primary};
  background: ${hexToRgba(primary, 0.08)};
  color: ${primary};
}
.srp-exchange-input {
  margin-top: 6px;
}

/* ── Image upload ── */
.srp-upload-area {
  margin-top: 8px;
}
.srp-upload-label {
  font-size: 0.82em;
  font-weight: 600;
  color: ${labelColor};
  margin-bottom: 4px;
  display: block;
}
.srp-upload-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  font-size: 0.82em;
  font-weight: 500;
  border: 1.5px dashed ${inputBorder};
  border-radius: ${radius};
  background: transparent;
  color: ${subtextColor};
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
}
.srp-upload-btn:hover {
  border-color: ${primary};
  color: ${primary};
}
.srp-upload-btn svg { width: 14px; height: 14px; }
.srp-upload-btn--uploading {
  opacity: 0.6;
  cursor: not-allowed;
}
.srp-upload-previews {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}
.srp-upload-thumb {
  position: relative;
  width: 60px;
  height: 60px;
  border-radius: 6px;
  overflow: hidden;
  border: 1px solid ${cardBorder};
}
.srp-upload-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.srp-upload-thumb__remove {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: rgba(0,0,0,0.6);
  color: #fff;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  line-height: 1;
  padding: 0;
}
.srp-upload-required {
  font-size: 0.78em;
  color: ${primary};
  font-weight: 500;
  margin-left: 4px;
}

/* ── Back link ── */
.srp-back {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.85em;
  color: ${subtextColor};
  cursor: pointer;
  margin-bottom: 1rem;
  background: none;
  border: none;
  font-family: ${bodyFont};
  transition: color 0.15s;
}
.srp-back:hover { color: ${textColor}; }
.srp-back svg { width: 16px; height: 16px; }
`;
}

// ── Portal Renderer ──────────────────────────────────────────────────────────

function createPortal(container: HTMLElement, backendUrl: string, brandSlug: string, design: BrandDesign, portalConfig: PortalConfig | null, noHeader: boolean): void {
  const returnReasons = portalConfig?.settings?.available_reasons
    ? portalConfig.settings.available_reasons.map((slug) => ({
        value: slug,
        label: portalConfig.settings!.reason_labels[slug] || slug.replace(/_/g, ' '),
      }))
    : DEFAULT_RETURN_REASONS;

  const portalTitle = portalConfig?.settings?.portal_title || 'Returns & Exchanges';
  const portalDescription = portalConfig?.settings?.portal_description || 'Start a return or exchange in just a few steps.';
  const btnTextLookup = design.buttonTextLookup || 'Find My Order';
  const btnTextContinue = design.buttonTextContinue || 'Continue to Review';
  const btnTextSubmit = design.buttonTextSubmit || 'Submit Return Request';
  const stepLabelsList = design.stepLabels || ['Find Order', 'Select Items', 'Confirm'];
  const successTitle = design.successTitle || 'Return Request Submitted';
  const successMessage = design.successMessage || 'Your return request has been received.';
  const successBtnText = design.successButtonText || 'Start Another Return';

  const availableResolutions = portalConfig?.settings?.available_resolutions || ['refund', 'store_credit', 'exchange'];
  const hasExchangeOption = availableResolutions.includes('exchange');
  const requirePhotosForReasons = portalConfig?.settings?.require_photos_for_reasons || [];

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

  // Inject styles
  if (!document.getElementById('srp-styles')) {
    const style = document.createElement('style');
    style.id = 'srp-styles';
    style.textContent = buildStyles(design);
    document.head.appendChild(style);
  }

  const brandParam = brandSlug ? `?brand=${brandSlug}` : '';

  function stepsHtml(): string {
    const steps: Array<{ num: number; label: string; key: Step }> = [
      { num: 1, label: stepLabelsList[0] || 'Find Order', key: 'lookup' },
      { num: 2, label: stepLabelsList[1] || 'Select Items', key: 'select_items' },
      { num: 3, label: stepLabelsList[2] || 'Confirm', key: 'confirm' },
    ];
    const stepOrder: Step[] = ['lookup', 'select_items', 'confirm', 'success'];
    const currentIdx = stepOrder.indexOf(state.step);

    return `<div class="srp-steps">${steps.map((s, i) => {
      const isDone = currentIdx > stepOrder.indexOf(s.key);
      const isActive = state.step === s.key;
      const cls = isDone ? 'srp-step--done' : isActive ? 'srp-step--active' : '';
      const line = i < steps.length - 1
        ? `<div class="srp-step__line${isDone ? ' srp-step__line--done' : ''}"></div>`
        : '';
      const checkSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>';
      return `<div class="srp-step ${cls}">
        <div class="srp-step__num">${isDone ? checkSvg : s.num}</div>
        <span>${s.label}</span>
      </div>${line}`;
    }).join('')}</div>`;
  }

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
          <h2 class="srp-title">${escapeHtml(portalTitle)}</h2>
          <p class="srp-subtitle">${escapeHtml(portalDescription)}</p>
        </div>`;

    container.innerHTML = `
      <div class="srp-wrap">
        ${headerHtml}
        ${stepsHtml()}
        ${state.error ? `<div class="srp-error">${escapeHtml(state.error)}</div>` : ''}
        ${content}
      </div>`;

    bindEvents();
  }

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
      </button>`;
  }

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

      const checkSvg = isSelected
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>'
        : '';

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
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              ${isUploading ? 'Uploading...' : 'Upload Photo'}
            </button>
          </div>`;

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
          </div>`;
      }

      return `
        <div class="${cls}" data-item-toggle="${item.eligible ? item.id : ''}">
          <div class="srp-item__check">${checkSvg}</div>
          <div class="srp-item__info">
            <div class="srp-item__title">${escapeHtml(item.title)}</div>
            ${item.variantTitle ? `<div class="srp-item__variant">${escapeHtml(item.variantTitle)}</div>` : ''}
            <div class="srp-item__meta">
              <span>Qty: ${item.quantity}</span>
              <span>${item.price}</span>
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
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M19 12H5"/><polyline points="12 19 5 12 12 5"/></svg>
        Back
      </button>
      <div class="srp-order-card">
        <div class="srp-order-card__title">Order ${escapeHtml(order.name)}</div>
        <div class="srp-order-card__detail">Placed ${orderDate} · ${escapeHtml(order.fulfillmentStatus || 'Processing')}</div>
      </div>
      <p class="srp-label" style="margin-bottom:10px;">Select items to return or exchange:</p>
      <div class="srp-items">${itemsHtml}</div>
      <button class="srp-btn srp-btn--primary" id="srp-continue" ${!hasSelection || !allValid ? 'disabled' : ''}>
        ${escapeHtml(btnTextContinue)}
      </button>`;
  }

  function renderConfirm(): string {
    const order = state.order!;
    const items = Array.from(state.selectedItems.values());

    const itemsHtml = items.map(item => {
      const reasonLabel = returnReasons.find(r => r.value === item.reason)?.label || item.reason;
      const resLabel = item.resolutionType === 'exchange' ? 'Exchange' : 'Return';
      const exchangeInfo = item.resolutionType === 'exchange' && item.exchangeVariant
        ? ` (want: ${escapeHtml(item.exchangeVariant)})`
        : '';
      const photoCount = item.photoUrls.length > 0 ? ` · ${item.photoUrls.length} photo(s)` : '';
      return `
        <div class="srp-confirm-item">
          <div>
            <div>${escapeHtml(item.title)}${item.variantTitle ? ` — ${escapeHtml(item.variantTitle)}` : ''}</div>
            <div class="srp-confirm-item__reason">${escapeHtml(resLabel)}${exchangeInfo} · ${escapeHtml(reasonLabel)}${item.notes ? ` — ${escapeHtml(item.notes)}` : ''}${photoCount}</div>
          </div>
          <div>x${item.quantity}</div>
        </div>`;
    }).join('');

    return `
      <button class="srp-back" id="srp-back-items">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M19 12H5"/><polyline points="12 19 5 12 12 5"/></svg>
        Back
      </button>
      <div class="srp-order-card">
        <div class="srp-order-card__title">Returning from Order ${escapeHtml(order.name)}</div>
        <div class="srp-order-card__detail">${escapeHtml(state.email)}</div>
      </div>
      <p class="srp-label" style="margin-bottom:6px;">Items to return/exchange:</p>
      <div class="srp-confirm-items">${itemsHtml}</div>
      <button class="srp-btn srp-btn--primary" id="srp-submit" ${state.loading ? 'disabled' : ''}>
        ${state.loading ? 'Submitting...' : escapeHtml(btnTextSubmit)}
      </button>`;
  }

  function renderSuccess(): void {
    const refId = state.referenceId || '';
    const shortRef = refId.slice(0, 8).toUpperCase();
    const statusLabel = state.resultStatus === 'approved'
      ? 'Approved'
      : state.resultStatus === 'denied'
        ? 'Denied'
        : 'Under Review';

    container.innerHTML = `
      <div class="srp-wrap">
        <div class="srp-success">
          <div class="srp-success-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          </div>
          <div class="srp-success-title">${escapeHtml(successTitle)}</div>
          <div class="srp-success-text">
            ${escapeHtml(successMessage)} Your reference number is:
          </div>
          <div class="srp-success-ref">#${escapeHtml(shortRef)}</div>
          <div class="srp-success-status">${escapeHtml(statusLabel)}</div>
          <div class="srp-success-text" style="margin-top:16px;">
            We've sent a confirmation email to <strong>${escapeHtml(state.email)}</strong>.
            ${state.resultStatus === 'approved' ? 'Your return has been approved — check your email for next steps.' : 'Our team will review your request and get back to you shortly.'}
          </div>
          <button class="srp-btn srp-btn--secondary" id="srp-new" style="margin-top:20px;">${escapeHtml(successBtnText)}</button>
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
  }

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
        state.error = 'None of the items in this order are eligible for return.';
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
      const styleEl = document.getElementById('srp-styles');
      if (styleEl) styleEl.textContent = buildStyles(newDesign);
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
    primaryColor: '#18181b',
    backgroundColor: '#ffffff',
    borderRadius: 'rounded',
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
        const styleEl = document.getElementById('srp-styles');
        if (styleEl) styleEl.textContent = buildStyles(design);
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
