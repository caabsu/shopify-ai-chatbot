/**
 * Contact Form Widget — Brand-aware, embeddable on any Shopify "Contact Us" page.
 * Posts to the backend ticket API to create support tickets.
 *
 * Usage:
 *   <div id="support-contact-form"></div>
 *   <script src="https://your-backend/widget/contact-form.js" data-brand="misu"></script>
 *
 * The data-brand attribute determines which brand config to load.
 * If omitted, the backend resolves brand from the page Origin.
 */

// ── Types ────────────────────────────────────────────────────────────────────

interface BrandDesign {
  primaryColor: string;
  backgroundColor: string;
  headerTitle: string;
  borderRadius: string;
  fontSize: string;
  fontFamily?: string;
  headingFontFamily?: string;
}

interface FormState {
  submitting: boolean;
  submitted: boolean;
  ticketNumber: string | null;
  error: string | null;
}

interface FormContentConfig {
  headerTitle: string;
  subtitle: string;
  submitButtonText: string;
  successTitle: string;
  successMessage: string;
  categories: Array<{ value: string; label: string }>;
  showOrderNumber: boolean;
  showPhone: boolean;
  headerFontSize?: string;
  headerFontWeight?: string;
  customCSS?: string;
}

interface FormConfig {
  design: BrandDesign;
  content: FormContentConfig;
  brandSlug: string;
  backendUrl: string;
}

// ── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_DESIGN: BrandDesign = {
  primaryColor: '#18181b',
  backgroundColor: '#ffffff',
  headerTitle: 'Contact Us',
  borderRadius: 'rounded',
  fontSize: 'medium',
};

const DEFAULT_CONTENT: FormContentConfig = {
  headerTitle: 'Get in Touch',
  subtitle: 'Have a question or need help? Fill out the form below and we\'ll respond as soon as we can.',
  submitButtonText: 'Send Message',
  successTitle: 'Message Received',
  successMessage: 'Thank you for reaching out. We\'ll get back to you via email as soon as possible.',
  categories: [
    { value: 'order_issue', label: 'Order Issue' },
    { value: 'return_refund', label: 'Return / Refund' },
    { value: 'product_inquiry', label: 'Product Question' },
    { value: 'shipping', label: 'Shipping' },
    { value: 'other', label: 'Other' },
  ],
  showOrderNumber: true,
  showPhone: true,
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function getScriptInfo(): { backendUrl: string; brandSlug: string } {
  const scripts = document.querySelectorAll('script[src]');
  let backendUrl = '';
  let brandSlug = '';

  for (const script of scripts) {
    const el = script as HTMLScriptElement;
    if (el.src.includes('contact-form')) {
      try {
        backendUrl = new URL(el.src).origin;
      } catch { /* ignore */ }
      brandSlug = el.getAttribute('data-brand') || '';
      break;
    }
  }

  return { backendUrl: backendUrl || 'http://localhost:3001', brandSlug };
}

function radiusValue(r: string): string {
  if (r === 'sharp') return '4px';
  if (r === 'pill') return '24px';
  return '12px'; // rounded
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

// ── Styles ───────────────────────────────────────────────────────────────────

function buildStyles(d: BrandDesign, ct: FormContentConfig): string {
  const radius = radiusValue(d.borderRadius);
  const baseFontSize = fontSizeBase(d.fontSize);
  const primary = d.primaryColor;
  const bg = d.backgroundColor;
  const bodyFont = d.fontFamily || "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
  const headingFont = d.headingFontFamily || bodyFont;
  const headerWeight = ct.headerFontWeight || '700';
  const headerSize = ct.headerFontSize || '1.65rem';
  const btnTextColor = isLightColor(primary) ? '#1a1a1a' : '#ffffff';
  const inputBorder = isLightColor(bg) ? '#d1d5db' : '#4a4a4a';
  const inputBg = isLightColor(bg) ? '#ffffff' : hexToRgba('#ffffff', 0.08);
  const textColor = isLightColor(bg) ? '#1a1a1a' : '#f5f5f5';
  const subtextColor = isLightColor(bg) ? '#6b7280' : '#a0a0a0';
  const labelColor = isLightColor(bg) ? '#374151' : '#d1d5db';
  const focusRing = hexToRgba(primary, 0.2);

  return `
.scf-wrap {
  max-width: 580px;
  margin: 0 auto;
  font-family: ${bodyFont};
  font-size: ${baseFontSize};
  color: ${textColor};
  line-height: 1.55;
}
.scf-wrap *, .scf-wrap *::before, .scf-wrap *::after { box-sizing: border-box; margin: 0; padding: 0; }

/* ── Header ── */
.scf-header {
  margin-bottom: 1.75rem;
}
.scf-title {
  font-family: ${headingFont};
  font-size: ${headerSize};
  font-weight: ${headerWeight};
  color: ${textColor};
  margin-bottom: 0.4rem;
  letter-spacing: -0.01em;
}
.scf-subtitle {
  font-size: 0.92em;
  color: ${subtextColor};
}

/* ── Fields ── */
.scf-field { margin-bottom: 1.1rem; }
.scf-label {
  display: block;
  font-size: 0.85em;
  font-weight: 600;
  margin-bottom: 0.35rem;
  color: ${labelColor};
  letter-spacing: 0.01em;
}
.scf-required { color: ${primary}; margin-left: 2px; }
.scf-input, .scf-select, .scf-textarea {
  width: 100%;
  padding: 0.65rem 0.85rem;
  font-size: 0.92em;
  font-family: ${bodyFont};
  border: 1.5px solid ${inputBorder};
  border-radius: ${radius};
  background: ${inputBg};
  color: ${textColor};
  transition: border-color 0.2s, box-shadow 0.2s;
}
.scf-input::placeholder, .scf-textarea::placeholder {
  color: ${subtextColor};
  opacity: 0.7;
}
.scf-input:focus, .scf-select:focus, .scf-textarea:focus {
  outline: none;
  border-color: ${primary};
  box-shadow: 0 0 0 3px ${focusRing};
}
.scf-textarea { resize: vertical; min-height: 130px; }
.scf-select { cursor: pointer; }

/* ── Grid ── */
.scf-row { display: flex; gap: 1rem; }
.scf-row .scf-field { flex: 1; }
@media (max-width: 480px) {
  .scf-row { flex-direction: column; gap: 0; }
}

/* ── Optional tag ── */
.scf-optional {
  font-size: 0.75em;
  font-weight: 400;
  color: ${subtextColor};
  margin-left: 4px;
}

/* ── Submit ── */
.scf-submit {
  width: 100%;
  padding: 0.75rem 1.5rem;
  font-size: 0.95em;
  font-weight: 600;
  font-family: ${headingFont};
  background: ${primary};
  color: ${btnTextColor};
  border: none;
  border-radius: ${radius};
  cursor: pointer;
  transition: opacity 0.2s, transform 0.1s;
  margin-top: 0.5rem;
  letter-spacing: 0.01em;
}
.scf-submit:hover { opacity: 0.9; }
.scf-submit:active { transform: scale(0.99); }
.scf-submit:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }

/* ── Messages ── */
.scf-form-error {
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #991b1b;
  padding: 0.7rem 1rem;
  border-radius: ${radius};
  font-size: 0.85em;
  margin-bottom: 1rem;
}
.scf-success {
  text-align: center;
  padding: 2.5rem 2rem;
  background: ${hexToRgba(primary, 0.06)};
  border: 1.5px solid ${hexToRgba(primary, 0.15)};
  border-radius: ${radius};
}
.scf-success-icon {
  width: 52px;
  height: 52px;
  margin: 0 auto 1rem;
  background: ${primary};
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}
.scf-success-icon svg { width: 24px; height: 24px; color: ${btnTextColor}; }
.scf-success-title {
  font-family: ${headingFont};
  font-size: 1.3rem;
  font-weight: ${headerWeight};
  color: ${textColor};
  margin-bottom: 0.5rem;
}
.scf-success-text {
  font-size: 0.92em;
  color: ${subtextColor};
  line-height: 1.6;
}
.scf-success-ticket {
  font-weight: 700;
  color: ${primary};
}
.scf-success-btn {
  margin-top: 1.5rem;
  padding: 0.55rem 1.5rem;
  font-size: 0.85em;
  font-weight: 600;
  font-family: ${headingFont};
  background: transparent;
  color: ${primary};
  border: 1.5px solid ${primary};
  border-radius: ${radius};
  cursor: pointer;
  transition: background 0.2s, color 0.2s;
}
.scf-success-btn:hover {
  background: ${primary};
  color: ${btnTextColor};
}
.scf-honeypot { position: absolute; left: -9999px; opacity: 0; height: 0; width: 0; }

/* ── Divider ── */
.scf-divider {
  border: none;
  border-top: 1px solid ${inputBorder};
  margin: 0.25rem 0 1.1rem;
  opacity: 0.5;
}
`;
}

// ── Form Renderer ────────────────────────────────────────────────────────────

function createForm(container: HTMLElement, cfg: FormConfig): void {
  const state: FormState = { submitting: false, submitted: false, ticketNumber: null, error: null };

  // Inject styles
  if (!document.getElementById('scf-styles')) {
    const style = document.createElement('style');
    style.id = 'scf-styles';
    style.textContent = buildStyles(cfg.design, cfg.content);
    document.head.appendChild(style);
  }

  // Inject custom CSS from form config
  if (cfg.content.customCSS) {
    let customTag = document.getElementById('scf-custom-css');
    if (!customTag) {
      customTag = document.createElement('style');
      customTag.id = 'scf-custom-css';
      document.head.appendChild(customTag);
    }
    customTag.textContent = cfg.content.customCSS;
  }

  // Inject Google Fonts if custom fonts specified
  if (cfg.design.fontFamily || cfg.design.headingFontFamily) {
    const families: string[] = [];
    if (cfg.design.headingFontFamily) {
      const name = cfg.design.headingFontFamily.split(',')[0].replace(/['"]/g, '').trim();
      if (name && !name.startsWith('-apple')) families.push(name.replace(/ /g, '+') + ':wght@200;400;600;700');
    }
    if (cfg.design.fontFamily) {
      const name = cfg.design.fontFamily.split(',')[0].replace(/['"]/g, '').trim();
      if (name && !name.startsWith('-apple') && !families.some(f => f.startsWith(name.replace(/ /g, '+')))) {
        families.push(name.replace(/ /g, '+') + ':wght@400;500;600');
      }
    }
    if (families.length > 0 && !document.getElementById('scf-fonts')) {
      const link = document.createElement('link');
      link.id = 'scf-fonts';
      link.rel = 'stylesheet';
      link.href = `https://fonts.googleapis.com/css2?${families.map(f => 'family=' + f).join('&')}&display=swap`;
      document.head.appendChild(link);
    }
  }

  const ct = cfg.content;

  function render(): void {
    if (state.submitted) {
      container.innerHTML = `
        <div class="scf-wrap">
          <div class="scf-success">
            <div class="scf-success-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            </div>
            <div class="scf-success-title">${ct.successTitle}</div>
            <div class="scf-success-text">
              ${ct.successMessage}${state.ticketNumber ? ` Your ticket number is <span class="scf-success-ticket">#${state.ticketNumber}</span>.` : ''}
            </div>
            <button class="scf-success-btn" id="scf-reset">Send Another Message</button>
          </div>
        </div>`;
      container.querySelector('#scf-reset')?.addEventListener('click', () => {
        state.submitted = false;
        state.ticketNumber = null;
        state.error = null;
        render();
      });
      return;
    }

    const optionalFields: string[] = [];
    if (ct.showOrderNumber) {
      optionalFields.push(`
            <div class="scf-field">
              <label class="scf-label">Order Number <span class="scf-optional">(optional)</span></label>
              <input class="scf-input" name="order_number" placeholder="#1234" />
            </div>`);
    }
    if (ct.showPhone) {
      optionalFields.push(`
            <div class="scf-field">
              <label class="scf-label">Phone <span class="scf-optional">(optional)</span></label>
              <input class="scf-input" name="phone" type="tel" placeholder="(555) 123-4567" autocomplete="tel" />
            </div>`);
    }
    const optionalHtml = optionalFields.length > 0
      ? `<hr class="scf-divider" /><div class="scf-row">${optionalFields.join('')}</div>`
      : '';

    container.innerHTML = `
      <div class="scf-wrap">
        <div class="scf-header">
          <h2 class="scf-title">${ct.headerTitle}</h2>
          <p class="scf-subtitle">${ct.subtitle}</p>
        </div>
        ${state.error ? `<div class="scf-form-error">${state.error}</div>` : ''}
        <form id="scf-form" novalidate>
          <div class="scf-row">
            <div class="scf-field">
              <label class="scf-label">Name <span class="scf-required">*</span></label>
              <input class="scf-input" name="name" required placeholder="Your name" autocomplete="name" />
            </div>
            <div class="scf-field">
              <label class="scf-label">Email <span class="scf-required">*</span></label>
              <input class="scf-input" name="email" type="email" required placeholder="you@email.com" autocomplete="email" />
            </div>
          </div>

          <div class="scf-field">
            <label class="scf-label">What can we help with? <span class="scf-required">*</span></label>
            <select class="scf-select" name="category" required>
              <option value="">Select a topic...</option>
              ${ct.categories.map(c => `<option value="${c.value}">${c.label}</option>`).join('')}
            </select>
          </div>

          <div class="scf-field">
            <label class="scf-label">Subject <span class="scf-required">*</span></label>
            <input class="scf-input" name="subject" required placeholder="Brief summary of your request" />
          </div>

          <div class="scf-field">
            <label class="scf-label">Message <span class="scf-required">*</span></label>
            <textarea class="scf-textarea" name="message" required placeholder="Tell us more details..."></textarea>
          </div>

          ${optionalHtml}

          <input class="scf-honeypot" name="website" tabindex="-1" autocomplete="off" />
          <button type="submit" class="scf-submit" ${state.submitting ? 'disabled' : ''}>
            ${state.submitting ? 'Sending...' : ct.submitButtonText}
          </button>
        </form>
      </div>`;

    const form = container.querySelector('#scf-form') as HTMLFormElement;
    form?.addEventListener('submit', handleSubmit);
  }

  async function handleSubmit(e: Event): Promise<void> {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const data = new FormData(form);

    // Honeypot
    if (data.get('website')) return;

    const name = (data.get('name') as string)?.trim();
    const email = (data.get('email') as string)?.trim();
    const category = (data.get('category') as string)?.trim();
    const subject = (data.get('subject') as string)?.trim();
    const message = (data.get('message') as string)?.trim();
    const orderNumber = (data.get('order_number') as string)?.trim();
    const phone = (data.get('phone') as string)?.trim();

    if (!name || !email || !category || !subject || !message) {
      state.error = 'Please fill in all required fields.';
      render();
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      state.error = 'Please enter a valid email address.';
      render();
      return;
    }

    state.submitting = true;
    state.error = null;
    render();

    try {
      const brandParam = cfg.brandSlug ? `?brand=${cfg.brandSlug}` : '';
      const res = await fetch(`${cfg.backendUrl}/api/tickets/form${brandParam}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          email,
          category,
          subject,
          message: orderNumber ? `${message}\n\nOrder #: ${orderNumber}` : message,
          order_number: orderNumber || undefined,
          phone: phone || undefined,
        }),
      });

      if (res.status === 429) {
        state.error = 'Too many submissions. Please wait a few minutes and try again.';
        state.submitting = false;
        render();
        return;
      }

      const result = await res.json();
      if (!res.ok) {
        state.error = result.error || 'Something went wrong. Please try again.';
        state.submitting = false;
        render();
        return;
      }

      state.submitted = true;
      state.ticketNumber = result.ticketNumber;
      state.submitting = false;
      render();
    } catch {
      state.error = 'Network error. Please check your connection and try again.';
      state.submitting = false;
      render();
    }
  }

  render();
}

// ── Init ─────────────────────────────────────────────────────────────────────

async function init(): Promise<void> {
  const { backendUrl, brandSlug } = getScriptInfo();

  // Load brand design + form content config
  let design = { ...DEFAULT_DESIGN };
  let content = { ...DEFAULT_CONTENT };
  try {
    const configUrl = `${backendUrl}/api/widget/config${brandSlug ? '?brand=' + brandSlug : ''}`;
    const res = await fetch(configUrl);
    if (res.ok) {
      const data = await res.json();
      if (data.design) {
        design = { ...design, ...data.design };
      }
      if (data.formConfig) {
        content = { ...content, ...data.formConfig };
      }
    }
  } catch {
    // Use defaults
  }

  const cfg: FormConfig = { design, content, brandSlug, backendUrl };

  // Find or create container
  const explicit = document.getElementById('support-contact-form');
  if (explicit) {
    createForm(explicit, cfg);
  } else {
    const container = document.createElement('div');
    container.id = 'support-contact-form';
    document.body.appendChild(container);
    createForm(container, cfg);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
