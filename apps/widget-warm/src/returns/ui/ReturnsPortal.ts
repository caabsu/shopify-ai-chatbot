import { lookupOrder, submitReturn } from '../api/client.js';
import type { OrderItem, ReturnsPortalConfig } from '../api/client.js';

const DEFAULT_REASONS: Record<string, string> = {
  doesnt_fit: 'Wrong size',
  wrong_item: 'Wrong color',
  defective: 'Arrived damaged',
  not_as_described: 'Brightness off',
  changed_mind: 'Changed my mind',
  other: 'Other',
};

const REFUND_METHODS = [
  { id: 'original', label: 'Original card', description: 'Refund to original payment', bonus: 0 },
  { id: 'store_credit', label: 'Store credit', description: '+10% bonus - instant', bonus: 0.1 },
  { id: 'exchange', label: 'Exchange', description: 'Pick a different lamp', bonus: 0 },
] as const;

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
  const portalTitle = settings.portal_title || 'Start a return.';
  const portalDescription = settings.portal_description || `${settings.return_window_days ?? 30} days. Free shipping back. No questions.`;
  const availableReasons = settings.available_reasons?.length ? settings.available_reasons : Object.keys(DEFAULT_REASONS);
  const reasonLabels = { ...DEFAULT_REASONS, ...(settings.reason_labels ?? {}) };

  applyDesignVariables(section, design);

  let orderId = '';
  let orderNumber = '';
  let customerEmail = '';
  let customerName: string | null | undefined = null;
  let items: OrderItem[] = [];
  const selectedItems = new Set<string>();
  let selectedReason = availableReasons[0] ?? 'other';
  let selectedRefundMethod = 'original';

  section.innerHTML = `
    <div class="wbd-returns__wrap">
      <div class="wbd-returns__inner">
        <div class="wbd-returns__strip" id="wbd-returns-strip">
          ${['Order', 'Items', 'Reason', 'Refund', 'Done'].map((label, index) => `
            <div class="wbd-returns__strip-cell${index === 0 ? ' is-on' : ''}" data-step="${index + 1}">
              <div class="wbd-returns__strip-num">${String(index + 1).padStart(2, '0')}</div>
              <div class="wbd-returns__strip-name">${label}</div>
            </div>
          `).join('')}
        </div>

        <section class="wbd-returns__stage is-on" data-stage="1">
          <h1 class="wbd-returns__title">${escapeHtml(portalTitle)}</h1>
          <p class="wbd-returns__subtitle">${escapeHtml(portalDescription)}</p>
          <div class="wbd-returns__lookup">
            <input class="wbd-returns__input" id="wbd-order-number" placeholder="Order number">
            <input class="wbd-returns__input" id="wbd-order-email" type="email" placeholder="Email on the order">
          </div>
          <div class="wbd-returns__error" id="wbd-lookup-error"></div>
          <button class="wbd-returns__primary" id="wbd-lookup-btn">${escapeHtml(design.buttonTextLookup || 'Continue')}</button>
        </section>

        <section class="wbd-returns__stage" data-stage="2">
          <h1 class="wbd-returns__title">What's heading back?</h1>
          <p class="wbd-returns__subtitle" id="wbd-items-subtitle"></p>
          <div class="wbd-returns__items" id="wbd-items-list"></div>
          <div class="wbd-returns__error" id="wbd-items-error"></div>
          <div class="wbd-returns__nav">
            <button class="wbd-returns__secondary" data-back="1">Back</button>
            <button class="wbd-returns__primary" id="wbd-items-continue">Continue</button>
          </div>
        </section>

        <section class="wbd-returns__stage" data-stage="3">
          <h1 class="wbd-returns__title">Why?</h1>
          <p class="wbd-returns__subtitle">Helps us improve. Doesn't change your refund.</p>
          <div class="wbd-returns__reasons" id="wbd-reasons-list">
            ${availableReasons.map((reason, index) => `
              <div class="wbd-returns__pill">
                <input type="radio" name="wbd-reason" id="wbd-reason-${index}" value="${escapeHtml(reason)}"${index === 0 ? ' checked' : ''}>
                <label for="wbd-reason-${index}">${escapeHtml(reasonLabels[reason] || reason)}</label>
              </div>
            `).join('')}
          </div>
          <textarea class="wbd-returns__textarea" id="wbd-reason-notes" placeholder="Optional details"></textarea>
          <div class="wbd-returns__nav">
            <button class="wbd-returns__secondary" data-back="2">Back</button>
            <button class="wbd-returns__primary" data-next="4">Continue</button>
          </div>
        </section>

        <section class="wbd-returns__stage" data-stage="4">
          <h1 class="wbd-returns__title">Refund as?</h1>
          <p class="wbd-returns__subtitle">Store credit gets +10% bonus.</p>
          <div class="wbd-returns__refunds" id="wbd-refunds-list"></div>
          <div class="wbd-returns__error" id="wbd-submit-error"></div>
          <div class="wbd-returns__nav">
            <button class="wbd-returns__secondary" data-back="3">Back</button>
            <button class="wbd-returns__primary" id="wbd-submit-btn">${escapeHtml(design.buttonTextSubmit || 'Get my label')}</button>
          </div>
        </section>

        <section class="wbd-returns__stage" data-stage="5">
          <div class="wbd-returns__done">
            <div class="wbd-returns__done-icon">
              <span class="material-symbols-outlined">check</span>
            </div>
            <h1 class="wbd-returns__title">${escapeHtml(design.successTitle || 'Done.')}</h1>
            <p class="wbd-returns__subtitle" id="wbd-success-message">${escapeHtml(design.successMessage || 'Return request submitted. We will email the next steps after review.')}</p>
            <div class="wbd-returns__done-actions">
              <button class="wbd-returns__primary" type="button" id="wbd-show-qr"><span class="material-symbols-outlined">qr_code_2</span>Show QR</button>
              <button class="wbd-returns__secondary" type="button" id="wbd-download-label"><span class="material-symbols-outlined">download</span>PDF label</button>
            </div>
          </div>
        </section>
      </div>
    </div>
  `;

  const lookupBtn = section.querySelector('#wbd-lookup-btn') as HTMLButtonElement;
  const lookupError = section.querySelector('#wbd-lookup-error') as HTMLElement;
  lookupBtn.addEventListener('click', async () => {
    const orderNum = (section.querySelector('#wbd-order-number') as HTMLInputElement).value.trim();
    const email = (section.querySelector('#wbd-order-email') as HTMLInputElement).value.trim();

    if (!orderNum || !email) {
      showError(lookupError, 'Please enter both your order number and email.');
      return;
    }

    lookupError.classList.remove('is-visible');
    lookupBtn.disabled = true;
    lookupBtn.textContent = 'Looking up...';

    try {
      const result = await lookupOrder(orderNum, email);
      orderId = result.orderId;
      orderNumber = result.orderNumber;
      customerEmail = result.customerEmail;
      customerName = result.customerName;
      items = result.items;
      selectedItems.clear();
      renderItems();
      renderRefundOptions();
      const subtitle = section.querySelector('#wbd-items-subtitle') as HTMLElement;
      subtitle.textContent = `${result.orderNumber} - ${result.returnWindow || `${settings.return_window_days ?? 30} day window`}`;
      go(2);
    } catch (err) {
      showError(lookupError, err instanceof Error ? err.message : 'Order not found. Please check your details.');
    } finally {
      lookupBtn.disabled = false;
      lookupBtn.textContent = design.buttonTextLookup || 'Continue';
    }
  });

  section.querySelectorAll<HTMLElement>('[data-back]').forEach((btn) => {
    btn.addEventListener('click', () => go(Number(btn.dataset.back)));
  });
  section.querySelectorAll<HTMLElement>('[data-next]').forEach((btn) => {
    btn.addEventListener('click', () => go(Number(btn.dataset.next)));
  });

  const itemsContinue = section.querySelector('#wbd-items-continue') as HTMLButtonElement;
  const itemsError = section.querySelector('#wbd-items-error') as HTMLElement;
  itemsContinue.addEventListener('click', () => {
    if (selectedItems.size === 0) {
      showError(itemsError, 'Please select at least one item.');
      return;
    }
    itemsError.classList.remove('is-visible');
    renderRefundOptions();
    go(3);
  });

  section.querySelectorAll<HTMLInputElement>('input[name="wbd-reason"]').forEach((input) => {
    input.addEventListener('change', () => {
      selectedReason = input.value;
    });
  });

  const submitBtn = section.querySelector('#wbd-submit-btn') as HTMLButtonElement;
  const submitError = section.querySelector('#wbd-submit-error') as HTMLElement;
  submitBtn.addEventListener('click', async () => {
    if (selectedItems.size === 0) {
      showError(submitError, 'Please select at least one item.');
      go(2);
      return;
    }

    submitError.classList.remove('is-visible');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting...';

    try {
      const notes = (section.querySelector('#wbd-reason-notes') as HTMLTextAreaElement).value.trim();
      const selectedReturnItems = Array.from(selectedItems).map((id) => {
        const item = items.find((candidate) => candidate.id === id);
        if (!item) throw new Error('Selected item is no longer available. Please look up the order again.');
        return {
          line_item_id: item.id,
          product_title: item.title,
          variant_title: item.variantTitle,
          product_image_url: item.imageUrl ?? null,
          quantity: item.quantity,
          price: parsePrice(item.price),
          reason: selectedReason,
          reason_details: [notes, `Preferred resolution: ${selectedRefundMethod}`].filter(Boolean).join('\n') || null,
        };
      });

      const result = await submitReturn({
        orderId,
        orderNumber,
        customerEmail,
        customerName,
        items: selectedReturnItems,
        notes,
      });
      const success = section.querySelector('#wbd-success-message') as HTMLElement;
      success.innerHTML = `Request ${escapeHtml(result.status)} for <span>${escapeHtml(customerEmail)}</span>.<br>We'll email next steps after review.`;
      go(5);
    } catch (err) {
      showError(submitError, err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = design.buttonTextSubmit || 'Get my label';
    }
  });

  section.querySelector('#wbd-show-qr')?.addEventListener('click', () => {
    window.alert('Your return QR code will be available in the approval email after the request is reviewed.');
  });
  section.querySelector('#wbd-download-label')?.addEventListener('click', () => {
    window.alert('Your PDF label will be emailed after the request is approved.');
  });

  function renderItems(): void {
    const list = section.querySelector('#wbd-items-list') as HTMLElement;
    list.innerHTML = '';
    const eligible = items.filter((item) => item.returnEligible);

    if (eligible.length === 0) {
      list.innerHTML = '<p class="wbd-returns__empty">No eligible return items were found for this order.</p>';
      return;
    }

    for (const [index, item] of eligible.entries()) {
      const inputId = `wbd-return-item-${index}`;
      const row = document.createElement('div');
      row.className = 'wbd-returns__item';
      row.innerHTML = `
        <input type="checkbox" id="${inputId}" value="${escapeHtml(item.id)}">
        <label for="${inputId}">
          <span class="wbd-returns__check"><span class="material-symbols-outlined">check</span></span>
          <span class="wbd-returns__thumb">
            ${item.imageUrl
              ? `<img src="${item.imageUrl}" alt="${escapeHtml(item.title)}">`
              : '<span class="wbd-returns__lamp"></span>'
            }
          </span>
          <span class="wbd-returns__item-info">
            <span class="wbd-returns__item-name">${escapeHtml(item.title)}</span>
            <span class="wbd-returns__item-variant">${escapeHtml(item.variantTitle || `${item.quantity} item${item.quantity === 1 ? '' : 's'}`)}</span>
          </span>
          <span class="wbd-returns__item-price">${escapeHtml(formatDisplayPrice(item))}</span>
        </label>
      `;
      const input = row.querySelector('input') as HTMLInputElement;
      input.addEventListener('change', () => {
        if (input.checked) selectedItems.add(item.id);
        else selectedItems.delete(item.id);
        renderRefundOptions();
      });
      list.appendChild(row);
    }
  }

  function renderRefundOptions(): void {
    const list = section.querySelector('#wbd-refunds-list') as HTMLElement;
    const amount = selectedTotal(items, selectedItems);
    const currency = selectedCurrency(items, selectedItems);
    list.innerHTML = '';

    for (const method of REFUND_METHODS) {
      const optionId = `wbd-refund-${method.id}`;
      const value = method.id === 'exchange' ? 'Free swap' : formatMoney(amount * (1 + method.bonus), currency);
      const row = document.createElement('div');
      row.className = 'wbd-returns__option';
      row.innerHTML = `
        <input type="radio" name="wbd-refund-method" id="${optionId}" value="${method.id}"${method.id === selectedRefundMethod ? ' checked' : ''}>
        <label for="${optionId}">
          <span class="wbd-returns__dot"></span>
          <span class="wbd-returns__option-info">
            <span class="wbd-returns__option-title">${method.label}</span>
            <span class="${method.id === 'store_credit' ? 'wbd-returns__option-sub wbd-returns__option-sub--amber' : 'wbd-returns__option-sub'}">${method.description}</span>
          </span>
          <span class="${method.id === 'store_credit' ? 'wbd-returns__option-value wbd-returns__option-value--amber' : 'wbd-returns__option-value'}">${value}</span>
        </label>
      `;
      const input = row.querySelector('input') as HTMLInputElement;
      input.addEventListener('change', () => {
        selectedRefundMethod = input.value;
        renderRefundOptions();
      });
      list.appendChild(row);
    }
  }

  function go(step: number): void {
    section.querySelectorAll('.wbd-returns__stage').forEach((stage) => stage.classList.remove('is-on'));
    section.querySelector(`[data-stage="${step}"]`)?.classList.add('is-on');
    section.querySelectorAll<HTMLElement>('.wbd-returns__strip-cell').forEach((cell, index) => {
      cell.classList.remove('is-on', 'is-done');
      if (index + 1 < step) cell.classList.add('is-done');
      if (index + 1 === step) cell.classList.add('is-on');
    });
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return section;
}

function applyDesignVariables(section: HTMLElement, design: NonNullable<ReturnsPortalConfig['design']>): void {
  if (design?.primaryColor) section.style.setProperty('--wbd-returns-accent', design.primaryColor);
  if (design?.backgroundColor) section.style.setProperty('--wbd-returns-bg', design.backgroundColor);
  if (design?.cardBackgroundColor) section.style.setProperty('--wbd-returns-card-bg', design.cardBackgroundColor);
  if (design?.textColor) section.style.setProperty('--wbd-returns-text', design.textColor);
  if (design?.mutedTextColor) section.style.setProperty('--wbd-returns-muted', design.mutedTextColor);
  if (design?.fontFamily) section.style.setProperty('--wbd-returns-font', design.fontFamily);
  if (design?.headingFontFamily) section.style.setProperty('--wbd-returns-heading-font', design.headingFontFamily);
  if (design?.borderRadius) section.style.setProperty('--wbd-returns-radius', radiusValue(design.borderRadius));
  if (design?.fontSize) section.style.setProperty('--wbd-returns-base-size', fontSizeValue(design.fontSize));
}

function showError(el: HTMLElement, message: string): void {
  el.textContent = message;
  el.classList.add('is-visible');
}

function parsePrice(price: string): number {
  return parseFloat(price.replace(/[^0-9.]/g, '')) || 0;
}

function selectedCurrency(items: OrderItem[], selectedItems: Set<string>): string {
  const selected = items.find((item) => selectedItems.has(item.id));
  return selected?.currency || 'USD';
}

function formatDisplayPrice(item: OrderItem): string {
  if (item.currency) return `${item.currency} ${item.price}`;
  return item.price;
}

function selectedTotal(items: OrderItem[], selectedItems: Set<string>): number {
  return items.reduce((sum, item) => {
    if (!selectedItems.has(item.id)) return sum;
    return sum + parsePrice(item.price) * Math.max(1, item.quantity || 1);
  }, 0);
}

function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
  } catch {
    return `$${amount.toFixed(2)}`;
  }
}

function radiusValue(radius: 'sharp' | 'rounded' | 'pill'): string {
  if (radius === 'sharp') return '0';
  if (radius === 'pill') return '24px';
  return '12px';
}

function fontSizeValue(size: 'small' | 'medium' | 'large'): string {
  if (size === 'small') return '13px';
  if (size === 'large') return '16px';
  return '15px';
}
