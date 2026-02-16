import { subscribe, getState } from '../state/store.js';
import type { WidgetMessage } from '../state/store.js';

function renderMessage(msg: WidgetMessage): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = `aicb-msg aicb-msg--${msg.role}`;

  const bubble = document.createElement('div');
  bubble.className = 'aicb-msg__bubble';
  bubble.textContent = msg.content;
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
    // Re-render only when messages change or loading changes
    if (state.messages.length !== prevCount || container.querySelector('.aicb-typing') !== null !== state.isLoading) {
      container.innerHTML = '';
      for (const msg of state.messages) {
        container.appendChild(renderMessage(msg));
      }
      if (state.isLoading) {
        container.appendChild(renderTypingIndicator());
      }
      prevCount = state.messages.length;

      // Auto-scroll to bottom
      requestAnimationFrame(() => {
        container.scrollTop = container.scrollHeight;
      });
    }
  });

  return container;
}
