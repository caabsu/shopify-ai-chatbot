import { subscribe, getState } from '../state/store.js';
import type { WidgetMessage, PresetAction } from '../state/store.js';

const BOT_AVATAR_SVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>`;

const PRESET_ICONS: Record<string, string> = {
  truck: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="15" height="13" rx="1"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>`,
  return: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>`,
  search: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
  contact: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
};

const CHEVRON_SVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`;

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

      // Detect "**Label** — Value" or "**Label:** Value" patterns
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
  html = html.replace(/(?:\n?{{BREAK}}\n?)+/g, '</p><p>');
  html = html.replace(/\n/g, '<br>');
  html = '<p>' + html + '</p>';

  // Clean up
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

  // Add bot avatar for assistant messages
  if (msg.role === 'assistant') {
    const avatar = document.createElement('div');
    avatar.className = 'aicb-msg__avatar';
    avatar.innerHTML = BOT_AVATAR_SVG;
    wrapper.appendChild(avatar);
  }

  const content = document.createElement('div');
  content.className = 'aicb-msg__content';

  const bubble = document.createElement('div');
  bubble.className = 'aicb-msg__bubble';

  if (msg.role === 'assistant') {
    bubble.innerHTML = renderMarkdown(msg.content);
  } else {
    bubble.textContent = msg.content;
  }

  content.appendChild(bubble);

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
    content.appendChild(navContainer);
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
    content.appendChild(cardsContainer);
  }

  // Cart data
  if (msg.cartData && msg.cartData.checkoutUrl) {
    const cartEl = document.createElement('div');
    cartEl.className = 'aicb-cart-summary';
    cartEl.innerHTML = `
      <div class="aicb-cart-summary__total">${msg.cartData.lineItems.length} item(s) - ${msg.cartData.currency} ${msg.cartData.totalAmount}</div>
      <a class="aicb-cart-summary__checkout" href="${msg.cartData.checkoutUrl}" target="_blank">Checkout</a>
    `;
    content.appendChild(cartEl);
  }

  wrapper.appendChild(content);

  return wrapper;
}

function renderPresetCards(presets: PresetAction[], onSelect: (id: string) => void): HTMLElement {
  const container = document.createElement('div');
  container.className = 'aicb-preset-cards';

  for (const preset of presets) {
    const card = document.createElement('button');
    card.className = 'aicb-preset-card';

    const iconSvg = PRESET_ICONS[preset.icon] || PRESET_ICONS['search'];

    card.innerHTML = `
      <div class="aicb-preset-card__icon">${iconSvg}</div>
      <span class="aicb-preset-card__label">${preset.label}</span>
      <span class="aicb-preset-card__chevron">${CHEVRON_SVG}</span>
    `;

    card.addEventListener('click', () => onSelect(preset.id));
    container.appendChild(card);
  }

  return container;
}

function renderTypingIndicator(): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'aicb-msg aicb-msg--assistant aicb-typing';

  const avatar = document.createElement('div');
  avatar.className = 'aicb-msg__avatar';
  avatar.innerHTML = BOT_AVATAR_SVG;
  wrapper.appendChild(avatar);

  const content = document.createElement('div');
  content.className = 'aicb-msg__content';
  content.innerHTML = `<div class="aicb-msg__bubble aicb-typing__bubble"><span></span><span></span><span></span></div>`;
  wrapper.appendChild(content);

  return wrapper;
}

export function createMessageList(onPresetSelect: (id: string) => void): HTMLElement {
  const container = document.createElement('div');
  container.className = 'aicb-messages';

  let prevCount = 0;
  let prevLoading = false;
  let prevHasUserSent = false;

  subscribe((state) => {
    const needsRender =
      state.messages.length !== prevCount ||
      state.isLoading !== prevLoading ||
      state.hasUserSentMessage !== prevHasUserSent;

    if (needsRender) {
      container.innerHTML = '';

      for (const msg of state.messages) {
        container.appendChild(renderMessage(msg));
      }

      // Show preset action cards after greeting (before user sends anything)
      if (!state.hasUserSentMessage && state.presetActions.length > 0 && !state.isLoading) {
        container.appendChild(renderPresetCards(state.presetActions, onPresetSelect));
      }

      if (state.isLoading) {
        container.appendChild(renderTypingIndicator());
      }

      prevCount = state.messages.length;
      prevLoading = state.isLoading;
      prevHasUserSent = state.hasUserSentMessage;

      requestAnimationFrame(() => {
        container.scrollTop = container.scrollHeight;
      });
    }
  });

  return container;
}
