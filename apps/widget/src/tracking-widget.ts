/**
 * Outlight Tracking Widget — Centered Editorial design
 */
import './styles/tracking-widget.css';

// ── Types ────────────────────────────────────────────────────────────────────

interface DesignConfig {
  accentColor?: string;
  backgroundColor?: string;
  textColor?: string;
  headingColor?: string;
}

interface TrackingEvent {
  timestamp: string;
  description: string;
  location?: string;
  status?: string;
}

interface TrackingOrderInfo {
  orderNumber: string;
  lineItems: { title: string; variant?: string | null; quantity: number; price: string; imageUrl?: string | null }[];
  destination?: string | null;
  transitDays?: number | null;
  total?: string | null;
}

interface TrackingResult {
  trackingNumber: string;
  carrier?: string;
  carrierDisplay?: string;
  status: string;
  statusMessage?: string;
  statusDetail?: string;
  estimatedDelivery?: string | null;
  signedBy?: string | null;
  deliveredAt?: string | null;
  events: TrackingEvent[];
  order?: TrackingOrderInfo | null;
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

// ── Helpers ──────────────────────────────────────────────────────────────────

function getScriptInfo(): { backendUrl: string; brandSlug: string } {
  for (const s of document.querySelectorAll('script[src]')) {
    const el = s as HTMLScriptElement;
    if (el.src.includes('tracking-widget')) {
      try { return { backendUrl: new URL(el.src).origin, brandSlug: el.getAttribute('data-brand') || '' }; } catch { /* */ }
    }
  }
  return { backendUrl: 'http://localhost:3001', brandSlug: '' };
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, txt?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (txt !== undefined) e.textContent = txt;
  return e;
}

function fmtDate(ts: string): string {
  try {
    const d = new Date(ts);
    const mo = d.toLocaleString('en-US', { month: 'short' });
    const day = d.getDate();
    const yr = d.getFullYear();
    const time = d.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    return `${day} ${mo} ${yr}, ${time}`;
  } catch { return ts; }
}

function fmtDateShort(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
  } catch { return ts; }
}

// ── SVG Icons (filled check circle for delivered) ────────────────────────────

function checkCircleSvg(): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '20');
  svg.setAttribute('height', '20');
  // Filled circle with checkmark
  const circle = document.createElementNS(ns, 'circle');
  circle.setAttribute('cx', '12'); circle.setAttribute('cy', '12'); circle.setAttribute('r', '11');
  circle.setAttribute('fill', 'currentColor');
  svg.appendChild(circle);
  const check = document.createElementNS(ns, 'polyline');
  check.setAttribute('points', '7 12 10 15 17 9');
  check.setAttribute('fill', 'none'); check.setAttribute('stroke', '#fff');
  check.setAttribute('stroke-width', '2'); check.setAttribute('stroke-linecap', 'round'); check.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(check);
  return svg;
}

function truckSvg(): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', '20'); svg.setAttribute('height', '20');
  svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '2');
  const p1 = document.createElementNS(ns, 'path'); p1.setAttribute('d', 'M1 3h15v13H1z'); svg.appendChild(p1);
  const p2 = document.createElementNS(ns, 'path'); p2.setAttribute('d', 'M16 8h4l3 3v5h-7V8z'); svg.appendChild(p2);
  const c1 = document.createElementNS(ns, 'circle'); c1.setAttribute('cx', '5.5'); c1.setAttribute('cy', '18.5'); c1.setAttribute('r', '2.5'); svg.appendChild(c1);
  const c2 = document.createElementNS(ns, 'circle'); c2.setAttribute('cx', '18.5'); c2.setAttribute('cy', '18.5'); c2.setAttribute('r', '2.5'); svg.appendChild(c2);
  return svg;
}

function questionSvg(): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', '20'); svg.setAttribute('height', '20');
  svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '2');
  const c = document.createElementNS(ns, 'circle'); c.setAttribute('cx', '12'); c.setAttribute('cy', '12'); c.setAttribute('r', '10'); svg.appendChild(c);
  const p = document.createElementNS(ns, 'path'); p.setAttribute('d', 'M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3'); svg.appendChild(p);
  const l = document.createElementNS(ns, 'line'); l.setAttribute('x1', '12'); l.setAttribute('y1', '17'); l.setAttribute('x2', '12.01'); l.setAttribute('y2', '17'); svg.appendChild(l);
  return svg;
}

function copySvg(): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '2');
  const r = document.createElementNS(ns, 'rect');
  r.setAttribute('x', '9'); r.setAttribute('y', '9'); r.setAttribute('width', '13'); r.setAttribute('height', '13'); r.setAttribute('rx', '2');
  svg.appendChild(r);
  const p = document.createElementNS(ns, 'path'); p.setAttribute('d', 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1');
  svg.appendChild(p);
  return svg;
}

function statusIcon(status: string): SVGSVGElement {
  if (status === 'delivered') return checkCircleSvg();
  if (status === 'in_transit' || status === 'out_for_delivery') return truckSvg();
  return questionSvg();
}

// ── Widget ───────────────────────────────────────────────────────────────────

function createWidget(container: HTMLElement, backendUrl: string, brandSlug: string, design: DesignConfig): void {
  container.style.setProperty('--otw-accent', design.accentColor || '#C5A059');
  container.style.setProperty('--otw-bg', design.backgroundColor || '#F9F9FB');

  const state: WidgetState = {
    activeTab: 'order', orderNumber: '', email: '', trackingNumber: '',
    loading: false, error: null, result: null, showAllEvents: false,
  };

  function render(): void {
    // Save input values before clearing
    const prevOrder = (container.querySelector('#otw-order') as HTMLInputElement)?.value ?? state.orderNumber;
    const prevEmail = (container.querySelector('#otw-email') as HTMLInputElement)?.value ?? state.email;
    const prevTrack = (container.querySelector('#otw-track') as HTMLInputElement)?.value ?? state.trackingNumber;
    state.orderNumber = prevOrder;
    state.email = prevEmail;
    state.trackingNumber = prevTrack;

    container.innerHTML = '';
    const wrap = el('div', 'otw-container');

    // ── Header ──
    const header = el('div', 'otw-header');
    header.appendChild(el('div', 'otw-eyebrow', 'Order Tracking'));
    header.appendChild(el('div', 'otw-title', 'Track Your Order'));
    header.appendChild(el('div', 'otw-subtitle', 'Enter your details below to view real-time shipping updates.'));
    wrap.appendChild(header);

    wrap.appendChild(el('div', 'otw-divider otw-divider--after-header'));

    // ── Tabs ──
    const tabs = el('div', 'otw-tabs');
    const orderTab = el('button', `otw-tab${state.activeTab === 'order' ? ' otw-tab--active' : ''}`, 'Order Number');
    const trackTab = el('button', `otw-tab${state.activeTab === 'tracking' ? ' otw-tab--active' : ''}`, 'Tracking Number');
    orderTab.addEventListener('click', () => { state.activeTab = 'order'; state.error = null; render(); });
    trackTab.addEventListener('click', () => { state.activeTab = 'tracking'; state.error = null; render(); });
    tabs.appendChild(orderTab);
    tabs.appendChild(trackTab);
    wrap.appendChild(tabs);

    // ── Error ──
    if (state.error) wrap.appendChild(el('div', 'otw-error', state.error));

    // ── Form ──
    const form = el('div', 'otw-form');
    if (state.activeTab === 'order') {
      const oi = el('input', 'otw-input') as HTMLInputElement;
      oi.type = 'text'; oi.placeholder = 'Order number (e.g. #OL-24891)'; oi.id = 'otw-order'; oi.value = state.orderNumber;
      form.appendChild(oi);
      const ei = el('input', 'otw-input') as HTMLInputElement;
      ei.type = 'email'; ei.placeholder = 'Email address'; ei.id = 'otw-email'; ei.value = state.email;
      form.appendChild(ei);
    } else {
      const ti = el('input', 'otw-input') as HTMLInputElement;
      ti.type = 'text'; ti.placeholder = 'Tracking number'; ti.id = 'otw-track'; ti.value = state.trackingNumber;
      form.appendChild(ti);
    }
    wrap.appendChild(form);

    const btn = el('button', 'otw-submit', state.loading ? 'Tracking...' : 'Track Order');
    btn.disabled = state.loading;
    btn.addEventListener('click', handleSubmit);
    wrap.appendChild(btn);

    // ── Loading ──
    if (state.loading) {
      const ld = el('div', 'otw-loading');
      ld.appendChild(el('div', 'otw-spinner'));
      wrap.appendChild(ld);
    }

    // ── Results ──
    if (state.result) {
      const r = state.result;

      // Status divider with icon
      const sd = el('div', 'otw-status-divider');
      sd.appendChild(el('div', 'otw-status-line'));
      const ic = el('div', 'otw-status-icon');
      ic.appendChild(statusIcon(r.status));
      sd.appendChild(ic);
      sd.appendChild(el('div', 'otw-status-line'));
      wrap.appendChild(sd);

      // Status center
      const sc = el('div', 'otw-status-center');
      sc.appendChild(el('div', 'otw-status-heading', r.statusMessage || r.status));
      const detailParts: string[] = [];
      if (r.deliveredAt) detailParts.push(`Delivered ${fmtDateShort(r.deliveredAt)}`);
      if (r.signedBy) detailParts.push(`Signed by ${r.signedBy}`);
      if (!r.deliveredAt && r.estimatedDelivery) detailParts.push(`Est. delivery: ${fmtDateShort(r.estimatedDelivery)}`);
      if (detailParts.length === 0 && r.statusDetail) detailParts.push(r.statusDetail);
      if (detailParts.length) sc.appendChild(el('div', 'otw-status-detail', detailParts.join(' · ')));
      wrap.appendChild(sc);

      // ── Timeline ──
      if (r.events && r.events.length > 0) {
        const tRow = el('div', 'otw-section-row');
        tRow.appendChild(el('span', 'otw-section-label', 'Tracking Timeline'));
        if (r.trackingNumber) {
          const tn = el('div', 'otw-tracking-num');
          tn.appendChild(el('span', 'otw-tracking-num-text', r.trackingNumber));
          const cb = el('button', 'otw-copy-btn');
          cb.appendChild(copySvg());
          cb.addEventListener('click', () => { navigator.clipboard?.writeText(r.trackingNumber); });
          tn.appendChild(cb);
          tRow.appendChild(tn);
        }
        wrap.appendChild(tRow);
        wrap.appendChild(el('div', 'otw-timeline-divider'));

        const SHOW_INITIAL = 3;
        const evts = state.showAllEvents ? r.events : r.events.slice(0, SHOW_INITIAL);
        const tl = el('div', 'otw-timeline');

        evts.forEach((evt, i) => {
          const isLast = i === evts.length - 1 && (state.showAllEvents || r.events.length <= SHOW_INITIAL);
          const tier = i < 2 ? 'recent' : (i < 4 ? 'mid' : 'faded');

          const row = el('div', 'otw-event');
          const left = el('div', 'otw-event-left');
          left.appendChild(el('div', `otw-dot otw-dot--${tier}`));
          if (!isLast) {
            left.appendChild(el('div', `otw-connector otw-connector--${tier}`));
          }
          row.appendChild(left);

          const right = el('div');
          const descCls = tier === 'recent' ? 'otw-event-desc' : `otw-event-desc otw-event-desc--${tier}`;
          right.appendChild(el('span', descCls, evt.description));
          const metaParts = [evt.location, evt.timestamp ? fmtDate(evt.timestamp) : ''].filter(Boolean).join(' · ');
          if (metaParts) {
            right.appendChild(el('span', tier === 'faded' ? 'otw-event-meta otw-event-meta--faded' : 'otw-event-meta', metaParts));
          }
          row.appendChild(right);
          tl.appendChild(row);
        });
        wrap.appendChild(tl);

        if (r.events.length > SHOW_INITIAL) {
          const sm = el('button', 'otw-show-more');
          const hidden = r.events.length - SHOW_INITIAL;
          sm.textContent = state.showAllEvents ? 'Show fewer events' : `Show ${hidden} more event${hidden !== 1 ? 's' : ''}`;
          sm.addEventListener('click', () => { state.showAllEvents = !state.showAllEvents; render(); });
          wrap.appendChild(sm);
        }
      }

      // ── Order Details ──
      if (r.order) {
        wrap.appendChild(el('div', 'otw-divider otw-divider--section'));

        const oRow = el('div', 'otw-section-row');
        oRow.appendChild(el('span', 'otw-section-label', 'Order Details'));
        oRow.appendChild(el('span', 'otw-order-num-right', r.order.orderNumber));
        wrap.appendChild(oRow);

        for (const item of r.order.lineItems || []) {
          const pr = el('div', 'otw-product-row');
          if (item.imageUrl) {
            const img = el('img', 'otw-product-img') as HTMLImageElement;
            img.src = item.imageUrl; img.alt = item.title; img.loading = 'lazy';
            pr.appendChild(img);
          } else {
            pr.appendChild(el('div', 'otw-product-placeholder'));
          }
          const info = el('div', 'otw-product-info');
          info.appendChild(el('div', 'otw-product-title', item.title));
          if (item.variant) info.appendChild(el('div', 'otw-product-variant', item.variant));
          pr.appendChild(info);
          const pc = el('div', 'otw-price-col');
          pc.appendChild(el('div', 'otw-price', `$${parseFloat(item.price).toFixed(2)}`));
          pc.appendChild(el('div', 'otw-qty', `× ${item.quantity}`));
          pr.appendChild(pc);
          wrap.appendChild(pr);
        }

        // Footer
        const ft = el('div', 'otw-footer');
        const ftl = el('div', 'otw-footer-left');
        if (r.order.destination) {
          const df = el('div');
          df.appendChild(el('span', 'otw-footer-field-label', 'Destination'));
          df.appendChild(el('span', 'otw-footer-field-value', r.order.destination));
          ftl.appendChild(df);
        }
        if (r.order.transitDays) {
          const tf = el('div');
          tf.appendChild(el('span', 'otw-footer-field-label', 'Transit'));
          tf.appendChild(el('span', 'otw-footer-field-value', `${r.order.transitDays} Days`));
          ftl.appendChild(tf);
        }
        ft.appendChild(ftl);
        if (r.order.total) {
          const ftr = el('div', 'otw-footer-right');
          ftr.appendChild(el('div', 'otw-total-label', 'Total'));
          ftr.appendChild(el('div', 'otw-total-value', r.order.total));
          ft.appendChild(ftr);
        }
        wrap.appendChild(ft);
      }
    }

    container.appendChild(wrap);
  }

  async function handleSubmit(): Promise<void> {
    // Capture values
    const oi = container.querySelector('#otw-order') as HTMLInputElement | null;
    const ei = container.querySelector('#otw-email') as HTMLInputElement | null;
    const ti = container.querySelector('#otw-track') as HTMLInputElement | null;
    if (oi) state.orderNumber = oi.value.trim();
    if (ei) state.email = ei.value.trim();
    if (ti) state.trackingNumber = ti.value.trim();

    if (state.activeTab === 'order' && !state.orderNumber) { state.error = 'Please enter your order number.'; render(); return; }
    if (state.activeTab === 'order' && (!state.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(state.email))) { state.error = 'Please enter a valid email address.'; render(); return; }
    if (state.activeTab === 'tracking' && !state.trackingNumber) { state.error = 'Please enter a tracking number.'; render(); return; }

    state.error = null; state.loading = true; state.result = null; state.showAllEvents = false;
    render();

    window.parent.postMessage({ type: 'otw:lookup', data: { tab: state.activeTab, orderNumber: state.orderNumber, trackingNumber: state.trackingNumber } }, '*');

    try {
      const bp = brandSlug ? `?brand=${brandSlug}` : '';
      const url = state.activeTab === 'order'
        ? `${backendUrl}/api/tracking/lookup${bp}`
        : `${backendUrl}/api/tracking/track${bp}`;
      const body = state.activeTab === 'order'
        ? { order_number: state.orderNumber, email: state.email }
        : { tracking_number: state.trackingNumber };

      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Request failed' }));
        state.error = err.error || 'Unable to find tracking information.';
        state.loading = false; render();
        window.parent.postMessage({ type: 'otw:error', data: { error: state.error } }, '*');
        return;
      }
      state.result = await res.json();
      state.loading = false; render();
      window.parent.postMessage({ type: 'otw:result', data: state.result }, '*');
    } catch {
      state.error = 'Network error. Please check your connection.';
      state.loading = false; render();
      window.parent.postMessage({ type: 'otw:error', data: { error: state.error } }, '*');
    }
  }

  // ── Auto-fill from URL params ──
  const urlParams = new URLSearchParams(window.location.search);
  const urlTracking = urlParams.get('tracking') || urlParams.get('t');
  const urlOrder = urlParams.get('order') || urlParams.get('o');
  const urlEmail = urlParams.get('email') || urlParams.get('e');

  if (urlTracking) {
    state.activeTab = 'tracking';
    state.trackingNumber = urlTracking;
    render();
    handleSubmit();
  } else if (urlOrder) {
    state.activeTab = 'order';
    state.orderNumber = urlOrder;
    if (urlEmail) state.email = urlEmail;
    render();
    if (urlEmail) handleSubmit();
  } else {
    render();
  }

  window.addEventListener('message', (e) => {
    if (e.data?.type === 'otw:design_update' && e.data.design) {
      Object.assign(design, e.data.design);
      container.style.setProperty('--otw-accent', design.accentColor || '#C5A059');
      container.style.setProperty('--otw-bg', design.backgroundColor || '#F9F9FB');
      render();
    }
  });
}

// ── Init ─────────────────────────────────────────────────────────────────────

async function init(): Promise<void> {
  const { backendUrl, brandSlug } = getScriptInfo();
  const c = document.getElementById('outlight-tracking') || document.querySelector('[data-outlight-tracking]') as HTMLElement | null;
  if (!c) return;

  let design: DesignConfig = {};
  try {
    const bp = brandSlug ? `?brand=${brandSlug}` : '';
    const res = await fetch(`${backendUrl}/api/tracking/widget/config${bp}`);
    if (res.ok) { const d = await res.json(); design = d.widget_design || {}; }
  } catch { /* defaults */ }

  createWidget(c, backendUrl, brandSlug, design);
  window.parent.postMessage({ type: 'otw:loaded' }, '*');
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
