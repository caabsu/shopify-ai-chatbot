import './styles/widget.css';
import { createFloatingButton } from './ui/FloatingButton.js';
import { createChatWindow } from './ui/ChatWindow.js';
import { getState, setState, loadSession, saveSession, clearSession } from './state/store.js';
import { initBaseUrl, getConfig, createSession } from './api/client.js';

function init() {
  initBaseUrl();

  const root = document.createElement('div');
  root.id = 'aicb-root';
  document.body.appendChild(root);

  let chatWindow: HTMLElement | null = null;

  const fab = createFloatingButton(toggleChat);
  root.appendChild(fab);

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
