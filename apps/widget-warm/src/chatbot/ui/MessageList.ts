import { subscribe, getState } from '../state/store.js';
import type { WidgetMessage } from '../state/store.js';

function renderMarkdown(text: string): string {
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');

  html = html.replace(
    /\[([^\]]+)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)/g,
    (_, linkText, url) => {
      const isMailto = url.startsWith('mailto:');
      return `<a href="${url}"${isMailto ? '' : ' target="_blank" rel="noopener"'} class="wbd-link">${linkText}</a>`;
    }
  );

  const lines = html.split('\n');
  const processed: string[] = [];
  let inList = false;

  for (const line of lines) {
    const listMatch = line.match(/^[-*]\s+(.+)$/);
    if (listMatch) {
      if (!inList) { processed.push('<ul class="wbd-list">'); inList = true; }
      processed.push(`<li>${listMatch[1]}</li>`);
    } else {
      if (inList) { processed.push('</ul>'); inList = false; }
      const kvMatch = line.match(/^<strong>([^<]+)<\/strong>\s*(?:--|:|–)\s*(.+)$/);
      if (kvMatch) {
        processed.push(`<div class="wbd-kv"><span class="wbd-kv__label">${kvMatch[1]}</span><span class="wbd-kv__value">${kvMatch[2]}</span></div>`);
      } else if (line.trim() === '') {
        processed.push('{{BREAK}}');
      } else {
        processed.push(line);
      }
    }
  }
  if (inList) processed.push('</ul>');

  html = processed.join('\n');
  html = html.replace(/(?:\n?{{BREAK}}\n?)+/g, '</p><p>');
  html = html.replace(/\n/g, '<br>');
  html = '<p>' + html + '</p>';
  html = html.replace(/<p>\s*<\/p>/g, '');

  return html;
}

function renderMessage(msg: WidgetMessage): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = `wbd-msg wbd-msg--${msg.role}`;

  const bubble = document.createElement('div');
  bubble.className = 'wbd-msg__bubble';

  if (msg.role === 'assistant') {
    bubble.innerHTML = renderMarkdown(msg.content);
  } else {
    bubble.textContent = msg.content;
  }

  wrapper.appendChild(bubble);

  // Inline product cards
  if (msg.productCards && msg.productCards.length > 0) {
    for (const product of msg.productCards) {
      const card = document.createElement('div');
      card.className = 'wbd-product';
      card.innerHTML = `
        <div class="wbd-product__img">
          ${product.imageUrl
            ? `<img src="${product.imageUrl}" alt="${product.title}" loading="lazy" />`
            : `<span class="material-symbols-outlined">lightbulb</span>`
          }
        </div>
        <div class="wbd-product__info">
          <span class="wbd-product__name">${product.title}</span>
          <span class="wbd-product__price">${product.currency} ${product.price}</span>
          ${product.productUrl ? `<a href="${product.productUrl}" target="_blank" class="wbd-product__link">View product</a>` : ''}
        </div>
      `;
      wrapper.appendChild(card);
    }
  }

  // Navigation buttons
  if (msg.navigationButtons && msg.navigationButtons.length > 0) {
    const navContainer = document.createElement('div');
    navContainer.className = 'wbd-nav-buttons';
    for (const nav of msg.navigationButtons) {
      const link = document.createElement('a');
      link.className = 'wbd-nav-btn';
      link.href = nav.url;
      link.target = '_self';
      link.textContent = nav.label;
      navContainer.appendChild(link);
    }
    wrapper.appendChild(navContainer);
  }

  // Cart data
  if (msg.cartData && msg.cartData.checkoutUrl) {
    const cartEl = document.createElement('div');
    cartEl.className = 'wbd-cart';
    cartEl.innerHTML = `
      <span class="wbd-cart__total">${msg.cartData.lineItems.length} item(s) - ${msg.cartData.currency} ${msg.cartData.totalAmount}</span>
      <a class="wbd-cart__checkout" href="${msg.cartData.checkoutUrl}" target="_blank">Checkout</a>
    `;
    wrapper.appendChild(cartEl);
  }

  return wrapper;
}

function renderTypingIndicator(): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'wbd-msg wbd-msg--assistant wbd-typing';
  wrapper.innerHTML = `<div class="wbd-msg__bubble wbd-typing__bubble"><span></span><span></span><span></span></div>`;
  return wrapper;
}

export function createMessageList(): HTMLElement {
  const container = document.createElement('div');
  container.className = 'wbd-messages';

  let prevCount = -1;
  let prevLoading: boolean | null = null;

  function render(state: { messages: WidgetMessage[]; isLoading: boolean }) {
    if (state.messages.length === prevCount && state.isLoading === prevLoading) return;

    container.innerHTML = '';

    for (const msg of state.messages) {
      container.appendChild(renderMessage(msg));
    }

    if (state.isLoading) {
      container.appendChild(renderTypingIndicator());
    }

    prevCount = state.messages.length;
    prevLoading = state.isLoading;

    requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
    });
  }

  subscribe(render);
  render(getState());

  return container;
}
