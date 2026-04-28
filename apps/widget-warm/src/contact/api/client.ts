let baseUrl = '';
const BRAND_SLUG = 'warm-by-design';

export function initBaseUrl(): void {
  const scripts = document.querySelectorAll('script[src*="contact.js"]');
  if (scripts.length > 0) {
    const src = (scripts[scripts.length - 1] as HTMLScriptElement).src;
    try {
      baseUrl = new URL(src).origin;
    } catch {
      baseUrl = '';
    }
  }
  if (!baseUrl) {
    baseUrl = 'http://localhost:3001';
  }
}

export interface ContactSubmitResponse {
  success: boolean;
  ticketNumber?: string;
  message: string;
}

export interface ContactWidgetConfig {
  widget_design?: Record<string, unknown>;
  form_config?: Record<string, unknown>;
}

export async function getContactWidgetConfig(): Promise<ContactWidgetConfig> {
  const url = `${baseUrl}/api/contact-form/widget/config`;
  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      'X-Brand': BRAND_SLUG,
    },
  });

  if (!res.ok) return {};
  return res.json() as Promise<ContactWidgetConfig>;
}

export async function submitContactForm(data: {
  name: string;
  email: string;
  message: string;
  topic?: string;
  subject?: string;
}): Promise<ContactSubmitResponse> {
  const url = `${baseUrl}/api/contact/submit`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Brand': BRAND_SLUG,
    },
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || 'Failed to submit form');
  }

  return res.json() as Promise<ContactSubmitResponse>;
}
