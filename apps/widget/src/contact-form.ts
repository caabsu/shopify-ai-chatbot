/**
 * Contact Form Widget — Embeddable on Shopify "Contact Us" page.
 * Posts to the backend ticket API to create support tickets.
 * Embed: <script src="https://your-backend/widget/contact-form.js"></script>
 * Or: <div id="support-contact-form"></div><script src="..."></script>
 */

const FORM_STYLES = `
.scf-form-container {
  max-width: 560px;
  margin: 0 auto;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  color: #1a1a1a;
}
.scf-form-container * { box-sizing: border-box; margin: 0; padding: 0; }
.scf-title { font-size: 1.5rem; font-weight: 600; margin-bottom: 0.25rem; }
.scf-subtitle { font-size: 0.9rem; color: #6b7280; margin-bottom: 1.5rem; }
.scf-field { margin-bottom: 1rem; }
.scf-label { display: block; font-size: 0.85rem; font-weight: 500; margin-bottom: 0.35rem; color: #374151; }
.scf-label .scf-required { color: #ef4444; margin-left: 2px; }
.scf-input, .scf-select, .scf-textarea {
  width: 100%; padding: 0.6rem 0.75rem; font-size: 0.9rem; border: 1px solid #d1d5db;
  border-radius: 8px; background: #fff; color: #1a1a1a; transition: border-color 0.15s, box-shadow 0.15s;
  font-family: inherit;
}
.scf-input:focus, .scf-select:focus, .scf-textarea:focus {
  outline: none; border-color: #6366f1; box-shadow: 0 0 0 3px rgba(99,102,241,0.1);
}
.scf-textarea { resize: vertical; min-height: 120px; }
.scf-row { display: flex; gap: 1rem; }
.scf-row .scf-field { flex: 1; }
.scf-submit {
  width: 100%; padding: 0.7rem 1.5rem; font-size: 0.95rem; font-weight: 500;
  background: #18181b; color: #fff; border: none; border-radius: 8px; cursor: pointer;
  transition: background 0.15s;
}
.scf-submit:hover { background: #27272a; }
.scf-submit:disabled { opacity: 0.6; cursor: not-allowed; }
.scf-error { color: #ef4444; font-size: 0.8rem; margin-top: 0.25rem; }
.scf-form-error { background: #fef2f2; border: 1px solid #fecaca; color: #991b1b; padding: 0.75rem 1rem; border-radius: 8px; font-size: 0.85rem; margin-bottom: 1rem; }
.scf-success {
  text-align: center; padding: 2rem; background: #f0fdf4; border: 1px solid #bbf7d0;
  border-radius: 12px;
}
.scf-success-icon { font-size: 2.5rem; margin-bottom: 0.75rem; }
.scf-success-title { font-size: 1.25rem; font-weight: 600; color: #166534; margin-bottom: 0.5rem; }
.scf-success-text { font-size: 0.9rem; color: #374151; line-height: 1.5; }
.scf-success-ticket { font-weight: 600; color: #18181b; }
.scf-success-btn {
  margin-top: 1.25rem; padding: 0.5rem 1.25rem; font-size: 0.85rem; background: #18181b;
  color: #fff; border: none; border-radius: 8px; cursor: pointer;
}
.scf-success-btn:hover { background: #27272a; }
.scf-honeypot { position: absolute; left: -9999px; opacity: 0; height: 0; width: 0; }
`;

const CATEGORIES = [
  { value: 'order_issue', label: 'Order Issue' },
  { value: 'return_refund', label: 'Return / Refund' },
  { value: 'product_inquiry', label: 'Product Question' },
  { value: 'shipping', label: 'Shipping' },
  { value: 'billing', label: 'Billing' },
  { value: 'other', label: 'Other' },
];

function getBackendUrl(): string {
  const scripts = document.querySelectorAll('script[src]');
  for (const script of scripts) {
    const src = (script as HTMLScriptElement).src;
    if (src.includes('contact-form')) {
      try {
        const url = new URL(src);
        return url.origin;
      } catch { /* ignore */ }
    }
  }
  return 'http://localhost:3001';
}

interface FormState {
  submitting: boolean;
  submitted: boolean;
  ticketNumber: string | null;
  error: string | null;
}

function createForm(container: HTMLElement): void {
  const backendUrl = getBackendUrl();
  const state: FormState = { submitting: false, submitted: false, ticketNumber: null, error: null };

  // Inject styles
  if (!document.getElementById('scf-styles')) {
    const style = document.createElement('style');
    style.id = 'scf-styles';
    style.textContent = FORM_STYLES;
    document.head.appendChild(style);
  }

  function render(): void {
    if (state.submitted) {
      container.innerHTML = `
        <div class="scf-form-container">
          <div class="scf-success">
            <div class="scf-success-icon">&#10003;</div>
            <div class="scf-success-title">Thank you!</div>
            <div class="scf-success-text">
              Your request has been received.<br>
              Ticket number: <span class="scf-success-ticket">#${state.ticketNumber}</span><br><br>
              We'll get back to you at your email as soon as possible.
            </div>
            <button class="scf-success-btn" id="scf-reset">Submit Another Request</button>
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

    container.innerHTML = `
      <div class="scf-form-container">
        <h2 class="scf-title">Contact Us</h2>
        <p class="scf-subtitle">We'd love to hear from you. Fill out the form below and we'll get back to you as soon as possible.</p>
        ${state.error ? `<div class="scf-form-error">${state.error}</div>` : ''}
        <form id="scf-form" novalidate>
          <div class="scf-row">
            <div class="scf-field">
              <label class="scf-label">Name <span class="scf-required">*</span></label>
              <input class="scf-input" name="name" required placeholder="Your full name" />
            </div>
            <div class="scf-field">
              <label class="scf-label">Email <span class="scf-required">*</span></label>
              <input class="scf-input" name="email" type="email" required placeholder="your@email.com" />
            </div>
          </div>
          <div class="scf-row">
            <div class="scf-field">
              <label class="scf-label">What can we help with? <span class="scf-required">*</span></label>
              <select class="scf-select" name="category" required>
                <option value="">Select a topic...</option>
                ${CATEGORIES.map(c => `<option value="${c.value}">${c.label}</option>`).join('')}
              </select>
            </div>
            <div class="scf-field">
              <label class="scf-label">Order Number</label>
              <input class="scf-input" name="order_number" placeholder="#1234 (optional)" />
            </div>
          </div>
          <div class="scf-field">
            <label class="scf-label">Subject <span class="scf-required">*</span></label>
            <input class="scf-input" name="subject" required placeholder="Brief description of your issue" />
          </div>
          <div class="scf-field">
            <label class="scf-label">Message <span class="scf-required">*</span></label>
            <textarea class="scf-textarea" name="message" required placeholder="Tell us more about your issue..."></textarea>
          </div>
          <input class="scf-honeypot" name="website" tabindex="-1" autocomplete="off" />
          <button type="submit" class="scf-submit" ${state.submitting ? 'disabled' : ''}>
            ${state.submitting ? 'Submitting...' : 'Submit'}
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

    // Honeypot check
    if (data.get('website')) return;

    const name = (data.get('name') as string)?.trim();
    const email = (data.get('email') as string)?.trim();
    const category = (data.get('category') as string)?.trim();
    const subject = (data.get('subject') as string)?.trim();
    const message = (data.get('message') as string)?.trim();
    const orderNumber = (data.get('order_number') as string)?.trim();

    // Validate
    if (!name || !email || !category || !subject || !message) {
      state.error = 'Please fill in all required fields.';
      render();
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      state.error = 'Please enter a valid email address.';
      render();
      return;
    }

    state.submitting = true;
    state.error = null;
    render();

    try {
      const res = await fetch(`${backendUrl}/api/tickets/form`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, category, subject, message, order_number: orderNumber || undefined }),
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

// Initialize
function init(): void {
  // Look for explicit container first
  const explicit = document.getElementById('support-contact-form');
  if (explicit) {
    createForm(explicit);
    return;
  }

  // Otherwise create a container and append to body
  const container = document.createElement('div');
  container.id = 'support-contact-form';
  document.body.appendChild(container);
  createForm(container);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
