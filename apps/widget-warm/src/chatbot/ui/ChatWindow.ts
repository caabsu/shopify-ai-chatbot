import { createHeader, updatePresets } from './Header.js';
import { createMessageList } from './MessageList.js';
import { createInputBar } from './InputBar.js';
import { getState, setState, saveSession, clearSession, subscribe } from '../state/store.js';
import * as api from '../api/client.js';
import type { WidgetMessage } from '../state/store.js';

export function createChatWindow(onClose: () => void, onSessionInit: () => Promise<void>): HTMLElement {
  const win = document.createElement('div');
  win.className = 'wbd-window';

  function handleReset() {
    clearSession();
    if (onSessionInit) onSessionInit();
  }

  const header = createHeader(onClose, handleReset, handlePresetClick);
  const messageList = createMessageList();
  const inputBar = createInputBar(handleSendMessage);

  win.appendChild(header);
  win.appendChild(messageList);
  win.appendChild(inputBar);

  // Update preset chips when they load from session
  subscribe((state) => {
    if (!state.hasUserSentMessage && state.presetActions.length > 0) {
      updatePresets(header, state.presetActions, handlePresetClick);
    }
  });

  async function handleSendMessage(text: string) {
    const state = getState();
    if (!state.sessionId || !state.conversationId) return;

    const userMsg: WidgetMessage = { role: 'user', content: text, timestamp: Date.now() };

    setState({
      messages: [...state.messages, userMsg],
      isLoading: true,
      hasUserSentMessage: true,
      lastActivity: Date.now(),
      error: null,
    });
    saveSession();

    // Hide presets after first message
    const presetsEl = header.querySelector('.wbd-presets');
    if (presetsEl) presetsEl.remove();

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
      setState({
        messages: [...getState().messages, { role: 'assistant' as const, content: errorMsg, timestamp: Date.now() }],
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

    const userMsg: WidgetMessage = { role: 'user', content: preset.prompt, timestamp: Date.now() };

    setState({
      messages: [...state.messages, userMsg],
      isLoading: true,
      hasUserSentMessage: true,
      lastActivity: Date.now(),
      error: null,
    });
    saveSession();

    const presetsEl = header.querySelector('.wbd-presets');
    if (presetsEl) presetsEl.remove();

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

  // Focus input on desktop
  if (window.innerWidth > 480) {
    requestAnimationFrame(() => {
      (inputBar as HTMLElement & { focusInput?: () => void }).focusInput?.();
    });
  }

  return win;
}
