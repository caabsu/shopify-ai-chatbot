import './styles/returns.css';
import { getPortalConfig, initBaseUrl } from './api/client.js';
import type { ReturnsPortalConfig } from './api/client.js';
import { createReturnsPortal } from './ui/ReturnsPortal.js';

const currentScript = document.currentScript as HTMLScriptElement | null;

function getInlinePortalConfig(): ReturnsPortalConfig | null {
  const inline = (window as unknown as {
    __SRP_CONFIG?: { portalConfig?: ReturnsPortalConfig | null };
  }).__SRP_CONFIG;

  return inline?.portalConfig ?? null;
}

function loadFonts(): void {
  if (document.getElementById('wbd-fonts')) return;

  const link = document.createElement('link');
  link.id = 'wbd-fonts';
  link.rel = 'stylesheet';
  link.href = 'https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&display=swap';
  document.head.appendChild(link);

  const iconLink = document.createElement('link');
  iconLink.id = 'wbd-icons';
  iconLink.rel = 'stylesheet';
  iconLink.href = 'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200';
  document.head.appendChild(iconLink);
}

async function init() {
  initBaseUrl();
  loadFonts();

  const targetSelector = currentScript?.getAttribute('data-target');
  let target = targetSelector ? document.querySelector(targetSelector) : null;

  if (!target) {
    target = document.createElement('div');
    target.id = targetSelector?.startsWith('#') ? targetSelector.slice(1) : 'wbd-returns-page';
    const parent = currentScript?.parentElement ?? document.body;
    parent.insertBefore(target, currentScript ?? null);
  }

  let config: ReturnsPortalConfig | null = getInlinePortalConfig();
  try {
    config = config ?? await getPortalConfig();
  } catch (err) {
    console.warn('[wbd-returns] Failed to load backend config; using defaults.', err);
  }

  function render(nextConfig?: ReturnsPortalConfig | null) {
    target.innerHTML = '';
    target.appendChild(createReturnsPortal(nextConfig ?? undefined));
  }

  render(config);

  window.addEventListener('message', (event) => {
    if (!event.data || event.data.type !== 'srp:design_update') return;
    config = {
      ...(config ?? {}),
      design: {
        ...((config?.design ?? {}) as NonNullable<ReturnsPortalConfig['design']>),
        ...(event.data.design ?? {}),
      },
    };
    render(config);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
