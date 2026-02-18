import './styles/widget.css';
import { createFloatingButton } from './ui/FloatingButton.js';
import { createChatWindow } from './ui/ChatWindow.js';
import { getState, setState, loadSession, saveSession, clearSession } from './state/store.js';
import { initBaseUrl, getConfig, createSession } from './api/client.js';
import type { WidgetDesign } from './api/client.js';

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) }
    : null;
}

function darkenHex(hex: string, amount: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const r = Math.max(0, rgb.r - amount);
  const g = Math.max(0, rgb.g - amount);
  const b = Math.max(0, rgb.b - amount);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

function lightenHex(hex: string, amount: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const r = Math.min(255, rgb.r + amount);
  const g = Math.min(255, rgb.g + amount);
  const b = Math.min(255, rgb.b + amount);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

function applyDesign(root: HTMLElement, design: WidgetDesign): void {
  const primary = design.primaryColor || '#6B4A37';
  const bg = design.backgroundColor || '#ffffff';

  root.style.setProperty('--aicb-primary', primary);
  root.style.setProperty('--aicb-primary-dark', darkenHex(primary, 15));
  root.style.setProperty('--aicb-primary-header', darkenHex(primary, 47));
  root.style.setProperty('--aicb-primary-header-end', darkenHex(primary, 55));
  root.style.setProperty('--aicb-primary-light', lightenHex(primary, 16));
  root.style.setProperty('--aicb-bg', bg);

  // Position
  if (design.position === 'bottom-left') {
    root.style.left = '24px';
    root.style.right = 'auto';
  }

  // Header title
  if (design.headerTitle) {
    setState({ headerTitle: design.headerTitle });
  }
}

function init() {
  initBaseUrl();

  const root = document.createElement('div');
  root.id = 'aicb-root';
  document.body.appendChild(root);

  let chatWindow: HTMLElement | null = null;

  const fab = createFloatingButton(toggleChat);
  root.appendChild(fab);

  // Fetch design config eagerly (non-blocking)
  getConfig()
    .then((config) => {
      if (config.design) {
        applyDesign(root, config.design);
      }
    })
    .catch(() => {
      // Use CSS defaults
    });

  async function toggleChat() {
    const state = getState();

    if (state.isOpen) {
      setState({ isOpen: false });
      if (chatWindow) {
        chatWindow.remove();
        chatWindow = null;
      }
      return;
    }

    // Open immediately — don't wait for API
    setState({ isOpen: true });

    chatWindow = createChatWindow(() => {
      setState({ isOpen: false });
      if (chatWindow) {
        chatWindow.remove();
        chatWindow = null;
      }
    });
    root.appendChild(chatWindow);

    // Initialize session in background (non-blocking)
    if (!state.sessionId || !state.conversationId) {
      setState({ isLoading: true });

      try {
        const saved = loadSession();

        const sessionRes = await createSession({
          sessionId: saved?.sessionId,
          pageUrl: window.location.href,
        });

        setState({
          sessionId: sessionRes.sessionId,
          conversationId: sessionRes.conversationId,
          presetActions: sessionRes.presetActions,
          isLoading: false,
          messages:
            getState().messages.length > 0
              ? getState().messages
              : [
                  {
                    role: 'assistant' as const,
                    content: sessionRes.greeting,
                    timestamp: Date.now(),
                  },
                ],
          lastActivity: Date.now(),
        });
        saveSession();
      } catch (err) {
        console.error('[aicb] Failed to create session:', err);
        setState({
          isLoading: false,
          messages: [
            {
              role: 'assistant' as const,
              content: "Hi! I'm having trouble connecting. Please try again in a moment.",
              timestamp: Date.now(),
            },
          ],
        });
      }
    }
  }
}

// Initialize on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
