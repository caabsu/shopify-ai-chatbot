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

// Widget playground — embeddable page with auto-open and postMessage debug relay
app.get('/widget/playground', (_req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Widget Preview</title>
  <style>
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; overflow: hidden; background: #FAF6F0; }

    /* === Embedded mode overrides === */
    /* Hide the floating action button */
    .aicb-fab { display: none !important; }

    /* Make root fill viewport */
    #aicb-root {
      position: fixed !important;
      top: 0 !important; left: 0 !important;
      right: 0 !important; bottom: 0 !important;
      width: 100% !important; height: 100% !important;
    }

    /* Make chat window fill viewport instead of floating */
    .aicb-window {
      position: absolute !important;
      top: 0 !important; left: 0 !important;
      right: 0 !important; bottom: 0 !important;
      width: 100% !important; height: 100% !important;
      border-radius: 0 !important;
      box-shadow: none !important;
      animation: none !important;
    }
  </style>
</head>
<body>
  <script>
    // Always clear previous session for a fresh start
    localStorage.removeItem('aicb_session');

    // Intercept fetch to relay debug data to parent via postMessage
    (function() {
      var _fetch = window.fetch;
      window.fetch = function() {
        var args = arguments;
        var url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
        return _fetch.apply(this, args).then(function(response) {
          if (url.indexOf('/api/chat/session') !== -1 || url.indexOf('/api/chat/message') !== -1) {
            var clone = response.clone();
            clone.json().then(function(data) {
              window.parent.postMessage({
                type: url.indexOf('/api/chat/session') !== -1 ? 'widget:session' : 'widget:message',
                data: data
              }, '*');
            }).catch(function() {});
          }
          return response;
        });
      };
    })();
  </script>
  <script src="/widget/widget.js"></script>
  <script>
    // Auto-open chat after widget initializes
    setTimeout(function() {
      var fab = document.querySelector('.aicb-fab');
      if (fab) fab.click();
    }, 300);
  </script>
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
      .in('key', ['greeting', 'preset_actions']);

    const configMap = new Map(
      (rows ?? []).map((r: { key: string; value: string }) => [r.key, r.value])
    );

    let presetActions = [];
    try {
      presetActions = JSON.parse(configMap.get('preset_actions') ?? '[]');
    } catch {
      // empty
    }

    res.json({
      greeting: configMap.get('greeting') ?? 'Hi! How can I help you?',
      presetActions,
      primaryColor: '#000000',
      position: 'bottom-right',
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
