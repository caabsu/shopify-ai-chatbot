let baseUrl = '';

export function initBaseUrl(): void {
  const scripts = document.querySelectorAll('script[src*="widget.js"]');
  if (scripts.length > 0) {
    const src = (scripts[scripts.length - 1] as HTMLScriptElement).src;
    try {
      const url = new URL(src);
      baseUrl = url.origin;
    } catch {
      baseUrl = '';
    }
  }
  // Fallback: if running in dev mode (Vite), use localhost
  if (!baseUrl) {
    baseUrl = 'http://localhost:3001';
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${baseUrl}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (res.status === 429) {
    throw new Error('Too many messages. Please wait a moment.');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || `Request failed (${res.status})`);
  }

  return res.json() as Promise<T>;
}

export interface WidgetDesign {
  primaryColor: string;
  backgroundColor: string;
  headerTitle: string;
  position: 'bottom-right' | 'bottom-left';
  bubbleIcon: 'chat' | 'headset' | 'sparkle' | 'help';
  welcomeMessage: string;
  inputPlaceholder: string;
  borderRadius: 'sharp' | 'rounded' | 'pill';
  fontSize: 'small' | 'medium' | 'large';
  showBrandingBadge: boolean;
  autoOpenDelay: number;
}

export interface WidgetConfig {
  greeting: string;
  presetActions: Array<{ id: string; label: string; icon: string; prompt: string }>;
  design: WidgetDesign;
}

export interface SessionResponse {
  sessionId: string;
  conversationId: string;
  greeting: string;
  presetActions: Array<{ id: string; label: string; icon: string; prompt: string }>;
  messages?: Array<{ role: 'user' | 'assistant'; content: string; timestamp: number }>;
}

export interface MessageResponse {
  response: string;
  navigationButtons: Array<{ url: string; label: string }>;
  productCards: Array<{
    id: string;
    title: string;
    description: string;
    price: string;
    currency: string;
    imageUrl: string;
    productUrl: string;
    available: boolean;
  }>;
  cartData: {
    cartId: string;
    checkoutUrl: string;
    totalAmount: string;
    currency: string;
    lineItems: Array<{ id: string; title: string; quantity: number; price: string }>;
  } | null;
  toolsUsed: string[];
  conversationStatus: string;
}

export async function getConfig(): Promise<WidgetConfig> {
  return request<WidgetConfig>('/api/widget/config');
}

export async function createSession(data: {
  sessionId?: string;
  customerEmail?: string;
  customerName?: string;
  pageUrl?: string;
}): Promise<SessionResponse> {
  return request<SessionResponse>('/api/chat/session', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function sendMessage(data: {
  sessionId: string;
  conversationId: string;
  message?: string;
  presetActionId?: string;
}): Promise<MessageResponse> {
  return request<MessageResponse>('/api/chat/message', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}
