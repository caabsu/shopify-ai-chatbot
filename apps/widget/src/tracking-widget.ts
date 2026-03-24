/**
 * Outlight Tracking Widget — Order & shipment tracking display.
 * Embeddable on any Shopify page or standalone tracking page.
 *
 * Usage:
 *   <div id="outlight-tracking" data-brand="misu"></div>
 *   <script src="https://your-backend/widget/tracking-widget.js" data-brand="misu"></script>
 *
 * Or attribute-based:
 *   <div data-outlight-tracking data-brand="misu"></div>
 */

import './styles/tracking-widget.css';

// ── Types ────────────────────────────────────────────────────────────────────

interface DesignConfig {
  accentColor?: string;
  backgroundColor?: string;
  textColor?: string;
  headingColor?: string;
  mutedColor?: string;
  borderColor?: string;
  dividerColor?: string;
}

interface TrackingEvent {
  timestamp: string;
  description: string;
  location?: string;
  status?: string;
}

interface TrackingOrderInfo {
  order_number: string;
  line_items: {
    title: string;
    variant_title?: string;
    quantity: number;
    price: string;
    image_url?: string;
  }[];
  destination?: string;
  total_price: string;
  currency: string;
}

interface TrackingResult {
  tracking_number: string;
  carrier?: string;
  status: 'delivered' | 'in_transit' | 'exception' | 'info_received' | 'not_found';
  status_detail?: string;
  estimated_delivery?: string;
  events: TrackingEvent[];
  order?: TrackingOrderInfo;
}

interface WidgetState {
  activeTab: 'order' | 'tracking';
  orderNumber: string;
  email: string;
  trackingNumber: string;
  loading: boolean;
  error: string | null;
  result: TrackingResult | null;
  showAllEvents: boolean;
}

interface WidgetConfig {
  tracking_design?: DesignConfig;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getScriptInfo(): { backendUrl: string; brandSlug: string } {
  const scripts = document.querySelectorAll('script[src]');
  let backendUrl = '';
  let brandSlug = '';

  for (const script of scripts) {
    const el = script as HTMLScriptElement;
    if (el.src.includes('tracking-widget')) {
      try {
        backendUrl = new URL(el.src).origin;
      } catch { /* ignore */ }
      brandSlug = el.getAttribute('data-brand') || '';
      break;
    }
  }

  return { backendUrl: backendUrl || 'http://localhost:3001', brandSlug };
}

function createEl<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function formatDate(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return ts;
  }
}

function formatPrice(price: string, currency: string): string {
  try {
    const num = parseFloat(price);
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(num);
  } catch {
    return `${currency} ${price}`;
  }
}

// ── SVG Icons ────────────────────────────────────────────────────────────────

function renderStatusIcon(status: TrackingResult['status']): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');

  function path(d: string): void {
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', d);
    svg.appendChild(p);
  }
  function circle(cx: string, cy: string, r: string): void {
    const c = document.createElementNS(ns, 'circle');
    c.setAttribute('cx', cx);
    c.setAttribute('cy', cy);
    c.setAttribute('r', r);
    svg.appendChild(c);
  }
  function polyline(points: string): void {
    const pl = document.createElementNS(ns, 'polyline');
    pl.setAttribute('points', points);
    svg.appendChild(pl);
  }
  function line(x1: string, y1: string, x2: string, y2: string): void {
    const l = document.createElementNS(ns, 'line');
    l.setAttribute('x1', x1); l.setAttribute('y1', y1);
    l.setAttribute('x2', x2); l.setAttribute('y2', y2);
    svg.appendChild(l);
  }

  switch (status) {
    case 'delivered':
      circle('12', '12', '10');
      polyline('20 6 9 17 4 12');
      break;
    case 'in_transit':
      path('M1 3h15v13H1z');
      path('M16 8h4l3 3v5h-7V8z');
      circle('5.5', '18.5', '2.5');
      circle('18.5', '18.5', '2.5');
      break;
    case 'exception':
      path('M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z');
      line('12', '9', '12', '13');
      line('12', '17', '12.01', '17');
      break;
    case 'info_received':
      circle('12', '12', '10');
      line('12', '8', '12', '12');
      line('12', '16', '12.01', '16');
      break;
    case 'not_found':
    default:
      circle('12', '12', '10');
      path('M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3');
      line('12', '17', '12.01', '17');
      break;
  }

  return svg;
}

function copySvg(): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  const rect1 = document.createElementNS(ns, 'rect');
  rect1.setAttribute('x', '9'); rect1.setAttribute('y', '9');
  rect1.setAttribute('width', '13'); rect1.setAttribute('height', '13');
  rect1.setAttribute('rx', '2'); rect1.setAttribute('ry', '2');
  svg.appendChild(rect1);
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1');
  svg.appendChild(path);
  return svg;
}

// ── Render Helpers ───────────────────────────────────────────────────────────

function renderTimeline(
  events: TrackingEvent[],
  trackingNumber: string,
  showAll: boolean,
  onToggleShowAll: () => void,
): HTMLElement {
  const section = createEl('div', 'otw-timeline-section');

  // Label row
  const labelRow = createEl('div', 'otw-section-label-row');
  labelRow.appendChild(createEl('span', 'otw-section-label', 'Tracking Timeline'));

  const numWrap = createEl('div', 'otw-tracking-number-wrap');
  const numText = createEl('span', 'otw-tracking-number-text', trackingNumber);
  numWrap.appendChild(numText);

  const copyBtn = createEl('button', 'otw-copy-btn');
  copyBtn.title = 'Copy tracking number';
  copyBtn.appendChild(copySvg());
  copyBtn.addEventListener('click', () => {
    navigator.clipboard?.writeText(trackingNumber).catch(() => {});
    copyBtn.title = 'Copied!';
    setTimeout(() => { copyBtn.title = 'Copy tracking number'; }, 2000);
  });
  numWrap.appendChild(copyBtn);
  labelRow.appendChild(numWrap);
  section.appendChild(labelRow);

  // Events
  const INITIAL_COUNT = 3;
  const displayEvents = showAll ? events : events.slice(0, INITIAL_COUNT);
  const hiddenCount = events.length - INITIAL_COUNT;

  const timeline = createEl('div', 'otw-timeline');

  displayEvents.forEach((evt, idx) => {
    const isRecent = idx < 2;
    const event = createEl('div', 'otw-timeline-event');

    // Left column: dot + connector
    const left = createEl('div', 'otw-timeline-left');
    const dot = createEl('div', `otw-timeline-dot ${isRecent ? 'otw-timeline-dot--recent' : 'otw-timeline-dot--older'}`);
    left.appendChild(dot);

    // Connector (not for last displayed event)
    if (idx < displayEvents.length - 1) {
      const connector = createEl('div', 'otw-timeline-connector');
      left.appendChild(connector);
    }
    event.appendChild(left);

    // Right column: description + meta
    const right = createEl('div', 'otw-timeline-right');
    const desc = createEl('div', `otw-timeline-desc${isRecent ? '' : ' otw-timeline-desc--older'}`, evt.description);
    right.appendChild(desc);

    const metaParts: string[] = [];
    if (evt.location) metaParts.push(evt.location);
    if (evt.timestamp) metaParts.push(formatDate(evt.timestamp));
    if (metaParts.length > 0) {
      right.appendChild(createEl('div', 'otw-timeline-meta', metaParts.join(' · ')));
    }
    event.appendChild(right);

    timeline.appendChild(event);
  });

  section.appendChild(timeline);

  // Show more / less toggle
  if (events.length > INITIAL_COUNT) {
    const toggleBtn = createEl('button', 'otw-show-more-btn');
    if (showAll) {
      toggleBtn.textContent = 'Show Fewer Events';
    } else {
      toggleBtn.textContent = `Show ${hiddenCount} More Event${hiddenCount !== 1 ? 's' : ''}`;
    }
    toggleBtn.addEventListener('click', onToggleShowAll);
    section.appendChild(toggleBtn);
  }

  return section;
}

function renderOrderDetails(order: TrackingOrderInfo): HTMLElement {
  const section = createEl('div', 'otw-order-section');

  // Label row
  const labelRow = createEl('div', 'otw-section-label-row');
  labelRow.appendChild(createEl('span', 'otw-section-label', 'Order Details'));
  labelRow.appendChild(createEl('span', 'otw-tracking-number-text', `#${order.order_number}`));
  section.appendChild(labelRow);

  // Product list
  const list = createEl('div', 'otw-product-list');
  for (const item of order.line_items) {
    const row = createEl('div', 'otw-product-row');

    // Image
    if (item.image_url) {
      const img = createEl('img', 'otw-product-img') as HTMLImageElement;
      img.src = item.image_url;
      img.alt = item.title;
      img.loading = 'lazy';
      row.appendChild(img);
    } else {
      row.appendChild(createEl('div', 'otw-product-img-placeholder'));
    }

    // Info
    const info = createEl('div', 'otw-product-info');
    info.appendChild(createEl('div', 'otw-product-title', item.title));
    if (item.variant_title) {
      info.appendChild(createEl('div', 'otw-product-variant', item.variant_title));
    }
    row.appendChild(info);

    // Price
    const priceCol = createEl('div', 'otw-product-price-col');
    priceCol.appendChild(createEl('div', 'otw-product-price', formatPrice(item.price, order.currency)));
    priceCol.appendChild(createEl('div', 'otw-product-qty', `×${item.quantity}`));
    row.appendChild(priceCol);

    list.appendChild(row);
  }
  section.appendChild(list);

  // Footer
  const footer = createEl('div', 'otw-order-footer');

  const left = createEl('div', 'otw-order-footer-left');

  if (order.destination) {
    const destField = createEl('div', 'otw-footer-field');
    destField.appendChild(createEl('span', 'otw-footer-label', 'Destination'));
    destField.appendChild(createEl('span', 'otw-footer-value', order.destination));
    left.appendChild(destField);
  }

  const transitField = createEl('div', 'otw-footer-field');
  transitField.appendChild(createEl('span', 'otw-footer-label', 'Transit'));
  transitField.appendChild(createEl('span', 'otw-footer-value', 'Standard Shipping'));
  left.appendChild(transitField);

  footer.appendChild(left);

  const right = createEl('div', 'otw-order-footer-right');
  right.appendChild(createEl('div', 'otw-total-label', 'Total'));
  right.appendChild(createEl('div', 'otw-total-value', formatPrice(order.total_price, order.currency)));
  footer.appendChild(right);

  section.appendChild(footer);

  return section;
}

function renderStatusSection(result: TrackingResult): HTMLElement {
  const status = createEl('div', 'otw-status');

  // Divider with icon
  const divider = createEl('div', 'otw-status-divider');
  divider.appendChild(createEl('div', 'otw-status-divider-line'));

  const iconWrap = createEl('div', `otw-status-icon otw-status-icon--${result.status}`);
  iconWrap.appendChild(renderStatusIcon(result.status));
  divider.appendChild(iconWrap);

  divider.appendChild(createEl('div', 'otw-status-divider-line'));
  status.appendChild(divider);

  // Heading: human-readable status
  const statusLabels: Record<string, string> = {
    delivered: 'Package Delivered',
    in_transit: 'In Transit',
    exception: 'Delivery Exception',
    info_received: 'Information Received',
    not_found: 'Tracking Not Found',
  };
  status.appendChild(createEl('div', 'otw-status-heading', statusLabels[result.status] ?? result.status));

  // Detail
  const detail = result.status_detail
    ?? (result.estimated_delivery ? `Estimated delivery: ${formatDate(result.estimated_delivery)}` : '');
  if (detail) {
    status.appendChild(createEl('div', 'otw-status-detail', detail));
  }

  return status;
}

function renderForm(
  state: WidgetState,
  backendUrl: string,
  brandSlug: string,
  onSubmit: () => void,
  onTabChange: (tab: 'order' | 'tracking') => void,
): HTMLElement {
  const frag = document.createDocumentFragment();

  // Header
  const header = createEl('div', 'otw-header');
  header.appendChild(createEl('div', 'otw-header-eyebrow', 'Order Tracking'));
  header.appendChild(createEl('div', 'otw-header-title', 'Track Your Order'));
  header.appendChild(createEl('div', 'otw-header-subtitle', 'Enter your order details below to see real-time updates.'));
  frag.appendChild(header);

  // Tabs
  const tabs = createEl('div', 'otw-tabs');
  const orderTab = createEl('button', `otw-tab${state.activeTab === 'order' ? ' otw-tab--active' : ''}`, 'Order Number');
  const trackingTab = createEl('button', `otw-tab${state.activeTab === 'tracking' ? ' otw-tab--active' : ''}`, 'Tracking Number');
  orderTab.addEventListener('click', () => onTabChange('order'));
  trackingTab.addEventListener('click', () => onTabChange('tracking'));
  tabs.appendChild(orderTab);
  tabs.appendChild(trackingTab);
  frag.appendChild(tabs);

  // Form fields
  const formSection = createEl('div', 'otw-form-section');

  if (state.error) {
    formSection.appendChild(createEl('div', 'otw-error', state.error));
  }

  if (state.activeTab === 'order') {
    const orderInput = createEl('input', 'otw-input') as HTMLInputElement;
    orderInput.type = 'text';
    orderInput.placeholder = 'Order number (e.g. #1234)';
    orderInput.id = 'otw-order-number';
    orderInput.value = state.orderNumber;
    orderInput.autocomplete = 'off';
    formSection.appendChild(createEl('div', 'otw-form-group').appendChild(orderInput) && (() => {
      const g = createEl('div', 'otw-form-group');
      g.appendChild(orderInput);
      return g;
    })());

    const emailInput = createEl('input', 'otw-input') as HTMLInputElement;
    emailInput.type = 'email';
    emailInput.placeholder = 'Email address used for order';
    emailInput.id = 'otw-email';
    emailInput.value = state.email;
    emailInput.autocomplete = 'email';
    const emailGroup = createEl('div', 'otw-form-group');
    emailGroup.appendChild(emailInput);
    formSection.appendChild(emailGroup);
  } else {
    const trackingInput = createEl('input', 'otw-input') as HTMLInputElement;
    trackingInput.type = 'text';
    trackingInput.placeholder = 'Tracking number';
    trackingInput.id = 'otw-tracking-number';
    trackingInput.value = state.trackingNumber;
    trackingInput.autocomplete = 'off';
    const trackGroup = createEl('div', 'otw-form-group');
    trackGroup.appendChild(trackingInput);
    formSection.appendChild(trackGroup);
  }

  const submitBtn = createEl('button', 'otw-submit-btn');
  submitBtn.textContent = state.loading ? 'Tracking...' : 'Track Order';
  submitBtn.disabled = state.loading;
  submitBtn.id = 'otw-submit';
  submitBtn.addEventListener('click', onSubmit);
  formSection.appendChild(submitBtn);

  frag.appendChild(formSection);

  // Wrap fragment in a div for return
  const wrapper = createEl('div');
  wrapper.appendChild(frag);
  return wrapper;
}

function renderResults(
  result: TrackingResult,
  state: WidgetState,
  onToggleShowAll: () => void,
): HTMLElement {
  const results = createEl('div', 'otw-results');

  results.appendChild(renderStatusSection(result));

  if (result.events && result.events.length > 0) {
    results.appendChild(createEl('div', 'otw-section-divider'));
    results.appendChild(renderTimeline(
      result.events,
      result.tracking_number,
      state.showAllEvents,
      onToggleShowAll,
    ));
  }

  if (result.order) {
    results.appendChild(createEl('div', 'otw-section-divider'));
    results.appendChild(renderOrderDetails(result.order));
  }

  return results;
}

// ── Widget Core ──────────────────────────────────────────────────────────────

function applyDesign(container: HTMLElement, design: DesignConfig): void {
  container.style.setProperty('--otw-accent', design.accentColor || '#C5A059');
  container.style.setProperty('--otw-bg', design.backgroundColor || '#F9F9FB');
  container.style.setProperty('--otw-text', design.textColor || '#2D3338');
  container.style.setProperty('--otw-heading', design.headingColor || '#C5A059');
  container.style.setProperty('--otw-muted', design.mutedColor || '#ADADAD');
  container.style.setProperty('--otw-border', design.borderColor || '#D4D4D8');
  container.style.setProperty('--otw-divider', design.dividerColor || '#E8E8EC');
}

function createWidget(
  container: HTMLElement,
  backendUrl: string,
  brandSlug: string,
  config: WidgetConfig,
): void {
  const design: DesignConfig = config.tracking_design || {};
  applyDesign(container, design);

  const state: WidgetState = {
    activeTab: 'order',
    orderNumber: '',
    email: '',
    trackingNumber: '',
    loading: false,
    error: null,
    result: null,
    showAllEvents: false,
  };

  function render(): void {
    container.innerHTML = '';
    const wrap = createEl('div', 'otw-container');

    if (state.loading && !state.result) {
      // Show form + spinner below
      const formEl = renderForm(state, backendUrl, brandSlug, handleSubmit, handleTabChange);
      wrap.appendChild(formEl);
      const loading = createEl('div', 'otw-loading');
      loading.appendChild(createEl('div', 'otw-spinner'));
      wrap.appendChild(loading);
      container.appendChild(wrap);
      return;
    }

    // Always show form
    const formEl = renderForm(state, backendUrl, brandSlug, handleSubmit, handleTabChange);
    wrap.appendChild(formEl);

    // Show results if available
    if (state.result) {
      wrap.appendChild(renderResults(state.result, state, () => {
        state.showAllEvents = !state.showAllEvents;
        render();
      }));
    }

    container.appendChild(wrap);

    // Restore input values after render
    const orderInput = container.querySelector('#otw-order-number') as HTMLInputElement | null;
    const emailInput = container.querySelector('#otw-email') as HTMLInputElement | null;
    const trackingInput = container.querySelector('#otw-tracking-number') as HTMLInputElement | null;
    if (orderInput) orderInput.value = state.orderNumber;
    if (emailInput) emailInput.value = state.email;
    if (trackingInput) trackingInput.value = state.trackingNumber;
  }

  function handleTabChange(tab: 'order' | 'tracking'): void {
    state.activeTab = tab;
    state.error = null;
    render();
  }

  async function handleSubmit(): Promise<void> {
    // Capture current input values
    const orderInput = container.querySelector('#otw-order-number') as HTMLInputElement | null;
    const emailInput = container.querySelector('#otw-email') as HTMLInputElement | null;
    const trackingInput = container.querySelector('#otw-tracking-number') as HTMLInputElement | null;

    if (orderInput) state.orderNumber = orderInput.value.trim();
    if (emailInput) state.email = emailInput.value.trim();
    if (trackingInput) state.trackingNumber = trackingInput.value.trim();

    // Validation
    if (state.activeTab === 'order') {
      if (!state.orderNumber) {
        state.error = 'Please enter your order number.';
        render();
        return;
      }
      if (!state.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(state.email)) {
        state.error = 'Please enter a valid email address.';
        render();
        return;
      }
    } else {
      if (!state.trackingNumber) {
        state.error = 'Please enter your tracking number.';
        render();
        return;
      }
    }

    state.error = null;
    state.loading = true;
    state.result = null;
    state.showAllEvents = false;
    render();

    // PostMessage: lookup started
    window.parent.postMessage({ type: 'otw:lookup', data: {
      tab: state.activeTab,
      orderNumber: state.orderNumber,
      trackingNumber: state.trackingNumber,
    }}, '*');

    try {
      const brandParam = brandSlug ? `?brand=${brandSlug}` : '';
      let url: string;
      let body: Record<string, string>;

      if (state.activeTab === 'order') {
        url = `${backendUrl}/api/tracking/lookup${brandParam}`;
        body = { order_number: state.orderNumber, email: state.email };
      } else {
        url = `${backendUrl}/api/tracking/track${brandParam}`;
        body = { tracking_number: state.trackingNumber };
      }

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: 'Request failed' }));
        state.error = errData.error || 'Unable to find tracking information. Please check your details and try again.';
        state.loading = false;
        render();

        window.parent.postMessage({ type: 'otw:error', data: { error: state.error } }, '*');
        return;
      }

      const result: TrackingResult = await res.json();
      state.result = result;
      state.loading = false;
      render();

      window.parent.postMessage({ type: 'otw:result', data: result }, '*');
    } catch {
      state.error = 'Network error. Please check your connection and try again.';
      state.loading = false;
      render();

      window.parent.postMessage({ type: 'otw:error', data: { error: state.error } }, '*');
    }
  }

  render();

  // Listen for live design updates from admin playground
  window.addEventListener('message', (event) => {
    if (event.data?.type === 'otw:design_update' && event.data.design) {
      Object.assign(design, event.data.design);
      applyDesign(container, design);
      render();
    }
  });
}

// ── Init ─────────────────────────────────────────────────────────────────────

async function init(): Promise<void> {
  const { backendUrl, brandSlug } = getScriptInfo();

  const container = (
    document.getElementById('outlight-tracking') ||
    document.querySelector('[data-outlight-tracking]')
  ) as HTMLElement | null;

  if (!container) return;

  // Fetch widget config
  let config: WidgetConfig = {};
  try {
    const brandParam = brandSlug ? `?brand=${brandSlug}` : '';
    const res = await fetch(`${backendUrl}/api/tracking/widget/config${brandParam}`);
    if (res.ok) config = await res.json();
  } catch { /* use defaults */ }

  createWidget(container, backendUrl, brandSlug, config);

  window.parent.postMessage({ type: 'otw:loaded' }, '*');
}

// ── Bootstrap ────────────────────────────────────────────────────────────────

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
