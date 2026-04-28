import { subscribe } from '../state/store.js';
import type { WidgetDesign } from '../api/client.js';

function escapeHtml(text: string): string {
  const el = document.createElement('span');
  el.textContent = text;
  return el.innerHTML;
}

export function createHeader(onClose: () => void, design?: WidgetDesign): HTMLElement {
  const header = document.createElement('div');
  header.className = 'wbd-header';
  const brand = design?.headerTitle && design.headerTitle !== 'Outlight Assistant'
    ? design.headerTitle
    : 'Warm by Design';
  const greeting = design?.greetingHeader || 'Every room deserves golden hour.';

  header.innerHTML = `
    <div class="wbd-header__row">
      <div class="wbd-header__brand-row">
        <div class="wbd-header__avatar"></div>
        <span class="wbd-header__brand">${escapeHtml(brand)}</span>
      </div>
      <button class="wbd-header__btn wbd-header__minimize" aria-label="Minimize">
        <span class="material-symbols-outlined">keyboard_arrow_down</span>
      </button>
    </div>
    <div class="wbd-header__greeting">${escapeHtml(greeting)}</div>
    ${design?.greetingSubtext ? `<div class="wbd-header__subtext">${escapeHtml(design.greetingSubtext)}</div>` : ''}
  `;

  header.querySelector('.wbd-header__minimize')!.addEventListener('click', onClose);

  return header;
}
