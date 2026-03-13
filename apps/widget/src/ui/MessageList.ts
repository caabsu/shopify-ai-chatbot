import { subscribe, getState } from '../state/store.js';
import type { WidgetMessage, PresetAction } from '../state/store.js';

const BOT_AVATAR_SVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>`;

const PRESET_ICONS: Record<string, string> = {
  truck: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="15" height="13" rx="1"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>`,
  return: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>`,
  search: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
  contact: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22 6 12 13 2 6"/></svg>`,
  sparkles: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5L12 3z"/><path d="M19 15l.5 1.5L21 17l-1.5.5L19 19l-.5-1.5L17 17l1.5-.5L19 15z"/></svg>`,
  leaf: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3v18"/><path d="M6 21C10 15 18 13.5 21 3c-7 2-11 5-15 18z"/></svg>`,
  repeat: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>`,
  user: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
  help: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
  tag: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>`,
  package: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>`,
  headphones: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg>`,
};

const CHEVRON_SVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`;

const CAROUSEL_LEFT_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>`;
const CAROUSEL_RIGHT_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`;

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

  // 4. Links: [text](url) — supports http, https, and mailto
  html = html.replace(
    /\[([^\]]+)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)/g,
    (_, text, url) => {
      const isMailto = url.startsWith('mailto:');
      return `<a href="${url}"${isMailto ? '' : ' target="_blank" rel="noopener"'} class="aicb-inline-link">${text}</a>`;
    }
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

  // Product cards (carousel)
  if (msg.productCards && msg.productCards.length > 0) {
    const carousel = document.createElement('div');
    carousel.className = 'aicb-carousel';

    const leftArrow = document.createElement('button');
    leftArrow.className = 'aicb-carousel__arrow aicb-carousel__arrow--left aicb-carousel__arrow--hidden';
    leftArrow.setAttribute('aria-label', 'Scroll left');
    leftArrow.innerHTML = CAROUSEL_LEFT_SVG;

    const rightArrow = document.createElement('button');
    rightArrow.className = 'aicb-carousel__arrow aicb-carousel__arrow--right';
    rightArrow.setAttribute('aria-label', 'Scroll right');
    rightArrow.innerHTML = CAROUSEL_RIGHT_SVG;

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

    const updateArrows = () => {
      const sl = cardsContainer.scrollLeft;
      const maxScroll = cardsContainer.scrollWidth - cardsContainer.clientWidth;
      leftArrow.classList.toggle('aicb-carousel__arrow--hidden', sl <= 4);
      rightArrow.classList.toggle('aicb-carousel__arrow--hidden', maxScroll <= 4 || sl >= maxScroll - 4);
    };

    cardsContainer.addEventListener('scroll', updateArrows, { passive: true });

    leftArrow.addEventListener('click', () => {
      const scrollAmount = cardsContainer.clientWidth - 40;
      cardsContainer.scrollBy({ left: -scrollAmount, behavior: 'smooth' });
    });

    rightArrow.addEventListener('click', () => {
      const scrollAmount = cardsContainer.clientWidth - 40;
      cardsContainer.scrollBy({ left: scrollAmount, behavior: 'smooth' });
    });

    carousel.appendChild(leftArrow);
    carousel.appendChild(cardsContainer);
    carousel.appendChild(rightArrow);
    content.appendChild(carousel);

    // Check arrows after DOM paint (scrollWidth needs layout)
    requestAnimationFrame(updateArrows);
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

    const iconSvg = PRESET_ICONS[preset.icon] || PRESET_ICONS['help'];

    card.innerHTML = `
      <div class="aicb-preset-card__icon">${iconSvg}</div>
      <span class="aicb-preset-card__label">${preset.label}</span>
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

  let prevCount = -1; // -1 forces initial render
  let prevLoading: boolean | null = null;
  let prevHasUserSent: boolean | null = null;

  function render(state: { messages: WidgetMessage[]; isLoading: boolean; hasUserSentMessage: boolean; presetActions: PresetAction[] }) {
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
  }

  subscribe(render);

  // Initial render from current state (critical for reopen after close)
  render(getState());

  return container;
}
