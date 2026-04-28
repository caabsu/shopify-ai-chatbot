import './styles/contact.css';
import { getContactWidgetConfig, initBaseUrl } from './api/client.js';
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

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function boolValue(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function getInlineDesign(): Record<string, unknown> {
  const inline = (window as unknown as {
    __SCF_CONFIG?: {
      design?: Record<string, unknown>;
      widget_design?: Record<string, unknown>;
    };
  }).__SCF_CONFIG;

  return inline?.widget_design ?? inline?.design ?? {};
}

async function init() {
  initBaseUrl();
  loadFonts();

  const targetSelector = currentScript?.getAttribute('data-target');
  let target = targetSelector ? document.querySelector(targetSelector) : null;

  if (!target) {
    target = document.createElement('div');
    target.id = targetSelector?.startsWith('#') ? targetSelector.slice(1) : 'wbd-contact-page';
    const parent = currentScript?.parentElement ?? document.body;
    parent.insertBefore(target, currentScript ?? null);
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

  let design = getInlineDesign();
  try {
    const backendConfig = await getContactWidgetConfig();
    design = { ...design, ...(backendConfig.widget_design ?? {}) };
  } catch (err) {
    console.warn('[wbd-contact] Failed to load backend config; using inline/default config.', err);
  }

  const mapped = {
    heading: stringValue(design.headerTitle),
    description: stringValue(design.description),
    chatButtonText: stringValue(design.chatButtonText),
    emailButtonText: stringValue(design.emailButtonText),
    emailAddress: stringValue(design.emailAddress),
    responseTime: stringValue(design.responseTime),
    location: stringValue(design.location),
    formHeading: stringValue(design.formHeading),
    primaryColor: stringValue(design.primaryColor),
    backgroundColor: stringValue(design.backgroundColor),
    inputBackground: stringValue(design.inputBackground),
    borderColor: stringValue(design.borderColor),
    textColor: stringValue(design.textColor),
    labelColor: stringValue(design.labelColor),
    placeholderColor: stringValue(design.placeholderColor),
    accentColor: stringValue(design.accentColor),
    headingFontFamily: stringValue(design.headingFontFamily),
    bodyFontFamily: stringValue(design.bodyFontFamily),
    headingFontSize: stringValue(design.headingFontSize),
    labelFontSize: stringValue(design.labelFontSize),
    inputFontSize: stringValue(design.inputFontSize),
    cardBorderRadius: stringValue(design.cardBorderRadius),
    inputBorderRadius: stringValue(design.inputBorderRadius),
    buttonBorderRadius: stringValue(design.buttonBorderRadius),
    nameLabel: stringValue(design.nameLabel),
    namePlaceholder: stringValue(design.namePlaceholder),
    emailLabel: stringValue(design.emailLabel),
    emailPlaceholder: stringValue(design.emailPlaceholder),
    subjectLabel: stringValue(design.subjectLabel),
    subjectPlaceholder: stringValue(design.subjectPlaceholder),
    messageLabel: stringValue(design.messageLabel),
    messagePlaceholder: stringValue(design.messagePlaceholder),
    buttonText: stringValue(design.buttonText),
    buttonShowArrow: boolValue(design.buttonShowArrow),
    successMessage: stringValue(design.successMessage),
    showSubjectField: boolValue(design.showSubjectField),
    cardPadding: stringValue(design.cardPadding),
  };

  for (const [key, value] of Object.entries(mapped)) {
    if (value !== undefined && config[key] === undefined) config[key] = value;
  }

  const page = createContactPage(config);
  target.appendChild(page);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
