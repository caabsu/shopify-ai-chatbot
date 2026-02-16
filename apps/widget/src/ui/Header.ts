export function createHeader(onClose: () => void): HTMLElement {
  const header = document.createElement('div');
  header.className = 'aicb-header';

  header.innerHTML = `
    <div class="aicb-header__info">
      <span class="aicb-header__dot"></span>
      <span class="aicb-header__title">Customer Support</span>
    </div>
    <div class="aicb-header__actions">
      <button class="aicb-header__btn aicb-header__close" aria-label="Close chat">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
  `;

  header.querySelector('.aicb-header__close')!.addEventListener('click', onClose);

  return header;
}
