import path from 'path';

import express from 'express';
import cors from 'cors';
import { config } from './config/env.js';
import { healthRouter } from './controllers/health.controller.js';
import { chatRouter } from './controllers/chat.controller.js';
import { supabase } from './config/supabase.js';
import { getToken } from './services/shopify-auth.service.js';

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

// Serve widget static files
const widgetDir = path.resolve(process.cwd(), 'apps/widget/dist');
app.use('/widget', express.static(widgetDir));

// Widget playground — mock Shopify store with functioning floating chat bubble
app.get('/widget/playground', (_req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Outlight Store — Preview</title>
  <style>
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

    /* ── Hero ── */
    .pg-hero {
      position: relative;
      height: 480px;
      background: linear-gradient(135deg, #f5f0eb 0%, #ede4db 100%);
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
      color: #8a7060;
      margin-bottom: 16px;
    }
    .pg-hero__title {
      font-size: 48px;
      font-weight: 700;
      letter-spacing: -0.03em;
      line-height: 1.1;
      color: #1a1a1a;
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
      background: #1a1a1a;
      color: #fff;
      text-decoration: none;
      font-size: 14px;
      font-weight: 600;
      border-radius: 4px;
      transition: background 0.2s;
    }
    .pg-hero__btn:hover { background: #333; }

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
      font-size: 28px;
      font-weight: 700;
      letter-spacing: -0.02em;
      color: #1a1a1a;
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
      background: #f0ece6;
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
      color: #1a1a1a;
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
      color: #8a7060;
    }
    .pg-feature__title {
      font-size: 14px;
      font-weight: 600;
      color: #1a1a1a;
      margin-bottom: 4px;
    }
    .pg-feature__desc {
      font-size: 13px;
      color: #888;
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
  <div class="pg-announce">FREE SHIPPING ON ORDERS OVER $75 &mdash; SHOP NOW</div>

  <!-- Navigation -->
  <nav class="pg-nav">
    <a href="#" class="pg-nav__logo">OUTLIGHT</a>
    <ul class="pg-nav__links">
      <li><a href="#">New Arrivals</a></li>
      <li><a href="#">Collections</a></li>
      <li><a href="#">Best Sellers</a></li>
      <li><a href="#">Sale</a></li>
      <li><a href="#">About</a></li>
    </ul>
    <div class="pg-nav__icons">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg>
    </div>
  </nav>

  <!-- Hero -->
  <section class="pg-hero">
    <div class="pg-hero__content">
      <p class="pg-hero__tag">Spring Collection 2026</p>
      <h1 class="pg-hero__title">Effortless Style,<br>Every Day</h1>
      <p class="pg-hero__sub">Discover our curated selection of modern essentials designed for comfort and style.</p>
      <a href="#" class="pg-hero__btn">Shop the Collection</a>
    </div>
  </section>

  <!-- Featured Products -->
  <section class="pg-section">
    <div class="pg-section__header">
      <h2 class="pg-section__title">Featured Products</h2>
      <p class="pg-section__sub">Handpicked favorites from this season</p>
    </div>
    <div class="pg-products">
      <div class="pg-product">
        <div class="pg-product__img">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
        </div>
        <div class="pg-product__info">
          <div class="pg-product__name">Classic Linen Shirt</div>
          <div class="pg-product__price">$68.00</div>
        </div>
      </div>
      <div class="pg-product">
        <div class="pg-product__img">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
        </div>
        <div class="pg-product__info">
          <div class="pg-product__name">Organic Cotton Tee</div>
          <div class="pg-product__price">$42.00</div>
        </div>
      </div>
      <div class="pg-product">
        <div class="pg-product__img">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
        </div>
        <div class="pg-product__info">
          <div class="pg-product__name">Relaxed Fit Chinos</div>
          <div class="pg-product__price">$85.00</div>
        </div>
      </div>
      <div class="pg-product">
        <div class="pg-product__img">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
        </div>
        <div class="pg-product__info">
          <div class="pg-product__name">Leather Weekend Bag</div>
          <div class="pg-product__price">$195.00</div>
        </div>
      </div>
    </div>
  </section>

  <!-- Features -->
  <div class="pg-features">
    <div class="pg-feature">
      <svg class="pg-feature__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>
      <div class="pg-feature__title">Free Shipping</div>
      <div class="pg-feature__desc">On all orders over $75</div>
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

  <!-- More Products -->
  <section class="pg-section">
    <div class="pg-section__header">
      <h2 class="pg-section__title">New Arrivals</h2>
      <p class="pg-section__sub">Fresh drops, just landed</p>
    </div>
    <div class="pg-products">
      <div class="pg-product">
        <div class="pg-product__img">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
        </div>
        <div class="pg-product__info">
          <div class="pg-product__name">Wool Blend Jacket</div>
          <div class="pg-product__price">$245.00</div>
        </div>
      </div>
      <div class="pg-product">
        <div class="pg-product__img">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
        </div>
        <div class="pg-product__info">
          <div class="pg-product__name">Silk Scarf</div>
          <div class="pg-product__price">$55.00</div>
        </div>
      </div>
      <div class="pg-product">
        <div class="pg-product__img">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
        </div>
        <div class="pg-product__info">
          <div class="pg-product__name">Canvas Sneakers</div>
          <div class="pg-product__price">$98.00</div>
        </div>
      </div>
      <div class="pg-product">
        <div class="pg-product__img">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
        </div>
        <div class="pg-product__info">
          <div class="pg-product__name">Minimalist Watch</div>
          <div class="pg-product__price">$165.00</div>
        </div>
      </div>
    </div>
  </section>

  <!-- Footer -->
  <footer class="pg-footer">
    <div class="pg-footer__inner">
      <div class="pg-footer__col">
        <div class="pg-footer__col-title">Shop</div>
        <a href="#">New Arrivals</a>
        <a href="#">Best Sellers</a>
        <a href="#">Collections</a>
        <a href="#">Sale</a>
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
    <div class="pg-footer__bottom">&copy; 2026 Outlight. All rights reserved. &mdash; This is a preview storefront.</div>
  </footer>

  <!-- Chat widget (loaded exactly like it would be on a real store) -->
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
  <script src="/widget/widget.js"></script>
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

// Widget config endpoint
app.get('/api/widget/config', async (_req, res) => {
  try {
    const { data: rows } = await supabase
      .from('ai_config')
      .select('key, value')
      .in('key', ['greeting', 'preset_actions', 'widget_design']);

    const configMap = new Map(
      (rows ?? []).map((r: { key: string; value: string }) => [r.key, r.value])
    );

    let presetActions = [];
    try {
      presetActions = JSON.parse(configMap.get('preset_actions') ?? '[]');
    } catch {
      // empty
    }

    let design = {
      primaryColor: '#6B4A37',
      backgroundColor: '#ffffff',
      headerTitle: 'Outlight Assistant',
      position: 'bottom-right',
    };
    try {
      const raw = configMap.get('widget_design');
      if (raw) design = { ...design, ...JSON.parse(raw) };
    } catch {
      // empty
    }

    res.json({
      greeting: configMap.get('greeting') ?? 'Hi! How can I help you?',
      presetActions,
      design,
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
});

export { app };
