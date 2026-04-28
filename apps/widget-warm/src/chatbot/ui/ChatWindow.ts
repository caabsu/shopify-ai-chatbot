import { createHeader } from './Header.js';
import { createMessageList } from './MessageList.js';
import { createInputBar } from './InputBar.js';
import { getState, setState, saveSession, clearSession, subscribe } from '../state/store.js';
import * as api from '../api/client.js';
import type { WidgetDesign } from '../api/client.js';
import type { WidgetMessage, PresetAction } from '../state/store.js';

const PRESET_ICONS: Record<string, string> = {
  truck: 'local_shipping',
  return: 'undo',
  search: 'search',
  contact: 'support_agent',
  help: 'help_outline',
  sparkles: 'auto_awesome',
};

const LOCKED_ACTIONS: Array<{
  id: string;
  label: string;
  icon: string;
  prompt?: string;
  href?: string;
}> = [
  {
    id: 'track_order',
    label: 'Track my order',
    icon: 'local_shipping',
    prompt: 'I want to track my order.',
  },
  {
    id: 'start_return',
    label: 'Start a return',
    icon: 'undo',
    href: '/pages/returns',
  },
  {
    id: 'email_support',
    label: 'Email us instead',
    icon: 'mail',
    href: 'mailto:support@warmbydesign.com',
  },
];

function createPresetChips(presets: PresetAction[], onClick: (id: string) => void, onPrompt: (prompt: string) => void): HTMLElement {
  const container = document.createElement('div');
  container.className = 'wbd-presets';

  const renderedActions = LOCKED_ACTIONS.map((action) => {
    const preset = presets.find((candidate) => candidate.id === action.id || candidate.label.toLowerCase().includes(action.label.split(' ')[0].toLowerCase()));
    return {
      ...action,
      prompt: action.prompt ?? preset?.prompt,
      presetId: preset?.id,
      label: preset?.label && action.id === 'track_order' ? preset.label : action.label,
    };
  });

  for (const action of renderedActions) {
    const button = document.createElement(action.href ? 'a' : 'button');
    button.className = 'wbd-action';
    if (action.href) {
      (button as HTMLAnchorElement).href = action.href;
      if (action.href.startsWith('mailto:')) (button as HTMLAnchorElement).target = '_self';
    } else {
      (button as HTMLButtonElement).type = 'button';
    }
    button.innerHTML = `
      <span class="wbd-action__icon material-symbols-outlined">${action.icon}</span>
      <span class="wbd-action__label">${action.label}</span>
      <span class="wbd-action__arrow material-symbols-outlined">chevron_right</span>
    `;
    if (!action.href) {
      button.addEventListener('click', () => {
        if (action.presetId) onClick(action.presetId);
        else if (action.prompt) onPrompt(action.prompt);
      });
    }
    container.appendChild(button);
  }

  return container;
}

export function createChatWindow(onClose: () => void, onSessionInit: () => Promise<void>, design?: WidgetDesign): HTMLElement {
  const win = document.createElement('div');
  win.className = 'wbd-window';

  const header = createHeader(onClose, design);
  const messageList = createMessageList();
  const inputBar = createInputBar(handleSendMessage, design);

  // Presets container — inserted between header and messages
  let presetsEl: HTMLElement | null = null;

  win.appendChild(header);
  // Presets will be inserted here when they load
  win.appendChild(messageList);
  win.appendChild(inputBar);

  // Listen for presets to load from session init
  const unsubPresets = subscribe((state) => {
    if (!state.hasUserSentMessage && state.presetActions.length > 0 && !presetsEl) {
      presetsEl = createPresetChips(state.presetActions, handlePresetClick, handlePromptClick);
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

  async function handlePromptClick(prompt: string) {
    await handleSendMessage(prompt);
  }

  // Focus input on desktop
  if (window.innerWidth > 480) {
    requestAnimationFrame(() => {
      (inputBar as HTMLElement & { focusInput?: () => void }).focusInput?.();
    });
  }

  return win;
}
