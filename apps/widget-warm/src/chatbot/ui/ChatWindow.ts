import { createHeader } from './Header.js';
import { createMessageList } from './MessageList.js';
import { createInputBar } from './InputBar.js';
import { getState, setState, saveSession, clearSession, subscribe } from '../state/store.js';
import * as api from '../api/client.js';
import type { WidgetMessage, PresetAction } from '../state/store.js';

const PRESET_ICONS: Record<string, string> = {
  truck: 'local_shipping',
  return: 'undo',
  search: 'search',
  contact: 'support_agent',
  help: 'help_outline',
  sparkles: 'auto_awesome',
};

function createPresetChips(presets: PresetAction[], onClick: (id: string) => void): HTMLElement {
  const container = document.createElement('div');
  container.className = 'wbd-presets';

  for (const preset of presets) {
    const chip = document.createElement('button');
    chip.className = 'wbd-preset-chip';
    const iconName = PRESET_ICONS[preset.icon] || 'chat_bubble_outline';
    chip.innerHTML = `<span class="material-symbols-outlined">${iconName}</span>${preset.label}`;
    chip.addEventListener('click', () => onClick(preset.id));
    container.appendChild(chip);
  }

  return container;
}

export function createChatWindow(onClose: () => void, onSessionInit: () => Promise<void>): HTMLElement {
  const win = document.createElement('div');
  win.className = 'wbd-window';

  const header = createHeader(onClose);
  const messageList = createMessageList();
  const inputBar = createInputBar(handleSendMessage);

  // Presets container — inserted between header and messages
  let presetsEl: HTMLElement | null = null;

  win.appendChild(header);
  // Presets will be inserted here when they load
  win.appendChild(messageList);
  win.appendChild(inputBar);

  // Listen for presets to load from session init
  const unsubPresets = subscribe((state) => {
    if (!state.hasUserSentMessage && state.presetActions.length > 0 && !presetsEl) {
      presetsEl = createPresetChips(state.presetActions, handlePresetClick);
      win.insertBefore(presetsEl, messageList);
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

    // Remove presets after first message
    if (presetsEl) {
      presetsEl.remove();
      presetsEl = null;
    }

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

    if (presetsEl) {
      presetsEl.remove();
      presetsEl = null;
    }

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
