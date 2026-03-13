import { getState, subscribe } from '../state/store.js';

export function createInputBar(onSend: (text: string) => void): HTMLElement {
  const container = document.createElement('div');
  container.className = 'aicb-input-bar';

  // Wrapper that holds both input and send button (capsule shape)
  const inputWrap = document.createElement('div');
  inputWrap.className = 'aicb-input-bar__wrap';

  const input = document.createElement('textarea');
  input.className = 'aicb-input-bar__input';
  input.placeholder = getState().inputPlaceholder || 'Type a message...';
  input.rows = 1;

  const sendBtn = document.createElement('button');
  sendBtn.className = 'aicb-input-bar__send';
  sendBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5l7 7-7 7"/></svg>`;
  sendBtn.disabled = true;
  sendBtn.setAttribute('aria-label', 'Send message');

  function handleSend() {
    const text = input.value.trim();
    if (!text || getState().isLoading) return;
    onSend(text);
    input.value = '';
    sendBtn.disabled = true;
    sendBtn.classList.remove('aicb-input-bar__send--visible');
    input.style.height = 'auto';
  }

  input.addEventListener('input', () => {
    const hasText = !!input.value.trim();
    sendBtn.disabled = !hasText || getState().isLoading;
    sendBtn.classList.toggle('aicb-input-bar__send--visible', hasText);
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

  inputWrap.appendChild(input);
  inputWrap.appendChild(sendBtn);
  container.appendChild(inputWrap);

  // Public method to focus the input
  (container as HTMLElement & { focusInput: () => void }).focusInput = () => input.focus();

  return container;
}
