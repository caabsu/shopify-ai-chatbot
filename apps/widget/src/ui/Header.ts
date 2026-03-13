import { getState, subscribe } from '../state/store.js';

export function createHeader(onMinimize: () => void, onClose: () => void, onReset?: () => void): HTMLElement {
  const header = document.createElement('div');
  header.className = 'aicb-header';

  const title = getState().headerTitle || 'Outlight Assistant';

  header.innerHTML = `
    <div class="aicb-header__info">
      <span class="aicb-header__title">${title}</span>
    </div>
    <div class="aicb-header__actions">
      <button class="aicb-header__btn aicb-header__reset" aria-label="New conversation">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/></svg>
      </button>
      <button class="aicb-header__btn aicb-header__minimize" aria-label="Minimize chat">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>
      </button>
      <button class="aicb-header__btn aicb-header__close" aria-label="Close chat">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
  `;

  header.querySelector('.aicb-header__minimize')!.addEventListener('click', onMinimize);
  header.querySelector('.aicb-header__close')!.addEventListener('click', onClose);
  if (onReset) {
    header.querySelector('.aicb-header__reset')!.addEventListener('click', onReset);
  }

  // Update title dynamically if it changes
  subscribe((state) => {
    const titleEl = header.querySelector('.aicb-header__title');
    if (titleEl && state.headerTitle && titleEl.textContent !== state.headerTitle) {
      titleEl.textContent = state.headerTitle;
    }
  });

  return header;
}
