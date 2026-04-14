import './styles/contact.css';
import { initBaseUrl } from './api/client.js';
import { createContactPage } from './ui/ContactPage.js';

const currentScript = document.currentScript as HTMLScriptElement | null;

function loadFonts(): void {
  if (document.getElementById('wbd-fonts')) return;

  const link = document.createElement('link');
  link.id = 'wbd-fonts';
  link.rel = 'stylesheet';
  link.href = 'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@200;300;400;500&family=Outfit:wght@200;300;400;500&family=Syne:wght@400;500;600&display=swap';
  document.head.appendChild(link);

  const iconLink = document.createElement('link');
  iconLink.id = 'wbd-icons';
  iconLink.rel = 'stylesheet';
  iconLink.href = 'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200';
  document.head.appendChild(iconLink);
}

function init() {
  initBaseUrl();
  loadFonts();

  const targetSelector = currentScript?.getAttribute('data-target');
  const target = targetSelector ? document.querySelector(targetSelector) : null;

  if (!target) {
    console.error('[wbd-contact] No target found. Use data-target="#your-container" on the script tag.');
    return;
  }

  // Parse optional config from data attributes
  const config: Record<string, unknown> = {};

  const attrs = [
    'heading', 'description', 'chat-button-text', 'email-button-text',
    'email-address', 'response-time', 'location', 'form-heading',
  ];

  for (const attr of attrs) {
    const val = currentScript?.getAttribute(`data-${attr}`);
    if (val) {
      // Convert kebab-case to camelCase
      const key = attr.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      config[key] = val;
    }
  }

  const page = createContactPage(config);
  target.appendChild(page);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
