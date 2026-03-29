import path from 'path';

import express from 'express';
import cors from 'cors';
import { config } from './config/env.js';
import { healthRouter } from './controllers/health.controller.js';
import { chatRouter } from './controllers/chat.controller.js';
import { ticketRouter } from './controllers/ticket.controller.js';
import { agentRouter } from './controllers/agent.controller.js';
import { returnRouter } from './controllers/return.controller.js';
import { tradeRouter } from './controllers/trade.controller.js';
import { reviewRouter } from './controllers/review.controller.js';
import { trackingRouter } from './controllers/tracking.controller.js';
import { rmaRouter } from './controllers/rma.controller.js';
import { quizRouter } from './controllers/quiz.controller.js';
import { processScheduledEmails, processScheduledReminders, expireOldRequests } from './services/review-email.service.js';
import { registerWebhooks as registerReviewWebhooks } from './services/product-sync.service.js';
import { supabase } from './config/supabase.js';
import { resolveBrandId } from './config/brand.js';
import { getToken } from './services/shopify-auth.service.js';
import * as ticketService from './services/ticket.service.js';
import { sendTicketConfirmation } from './services/email.service.js';
import { classifyEmail } from './services/email-classifier.service.js';

const app = express();

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[http] ${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`);
  });
  next();
});

// CORS
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      const allowed = config.server.corsOrigin.split(',').map((o) => o.trim());
      if (allowed.includes('*') || allowed.includes(origin)) {
        return callback(null, true);
      }
      callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
  })
);

app.use(express.json({ limit: '1mb' }));

// Serve widget static files with short caching so browser doesn't re-download every time
const widgetDir = path.resolve(process.cwd(), 'apps/widget/dist');
app.use('/widget', express.static(widgetDir, {
  maxAge: config.server.nodeEnv === 'production' ? '5m' : '1m',
  etag: true,
}));

// Shared playground styles (tab bar + common layout)
const playgroundTabStyles = `
    /* ── Playground Tab Bar ── */
    .pg-tabs {
      display: flex;
      gap: 0;
      background: #fff;
      border-bottom: 1px solid #e5e5e5;
      padding: 0 32px;
    }
    .pg-tab {
      display: inline-block;
      padding: 10px 20px;
      font-size: 13px;
      font-weight: 500;
      color: #888;
      text-decoration: none;
      border-bottom: 2px solid transparent;
      transition: color 0.15s, border-color 0.15s;
    }
    .pg-tab:hover { color: #1a1a1a; }
    .pg-tab--active {
      color: #1a1a1a;
      border-bottom-color: #1a1a1a;
    }
`;

const playgroundBaseStyles = `
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      color: #1a1a1a;
      background: #ffffff;
      line-height: 1.6;
    }

    /* ── Announcement bar ── */
    .pg-announce {
      background: #1a1a1a;
      color: #fff;
      text-align: center;
      padding: 8px 16px;
      font-size: 12px;
      letter-spacing: 0.04em;
    }

    /* ── Navigation ── */
    .pg-nav {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 32px;
      border-bottom: 1px solid #e5e5e5;
      background: #fff;
      position: sticky;
      top: 0;
      z-index: 100;
    }
    .pg-nav__logo {
      font-size: 22px;
      font-weight: 700;
      letter-spacing: -0.02em;
      color: #1a1a1a;
      text-decoration: none;
    }
    .pg-nav__links {
      display: flex;
      gap: 28px;
      list-style: none;
    }
    .pg-nav__links a {
      text-decoration: none;
      color: #555;
      font-size: 14px;
      font-weight: 500;
      transition: color 0.15s;
    }
    .pg-nav__links a:hover { color: #1a1a1a; }
    .pg-nav__icons {
      display: flex;
      gap: 16px;
      align-items: center;
    }
    .pg-nav__icons svg {
      width: 20px;
      height: 20px;
      color: #555;
      cursor: pointer;
    }

    /* ── Footer ── */
    .pg-footer {
      padding: 48px 32px 32px;
      background: #fafafa;
      border-top: 1px solid #eee;
      max-width: 100%;
    }
    .pg-footer__inner {
      max-width: 1200px;
      margin: 0 auto;
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 32px;
    }
    .pg-footer__col-title {
      font-size: 13px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #1a1a1a;
      margin-bottom: 12px;
    }
    .pg-footer__col a {
      display: block;
      font-size: 13px;
      color: #888;
      text-decoration: none;
      margin-bottom: 6px;
    }
    .pg-footer__col a:hover { color: #1a1a1a; }
    .pg-footer__bottom {
      max-width: 1200px;
      margin: 32px auto 0;
      padding-top: 24px;
      border-top: 1px solid #eee;
      font-size: 12px;
      color: #aaa;
      text-align: center;
    }

    /* ── Responsive ── */
    @media (max-width: 640px) {
      .pg-nav { padding: 12px 16px; }
      .pg-nav__links { display: none; }
      .pg-tabs { padding: 0 16px; }
    }
`;

// ── Playground Brand Configs ──────────────────────────────────────────────────

interface PlaygroundBrand {
  name: string;
  tagline: string;
  heroTag: string;
  heroTitle: string;
  heroSub: string;
  heroCta: string;
  announcement: string;
  accentColor: string;
  bgGradientFrom: string;
  bgGradientTo: string;
  footerBg: string;
  fontLink: string;
  bodyFont: string;
  headingFont: string;
  products: Array<{ name: string; price: string }>;
  navLinks: string[];
}

const PLAYGROUND_DEFAULTS: PlaygroundBrand = {
  name: 'Store',
  tagline: 'Welcome',
  heroTag: 'New Collection',
  heroTitle: 'Welcome to<br>Our Store',
  heroSub: 'Discover our products.',
  heroCta: 'Shop Now',
  announcement: 'FREE SHIPPING ON ALL ORDERS',
  accentColor: '#8a7060',
  bgGradientFrom: '#f5f0eb',
  bgGradientTo: '#ede4db',
  footerBg: '#fafafa',
  fontLink: '',
  bodyFont: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  headingFont: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  products: [{ name: 'Sample Product', price: '$29.00' }],
  navLinks: ['Shop', 'About', 'Contact'],
};

// Cache loaded brands for 5 min
const playgroundBrandCache = new Map<string, { data: PlaygroundBrand; expiry: number }>();
const PG_CACHE_TTL = 5 * 60 * 1000;

async function getPlaygroundBrand(req: express.Request): Promise<PlaygroundBrand> {
  const slug = (req.query.brand as string || '').toLowerCase() || 'outlight';
  const cached = playgroundBrandCache.get(slug);
  if (cached && Date.now() < cached.expiry) return cached.data;

  try {
    const { data: brand } = await supabase
      .from('brands')
      .select('name, settings')
      .eq('slug', slug)
      .eq('enabled', true)
      .single();

    if (!brand) return PLAYGROUND_DEFAULTS;

    const s = (brand.settings as Record<string, unknown>)?.storefront as Record<string, unknown> | undefined;
    if (!s) {
      const fallback = { ...PLAYGROUND_DEFAULTS, name: brand.name as string };
      playgroundBrandCache.set(slug, { data: fallback, expiry: Date.now() + PG_CACHE_TTL });
      return fallback;
    }

    // Build font link from fontLink URL or custom fonts
    let fontLink = '';
    if (s.fontLink && typeof s.fontLink === 'string' && s.fontLink.startsWith('http')) {
      fontLink = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="${s.fontLink}" rel="stylesheet">`;
    }

    const result: PlaygroundBrand = {
      name: (brand.name as string) || PLAYGROUND_DEFAULTS.name,
      tagline: (s.tagline as string) || PLAYGROUND_DEFAULTS.tagline,
      heroTag: (s.heroTag as string) || PLAYGROUND_DEFAULTS.heroTag,
      heroTitle: (s.heroTitle as string) || PLAYGROUND_DEFAULTS.heroTitle,
      heroSub: (s.heroSub as string) || PLAYGROUND_DEFAULTS.heroSub,
      heroCta: (s.heroCta as string) || PLAYGROUND_DEFAULTS.heroCta,
      announcement: (s.announcement as string) || PLAYGROUND_DEFAULTS.announcement,
      accentColor: (s.accentColor as string) || PLAYGROUND_DEFAULTS.accentColor,
      bgGradientFrom: (s.bgGradientFrom as string) || PLAYGROUND_DEFAULTS.bgGradientFrom,
      bgGradientTo: (s.bgGradientTo as string) || PLAYGROUND_DEFAULTS.bgGradientTo,
      footerBg: (s.footerBg as string) || PLAYGROUND_DEFAULTS.footerBg,
      fontLink,
      bodyFont: (s.bodyFont as string) || PLAYGROUND_DEFAULTS.bodyFont,
      headingFont: (s.headingFont as string) || PLAYGROUND_DEFAULTS.headingFont,
      products: (s.products as Array<{ name: string; price: string }>) || PLAYGROUND_DEFAULTS.products,
      navLinks: (s.navLinks as string[]) || PLAYGROUND_DEFAULTS.navLinks,
    };

    playgroundBrandCache.set(slug, { data: result, expiry: Date.now() + PG_CACHE_TTL });
    return result;
  } catch (err) {
    console.error('[playground] Failed to load brand config:', err instanceof Error ? err.message : err);
    return PLAYGROUND_DEFAULTS;
  }
}

function brandQueryString(req: express.Request): string {
  const slug = (req.query.brand as string || '').toLowerCase();
  return slug && slug !== 'outlight' ? `?brand=${slug}` : '';
}

// ── Inline Config Helpers (cached, for playground/preview HTML) ───────────────

const inlineConfigCache = new Map<string, { data: Record<string, unknown>; expiry: number }>();
const INLINE_CACHE_TTL = 60 * 1000; // 1 minute

async function getInlineWidgetConfig(brandId: string): Promise<Record<string, unknown>> {
  const key = `widget:${brandId}`;
  const cached = inlineConfigCache.get(key);
  if (cached && Date.now() < cached.expiry) return cached.data;

  try {
    const { data: rows } = await supabase
      .from('ai_config')
      .select('key, value')
      .eq('brand_id', brandId)
      .in('key', ['widget_design', 'contact_form_config']);

    const configMap = new Map(
      (rows ?? []).map((r: { key: string; value: string }) => [r.key, r.value])
    );

    let design: Record<string, unknown> = {};
    try {
      const raw = configMap.get('widget_design');
      if (raw) design = JSON.parse(raw);
    } catch { /* ignore */ }

    let formConfig = null;
    try {
      const raw = configMap.get('contact_form_config');
      if (raw) formConfig = JSON.parse(raw);
    } catch { /* ignore */ }

    const result = { design, formConfig };
    inlineConfigCache.set(key, { data: result, expiry: Date.now() + INLINE_CACHE_TTL });
    return result;
  } catch {
    return { design: {}, formConfig: null };
  }
}

async function getInlinePortalConfig(brandId: string): Promise<Record<string, unknown> | null> {
  const key = `portal:${brandId}`;
  const cached = inlineConfigCache.get(key);
  if (cached && Date.now() < cached.expiry) return cached.data;

  try {
    const { getReturnSettings } = await import('./services/return-settings.service.js');
    const [settings, designRow] = await Promise.all([
      getReturnSettings(brandId),
      supabase
        .from('ai_config')
        .select('value')
        .eq('brand_id', brandId)
        .eq('key', 'return_portal_design')
        .single(),
    ]);

    let design = null;
    if (designRow.data?.value) {
      try { design = JSON.parse(designRow.data.value); } catch { /* ignore */ }
    }

    const result = {
      settings: {
        return_window_days: settings.return_window_days,
        require_photos: settings.require_photos,
        require_photos_for_reasons: settings.require_photos_for_reasons || [],
        available_reasons: settings.available_reasons,
        reason_labels: settings.reason_labels,
        available_resolutions: settings.available_resolutions,
        portal_title: settings.portal_title,
        portal_description: settings.portal_description,
        restocking_fee_percent: settings.restocking_fee_percent ?? 20,
        restocking_fee_exempt_reasons: settings.restocking_fee_exempt_reasons ?? ['defective', 'wrong_item', 'not_as_described'],
        collect_dimensions_for_reasons: settings.collect_dimensions_for_reasons ?? ['defective', 'wrong_item', 'not_as_described'],
        provide_prepaid_label_for_reasons: settings.provide_prepaid_label_for_reasons ?? ['defective', 'wrong_item', 'not_as_described'],
        dimension_collection_enabled: settings.dimension_collection_enabled ?? true,
      },
      design,
    };
    inlineConfigCache.set(key, { data: result, expiry: Date.now() + INLINE_CACHE_TTL });
    return result;
  } catch {
    return null;
  }
}

// ── Lightweight Preview Endpoints ────────────────────────────────────────────
// Minimal HTML for admin dashboard iframes — no storefront chrome, instant load.

app.get('/widget/preview-returns', async (req, res) => {
  const brandSlug = (req.query.brand as string || '').toLowerCase();
  const dataBrandAttr = brandSlug && brandSlug !== 'outlight' ? ` data-brand="${brandSlug}"` : '';

  // Run ALL queries in parallel — single await
  const brandId = await resolveBrandId(req);
  const [widgetConfig, portalConfig] = await Promise.all([
    getInlineWidgetConfig(brandId),
    getInlinePortalConfig(brandId),
  ]);

  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Returns Preview</title>
  <style>
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #fff; }
    #returns-portal { max-width: 960px; margin: 0 auto; padding: 24px 16px; }
  </style>
</head>
<body>
  <div id="returns-portal"></div>
  <script>
    window.__SRP_CONFIG = {
      widgetDesign: ${JSON.stringify(widgetConfig.design || {})},
      portalConfig: ${JSON.stringify(portalConfig)}
    };
    window.__SRP_DEBUG = ${req.query.debug === '1' ? 'true' : 'false'};
    // Listen for parent frame toggling debug mode
    window.addEventListener('message', function(e) {
      if (e.data && e.data.type === 'srp:set_debug') {
        window.__SRP_DEBUG = !!e.data.enabled;
      }
    });
  </script>
  <script src="/widget/returns-portal.js"${dataBrandAttr}></script>
</body>
</html>`);
});

// Review widget preview (for admin playground)
app.get('/widget/preview-reviews', (req, res) => {
  const brandSlug = (req.query.brand as string || '').toLowerCase();
  const dataBrandAttr = brandSlug && brandSlug !== 'outlight' ? ` data-brand="${brandSlug}"` : '';
  const handle = (req.query.handle as string) || 'aven';

  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Review Widget Preview</title>
  <style>
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #fff; }
    #outlight-reviews { max-width: 960px; margin: 0 auto; padding: 24px 16px; }
  </style>
</head>
<body>
  <div id="outlight-reviews" data-product-handle="${handle}"></div>
  <script src="/widget/review-widget.js"${dataBrandAttr}></script>
</body>
</html>`);
});

// Tracking widget preview (for admin playground)
app.get('/widget/preview-tracking', (req, res) => {
  const brandSlug = (req.query.brand as string || '').toLowerCase();
  const dataBrandAttr = brandSlug && brandSlug !== 'outlight' ? ` data-brand="${brandSlug}"` : '';

  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Tracking Widget Preview</title>
  <style>
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #fff; }
    #outlight-tracking { max-width: 960px; margin: 0 auto; padding: 24px 16px; }
  </style>
</head>
<body>
  <div id="outlight-tracking"></div>
  <script src="/widget/tracking-widget.js"${dataBrandAttr}></script>
</body>
</html>`);
});

// Review submission page (from email links)
app.get('/review', (req, res) => {
  const token = req.query.token as string;
  if (!token) { res.status(400).send('Missing token'); return; }
  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Write a Review</title>
  <style>
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #fff; }
  </style>
</head>
<body>
  <div id="review-form-root" data-token="${token}"></div>
  <script src="/widget/review-widget.js"></script>
</body>
</html>`);
});

app.get('/widget/preview-embedded', async (req, res) => {
  const brandSlug = (req.query.brand as string || '').toLowerCase();
  const dataBrandAttr = brandSlug && brandSlug !== 'outlight' ? ` data-brand="${brandSlug}"` : '';

  const brandId = await resolveBrandId(req);
  const widgetConfig = await getInlineWidgetConfig(brandId);

  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Contact Form Preview</title>
  <style>
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #fff; }
    #chat-embed { height: 500px; border-radius: 16px; overflow: hidden; max-width: 960px; margin: 0 auto; }
    #support-contact-form { max-width: 960px; margin: 24px auto 0; padding: 0 16px; }
  </style>
</head>
<body>
  <div id="chat-embed"></div>
  <div id="support-contact-form"></div>
  <script>
    window.__SCF_CONFIG = {
      design: ${JSON.stringify(widgetConfig.design || {})},
      formConfig: ${JSON.stringify(widgetConfig.formConfig || null)}
    };
  </script>
  ${playgroundDebugScript}
  <script src="/widget/widget.js" data-mode="embedded" data-target="#chat-embed"${dataBrandAttr}></script>
  <script src="/widget/contact-form.js"${dataBrandAttr}></script>
</body>
</html>`);
});

app.get('/widget/preview-chat', async (req, res) => {
  const brandSlug = (req.query.brand as string || '').toLowerCase();
  const dataBrandAttr = brandSlug && brandSlug !== 'outlight' ? ` data-brand="${brandSlug}"` : '';

  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Chat Preview</title>
  <style>
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #fafafa; min-height: 100vh; }
  </style>
</head>
<body>
  <script>
    if (new URLSearchParams(window.location.search).has('newconv')) {
      Object.keys(localStorage).filter(function(k){return k.indexOf('aicb_session')===0;}).forEach(function(k){localStorage.removeItem(k);});
    }
  </script>
  ${playgroundDebugScript}
  <script src="/widget/widget.js"${dataBrandAttr}></script>
</body>
</html>`);
});

const playgroundDebugScript = `
  <script>
    // Clear session if this is a forced new conversation (from playground "New Conversation" button)
    if (new URLSearchParams(window.location.search).has('newconv')) {
      Object.keys(localStorage).filter(function(k){return k.indexOf('aicb_session')===0;}).forEach(function(k){localStorage.removeItem(k);});
    }
  </script>
  <script>
    // Intercept fetch to relay debug data to parent via postMessage
    (function() {
      var nativeFetch = window.fetch.bind(window);
      window.fetch = function(input, init) {
        return nativeFetch(input, init).then(function(response) {
          try {
            var url = typeof input === 'string' ? input : (input && input.url) || '';
            if (url.indexOf('/api/chat/') !== -1) {
              response.clone().json().then(function(data) {
                var type = url.indexOf('session') !== -1 ? 'widget:session' : 'widget:message';
                window.parent.postMessage({ type: type, data: data }, '*');
              }).catch(function() {});
            }
          } catch(e) {}
          return response;
        });
      };
    })();
  </script>
`;

// Widget playground — mock Shopify store with functioning floating chat bubble
app.get('/widget/playground', async (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  const brand = await getPlaygroundBrand(req);
  const qs = brandQueryString(req);
  const inkColor = brand.bgGradientFrom === '#F3EDE2' ? '#1C130A' : '#1a1a1a';
  const pgBrandSlug = (req.query.brand as string || '').toLowerCase();
  const dataBrandAttr = pgBrandSlug && pgBrandSlug !== 'outlight'
    ? ` data-brand="${pgBrandSlug}"`
    : '';

  const productCardsHtml = brand.products
    .map(
      (p) => `
      <div class="pg-product">
        <div class="pg-product__img">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
        </div>
        <div class="pg-product__info">
          <div class="pg-product__name">${p.name}</div>
          <div class="pg-product__price">${p.price}</div>
        </div>
      </div>`
    )
    .join('\n');

  const navLinksHtml = brand.navLinks.map((l) => `<li><a href="#">${l}</a></li>`).join('\n      ');

  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${brand.name} Store — Preview</title>
  ${brand.fontLink}
  <style>
    ${playgroundBaseStyles}
    ${playgroundTabStyles}

    body {
      font-family: ${brand.bodyFont};
      color: ${inkColor};
    }

    .pg-announce { background: ${inkColor}; }
    .pg-nav__logo {
      font-family: ${brand.headingFont};
      color: ${inkColor};
    }

    /* ── Hero ── */
    .pg-hero {
      position: relative;
      height: 480px;
      background: linear-gradient(135deg, ${brand.bgGradientFrom} 0%, ${brand.bgGradientTo} 100%);
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    }
    .pg-hero__content {
      text-align: center;
      z-index: 1;
      padding: 0 24px;
    }
    .pg-hero__tag {
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: ${brand.accentColor};
      margin-bottom: 16px;
    }
    .pg-hero__title {
      font-family: ${brand.headingFont};
      font-size: 48px;
      font-weight: 700;
      letter-spacing: -0.03em;
      line-height: 1.1;
      color: ${inkColor};
      margin-bottom: 16px;
    }
    .pg-hero__sub {
      font-size: 16px;
      color: #666;
      max-width: 480px;
      margin: 0 auto 28px;
    }
    .pg-hero__btn {
      display: inline-block;
      padding: 14px 36px;
      background: ${inkColor};
      color: #fff;
      text-decoration: none;
      font-size: 14px;
      font-weight: 600;
      border-radius: 4px;
      transition: background 0.2s;
    }
    .pg-hero__btn:hover { opacity: 0.85; }

    /* ── Section heading ── */
    .pg-section {
      padding: 64px 32px;
      max-width: 1200px;
      margin: 0 auto;
    }
    .pg-section__header {
      text-align: center;
      margin-bottom: 40px;
    }
    .pg-section__title {
      font-family: ${brand.headingFont};
      font-size: 28px;
      font-weight: 700;
      letter-spacing: -0.02em;
      color: ${inkColor};
    }
    .pg-section__sub {
      font-size: 14px;
      color: #888;
      margin-top: 8px;
    }

    /* ── Product grid ── */
    .pg-products {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
      gap: 24px;
    }
    .pg-product {
      background: #fff;
      border-radius: 8px;
      overflow: hidden;
      border: 1px solid #eee;
      transition: box-shadow 0.2s, transform 0.2s;
    }
    .pg-product:hover {
      box-shadow: 0 8px 24px rgba(0,0,0,0.08);
      transform: translateY(-2px);
    }
    .pg-product__img {
      width: 100%;
      height: 280px;
      background: ${brand.bgGradientFrom};
      display: flex;
      align-items: center;
      justify-content: center;
      color: #c4b8a8;
      font-size: 13px;
    }
    .pg-product__info {
      padding: 16px;
    }
    .pg-product__name {
      font-size: 15px;
      font-weight: 600;
      color: ${inkColor};
      margin-bottom: 4px;
    }
    .pg-product__price {
      font-size: 14px;
      color: #666;
    }

    /* ── Features banner ── */
    .pg-features {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 32px;
      padding: 48px 32px;
      max-width: 1200px;
      margin: 0 auto;
      border-top: 1px solid #eee;
      border-bottom: 1px solid #eee;
    }
    .pg-feature {
      text-align: center;
    }
    .pg-feature__icon {
      width: 40px;
      height: 40px;
      margin: 0 auto 12px;
      color: ${brand.accentColor};
    }
    .pg-feature__title {
      font-size: 14px;
      font-weight: 600;
      color: ${inkColor};
      margin-bottom: 4px;
    }
    .pg-feature__desc {
      font-size: 13px;
      color: #888;
    }

    .pg-footer { background: ${brand.footerBg}; }
    .pg-footer__col-title { color: ${inkColor}; }
    .pg-footer__bottom { color: #aaa; }

    /* ── Responsive (storefront-specific) ── */
    @media (max-width: 640px) {
      .pg-hero { height: 360px; }
      .pg-hero__title { font-size: 32px; }
      .pg-section { padding: 40px 16px; }
      .pg-products { grid-template-columns: repeat(2, 1fr); gap: 12px; }
      .pg-product__img { height: 180px; }
    }
  </style>
</head>
<body>

  <!-- Announcement Bar -->
  <div class="pg-announce">${brand.announcement}</div>

  <!-- Navigation -->
  <nav class="pg-nav">
    <a href="#" class="pg-nav__logo">${brand.name}</a>
    <ul class="pg-nav__links">
      ${navLinksHtml}
    </ul>
    <div class="pg-nav__icons">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg>
    </div>
  </nav>

  <!-- Tab Bar -->
  <div class="pg-tabs">
    <a href="/widget/playground${qs}" class="pg-tab pg-tab--active">Storefront</a>
    <a href="/widget/playground-embedded${qs}" class="pg-tab">Embedded</a>
    <a href="/widget/playground-returns${qs}" class="pg-tab">Returns</a>
  </div>

  <!-- Hero -->
  <section class="pg-hero">
    <div class="pg-hero__content">
      <p class="pg-hero__tag">${brand.heroTag}</p>
      <h1 class="pg-hero__title">${brand.heroTitle}</h1>
      <p class="pg-hero__sub">${brand.heroSub}</p>
      <a href="#" class="pg-hero__btn">${brand.heroCta}</a>
    </div>
  </section>

  <!-- Featured Products -->
  <section class="pg-section">
    <div class="pg-section__header">
      <h2 class="pg-section__title">Featured Products</h2>
      <p class="pg-section__sub">Handpicked favorites</p>
    </div>
    <div class="pg-products">
      ${productCardsHtml}
    </div>
  </section>

  <!-- Features -->
  <div class="pg-features">
    <div class="pg-feature">
      <svg class="pg-feature__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>
      <div class="pg-feature__title">Free Shipping</div>
      <div class="pg-feature__desc">On all orders</div>
    </div>
    <div class="pg-feature">
      <svg class="pg-feature__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>
      <div class="pg-feature__title">Easy Returns</div>
      <div class="pg-feature__desc">30-day return policy</div>
    </div>
    <div class="pg-feature">
      <svg class="pg-feature__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
      <div class="pg-feature__title">Secure Checkout</div>
      <div class="pg-feature__desc">SSL encrypted payments</div>
    </div>
    <div class="pg-feature">
      <svg class="pg-feature__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>
      <div class="pg-feature__title">Quality Guaranteed</div>
      <div class="pg-feature__desc">Premium materials only</div>
    </div>
  </div>

  <!-- Footer -->
  <footer class="pg-footer">
    <div class="pg-footer__inner">
      <div class="pg-footer__col">
        <div class="pg-footer__col-title">Shop</div>
        ${brand.navLinks.slice(0, 4).map((l) => `<a href="#">${l}</a>`).join('\n        ')}
      </div>
      <div class="pg-footer__col">
        <div class="pg-footer__col-title">Help</div>
        <a href="#">Contact Us</a>
        <a href="#">Shipping Info</a>
        <a href="#">Returns &amp; Exchanges</a>
        <a href="#">FAQ</a>
      </div>
      <div class="pg-footer__col">
        <div class="pg-footer__col-title">About</div>
        <a href="#">Our Story</a>
        <a href="#">Sustainability</a>
        <a href="#">Careers</a>
        <a href="#">Press</a>
      </div>
      <div class="pg-footer__col">
        <div class="pg-footer__col-title">Connect</div>
        <a href="#">Instagram</a>
        <a href="#">Twitter</a>
        <a href="#">Pinterest</a>
        <a href="#">Newsletter</a>
      </div>
    </div>
    <div class="pg-footer__bottom">&copy; 2026 ${brand.name}. All rights reserved. &mdash; This is a preview storefront.</div>
  </footer>

  <!-- Chat widget (loaded exactly like it would be on a real store) -->
  ${playgroundDebugScript}
  <script src="/widget/widget.js"${dataBrandAttr}></script>
</body>
</html>`);
});

// Widget playground — embedded mode (Contact Us mock page)
app.get('/widget/playground-embedded', async (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  const brand = await getPlaygroundBrand(req);
  const qs = brandQueryString(req);
  const inkColor = brand.bgGradientFrom === '#F3EDE2' ? '#1C130A' : '#1a1a1a';
  const brandSlug = (req.query.brand as string || '').toLowerCase();
  const dataBrandAttr = brandSlug && brandSlug !== 'outlight'
    ? ` data-brand="${brandSlug}"`
    : '';

  // Pre-fetch widget config server-side to inline
  const brandId = await resolveBrandId(req);
  const widgetConfig = await getInlineWidgetConfig(brandId);

  const navLinksHtml = brand.navLinks.map((l) => `<li><a href="#">${l}</a></li>`).join('\n      ');

  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Contact Us — ${brand.name} Store</title>
  ${brand.fontLink}
  <style>
    ${playgroundBaseStyles}
    ${playgroundTabStyles}

    body {
      font-family: ${brand.bodyFont};
      color: ${inkColor};
    }

    .pg-announce { background: ${inkColor}; }
    .pg-nav__logo {
      font-family: ${brand.headingFont};
      color: ${inkColor};
    }

    .pg-footer { background: ${brand.footerBg}; }
    .pg-footer__col-title { color: ${inkColor}; }
    .pg-footer__bottom { color: #aaa; }

    /* ── Contact Page ── */
    .pg-contact {
      max-width: 960px;
      margin: 0 auto;
      padding: 48px 24px 64px;
    }
    .pg-contact__title {
      font-family: ${brand.headingFont};
      font-size: 32px;
      font-weight: 700;
      letter-spacing: -0.02em;
      color: ${inkColor};
      margin-bottom: 12px;
    }
    .pg-contact__desc {
      font-size: 15px;
      color: #666;
      margin-bottom: 32px;
      line-height: 1.6;
    }
    .pg-contact__chat {
      height: 600px;
      border-radius: 16px;
      overflow: hidden;
    }

    @media (max-width: 640px) {
      .pg-contact { padding: 32px 16px 48px; }
      .pg-contact__title { font-size: 24px; }
      .pg-contact__chat { height: 480px; }
    }
  </style>
</head>
<body>

  <!-- Announcement Bar -->
  <div class="pg-announce">${brand.announcement}</div>

  <!-- Navigation -->
  <nav class="pg-nav">
    <a href="#" class="pg-nav__logo">${brand.name}</a>
    <ul class="pg-nav__links">
      ${navLinksHtml}
    </ul>
    <div class="pg-nav__icons">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg>
    </div>
  </nav>

  <!-- Tab Bar -->
  <div class="pg-tabs">
    <a href="/widget/playground${qs}" class="pg-tab">Storefront</a>
    <a href="/widget/playground-embedded${qs}" class="pg-tab pg-tab--active">Embedded</a>
    <a href="/widget/playground-returns${qs}" class="pg-tab">Returns</a>
  </div>

  <!-- Contact Us Content -->
  <div class="pg-contact">
    <h1 class="pg-contact__title">Contact Us</h1>
    <p class="pg-contact__desc">Have a question about your order, our products, or need help with a return? Our AI assistant is here to help you instantly. Just type your question below.</p>
    <div id="chat-embed" class="pg-contact__chat"></div>
    <div id="support-contact-form" style="margin-top:32px;"></div>
  </div>

  <!-- Footer -->
  <footer class="pg-footer">
    <div class="pg-footer__inner">
      <div class="pg-footer__col">
        <div class="pg-footer__col-title">Shop</div>
        ${brand.navLinks.slice(0, 4).map((l) => `<a href="#">${l}</a>`).join('\n        ')}
      </div>
      <div class="pg-footer__col">
        <div class="pg-footer__col-title">Help</div>
        <a href="#">Contact Us</a>
        <a href="#">Shipping Info</a>
        <a href="#">Returns &amp; Exchanges</a>
        <a href="#">FAQ</a>
      </div>
      <div class="pg-footer__col">
        <div class="pg-footer__col-title">About</div>
        <a href="#">Our Story</a>
        <a href="#">Sustainability</a>
        <a href="#">Careers</a>
        <a href="#">Press</a>
      </div>
      <div class="pg-footer__col">
        <div class="pg-footer__col-title">Connect</div>
        <a href="#">Instagram</a>
        <a href="#">Twitter</a>
        <a href="#">Pinterest</a>
        <a href="#">Newsletter</a>
      </div>
    </div>
    <div class="pg-footer__bottom">&copy; 2026 ${brand.name}. All rights reserved. &mdash; This is a preview storefront.</div>
  </footer>

  ${playgroundDebugScript}
  <script>
    // Inline config — eliminates fetch round-trip for instant rendering
    window.__SCF_CONFIG = {
      design: ${JSON.stringify(widgetConfig.design || {})},
      formConfig: ${JSON.stringify(widgetConfig.formConfig || null)}
    };
  </script>
  <script src="/widget/widget.js" data-mode="embedded" data-target="#chat-embed"${dataBrandAttr}></script>
  <script src="/widget/contact-form.js"${dataBrandAttr}></script>
</body>
</html>`);
});

// Widget playground — returns portal page
app.get('/widget/playground-returns', async (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  const brand = await getPlaygroundBrand(req);
  const qs = brandQueryString(req);
  const inkColor = brand.bgGradientFrom === '#F3EDE2' ? '#1C130A' : '#1a1a1a';
  const brandSlug = (req.query.brand as string || '').toLowerCase();
  const dataBrandAttr = brandSlug && brandSlug !== 'outlight'
    ? ` data-brand="${brandSlug}"`
    : '';

  // Pre-fetch configs server-side to inline — eliminates client-side fetch lag
  const brandId = await resolveBrandId(req);
  const [widgetConfig, portalConfig] = await Promise.all([
    getInlineWidgetConfig(brandId),
    getInlinePortalConfig(brandId),
  ]);

  const navLinksHtml = brand.navLinks.map((l) => `<li><a href="#">${l}</a></li>`).join('\n      ');

  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Returns & Exchanges — ${brand.name} Store</title>
  ${brand.fontLink}
  <style>
    ${playgroundBaseStyles}
    ${playgroundTabStyles}

    body {
      font-family: ${brand.bodyFont};
      color: ${inkColor};
    }

    .pg-announce { background: ${inkColor}; }
    .pg-nav__logo {
      font-family: ${brand.headingFont};
      color: ${inkColor};
    }

    .pg-footer { background: ${brand.footerBg}; }
    .pg-footer__col-title { color: ${inkColor}; }
    .pg-footer__bottom { color: #aaa; }

    .pg-returns {
      max-width: 960px;
      margin: 0 auto;
      padding: 48px 24px 64px;
    }

    .pg-debug-toggle {
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 999;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 14px;
      border-radius: 8px;
      font-size: 12px;
      font-weight: 600;
      border: 1.5px solid #d1d5db;
      cursor: pointer;
      font-family: ${brand.bodyFont};
      transition: all 0.15s;
    }
    .pg-debug-toggle--on {
      background: #dcfce7;
      border-color: #16a34a;
      color: #15803d;
    }
    .pg-debug-toggle--off {
      background: #fff;
      border-color: #d1d5db;
      color: #6b7280;
    }
    .pg-debug-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
    }
    .pg-debug-toggle--on .pg-debug-dot { background: #16a34a; }
    .pg-debug-toggle--off .pg-debug-dot { background: #d1d5db; }

    @media (max-width: 640px) {
      .pg-returns { padding: 32px 16px 48px; }
    }
  </style>
</head>
<body>

  <!-- Announcement Bar -->
  <div class="pg-announce">${brand.announcement}</div>

  <!-- Navigation -->
  <nav class="pg-nav">
    <a href="#" class="pg-nav__logo">${brand.name}</a>
    <ul class="pg-nav__links">
      ${navLinksHtml}
    </ul>
    <div class="pg-nav__icons">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg>
    </div>
  </nav>

  <!-- Tab Bar -->
  <div class="pg-tabs">
    <a href="/widget/playground${qs}" class="pg-tab">Storefront</a>
    <a href="/widget/playground-embedded${qs}" class="pg-tab">Embedded</a>
    <a href="/widget/playground-returns${qs}" class="pg-tab pg-tab--active">Returns</a>
  </div>

  <!-- Returns Portal Content -->
  <div class="pg-returns">
    <div id="returns-portal"></div>
  </div>

  <!-- Debug Mode Toggle -->
  <button class="pg-debug-toggle pg-debug-toggle--on" id="debug-toggle" onclick="toggleDebug()">
    <span class="pg-debug-dot"></span>
    <span id="debug-label">Debug Mode ON</span>
  </button>

  <!-- Footer -->
  <footer class="pg-footer">
    <div class="pg-footer__inner">
      <div class="pg-footer__col">
        <div class="pg-footer__col-title">Shop</div>
        ${brand.navLinks.slice(0, 4).map((l) => `<a href="#">${l}</a>`).join('\n        ')}
      </div>
      <div class="pg-footer__col">
        <div class="pg-footer__col-title">Help</div>
        <a href="#">Contact Us</a>
        <a href="#">Shipping Info</a>
        <a href="#">Returns &amp; Exchanges</a>
        <a href="#">FAQ</a>
      </div>
      <div class="pg-footer__col">
        <div class="pg-footer__col-title">About</div>
        <a href="#">Our Story</a>
        <a href="#">Sustainability</a>
        <a href="#">Careers</a>
        <a href="#">Press</a>
      </div>
      <div class="pg-footer__col">
        <div class="pg-footer__col-title">Connect</div>
        <a href="#">Instagram</a>
        <a href="#">Twitter</a>
        <a href="#">Pinterest</a>
        <a href="#">Newsletter</a>
      </div>
    </div>
    <div class="pg-footer__bottom">&copy; 2026 ${brand.name}. All rights reserved. &mdash; This is a preview storefront.</div>
  </footer>

  <script>
    // Inline config — eliminates fetch round-trip for instant rendering
    window.__SRP_CONFIG = {
      widgetDesign: ${JSON.stringify(widgetConfig.design || {})},
      portalConfig: ${JSON.stringify(portalConfig)}
    };
    // Debug mode ON by default in playground
    window.__SRP_DEBUG = ${req.query.debug === '0' ? 'false' : 'true'};
    function toggleDebug() {
      window.__SRP_DEBUG = !window.__SRP_DEBUG;
      var btn = document.getElementById('debug-toggle');
      var label = document.getElementById('debug-label');
      if (window.__SRP_DEBUG) {
        btn.className = 'pg-debug-toggle pg-debug-toggle--on';
        label.textContent = 'Debug Mode ON';
      } else {
        btn.className = 'pg-debug-toggle pg-debug-toggle--off';
        label.textContent = 'Debug Mode OFF';
      }
      // Re-init portal with new debug state
      var portal = document.getElementById('returns-portal');
      if (portal) { portal.innerHTML = ''; }
      var oldStyle = document.getElementById('srp-styles');
      if (oldStyle) oldStyle.remove();
      if (typeof init === 'function') init();
    }
  </script>
  <script src="/widget/returns-portal.js"${dataBrandAttr}></script>
</body>
</html>`);
});

// Preview page (dev only)
if (config.server.nodeEnv === 'development') {
  app.get('/preview', (_req, res) => {
    res.sendFile(path.resolve(process.cwd(), 'apps/widget/preview.html'));
  });
}

// Routes
app.use('/health', healthRouter);
app.use('/api/chat', chatRouter);

// ── POST /api/tickets/form — Public Contact Form Submission (no auth) ───────
app.post('/api/tickets/form', async (req, res) => {
  try {
    const { name, email, category, subject, message, tags, priority } = req.body;

    if (!name || !email || !category || !subject || !message) {
      res.status(400).json({ error: 'name, email, category, subject, and message are required' });
      return;
    }

    const brandId = await resolveBrandId(req);

    const ticket = await ticketService.createTicket({
      source: 'form',
      subject,
      customer_email: email,
      customer_name: name,
      category,
      priority: priority || 'medium',
      brand_id: brandId,
      tags: Array.isArray(tags) ? tags : undefined,
    });

    await ticketService.addTicketMessage(ticket.id, {
      sender_type: 'customer',
      sender_name: name,
      sender_email: email,
      content: message,
    });

    console.log(`[server] Contact form ticket #${ticket.ticket_number} created from ${email}`);

    // Send confirmation email (fire-and-forget)
    sendTicketConfirmation({
      to: email,
      customerName: name,
      ticketNumber: ticket.ticket_number,
      subject,
      brandId,
    }).catch((err) => console.error('[server] Confirmation email failed:', err));

    res.status(201).json({ success: true, ticketNumber: ticket.ticket_number });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[server] POST /api/tickets/form error:', message);
    res.status(500).json({ error: 'Failed to submit contact form' });
  }
});

// ── POST /api/tickets/escalate — Internal AI Escalation Endpoint (no auth) ──
app.post('/api/tickets/escalate', async (req, res) => {
  try {
    const { conversationId, customerEmail, customerName, reason, priority, summary, recommendedActions } = req.body;

    if (!conversationId || !customerEmail || !reason) {
      res.status(400).json({ error: 'conversationId, customerEmail, and reason are required' });
      return;
    }

    const brandId = await resolveBrandId(req);

    const ticket = await ticketService.createTicketFromEscalation(conversationId, {
      customer_email: customerEmail,
      customer_name: customerName,
      reason,
      priority: priority ?? 'medium',
      summary,
      recommendedActions,
      brandId,
    });

    console.log(`[server] Escalation ticket #${ticket.ticket_number} created for conversation ${conversationId}`);
    res.status(201).json({ success: true, ticketNumber: ticket.ticket_number, ticketId: ticket.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[server] POST /api/tickets/escalate error:', message);
    res.status(500).json({ error: 'Failed to create escalation ticket' });
  }
});

// ── POST /api/webhooks/email — Inbound Email Webhook ─────────────────────────
// Accepts inbound emails from Resend, SendGrid, Postmark, etc.
// Creates a new ticket or adds a reply to an existing one.
app.post('/api/webhooks/email', async (req, res) => {
  try {
    // Support multiple webhook formats
    const {
      from, from_email, sender,          // sender email
      from_name, sender_name,            // sender name
      subject, to, to_email, recipient,  // recipient / subject
      text, body, plain, html,           // body content
      message_id, email_message_id,      // message ID for threading
      thread_messages,                   // full thread history from Google Apps Script
    } = req.body;

    const senderEmail = (from_email || from || sender || '').toLowerCase().trim();
    const senderName = from_name || sender_name || '';
    const emailSubject = subject || '(No Subject)';
    const emailBody = text || plain || body || '';
    const messageId = message_id || email_message_id || '';

    if (!senderEmail || !emailBody) {
      res.status(400).json({ error: 'from/from_email and text/body are required' });
      return;
    }

    // ── Loop Prevention: reject emails from our own support addresses ──
    // Collect all brand FROM addresses to detect self-referential loops
    const ownAddresses = new Set<string>();
    const defaultFrom = (process.env.EMAIL_FROM_ADDRESS || '').match(/<(.+?)>/)?.[1]?.toLowerCase();
    if (defaultFrom) ownAddresses.add(defaultFrom);
    // Check all RESEND/EMAIL env vars for brand-specific FROM addresses
    for (const [key, value] of Object.entries(process.env)) {
      if (key.startsWith('EMAIL_FROM_ADDRESS') && value) {
        const match = value.match(/<(.+?)>/);
        if (match) ownAddresses.add(match[1].toLowerCase());
        else if (value.includes('@')) ownAddresses.add(value.toLowerCase().trim());
      }
    }
    // Also check common noreply patterns
    if (senderEmail.includes('noreply@') || senderEmail.includes('no-reply@')) {
      ownAddresses.add(senderEmail); // will match below
    }

    if (ownAddresses.has(senderEmail)) {
      console.log(`[webhook] Ignoring email from own address: ${senderEmail} (loop prevention)`);
      res.json({ success: true, action: 'ignored', reason: 'Email from own support address — loop prevention' });
      return;
    }

    // ── Loop Prevention: reject ticket confirmation bounce-backs ──
    if (emailSubject.match(/^\[Ticket #\d+\]/) && emailBody.includes("We've received your message and created ticket")) {
      console.log(`[webhook] Ignoring ticket confirmation bounce-back from ${senderEmail}`);
      res.json({ success: true, action: 'ignored', reason: 'Ticket confirmation bounce-back' });
      return;
    }

    // Resolve brand from the "to" address or default
    const brandId = await resolveBrandId(req);

    // Check if this is a reply to an existing ticket
    // Strategy 1: Subject contains [Ticket #123]
    const ticketMatch = emailSubject.match(/\[Ticket #(\d+)\]/);
    if (ticketMatch) {
      const ticketNumber = parseInt(ticketMatch[1], 10);
      const { data: existingTicket } = await supabase
        .from('tickets')
        .select('id, status')
        .eq('ticket_number', ticketNumber)
        .single();

      if (existingTicket) {
        await ticketService.addTicketMessage(existingTicket.id, {
          sender_type: 'customer',
          sender_name: senderName || undefined,
          sender_email: senderEmail,
          content: emailBody,
          metadata: messageId ? { email_message_id: messageId } : undefined,
        });

        if (existingTicket.status === 'resolved' || existingTicket.status === 'closed') {
          await ticketService.updateTicket(existingTicket.id, { status: 'open' });
        }

        console.log(`[webhook] Email reply added to ticket #${ticketNumber} from ${senderEmail}`);
        res.json({ success: true, action: 'reply_added', ticketNumber });
        return;
      }
    }

    // Strategy 2: Match by Re:/Fwd: subject + same customer email (recent open/pending ticket)
    if (!ticketMatch && (emailSubject.startsWith('Re:') || emailSubject.startsWith('RE:') || emailSubject.startsWith('Fwd:'))) {
      const cleanSubject = emailSubject.replace(/^(Re:|RE:|Fwd:|FW:)\s*/i, '').trim();
      const { data: recentTicket } = await supabase
        .from('tickets')
        .select('id, status, ticket_number')
        .eq('customer_email', senderEmail)
        .eq('brand_id', brandId)
        .in('status', ['open', 'pending'])
        .ilike('subject', `%${cleanSubject.slice(0, 80)}%`)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (recentTicket) {
        await ticketService.addTicketMessage(recentTicket.id, {
          sender_type: 'customer',
          sender_name: senderName || undefined,
          sender_email: senderEmail,
          content: emailBody,
          metadata: messageId ? { email_message_id: messageId } : undefined,
        });

        if (recentTicket.status === 'resolved' || recentTicket.status === 'closed') {
          await ticketService.updateTicket(recentTicket.id, { status: 'open' });
        }

        console.log(`[webhook] Email reply matched to ticket #${recentTicket.ticket_number} by subject from ${senderEmail}`);
        res.json({ success: true, action: 'reply_added', ticketNumber: recentTicket.ticket_number });
        return;
      }
    }

    // Classify the inbound email with AI
    const classification = await classifyEmail({
      from: senderEmail,
      subject: emailSubject,
      body: emailBody,
    });

    console.log(`[webhook] Email from ${senderEmail} classified as: ${classification.classification} (confidence: ${classification.confidence.toFixed(2)})`);

    // Only create tickets for customer support emails (or low-confidence classifications)
    if (classification.classification !== 'customer_support' && classification.confidence >= 0.8) {
      console.log(`[webhook] Discarding non-support email from ${senderEmail}: ${classification.classification} — ${classification.reason}`);
      res.json({ success: true, action: 'discarded', classification: classification.classification, reason: classification.reason });
      return;
    }

    // New ticket from email
    const ticket = await ticketService.createTicket({
      source: 'email',
      subject: emailSubject,
      customer_email: senderEmail,
      customer_name: senderName || undefined,
      priority: 'medium',
      brand_id: brandId,
      classification: classification.classification,
      classification_confidence: classification.confidence,
    });

    // If thread_messages provided, store the full thread history (oldest first)
    if (Array.isArray(thread_messages) && thread_messages.length > 0) {
      for (const tm of thread_messages) {
        const tmFrom = (tm.from_email || '').toLowerCase().trim();
        const isOwnAddress = ownAddresses.has(tmFrom);
        await ticketService.addTicketMessage(ticket.id, {
          sender_type: isOwnAddress ? 'agent' : 'customer',
          sender_name: tm.from_name || undefined,
          sender_email: tmFrom || undefined,
          content: tm.text || tm.body || '',
          metadata: {
            ...(tm.message_id ? { email_message_id: tm.message_id } : {}),
            sent_at: tm.date || undefined,
            is_thread_history: true,
          },
        });
      }
    } else {
      // Single message — just store it
      await ticketService.addTicketMessage(ticket.id, {
        sender_type: 'customer',
        sender_name: senderName || undefined,
        sender_email: senderEmail,
        content: emailBody,
        metadata: messageId ? { email_message_id: messageId } : undefined,
      });
    }

    // Send confirmation only for customer support emails
    if (classification.classification === 'customer_support') {
      sendTicketConfirmation({
        to: senderEmail,
        customerName: senderName || undefined,
        ticketNumber: ticket.ticket_number,
        subject: emailSubject,
        brandId,
      }).catch((err) => console.error('[webhook] Confirmation email failed:', err));
    }

    console.log(`[webhook] Email ticket #${ticket.ticket_number} created from ${senderEmail}`);
    res.status(201).json({ success: true, action: 'ticket_created', ticketNumber: ticket.ticket_number, classification: classification.classification });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[webhook] POST /api/webhooks/email error:', message);
    res.status(500).json({ error: 'Failed to process inbound email' });
  }
});

// Ticket and agent routes (require auth)
app.use('/api/tickets', ticketRouter);
app.use('/api/agents', agentRouter);

// Return portal routes
app.use('/api/returns', returnRouter);

// Trade program routes
app.use('/api/trade', tradeRouter);

// Reviews routes
app.use('/api/reviews', reviewRouter);

// Tracking routes
app.use('/api/tracking', trackingRouter);

// RMA sync routes
app.use('/api/rma', rmaRouter);

// Quiz funnel routes
app.use('/api/quiz', quizRouter);

// Widget config endpoint
app.get('/api/widget/config', async (req, res) => {
  // Allow short browser caching to avoid repeated fetches on page loads
  res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
  try {
    const brandId = await resolveBrandId(req);

    const { data: rows } = await supabase
      .from('ai_config')
      .select('key, value')
      .eq('brand_id', brandId)
      .in('key', ['greeting', 'preset_actions', 'widget_design', 'contact_form_config']);

    const configMap = new Map(
      (rows ?? []).map((r: { key: string; value: string }) => [r.key, r.value])
    );

    let presetActions = [];
    try {
      presetActions = JSON.parse(configMap.get('preset_actions') ?? '[]');
    } catch {
      // empty
    }

    let design: Record<string, unknown> = {
      primaryColor: '#6B4A37',
      backgroundColor: '#ffffff',
      headerTitle: 'Outlight Assistant',
      position: 'bottom-right',
      bubbleIcon: 'chat',
      welcomeMessage: '',
      inputPlaceholder: 'Type a message...',
      borderRadius: 'rounded',
      fontSize: 'medium',
      showBrandingBadge: true,
      autoOpenDelay: 0,
      greetingHeader: '',
      greetingSubtext: '',
      headerSubtitle: '',
      headerLogo: '',
      brandingText: '',
      theme: 'light',
    };
    try {
      const raw = configMap.get('widget_design');
      if (raw) design = { ...design, ...JSON.parse(raw) };
    } catch {
      // empty
    }

    let formConfig = null;
    try {
      const raw = configMap.get('contact_form_config');
      if (raw) formConfig = JSON.parse(raw);
    } catch { /* empty */ }

    res.json({
      greeting: configMap.get('greeting') ?? 'Hi! How can I help you?',
      presetActions,
      design,
      formConfig,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[widget-config] Error:', message);
    res.status(500).json({ error: 'Failed to load widget config' });
  }
});

// 404
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Global error handler
app.use(
  (
    err: Error & { status?: number; type?: string },
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    // Handle JSON parse errors from express.json()
    if (err.type === 'entity.parse.failed') {
      console.error('[server] JSON parse error:', err.message);
      res.status(400).json({ error: 'Invalid JSON in request body' });
      return;
    }
    console.error('[server] Unhandled error:', err.message, err.stack?.split('\n')[1]?.trim());
    res.status(err.status || 500).json({ error: 'Internal server error' });
  }
);

// Startup checks
async function runStartupChecks() {
  console.log('[startup] Running connectivity checks...');

  // Supabase
  try {
    const { data, error } = await supabase.from('ai_config').select('key').limit(1);
    if (error) throw error;
    console.log('[startup] Supabase: connected');
  } catch (err) {
    console.warn('[startup] Supabase: FAILED -', err instanceof Error ? err.message : err);
  }

  // Shopify Auth
  try {
    await getToken();
    console.log('[startup] Shopify Auth: connected');
  } catch (err) {
    console.warn('[startup] Shopify Auth: FAILED -', err instanceof Error ? err.message : err);
  }

  // Shopify MCP
  try {
    const mcpUrl = `https://${config.shopify.shop}.myshopify.com/api/mcp`;
    const res = await fetch(mcpUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 0, params: {} }),
    });
    if (res.ok) {
      console.log('[startup] Shopify MCP: connected');
    } else {
      console.warn(`[startup] Shopify MCP: FAILED - status ${res.status}`);
    }
  } catch (err) {
    console.warn('[startup] Shopify MCP: FAILED -', err instanceof Error ? err.message : err);
  }
}

app.listen(config.server.port, async () => {
  console.log(`[server] Running on port ${config.server.port}`);
  console.log(`[server] Environment: ${config.server.nodeEnv}`);
  await runStartupChecks();

  // Register Shopify webhooks for product sync + review collection
  registerReviewWebhooks().catch(err =>
    console.warn('[startup] Review webhook registration failed:', err instanceof Error ? err.message : String(err))
  );

  // Review email job runner (every 5 minutes)
  setInterval(async () => {
    try {
      await processScheduledEmails();
      await processScheduledReminders();
      await expireOldRequests();
    } catch (err) {
      console.error('[review-email-job] Error:', err instanceof Error ? err.message : String(err));
    }
  }, 5 * 60 * 1000);
  console.log('[server] Review email job runner started (5m interval)');

  // RMA sync — poll Red Stag every 15 minutes
  const RMA_BRAND_ID = '883e4a28-9f2e-4850-a527-29f297d8b6f8';
  if (process.env.REDSTAG_API_ENDPOINT && process.env.REDSTAG_API_USER && process.env.REDSTAG_API_KEY) {
    // Run once on startup after 30 seconds (let the server settle)
    setTimeout(() => {
      import('./services/rma-sync.service.js').then(({ syncRMAs }) => {
        syncRMAs(RMA_BRAND_ID)
          .catch((err: unknown) => console.error('[rma-sync] Initial sync failed:', err instanceof Error ? err.message : String(err)));
      }).catch(() => {});
    }, 30 * 1000);

    // Then every 15 minutes
    setInterval(() => {
      import('./services/rma-sync.service.js').then(({ syncRMAs }) => {
        syncRMAs(RMA_BRAND_ID)
          .catch((err: unknown) => console.error('[rma-sync] Sync failed:', err instanceof Error ? err.message : String(err)));
      }).catch(() => {});
    }, 15 * 60 * 1000);

    const dryRunNote = process.env.RMA_SYNC_DRY_RUN === 'true' ? ' (DRY RUN mode)' : '';
    console.log(`[server] RMA sync started — 15m interval${dryRunNote}`);
  } else {
    console.log('[server] RMA sync disabled — REDSTAG_API_* env vars not set');
  }
});

export { app };
