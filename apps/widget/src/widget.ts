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

  // Border radius
  const radiusMap = { sharp: '8px', rounded: '16px', pill: '24px' };
  const radius = radiusMap[design.borderRadius] || '16px';
  root.style.setProperty('--aicb-radius', radius);

  // Font size
  const fontSizeMap = { small: '12.5px', medium: '13.5px', large: '15px' };
  const fontSize = fontSizeMap[design.fontSize] || '13.5px';
  root.style.setProperty('--aicb-font-size', fontSize);

  // Position
  if (design.position === 'bottom-left') {
    root.style.left = '24px';
    root.style.right = 'auto';
  }

  // Push design settings into state for UI components
  setState({
    headerTitle: design.headerTitle || 'Outlight Assistant',
    bubbleIcon: design.bubbleIcon || 'chat',
    inputPlaceholder: design.inputPlaceholder || 'Type a message...',
    welcomeMessage: design.welcomeMessage || '',
    borderRadius: design.borderRadius || 'rounded',
    fontSize: design.fontSize || 'medium',
    showBrandingBadge: design.showBrandingBadge !== false,
    autoOpenDelay: design.autoOpenDelay || 0,
  });
}

function showWelcomeTooltip(root: HTMLElement, message: string): void {
  // Don't show if chat is already open or user has seen it
  if (getState().isOpen) return;
  const tooltip = document.createElement('div');
  tooltip.className = 'aicb-welcome-tooltip';
  tooltip.textContent = message;
  root.appendChild(tooltip);

  // Show after a brief delay
  setTimeout(() => tooltip.classList.add('aicb-welcome-tooltip--visible'), 500);

  // Auto-dismiss after 8 seconds
  setTimeout(() => {
    tooltip.classList.remove('aicb-welcome-tooltip--visible');
    setTimeout(() => tooltip.remove(), 300);
  }, 8500);

  // Dismiss on click
  tooltip.addEventListener('click', () => {
    tooltip.classList.remove('aicb-welcome-tooltip--visible');
    setTimeout(() => tooltip.remove(), 300);
  });
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

      // Auto-open after delay if configured
      const delay = config.design?.autoOpenDelay;
      if (delay && delay > 0 && !getState().isOpen) {
        setTimeout(() => {
          if (!getState().isOpen) {
            toggleChat();
          }
        }, delay * 1000);
      }

      // Welcome message tooltip
      if (config.design?.welcomeMessage) {
        showWelcomeTooltip(root, config.design.welcomeMessage);
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

        // Restore messages: use backend history if resuming, otherwise show greeting
        let messages = getState().messages;
        if (messages.length === 0) {
          if (sessionRes.messages && sessionRes.messages.length > 0) {
            // Resumed session — restore full conversation history from backend
            messages = sessionRes.messages.map((m) => ({
              role: m.role,
              content: m.content,
              timestamp: m.timestamp,
            }));
          } else {
            // New session — show greeting
            messages = [
              {
                role: 'assistant' as const,
                content: sessionRes.greeting,
                timestamp: Date.now(),
              },
            ];
          }
        }

        setState({
          sessionId: sessionRes.sessionId,
          conversationId: sessionRes.conversationId,
          presetActions: sessionRes.presetActions,
          isLoading: false,
          hasUserSentMessage: messages.some((m) => m.role === 'user'),
          messages,
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
