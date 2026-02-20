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
  bubbleIcon: 'chat' | 'headset' | 'sparkle' | 'help';
  inputPlaceholder: string;
  welcomeMessage: string;
  borderRadius: 'sharp' | 'rounded' | 'pill';
  fontSize: 'small' | 'medium' | 'large';
  showBrandingBadge: boolean;
  autoOpenDelay: number;
}

const SESSION_TIMEOUT = 24 * 60 * 60 * 1000; // 24 hours
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
  bubbleIcon: 'chat',
  inputPlaceholder: 'Type a message...',
  welcomeMessage: '',
  borderRadius: 'rounded',
  fontSize: 'medium',
  showBrandingBadge: true,
  autoOpenDelay: 0,
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
        messages: state.messages,
      })
    );
  }
}

export function loadSession(): { sessionId: string; conversationId: string; messages?: WidgetMessage[] } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (Date.now() - data.lastActivity > SESSION_TIMEOUT) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return {
      sessionId: data.sessionId,
      conversationId: data.conversationId,
      messages: data.messages,
    };
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
