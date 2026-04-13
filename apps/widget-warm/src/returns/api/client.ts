let baseUrl = '';
const BRAND_SLUG = 'warm-by-design';

export function initBaseUrl(): void {
  const scripts = document.querySelectorAll('script[src*="returns.js"]');
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

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${baseUrl}${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Brand': BRAND_SLUG,
    ...options?.headers as Record<string, string>,
  };

  const res = await fetch(url, { ...options, headers });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || `Request failed (${res.status})`);
  }

  return res.json() as Promise<T>;
}

export interface OrderItem {
  id: string;
  title: string;
  variantTitle: string;
  price: string;
  currency: string;
  imageUrl?: string;
  quantity: number;
  returnEligible: boolean;
}

export interface OrderLookupResponse {
  orderId: string;
  orderNumber: string;
  items: OrderItem[];
  returnWindow: string;
}

export interface ReturnSubmitResponse {
  returnId: string;
  status: string;
  message: string;
}

export async function lookupOrder(orderNumber: string, email: string): Promise<OrderLookupResponse> {
  return request<OrderLookupResponse>('/api/returns/lookup', {
    method: 'POST',
    body: JSON.stringify({ orderNumber, email }),
  });
}

export async function submitReturn(data: {
  orderId: string;
  items: Array<{ itemId: string; reason: string }>;
  notes?: string;
}): Promise<ReturnSubmitResponse> {
  return request<ReturnSubmitResponse>('/api/returns/submit', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}
