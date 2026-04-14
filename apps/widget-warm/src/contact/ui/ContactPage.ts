import { submitContactForm } from '../api/client.js';

interface ContactConfig {
  heading: string;
  description: string;
  chatButtonText: string;
  emailButtonText: string;
  emailAddress: string;
  responseTime: string;
  location: string;
  formHeading: string;
  topics: Array<{ icon: string; label: string }>;
}

const DEFAULT_CONFIG: ContactConfig = {
  heading: 'Need lighting advice?',
  description: "Our team knows 2700K inside and out. Whether you're designing a room or choosing a finish, we're here.",
  chatButtonText: 'Start a Chat',
  emailButtonText: 'Email us',
  emailAddress: 'hello@warmbydesign.com',
  responseTime: '24hr response',
  location: 'Los Angeles, CA',
  formHeading: 'Send a message',
  topics: [
    { icon: 'emoji_objects', label: 'Which lamp is right for my living room?' },
    { icon: 'palette', label: 'Help choosing the right finish' },
    { icon: 'local_shipping', label: 'Shipping & returns question' },
    { icon: 'storefront', label: 'Trade or designer inquiry' },
  ],
};

export function createContactPage(config?: Partial<ContactConfig>): HTMLElement {
  const c = { ...DEFAULT_CONFIG, ...config };

  const root = document.createElement('div');
  root.className = 'wbd-contact';

  // ── Ambient glow background ──
  const glow = document.createElement('div');
  glow.className = 'wbd-contact__glow';
  glow.setAttribute('aria-hidden', 'true');
  root.appendChild(glow);

  // ── Content wrapper ──
  const content = document.createElement('div');
  content.className = 'wbd-contact__content';

  // ── Hero heading ──
  const hero = document.createElement('div');
  hero.className = 'wbd-contact__hero';
  hero.innerHTML = `
    <span class="wbd-contact__label">Contact</span>
    <h1 class="wbd-contact__title">${escapeHtml(c.heading)}</h1>
    ${c.description ? `<p class="wbd-contact__desc">${escapeHtml(c.description)}</p>` : ''}
  `;
  content.appendChild(hero);

  // ── Amber dot accent ──
  const dot = document.createElement('div');
  dot.className = 'wbd-contact__dot';
  content.appendChild(dot);

  // ── Glass panel ──
  const panel = document.createElement('div');
  panel.className = 'wbd-contact__panel-wrap';

  const glass = document.createElement('div');
  glass.className = 'wbd-contact__glass';

  // Corner glows
  glass.innerHTML = `
    <div class="wbd-contact__corner-glow wbd-contact__corner-glow--tr"></div>
    <div class="wbd-contact__corner-glow wbd-contact__corner-glow--bl"></div>
  `;

  // ── Quick contact row ──
  const quickRow = document.createElement('div');
  quickRow.className = 'wbd-contact__quick-row';

  // Chat button
  if (c.chatButtonText) {
    const chatBtn = document.createElement('button');
    chatBtn.className = 'wbd-contact__quick-btn';
    chatBtn.innerHTML = `
      <div class="wbd-contact__quick-icon">
        <span class="material-symbols-outlined">chat</span>
      </div>
      <div>
        <div class="wbd-contact__quick-title">${escapeHtml(c.chatButtonText)}</div>
        <div class="wbd-contact__quick-sub">Typically responds in minutes</div>
      </div>
    `;
    chatBtn.addEventListener('click', () => {
      // Find the chatbot FAB and click it to open
      const fab = document.querySelector('.wbd-fab') as HTMLElement | null;
      if (fab && !document.querySelector('.wbd-window')) {
        fab.click();
      } else if (fab && document.querySelector('.wbd-window')) {
        // Already open — scroll up to make it visible
      }
    });
    quickRow.appendChild(chatBtn);
  }

  // Email button
  if (c.emailButtonText) {
    const emailBtn = document.createElement('a');
    emailBtn.className = 'wbd-contact__quick-btn';
    emailBtn.href = `mailto:${c.emailAddress}`;
    emailBtn.innerHTML = `
      <div class="wbd-contact__quick-icon">
        <span class="material-symbols-outlined">mail</span>
      </div>
      <div>
        <div class="wbd-contact__quick-title">${escapeHtml(c.emailButtonText)}</div>
        <div class="wbd-contact__quick-sub">${escapeHtml(c.emailAddress)}</div>
      </div>
    `;
    quickRow.appendChild(emailBtn);
  }

  glass.appendChild(quickRow);

  // ── Divider ──
  glass.appendChild(createDivider());

  // ── Topics ──
  if (c.topics.length > 0) {
    const topicsSection = document.createElement('div');
    topicsSection.className = 'wbd-contact__topics';

    const topicsLabel = document.createElement('h3');
    topicsLabel.className = 'wbd-contact__section-label';
    topicsLabel.textContent = 'Common questions';
    topicsSection.appendChild(topicsLabel);

    const topicsList = document.createElement('div');
    topicsList.className = 'wbd-contact__topics-list';

    for (const topic of c.topics) {
      const btn = document.createElement('button');
      btn.className = 'wbd-contact__topic';
      btn.innerHTML = `
        ${topic.icon ? `<div class="wbd-contact__topic-icon"><span class="material-symbols-outlined">${escapeHtml(topic.icon)}</span></div>` : ''}
        <span class="wbd-contact__topic-label">${escapeHtml(topic.label)}</span>
        <span class="material-symbols-outlined wbd-contact__topic-arrow">chevron_right</span>
      `;
      // Clicking a topic opens chatbot with the question
      btn.addEventListener('click', () => {
        const fab = document.querySelector('.wbd-fab') as HTMLElement | null;
        if (fab && !document.querySelector('.wbd-window')) {
          fab.click();
        }
        // After a short delay for the chatbot to open, we could dispatch a message
        // For now, just open the chatbot
      });
      topicsList.appendChild(btn);
    }

    topicsSection.appendChild(topicsList);
    glass.appendChild(topicsSection);
    glass.appendChild(createDivider());
  }

  // ── Contact form ──
  const formSection = document.createElement('div');
  formSection.className = 'wbd-contact__form-section';

  if (c.formHeading) {
    const formLabel = document.createElement('h3');
    formLabel.className = 'wbd-contact__section-label';
    formLabel.textContent = c.formHeading;
    formSection.appendChild(formLabel);
  }

  const form = document.createElement('form');
  form.className = 'wbd-contact__form';
  form.noValidate = true;

  form.innerHTML = `
    <div class="wbd-contact__form-row">
      <div class="wbd-contact__form-field">
        <label class="wbd-contact__form-label" for="wbd-contact-name">Name</label>
        <input type="text" id="wbd-contact-name" class="wbd-contact__input" placeholder="Your name" required>
      </div>
      <div class="wbd-contact__form-field">
        <label class="wbd-contact__form-label" for="wbd-contact-email">Email</label>
        <input type="email" id="wbd-contact-email" class="wbd-contact__input" placeholder="your@email.com" required>
      </div>
    </div>
    <div class="wbd-contact__form-field">
      <label class="wbd-contact__form-label" for="wbd-contact-message">Message</label>
      <textarea id="wbd-contact-message" class="wbd-contact__textarea" placeholder="Tell us what you're looking for..." rows="5" required></textarea>
    </div>
    <div class="wbd-contact__form-error" id="wbd-contact-error"></div>
    <div class="wbd-contact__form-success" id="wbd-contact-success">
      <span class="material-symbols-outlined">check_circle</span>
      Thanks for reaching out! We'll get back to you within 24 hours.
    </div>
    <button type="submit" class="wbd-contact__submit">Send Message</button>
  `;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const nameInput = form.querySelector('#wbd-contact-name') as HTMLInputElement;
    const emailInput = form.querySelector('#wbd-contact-email') as HTMLInputElement;
    const messageInput = form.querySelector('#wbd-contact-message') as HTMLTextAreaElement;
    const errorEl = form.querySelector('#wbd-contact-error') as HTMLElement;
    const successEl = form.querySelector('#wbd-contact-success') as HTMLElement;
    const submitBtn = form.querySelector('.wbd-contact__submit') as HTMLButtonElement;

    const name = nameInput.value.trim();
    const email = emailInput.value.trim();
    const message = messageInput.value.trim();

    // Reset states
    errorEl.classList.remove('wbd-contact__form-error--visible');
    successEl.classList.remove('wbd-contact__form-success--visible');

    if (!name || !email || !message) {
      errorEl.textContent = 'Please fill in all fields.';
      errorEl.classList.add('wbd-contact__form-error--visible');
      return;
    }

    // Basic email validation
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errorEl.textContent = 'Please enter a valid email address.';
      errorEl.classList.add('wbd-contact__form-error--visible');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending...';

    try {
      await submitContactForm({ name, email, message });
      successEl.classList.add('wbd-contact__form-success--visible');
      nameInput.value = '';
      emailInput.value = '';
      messageInput.value = '';
    } catch (err) {
      errorEl.textContent = err instanceof Error ? err.message : 'Something went wrong. Please try again.';
      errorEl.classList.add('wbd-contact__form-error--visible');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Send Message';
    }
  });

  formSection.appendChild(form);
  glass.appendChild(formSection);

  // ── Footer meta ──
  const footer = document.createElement('div');
  footer.className = 'wbd-contact__footer';
  footer.innerHTML = `
    ${c.responseTime ? `<div class="wbd-contact__footer-item"><span class="material-symbols-outlined">schedule</span>${escapeHtml(c.responseTime)}</div>` : ''}
    ${c.location ? `<div class="wbd-contact__footer-item"><span class="material-symbols-outlined">location_on</span>${escapeHtml(c.location)}</div>` : ''}
    <div class="wbd-contact__footer-item"><span class="material-symbols-outlined">wb_twilight</span>Designed at 2700K</div>
  `;
  glass.appendChild(footer);

  panel.appendChild(glass);
  content.appendChild(panel);
  root.appendChild(content);

  return root;
}

function createDivider(): HTMLElement {
  const div = document.createElement('div');
  div.className = 'wbd-contact__divider';
  return div;
}

function escapeHtml(text: string): string {
  const el = document.createElement('span');
  el.textContent = text;
  return el.innerHTML;
}
