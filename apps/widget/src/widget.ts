import './styles/widget.css';
import { createFloatingButton } from './ui/FloatingButton.js';
import { createChatWindow } from './ui/ChatWindow.js';
import { getState, setState, loadSession, saveSession, setBrandForStorage } from './state/store.js';
import { initBaseUrl, setBrand, getConfig, createSession } from './api/client.js';
import type { WidgetDesign } from './api/client.js';

// Capture current script reference immediately — it's only available during
// initial script execution, not inside async callbacks or event listeners.
const currentScript = document.currentScript as HTMLScriptElement | null;

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

function loadGoogleFonts(design: WidgetDesign): void {
  const families: string[] = [];
  // Always load Newsreader (headings) and Manrope (body) for B3 Warm Tonal
  const headingFont = design.headingFontFamily || "'Newsreader'";
  const bodyFont = design.fontFamily || "'Manrope'";

  const headingName = headingFont.split(',')[0].replace(/['"]/g, '').trim();
  if (headingName && !headingName.startsWith('-apple')) {
    families.push(headingName.replace(/ /g, '+') + ':wght@200;300;400');
  }

  const bodyName = bodyFont.split(',')[0].replace(/['"]/g, '').trim();
  if (bodyName && !bodyName.startsWith('-apple') && !families.some(f => f.startsWith(bodyName.replace(/ /g, '+')))) {
    families.push(bodyName.replace(/ /g, '+') + ':wght@200;300;400;500');
  }

  if (families.length > 0 && !document.getElementById('aicb-gfonts')) {
    const link = document.createElement('link');
    link.id = 'aicb-gfonts';
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?${families.map(f => 'family=' + f).join('&')}&display=swap`;
    document.head.appendChild(link);
  }
}

function applyDesign(root: HTMLElement, design: WidgetDesign): void {
  const primary = design.primaryColor || '#C5A059';
  const bg = design.backgroundColor || '#F9F9FB';

  root.style.setProperty('--aicb-primary', primary);
  root.style.setProperty('--aicb-gold', primary);
  root.style.setProperty('--aicb-gold-hover', darkenHex(primary, 13));
  root.style.setProperty('--aicb-primary-dark', darkenHex(primary, 13));
  root.style.setProperty('--aicb-primary-light', lightenHex(primary, 16));
  root.style.setProperty('--aicb-bg', bg);
  root.style.setProperty('--aicb-surface', bg);

  // Dark theme
  if (design.theme === 'dark') {
    root.classList.add('aicb-dark');
  } else {
    root.classList.remove('aicb-dark');
  }

  // Font size
  const fontSizeMap = { small: '12.5px', medium: '13.5px', large: '15px' };
  const fontSize = fontSizeMap[design.fontSize] || '13.5px';
  root.style.setProperty('--aicb-font-size', fontSize);

  // Custom fonts — default to B3 Warm Tonal fonts
  const fontFamily = design.fontFamily || "'Manrope', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
  const headingFont = design.headingFontFamily || "'Newsreader', Georgia, 'Times New Roman', serif";
  root.style.setProperty('--aicb-font-family', fontFamily);
  root.style.setProperty('--aicb-heading-font', headingFont);

  if (design.headingFontWeight) {
    root.style.setProperty('--aicb-heading-weight', design.headingFontWeight);
  }
  if (design.headerFontSize) {
    root.style.setProperty('--aicb-header-font-size', design.headerFontSize);
  }
  loadGoogleFonts(design);

  // Inject custom CSS
  if (design.customCSS) {
    let tag = document.getElementById('aicb-custom-css');
    if (!tag) {
      tag = document.createElement('style');
      tag.id = 'aicb-custom-css';
      document.head.appendChild(tag);
    }
    tag.textContent = design.customCSS;
  }

  // Position
  if (design.position === 'bottom-left') {
    root.style.left = '24px';
    root.style.right = 'auto';
  }

  // Push design settings into state for UI components
  setState({
    headerTitle: design.headerTitle || 'Outlight',
    bubbleIcon: design.bubbleIcon || 'chat',
    inputPlaceholder: design.inputPlaceholder || 'Type your question...',
    welcomeMessage: design.welcomeMessage || '',
    borderRadius: design.borderRadius || 'sharp',
    fontSize: design.fontSize || 'medium',
    showBrandingBadge: design.showBrandingBadge !== false,
    autoOpenDelay: design.autoOpenDelay || 0,
    greetingHeader: design.greetingHeader || 'WELCOME',
    greetingSubtext: design.greetingSubtext || "Ask us anything \u2014 we're here to help",
    headerSubtitle: design.headerSubtitle || 'CONCIERGE',
    headerLogo: design.headerLogo || 'O',
    brandingText: design.brandingText || '',
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

function isMobile(): boolean {
  return window.innerWidth <= 480;
}

let savedScrollY = 0;

let bodyLocked = false;

function lockBodyScroll(): void {
  if (!isMobile()) return;
  savedScrollY = window.scrollY;
  document.body.style.top = `-${savedScrollY}px`;
  document.body.classList.add('aicb-body-locked');
  bodyLocked = true;
}

function unlockBodyScroll(): void {
  if (!bodyLocked) return;
  document.body.classList.remove('aicb-body-locked');
  document.body.style.top = '';
  window.scrollTo(0, savedScrollY);
  bodyLocked = false;
}

async function initSession() {
  setState({ isLoading: true });

  try {
    const saved = loadSession();

    const sessionRes = await createSession({
      sessionId: saved?.sessionId,
      pageUrl: window.location.href,
    });

    // Restore messages: prefer local (has rich content) > backend (text only) > greeting
    let messages = getState().messages;
    if (messages.length === 0) {
      if (saved?.messages && saved.messages.length > 0) {
        // Local storage — preserves navigation buttons, product cards, cart data
        messages = saved.messages;
      } else if (sessionRes.messages && sessionRes.messages.length > 0) {
        // Backend history fallback — text only, no rich attachments
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

async function initEmbedded(targetSelector: string) {
  const target = document.querySelector(targetSelector);
  if (!target) {
    console.error('[aicb] Embedded target not found:', targetSelector);
    return;
  }

  const root = document.createElement('div');
  root.id = 'aicb-root';
  root.classList.add('aicb-embedded');
  target.appendChild(root);

  // Load config BEFORE creating the window — prevents color flash and
  // ensures branding/header/placeholder state is correct at render time
  try {
    const config = await getConfig();
    if (config.design) applyDesign(root, config.design);
  } catch {
    // Use CSS defaults
  }

  // Now create chat window — state has correct values for branding, title, etc.
  const chatWindow = createChatWindow(() => {}, initSession);
  root.appendChild(chatWindow);
  setState({ isOpen: true });

  initSession();
}

function initFloating() {
  const root = document.createElement('div');
  root.id = 'aicb-root';
  document.body.appendChild(root);

  let chatWindow: HTMLElement | null = null;

  const fab = createFloatingButton(toggleChat);
  root.appendChild(fab);

  // Fetch config eagerly — store promise so toggleChat can await it
  // before creating the window (prevents color flash and wrong branding)
  const configReady = getConfig()
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

  function closeChatWindow() {
    setState({ isOpen: false });
    unlockBodyScroll();
    if (chatWindow) {
      chatWindow.remove();
      chatWindow = null;
    }
  }

  async function toggleChat() {
    const state = getState();

    if (state.isOpen) {
      closeChatWindow();
      return;
    }

    setState({ isOpen: true });
    lockBodyScroll();

    // Wait for config to be applied before creating the window — ensures
    // colors, branding badge, header title, placeholder are all correct
    await configReady;

    chatWindow = createChatWindow(closeChatWindow, initSession);
    root.appendChild(chatWindow);

    // Initialize session if needed (first open or after page reload)
    if (!state.sessionId || !state.conversationId) {
      await initSession();
    }
  }
}

function init() {
  initBaseUrl();

  // Detect brand from the script tag — critical for multi-brand isolation
  const brand = currentScript?.getAttribute('data-brand');
  if (brand) {
    setBrand(brand);
    setBrandForStorage(brand);
  }

  // Detect mode from the script tag that loaded this file
  const mode = currentScript?.getAttribute('data-mode');
  const targetSelector = currentScript?.getAttribute('data-target');

  if (mode === 'embedded' && targetSelector) {
    initEmbedded(targetSelector);
  } else {
    initFloating();
  }
}

// Initialize on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
