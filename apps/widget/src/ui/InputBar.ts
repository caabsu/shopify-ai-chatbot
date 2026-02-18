import { getState, subscribe } from '../state/store.js';

export function createInputBar(onSend: (text: string) => void): HTMLElement {
  const container = document.createElement('div');
  container.className = 'aicb-input-bar';

  const input = document.createElement('textarea');
  input.className = 'aicb-input-bar__input';
  input.placeholder = getState().inputPlaceholder || 'Type a message...';
  input.rows = 1;

  const sendBtn = document.createElement('button');
  sendBtn.className = 'aicb-input-bar__send';
  sendBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`;
  sendBtn.disabled = true;
  sendBtn.setAttribute('aria-label', 'Send message');

  function handleSend() {
    const text = input.value.trim();
    if (!text || getState().isLoading) return;
    onSend(text);
    input.value = '';
    sendBtn.disabled = true;
    input.style.height = 'auto';
  }

  input.addEventListener('input', () => {
    sendBtn.disabled = !input.value.trim() || getState().isLoading;
    // Auto-resize
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 100) + 'px';
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });

  sendBtn.addEventListener('click', handleSend);

  subscribe((state) => {
    sendBtn.disabled = !input.value.trim() || state.isLoading;
    input.disabled = state.isLoading;
  });

  container.appendChild(input);
  container.appendChild(sendBtn);

  // Public method to focus the input
  (container as HTMLElement & { focusInput: () => void }).focusInput = () => input.focus();

  return container;
}
