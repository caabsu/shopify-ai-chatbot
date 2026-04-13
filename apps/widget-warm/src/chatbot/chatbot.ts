import './styles/chatbot.css';
import { createFloatingButton } from './ui/FloatingButton.js';
import { createChatWindow } from './ui/ChatWindow.js';
import { getState, setState, loadSession, saveSession } from './state/store.js';
import { initBaseUrl, createSession } from './api/client.js';

const currentScript = document.currentScript as HTMLScriptElement | null;

function loadFonts(): void {
  if (document.getElementById('wbd-fonts')) return;

  const link = document.createElement('link');
  link.id = 'wbd-fonts';
  link.rel = 'stylesheet';
  link.href = 'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@200;300;400;500&family=Outfit:wght@200;300;400;500&family=Syne:wght@400;500;600&display=swap';
  document.head.appendChild(link);

  const iconLink = document.createElement('link');
  iconLink.id = 'wbd-icons';
  iconLink.rel = 'stylesheet';
  iconLink.href = 'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200';
  document.head.appendChild(iconLink);
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
  document.body.classList.add('wbd-body-locked');
  bodyLocked = true;
}

function unlockBodyScroll(): void {
  if (!bodyLocked) return;
  document.body.classList.remove('wbd-body-locked');
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

    let messages = getState().messages;
    if (messages.length === 0) {
      if (saved?.messages && saved.messages.length > 0) {
        messages = saved.messages;
      } else if (sessionRes.messages && sessionRes.messages.length > 0) {
        messages = sessionRes.messages.map((m) => ({
          role: m.role,
          content: m.content,
          timestamp: m.timestamp,
        }));
      } else {
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
    console.error('[wbd] Failed to create session:', err);
    setState({
      isLoading: false,
      messages: [
        {
          role: 'assistant' as const,
          content: "Hey — I'm having trouble connecting right now. Please try again in a moment.",
          timestamp: Date.now(),
        },
      ],
    });
  }
}

function initFloating() {
  loadFonts();

  const root = document.createElement('div');
  root.id = 'wbd-root';
  document.body.appendChild(root);

  let chatWindow: HTMLElement | null = null;

  const fab = createFloatingButton(toggleChat);
  root.appendChild(fab);

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

    chatWindow = createChatWindow(closeChatWindow, initSession);
    root.appendChild(chatWindow);

    if (!state.sessionId || !state.conversationId) {
      await initSession();
    }
  }
}

function init() {
  initBaseUrl();
  initFloating();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
