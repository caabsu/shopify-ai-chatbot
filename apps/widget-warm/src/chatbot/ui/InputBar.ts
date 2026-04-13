import { getState, subscribe } from '../state/store.js';

export function createInputBar(onSend: (text: string) => void): HTMLElement {
  const container = document.createElement('div');
  container.className = 'wbd-input-area';

  const inputWrap = document.createElement('div');
  inputWrap.className = 'wbd-input-wrap';

  const input = document.createElement('textarea');
  input.className = 'wbd-input';
  input.placeholder = 'Ask anything...';
  input.rows = 1;

  const sendBtn = document.createElement('button');
  sendBtn.className = 'wbd-send';
  sendBtn.innerHTML = `<span class="material-symbols-outlined">arrow_upward</span>`;
  sendBtn.disabled = true;
  sendBtn.setAttribute('aria-label', 'Send message');

  function updateSendState() {
    const hasText = !!input.value.trim();
    const loading = getState().isLoading;
    sendBtn.disabled = !hasText || loading;
  }

  function handleSend() {
    const text = input.value.trim();
    if (!text || getState().isLoading) return;
    onSend(text);
    input.value = '';
    sendBtn.disabled = true;
    input.style.height = 'auto';
  }

  input.addEventListener('input', () => {
    updateSendState();
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
  subscribe(() => updateSendState());

  inputWrap.appendChild(input);
  inputWrap.appendChild(sendBtn);
  container.appendChild(inputWrap);

  const powered = document.createElement('div');
  powered.className = 'wbd-powered';
  powered.textContent = 'Designed at 2700K';
  container.appendChild(powered);

  (container as HTMLElement & { focusInput: () => void }).focusInput = () => input.focus();

  return container;
}
