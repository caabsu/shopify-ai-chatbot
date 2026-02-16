import { getState, subscribe } from '../state/store.js';

const CHAT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
const CLOSE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;

export function createFloatingButton(onClick: () => void): HTMLElement {
  const btn = document.createElement('button');
  btn.className = 'aicb-fab';
  btn.innerHTML = CHAT_SVG;
  btn.setAttribute('aria-label', 'Open chat');
  btn.addEventListener('click', onClick);

  subscribe((state) => {
    btn.innerHTML = state.isOpen ? CLOSE_SVG : CHAT_SVG;
    btn.setAttribute('aria-label', state.isOpen ? 'Close chat' : 'Open chat');
    btn.classList.toggle('aicb-fab--open', state.isOpen);
  });

  return btn;
}
