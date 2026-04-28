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
  variantTitle: string | null;
  price: string;
  currency?: string;
  imageUrl?: string;
  quantity: number;
  returnEligible: boolean;
}

export interface OrderLookupResponse {
  orderId: string;
  orderNumber: string;
  customerEmail: string;
  customerName?: string | null;
  items: OrderItem[];
  returnWindow: string;
}

export interface ReturnSubmitResponse {
  returnId: string;
  status: string;
  message: string;
}

export interface ReturnsPortalConfig {
  settings?: {
    return_window_days?: number;
    available_reasons?: string[];
    reason_labels?: Record<string, string>;
    portal_title?: string;
    portal_description?: string;
  };
  design?: {
    primaryColor?: string;
    backgroundColor?: string;
    cardBackgroundColor?: string;
    textColor?: string;
    mutedTextColor?: string;
    borderRadius?: 'sharp' | 'rounded' | 'pill';
    fontSize?: 'small' | 'medium' | 'large';
    fontFamily?: string;
    headingFontFamily?: string;
    buttonTextLookup?: string;
    buttonTextContinue?: string;
    buttonTextSubmit?: string;
    successTitle?: string;
    successMessage?: string;
    successButtonText?: string;
  } | null;
}

export async function getPortalConfig(): Promise<ReturnsPortalConfig> {
  return request<ReturnsPortalConfig>('/api/returns/portal-config');
}

export async function lookupOrder(orderNumber: string, email: string): Promise<OrderLookupResponse> {
  const params = new URLSearchParams({ order_number: orderNumber, email });
  const data = await request<{
    order: { id: string; name: string };
    customer: { name: string | null; email: string | null };
    items: Array<{
      id: string;
      title: string;
      variantTitle: string | null;
      quantity: number;
      price: string;
      image: string | null;
      eligible: boolean;
    }>;
  }>(`/api/returns/lookup?${params.toString()}`);

  return {
    orderId: data.order.id,
    orderNumber: data.order.name,
    customerEmail: data.customer.email || email,
    customerName: data.customer.name,
    returnWindow: '30 days',
    items: data.items.map((item) => ({
      id: item.id,
      title: item.title,
      variantTitle: item.variantTitle,
      price: item.price,
      imageUrl: item.image || undefined,
      quantity: item.quantity,
      returnEligible: item.eligible,
    })),
  };
}

export async function submitReturn(data: {
  orderId: string;
  orderNumber: string;
  customerEmail: string;
  customerName?: string | null;
  items: Array<{
    line_item_id: string;
    product_title: string;
    variant_title?: string | null;
    product_image_url?: string | null;
    quantity: number;
    price?: number;
    reason: string;
    reason_details?: string | null;
  }>;
  notes?: string;
}): Promise<ReturnSubmitResponse> {
  const response = await request<{ return_request: { id: string }; status: string }>('/api/returns/submit', {
    method: 'POST',
    body: JSON.stringify({
      order_id: data.orderId,
      order_number: data.orderNumber,
      customer_email: data.customerEmail,
      customer_name: data.customerName ?? null,
      items: data.items,
    }),
  });

  return {
    returnId: response.return_request.id,
    status: response.status,
    message: 'Return request submitted',
  };
}
