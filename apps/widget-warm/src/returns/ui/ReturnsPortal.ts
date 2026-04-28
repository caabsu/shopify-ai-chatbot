import { lookupOrder, submitReturn } from '../api/client.js';
import type { OrderItem, ReturnsPortalConfig } from '../api/client.js';

const DEFAULT_REASONS: Record<string, string> = {
  changed_mind: 'Changed my mind',
  wrong_item: 'Ordered the wrong item',
  defective: 'Item arrived damaged',
  not_as_described: "Doesn't match description",
  doesnt_fit: "Doesn't fit the space",
  too_small: 'Too small',
  too_large: 'Too large',
  arrived_late: 'Arrived late',
  other: 'Other',
};

function escapeHtml(text: string): string {
  const el = document.createElement('span');
  el.textContent = text;
  return el.innerHTML;
}

export function createReturnsPortal(config?: ReturnsPortalConfig): HTMLElement {
  const section = document.createElement('section');
  section.className = 'wbd-returns';

  const settings = config?.settings ?? {};
  const design = config?.design ?? {};
  const portalTitle = settings.portal_title || 'Start a return';
  const portalDescription = settings.portal_description || 'Start a return request for eligible Warm by Design orders.';
  const returnWindow = settings.return_window_days ? `${settings.return_window_days} days` : '30 days';
  const availableReasons = settings.available_reasons?.length ? settings.available_reasons : Object.keys(DEFAULT_REASONS);
  const reasonLabels = { ...DEFAULT_REASONS, ...(settings.reason_labels ?? {}) };

  if (design.primaryColor) section.style.setProperty('--wbd-returns-accent', design.primaryColor);
  if (design.backgroundColor) section.style.setProperty('--wbd-returns-bg', design.backgroundColor);
  if (design.cardBackgroundColor) section.style.setProperty('--wbd-returns-card-bg', design.cardBackgroundColor);
  if (design.textColor) section.style.setProperty('--wbd-returns-text', design.textColor);
  if (design.mutedTextColor) section.style.setProperty('--wbd-returns-muted', design.mutedTextColor);
  if (design.fontFamily) section.style.setProperty('--wbd-returns-font', design.fontFamily);
  if (design.headingFontFamily) section.style.setProperty('--wbd-returns-heading-font', design.headingFontFamily);
  if (design.borderRadius) section.style.setProperty('--wbd-returns-radius', radiusValue(design.borderRadius));
  if (design.fontSize) section.style.setProperty('--wbd-returns-base-size', fontSizeValue(design.fontSize));

  let orderId = '';
  let orderNumber = '';
  let customerEmail = '';
  let customerName: string | null | undefined = null;
  let selectedItems: Set<string> = new Set();
  let items: OrderItem[] = [];

  // Header
  const header = document.createElement('div');
  header.className = 'wbd-returns__header';
  header.innerHTML = `
    <div class="wbd-returns__label">Returns</div>
    <h2 class="wbd-returns__title">${escapeHtml(portalTitle)}</h2>
    <p class="wbd-returns__subtitle">${escapeHtml(portalDescription)}</p>
  `;
  section.appendChild(header);

  // Card
  const card = document.createElement('div');
  card.className = 'wbd-returns__card';

  // Order lookup section
  const lookupSection = document.createElement('div');
  lookupSection.className = 'wbd-returns__section';
  lookupSection.innerHTML = `
    <div class="wbd-returns__section-label">Find your order</div>
    <div class="wbd-returns__row">
      <div class="wbd-returns__field">
        <label class="wbd-returns__field-label">Order number</label>
        <input type="text" class="wbd-returns__input" id="wbd-order-number" placeholder="#WBD-0000">
      </div>
      <div class="wbd-returns__field">
        <label class="wbd-returns__field-label">Email</label>
        <input type="email" class="wbd-returns__input" id="wbd-order-email" placeholder="you@email.com">
      </div>
    </div>
    <button class="wbd-returns__lookup-btn" id="wbd-lookup-btn">
      <span class="material-symbols-outlined">search</span>
      ${escapeHtml(design.buttonTextLookup || 'Look up order')}
    </button>
    <div class="wbd-returns__error" id="wbd-lookup-error"></div>
  `;
  card.appendChild(lookupSection);

  // Divider
  const divider = document.createElement('div');
  divider.className = 'wbd-returns__divider';
  card.appendChild(divider);

  // Items section (hidden initially)
  const itemsSection = document.createElement('div');
  itemsSection.className = 'wbd-returns__section wbd-returns__section--hidden';
  itemsSection.id = 'wbd-items-section';
  itemsSection.innerHTML = `
    <div class="wbd-returns__section-label">Select items to return</div>
    <div class="wbd-returns__items" id="wbd-items-list"></div>
  `;
  card.appendChild(itemsSection);

  // Reason section (hidden initially)
  const reasonSection = document.createElement('div');
  reasonSection.className = 'wbd-returns__section wbd-returns__section--hidden';
  reasonSection.id = 'wbd-reason-section';
  reasonSection.innerHTML = `
    <div class="wbd-returns__row" style="margin-bottom:16px;">
      <div class="wbd-returns__field wbd-returns__field--full">
        <label class="wbd-returns__field-label">Reason for return</label>
        <select class="wbd-returns__select" id="wbd-reason">
          <option value="" disabled selected>Select a reason</option>
          ${availableReasons.map((reason) => `<option value="${escapeHtml(reason)}">${escapeHtml(reasonLabels[reason] || reason)}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="wbd-returns__row">
      <div class="wbd-returns__field wbd-returns__field--full">
        <label class="wbd-returns__field-label">Additional details (optional)</label>
        <textarea class="wbd-returns__textarea" id="wbd-notes" placeholder="Anything else we should know?"></textarea>
      </div>
    </div>
    <button class="wbd-returns__submit" id="wbd-submit-btn">${escapeHtml(design.buttonTextSubmit || 'Submit return request')}</button>
    <div class="wbd-returns__error" id="wbd-submit-error"></div>
  `;
  card.appendChild(reasonSection);

  // Success message (hidden initially)
  const successSection = document.createElement('div');
  successSection.className = 'wbd-returns__section wbd-returns__section--hidden';
  successSection.id = 'wbd-success-section';
  successSection.innerHTML = `
    <div class="wbd-returns__success">
      <span class="material-symbols-outlined wbd-returns__success-icon">check_circle</span>
      <h3 class="wbd-returns__success-title">${escapeHtml(design.successTitle || 'Return request submitted')}</h3>
      <p class="wbd-returns__success-text">${escapeHtml(design.successMessage || "We'll send you a return label and instructions within 2 business days.")}</p>
    </div>
  `;
  card.appendChild(successSection);

  section.appendChild(card);

  // Meta strip
  const meta = document.createElement('div');
  meta.className = 'wbd-returns__meta';
  meta.innerHTML = `
    <span class="wbd-returns__meta-item">
      <span class="material-symbols-outlined">schedule</span>
      Processed within 2 business days
    </span>
    <span class="wbd-returns__meta-item">
      <span class="material-symbols-outlined">local_shipping</span>
      Return window: ${escapeHtml(returnWindow)}
    </span>
  `;
  section.appendChild(meta);

  // ── Event Handlers ──

  // Lookup
  const lookupBtn = card.querySelector('#wbd-lookup-btn') as HTMLButtonElement;
  const lookupError = card.querySelector('#wbd-lookup-error') as HTMLElement;

  lookupBtn.addEventListener('click', async () => {
    const orderNum = (card.querySelector('#wbd-order-number') as HTMLInputElement).value.trim();
    const email = (card.querySelector('#wbd-order-email') as HTMLInputElement).value.trim();

    if (!orderNum || !email) {
      lookupError.textContent = 'Please enter both your order number and email.';
      lookupError.classList.add('wbd-returns__error--visible');
      return;
    }

    lookupError.classList.remove('wbd-returns__error--visible');
    lookupBtn.disabled = true;
    lookupBtn.textContent = 'Looking up...';

    try {
      const result = await lookupOrder(orderNum, email);
      orderId = result.orderId;
      orderNumber = result.orderNumber;
      customerEmail = result.customerEmail;
      customerName = result.customerName;
      items = result.items;
      renderItems(result.items);
      itemsSection.classList.remove('wbd-returns__section--hidden');
      reasonSection.classList.remove('wbd-returns__section--hidden');
    } catch (err) {
      lookupError.textContent = err instanceof Error ? err.message : 'Order not found. Please check your details.';
      lookupError.classList.add('wbd-returns__error--visible');
    } finally {
      lookupBtn.disabled = false;
      lookupBtn.innerHTML = `<span class="material-symbols-outlined">search</span>${escapeHtml(design.buttonTextLookup || 'Look up order')}`;
    }
  });

  function renderItems(orderItems: OrderItem[]) {
    const list = card.querySelector('#wbd-items-list') as HTMLElement;
    list.innerHTML = '';

    for (const item of orderItems) {
      if (!item.returnEligible) continue;

      const row = document.createElement('div');
      row.className = 'wbd-returns__item';
      row.dataset.id = item.id;

      row.innerHTML = `
        <div class="wbd-returns__item-check">
          <span class="material-symbols-outlined">check</span>
        </div>
        <div class="wbd-returns__item-thumb">
          ${item.imageUrl
            ? `<img src="${item.imageUrl}" alt="${item.title}" />`
            : `<span class="material-symbols-outlined">lightbulb</span>`
          }
        </div>
        <div class="wbd-returns__item-info">
          <div class="wbd-returns__item-name">${item.title}</div>
          <div class="wbd-returns__item-variant">${item.variantTitle}</div>
        </div>
        <div class="wbd-returns__item-price">${item.currency ? `${item.currency} ` : ''}${item.price}</div>
      `;

      row.addEventListener('click', () => {
        row.classList.toggle('wbd-returns__item--selected');
        if (selectedItems.has(item.id)) {
          selectedItems.delete(item.id);
        } else {
          selectedItems.add(item.id);
        }
      });

      list.appendChild(row);
    }
  }

  // Submit
  const submitBtn = card.querySelector('#wbd-submit-btn') as HTMLButtonElement;
  const submitError = card.querySelector('#wbd-submit-error') as HTMLElement;

  submitBtn.addEventListener('click', async () => {
    const reason = (card.querySelector('#wbd-reason') as HTMLSelectElement).value;
    const notes = (card.querySelector('#wbd-notes') as HTMLTextAreaElement).value.trim();

    if (selectedItems.size === 0) {
      submitError.textContent = 'Please select at least one item to return.';
      submitError.classList.add('wbd-returns__error--visible');
      return;
    }

    if (!reason) {
      submitError.textContent = 'Please select a reason for your return.';
      submitError.classList.add('wbd-returns__error--visible');
      return;
    }

    submitError.classList.remove('wbd-returns__error--visible');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting...';

    try {
      const selectedReturnItems = Array.from(selectedItems).map((id) => {
        const item = items.find((candidate) => candidate.id === id);
        if (!item) {
          throw new Error('Selected item is no longer available. Please look up the order again.');
        }

        const numericPrice = parseFloat(item.price.replace(/[^0-9.]/g, '')) || 0;
        return {
          line_item_id: item.id,
          product_title: item.title,
          variant_title: item.variantTitle,
          product_image_url: item.imageUrl ?? null,
          quantity: item.quantity,
          price: numericPrice,
          reason,
          reason_details: notes || null,
        };
      });

      await submitReturn({
        orderId,
        orderNumber,
        customerEmail,
        customerName,
        items: selectedReturnItems,
      });

      // Show success
      lookupSection.classList.add('wbd-returns__section--hidden');
      divider.classList.add('wbd-returns__section--hidden');
      itemsSection.classList.add('wbd-returns__section--hidden');
      reasonSection.classList.add('wbd-returns__section--hidden');
      successSection.classList.remove('wbd-returns__section--hidden');
    } catch (err) {
      submitError.textContent = err instanceof Error ? err.message : 'Something went wrong. Please try again.';
      submitError.classList.add('wbd-returns__error--visible');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = design.buttonTextSubmit || 'Submit return request';
    }
  });

  return section;
}

function radiusValue(radius: 'sharp' | 'rounded' | 'pill'): string {
  if (radius === 'sharp') return '0';
  if (radius === 'pill') return '24px';
  return '12px';
}

function fontSizeValue(size: 'small' | 'medium' | 'large'): string {
  if (size === 'small') return '13px';
  if (size === 'large') return '16px';
  return '14px';
}
