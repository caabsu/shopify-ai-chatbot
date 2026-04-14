import { subscribe } from '../state/store.js';

export function createHeader(onClose: () => void): HTMLElement {
  const header = document.createElement('div');
  header.className = 'wbd-header';

  header.innerHTML = `
    <div class="wbd-header__row">
      <div class="wbd-header__brand-row">
        <div class="wbd-header__avatar"></div>
        <span class="wbd-header__brand">Warm by Design</span>
      </div>
      <button class="wbd-header__btn wbd-header__minimize" aria-label="Minimize">
        <span class="material-symbols-outlined">keyboard_arrow_down</span>
      </button>
    </div>
    <div class="wbd-header__greeting">Every room deserves <span class="wbd-header__greeting-accent">golden hour.</span></div>
  `;

  header.querySelector('.wbd-header__minimize')!.addEventListener('click', onClose);

  return header;
}
