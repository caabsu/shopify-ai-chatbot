import { submitContactForm } from '../api/client.js';

interface ContactConfig {
  heading: string;
  description: string;
  chatButtonText: string;
  emailButtonText: string;
  emailAddress: string;
  responseTime: string;
  formHeading: string;
  topics: Array<{ icon: string; label: string; subject?: string }>;
  primaryColor?: string;
  backgroundColor?: string;
  inputBackground?: string;
  borderColor?: string;
  textColor?: string;
  labelColor?: string;
  placeholderColor?: string;
  accentColor?: string;
  headingFontFamily?: string;
  bodyFontFamily?: string;
  headingFontSize?: string;
  labelFontSize?: string;
  inputFontSize?: string;
  cardBorderRadius?: string;
  inputBorderRadius?: string;
  buttonBorderRadius?: string;
  nameLabel: string;
  namePlaceholder: string;
  emailLabel: string;
  emailPlaceholder: string;
  subjectLabel: string;
  subjectPlaceholder: string;
  messageLabel: string;
  messagePlaceholder: string;
  buttonText: string;
  successMessage: string;
  showSubjectField: boolean;
  cardPadding?: string;
}

const DEFAULT_CONFIG: ContactConfig = {
  heading: 'Talk to us.',
  description: 'Reply in under 12 hours.',
  chatButtonText: 'Chat now',
  emailButtonText: 'Email us',
  emailAddress: 'support@warmbydesign.com',
  responseTime: 'Reply in under 12 hours',
  formHeading: '',
  topics: [
    { icon: 'light', label: 'Lamp pick', subject: 'Lamp pick' },
    { icon: 'palette', label: 'Finish', subject: 'Finish help' },
    { icon: 'local_shipping', label: 'Shipping / returns', subject: 'Shipping / returns' },
    { icon: 'business', label: 'Trade', subject: 'Trade inquiry' },
  ],
  nameLabel: 'Name',
  namePlaceholder: 'Your full name',
  emailLabel: 'Email',
  emailPlaceholder: 'you@example.com',
  subjectLabel: 'Subject',
  subjectPlaceholder: 'Order help, product question, or return',
  messageLabel: 'Message',
  messagePlaceholder: 'Tell us what you need help with...',
  buttonText: 'Send message',
  successMessage: "Message sent. We'll get back to you soon.",
  showSubjectField: true,
};

export function createContactPage(config?: Partial<ContactConfig>): HTMLElement {
  const c = { ...DEFAULT_CONFIG, ...config };
  const root = document.createElement('section');
  root.className = 'wbd-contact';
  applyDesignVariables(root, c);

  const wrap = document.createElement('div');
  wrap.className = 'wbd-contact__wrap';

  const card = document.createElement('div');
  card.className = 'wbd-contact__card';
  card.innerHTML = `
    <header class="wbd-contact__header">
      <h1 class="wbd-contact__title">${escapeHtml(c.heading)}</h1>
      ${c.description ? `<p class="wbd-contact__desc">${escapeHtml(c.description)}</p>` : ''}
    </header>
  `;

  const chips = document.createElement('div');
  chips.className = 'wbd-contact__chips';
  for (const topic of c.topics) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'wbd-contact__chip';
    chip.innerHTML = `
      <span class="wbd-contact__chip-icon material-symbols-outlined">${escapeHtml(topic.icon)}</span>
      ${escapeHtml(topic.label)}
    `;
    chip.addEventListener('click', () => {
      const subject = card.querySelector('#wbd-contact-subject') as HTMLInputElement | null;
      if (subject) subject.value = topic.subject ?? topic.label;
      const message = card.querySelector('#wbd-contact-message') as HTMLTextAreaElement | null;
      message?.focus();
    });
    chips.appendChild(chip);
  }
  card.appendChild(chips);

  const form = document.createElement('form');
  form.className = 'wbd-contact__form';
  form.noValidate = true;
  form.innerHTML = `
    <div class="wbd-contact__grid">
      <div class="wbd-contact__field">
        <label class="wbd-contact__form-label" for="wbd-contact-name">${escapeHtml(c.nameLabel)}</label>
        <input type="text" id="wbd-contact-name" class="wbd-contact__input" placeholder="${escapeHtml(c.namePlaceholder)}" required>
      </div>
      <div class="wbd-contact__field">
        <label class="wbd-contact__form-label" for="wbd-contact-email">${escapeHtml(c.emailLabel)}</label>
        <input type="email" id="wbd-contact-email" class="wbd-contact__input" placeholder="${escapeHtml(c.emailPlaceholder)}" required>
      </div>
    </div>
    ${c.showSubjectField ? `
      <div class="wbd-contact__field">
        <label class="wbd-contact__form-label" for="wbd-contact-subject">${escapeHtml(c.subjectLabel)}</label>
        <input type="text" id="wbd-contact-subject" class="wbd-contact__input" placeholder="${escapeHtml(c.subjectPlaceholder)}">
      </div>
    ` : ''}
    <div class="wbd-contact__field">
      <label class="wbd-contact__form-label" for="wbd-contact-message">${escapeHtml(c.messageLabel)}</label>
      <textarea id="wbd-contact-message" class="wbd-contact__textarea" placeholder="${escapeHtml(c.messagePlaceholder)}" required></textarea>
    </div>
    <div class="wbd-contact__form-error" id="wbd-contact-error"></div>
    <div class="wbd-contact__form-success" id="wbd-contact-success">
      <span class="material-symbols-outlined">check_circle</span>
      <span>${escapeHtml(c.successMessage)}</span>
    </div>
    <button type="submit" class="wbd-contact__submit">
      <span class="material-symbols-outlined">send</span>
      ${escapeHtml(c.buttonText)}
    </button>
  `;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const nameInput = form.querySelector('#wbd-contact-name') as HTMLInputElement;
    const emailInput = form.querySelector('#wbd-contact-email') as HTMLInputElement;
    const subjectInput = form.querySelector('#wbd-contact-subject') as HTMLInputElement | null;
    const messageInput = form.querySelector('#wbd-contact-message') as HTMLTextAreaElement;
    const errorEl = form.querySelector('#wbd-contact-error') as HTMLElement;
    const successEl = form.querySelector('#wbd-contact-success') as HTMLElement;
    const submitBtn = form.querySelector('.wbd-contact__submit') as HTMLButtonElement;

    const name = nameInput.value.trim();
    const email = emailInput.value.trim();
    const subject = subjectInput?.value.trim() || '';
    const message = messageInput.value.trim();

    errorEl.classList.remove('wbd-contact__form-error--visible');
    successEl.classList.remove('wbd-contact__form-success--visible');

    if (!name || !email || !message) {
      showError(errorEl, 'Please fill in name, email, and message.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showError(errorEl, 'Please enter a valid email address.');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="material-symbols-outlined">hourglass_empty</span>Sending...';

    try {
      await submitContactForm({ name, email, message, topic: subject || undefined, subject: subject || undefined });
      successEl.classList.add('wbd-contact__form-success--visible');
      nameInput.value = '';
      emailInput.value = '';
      if (subjectInput) subjectInput.value = '';
      messageInput.value = '';
    } catch (err) {
      showError(errorEl, err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = `<span class="material-symbols-outlined">send</span>${escapeHtml(c.buttonText)}`;
    }
  });
  card.appendChild(form);

  const divider = document.createElement('div');
  divider.className = 'wbd-contact__divider';
  divider.innerHTML = '<span></span><em>Or</em><span></span>';
  card.appendChild(divider);

  const actions = document.createElement('div');
  actions.className = 'wbd-contact__actions';
  actions.innerHTML = `
    <button type="button" class="wbd-contact__alt" id="wbd-contact-chat">
      <span class="material-symbols-outlined">chat</span>${escapeHtml(c.chatButtonText)}
    </button>
    <a class="wbd-contact__alt" href="mailto:${escapeHtml(c.emailAddress)}">
      <span class="material-symbols-outlined">mail</span>${escapeHtml(c.emailButtonText)}
    </a>
  `;
  actions.querySelector('#wbd-contact-chat')?.addEventListener('click', () => {
    const fab = document.querySelector('.wbd-fab') as HTMLElement | null;
    fab?.click();
  });
  card.appendChild(actions);

  wrap.appendChild(card);
  root.appendChild(wrap);
  return root;
}

function showError(errorEl: HTMLElement, message: string): void {
  errorEl.textContent = message;
  errorEl.classList.add('wbd-contact__form-error--visible');
}

function applyDesignVariables(root: HTMLElement, config: Partial<ContactConfig>): void {
  const vars: Array<[string, string | undefined]> = [
    ['--wbd-contact-accent', config.accentColor || config.primaryColor],
    ['--wbd-contact-bg', config.backgroundColor],
    ['--wbd-contact-card-bg', config.inputBackground],
    ['--wbd-contact-input-bg', config.inputBackground],
    ['--wbd-contact-border', config.borderColor],
    ['--wbd-contact-text', config.textColor],
    ['--wbd-contact-label', config.labelColor],
    ['--wbd-contact-placeholder', config.placeholderColor],
    ['--wbd-contact-heading-font', config.headingFontFamily],
    ['--wbd-contact-body-font', config.bodyFontFamily],
    ['--wbd-contact-heading-size', config.headingFontSize],
    ['--wbd-contact-label-size', config.labelFontSize],
    ['--wbd-contact-input-size', config.inputFontSize],
    ['--wbd-contact-card-radius', config.cardBorderRadius],
    ['--wbd-contact-input-radius', config.inputBorderRadius],
    ['--wbd-contact-button-radius', config.buttonBorderRadius],
    ['--wbd-contact-card-padding', config.cardPadding],
  ];

  for (const [name, value] of vars) {
    if (value) root.style.setProperty(name, value);
  }
}

function escapeHtml(text: string): string {
  const el = document.createElement('span');
  el.textContent = text;
  return el.innerHTML;
}
