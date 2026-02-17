import { subscribe, getState } from '../state/store.js';
import type { WidgetMessage } from '../state/store.js';

/** Lightweight markdown-to-HTML for chat bubbles. Escapes HTML first for safety. */
function renderMarkdown(text: string): string {
  // 1. Escape HTML entities
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // 2. Bold: **text**
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // 3. Italic: *text* (but not inside bold)
  html = html.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');

  // 4. Links: [text](url)
  html = html.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener" class="aicb-inline-link">$1</a>'
  );

  // 5. Process lines for lists and key-value detection
  const lines = html.split('\n');
  const processed: string[] = [];
  let inList = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const listMatch = line.match(/^[-*]\s+(.+)$/);

    if (listMatch) {
      if (!inList) {
        processed.push('<ul class="aicb-md-list">');
        inList = true;
      }
      processed.push(`<li>${listMatch[1]}</li>`);
    } else {
      if (inList) {
        processed.push('</ul>');
        inList = false;
      }

      // Detect "**Label** — Value" or "**Label:** Value" patterns for key-value rendering
      const kvMatch = line.match(/^<strong>([^<]+)<\/strong>\s*(?:—|:|–)\s*(.+)$/);
      if (kvMatch) {
        processed.push(`<div class="aicb-kv"><span class="aicb-kv__label">${kvMatch[1]}</span><span class="aicb-kv__value">${kvMatch[2]}</span></div>`);
      } else if (line.trim() === '') {
        processed.push('{{BREAK}}');
      } else {
        processed.push(line);
      }
    }
  }

  if (inList) processed.push('</ul>');

  // 6. Join and create paragraphs
  html = processed.join('\n');

  // Replace double breaks with paragraph separators
  html = html.replace(/(?:\n?{{BREAK}}\n?)+/g, '</p><p>');
  html = html.replace(/\n/g, '<br>');

  // Wrap in paragraph tags
  html = '<p>' + html + '</p>';

  // Clean up empty and double-wrapped elements
  html = html.replace(/<p>\s*<\/p>/g, '');
  html = html.replace(/<p>(<(?:ul|div)[^>]*>)/g, '$1');
  html = html.replace(/(<\/(?:ul|div)>)<\/p>/g, '$1');
  html = html.replace(/<p><br><\/p>/g, '');
  html = html.replace(/<br>(<div class="aicb-kv)/g, '$1');
  html = html.replace(/(aicb-kv__value">[^<]*<\/span><\/div>)<br>/g, '$1');
  html = html.replace(/<br>(<ul)/g, '$1');
  html = html.replace(/(<\/ul>)<br>/g, '$1');

  return html;
}

function renderMessage(msg: WidgetMessage): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = `aicb-msg aicb-msg--${msg.role}`;

  const bubble = document.createElement('div');
  bubble.className = 'aicb-msg__bubble';

  if (msg.role === 'assistant') {
    bubble.innerHTML = renderMarkdown(msg.content);
  } else {
    bubble.textContent = msg.content;
  }

  wrapper.appendChild(bubble);

  // Navigation buttons
  if (msg.navigationButtons && msg.navigationButtons.length > 0) {
    const navContainer = document.createElement('div');
    navContainer.className = 'aicb-msg__nav-buttons';
    for (const nav of msg.navigationButtons) {
      const link = document.createElement('a');
      link.className = 'aicb-nav-btn';
      link.href = nav.url;
      link.target = '_self';
      link.textContent = nav.label;
      navContainer.appendChild(link);
    }
    wrapper.appendChild(navContainer);
  }

  // Product cards
  if (msg.productCards && msg.productCards.length > 0) {
    const cardsContainer = document.createElement('div');
    cardsContainer.className = 'aicb-product-cards';
    for (const product of msg.productCards) {
      const card = document.createElement('div');
      card.className = 'aicb-product-card';
      card.innerHTML = `
        ${product.imageUrl ? `<img class="aicb-product-card__img" src="${product.imageUrl}" alt="${product.title}" loading="lazy" />` : ''}
        <div class="aicb-product-card__info">
          <div class="aicb-product-card__title">${product.title}</div>
          <div class="aicb-product-card__price">${product.currency} ${product.price}</div>
          ${product.productUrl ? `<a class="aicb-product-card__link" href="${product.productUrl}" target="_blank">View Product</a>` : ''}
        </div>
      `;
      cardsContainer.appendChild(card);
    }
    wrapper.appendChild(cardsContainer);
  }

  // Cart data
  if (msg.cartData && msg.cartData.checkoutUrl) {
    const cartEl = document.createElement('div');
    cartEl.className = 'aicb-cart-summary';
    cartEl.innerHTML = `
      <div class="aicb-cart-summary__total">${msg.cartData.lineItems.length} item(s) - ${msg.cartData.currency} ${msg.cartData.totalAmount}</div>
      <a class="aicb-cart-summary__checkout" href="${msg.cartData.checkoutUrl}" target="_blank">Checkout</a>
    `;
    wrapper.appendChild(cartEl);
  }

  return wrapper;
}

function renderTypingIndicator(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'aicb-msg aicb-msg--assistant aicb-typing';
  el.innerHTML = `<div class="aicb-msg__bubble aicb-typing__bubble"><span></span><span></span><span></span></div>`;
  return el;
}

export function createMessageList(): HTMLElement {
  const container = document.createElement('div');
  container.className = 'aicb-messages';

  let prevCount = 0;

  subscribe((state) => {
    if (state.messages.length !== prevCount || container.querySelector('.aicb-typing') !== null !== state.isLoading) {
      container.innerHTML = '';
      for (const msg of state.messages) {
        container.appendChild(renderMessage(msg));
      }
      if (state.isLoading) {
        container.appendChild(renderTypingIndicator());
      }
      prevCount = state.messages.length;

      requestAnimationFrame(() => {
        container.scrollTop = container.scrollHeight;
      });
    }
  });

  return container;
}
