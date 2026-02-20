import { createHeader } from './Header.js';
import { createMessageList } from './MessageList.js';
import { createInputBar } from './InputBar.js';
import { getState, setState, saveSession, subscribe } from '../state/store.js';
import * as api from '../api/client.js';
import type { WidgetMessage } from '../state/store.js';

export function createChatWindow(onClose: () => void): HTMLElement {
  const window = document.createElement('div');
  window.className = 'aicb-window';

  const header = createHeader(onClose, onClose);
  const messageList = createMessageList(handlePresetClick);
  const inputBar = createInputBar(handleSendMessage);

  window.appendChild(header);
  window.appendChild(messageList);
  window.appendChild(inputBar);

  // Branding badge
  const state = getState();
  if (state.showBrandingBadge) {
    const branding = document.createElement('div');
    branding.className = 'aicb-branding';
    branding.innerHTML = '<span class="aicb-branding__text">Powered by Outlight</span>';
    window.appendChild(branding);
  }

  async function handleSendMessage(text: string) {
    const state = getState();
    if (!state.sessionId || !state.conversationId) return;

    const userMsg: WidgetMessage = {
      role: 'user',
      content: text,
      timestamp: Date.now(),
    };

    setState({
      messages: [...state.messages, userMsg],
      isLoading: true,
      hasUserSentMessage: true,
      lastActivity: Date.now(),
      error: null,
    });
    saveSession();

    try {
      const result = await api.sendMessage({
        sessionId: state.sessionId,
        conversationId: state.conversationId,
        message: text,
      });

      const assistantMsg: WidgetMessage = {
        role: 'assistant',
        content: result.response,
        timestamp: Date.now(),
        navigationButtons: result.navigationButtons,
        productCards: result.productCards,
        cartData: result.cartData,
      };

      setState({
        messages: [...getState().messages, assistantMsg],
        isLoading: false,
        lastActivity: Date.now(),
      });
      saveSession();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Something went wrong';
      const assistantMsg: WidgetMessage = {
        role: 'assistant',
        content: errorMsg,
        timestamp: Date.now(),
      };
      setState({
        messages: [...getState().messages, assistantMsg],
        isLoading: false,
        error: errorMsg,
      });
    }
  }

  async function handlePresetClick(presetId: string) {
    const state = getState();
    if (!state.sessionId || !state.conversationId) return;

    const preset = state.presetActions.find((p) => p.id === presetId);
    if (!preset) return;

    const userMsg: WidgetMessage = {
      role: 'user',
      content: preset.prompt,
      timestamp: Date.now(),
    };

    setState({
      messages: [...state.messages, userMsg],
      isLoading: true,
      hasUserSentMessage: true,
      lastActivity: Date.now(),
      error: null,
    });
    saveSession();

    try {
      const result = await api.sendMessage({
        sessionId: state.sessionId,
        conversationId: state.conversationId,
        presetActionId: presetId,
      });

      const assistantMsg: WidgetMessage = {
        role: 'assistant',
        content: result.response,
        timestamp: Date.now(),
        navigationButtons: result.navigationButtons,
        productCards: result.productCards,
        cartData: result.cartData,
      };

      setState({
        messages: [...getState().messages, assistantMsg],
        isLoading: false,
        lastActivity: Date.now(),
      });
      saveSession();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Something went wrong';
      setState({
        messages: [...getState().messages, { role: 'assistant' as const, content: errorMsg, timestamp: Date.now() }],
        isLoading: false,
        error: errorMsg,
      });
    }
  }

  // Focus input when window opens (desktop only — avoid keyboard pop on mobile)
  if (window.innerWidth > 480) {
    requestAnimationFrame(() => {
      const inputEl = inputBar as HTMLElement & { focusInput?: () => void };
      inputEl.focusInput?.();
    });
  }

  return window;
}
