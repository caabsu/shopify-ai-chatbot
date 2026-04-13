import { subscribe } from '../state/store.js';

export function createFloatingButton(onClick: () => void): HTMLElement {
  const btn = document.createElement('button');
  btn.className = 'wbd-fab';
  btn.setAttribute('aria-label', 'Open chat');

  btn.innerHTML = `<span class="material-symbols-outlined wbd-fab__icon-chat">chat_bubble</span>
<span class="material-symbols-outlined wbd-fab__icon-close">close</span>`;

  btn.addEventListener('click', onClick);

  subscribe((state) => {
    btn.classList.toggle('wbd-fab--open', state.isOpen);
    btn.setAttribute('aria-label', state.isOpen ? 'Close chat' : 'Open chat');
  });

  return btn;
}
