export interface WidgetMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  navigationButtons?: Array<{ url: string; label: string }>;
  productCards?: Array<{
    id: string;
    title: string;
    description: string;
    price: string;
    currency: string;
    imageUrl: string;
    productUrl: string;
    available: boolean;
  }>;
  cartData?: {
    cartId: string;
    checkoutUrl: string;
    totalAmount: string;
    currency: string;
    lineItems: Array<{ id: string; title: string; quantity: number; price: string }>;
  } | null;
}

export interface PresetAction {
  id: string;
  label: string;
  icon: string;
  prompt: string;
}

export interface WidgetState {
  sessionId: string | null;
  conversationId: string | null;
  messages: WidgetMessage[];
  isOpen: boolean;
  isLoading: boolean;
  presetActions: PresetAction[];
  lastActivity: number;
  hasUserSentMessage: boolean;
  error: string | null;
  headerTitle: string;
}

const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes
const STORAGE_KEY = 'aicb_session';

type Listener = (state: WidgetState) => void;

let state: WidgetState = {
  sessionId: null,
  conversationId: null,
  messages: [],
  isOpen: false,
  isLoading: false,
  presetActions: [],
  lastActivity: Date.now(),
  hasUserSentMessage: false,
  error: null,
  headerTitle: 'Outlight Assistant',
};

const listeners: Set<Listener> = new Set();

export function getState(): WidgetState {
  return state;
}

export function setState(partial: Partial<WidgetState>): void {
  state = { ...state, ...partial };
  listeners.forEach((fn) => fn(state));
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function saveSession(): void {
  if (state.sessionId && state.conversationId) {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        sessionId: state.sessionId,
        conversationId: state.conversationId,
        lastActivity: Date.now(),
      })
    );
  }
}

export function loadSession(): { sessionId: string; conversationId: string } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (Date.now() - data.lastActivity > SESSION_TIMEOUT) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return { sessionId: data.sessionId, conversationId: data.conversationId };
  } catch {
    return null;
  }
}

export function clearSession(): void {
  localStorage.removeItem(STORAGE_KEY);
  setState({
    sessionId: null,
    conversationId: null,
    messages: [],
    hasUserSentMessage: false,
    presetActions: [],
  });
}
