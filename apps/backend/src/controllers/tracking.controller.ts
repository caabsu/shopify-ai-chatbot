import { Router } from 'express';
import { resolveBrandId } from '../config/brand.js';
import * as trackingService from '../services/tracking.service.js';
import * as trackingSettingsService from '../services/tracking-settings.service.js';

export const trackingRouter = Router();

// ── Simple in-memory rate limiter ─────────────────────────────────────────

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(key: string, maxPerWindow: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(key);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }

  entry.count++;
  return entry.count > maxPerWindow;
}

// ── POST /lookup — Look up order by order number + email ─────────────────

trackingRouter.post('/lookup', async (req, res) => {
  try {
    const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    const key = `lookup:${ip}`;

    if (isRateLimited(key, 10, 60 * 1000)) {
      res.status(429).json({ error: 'Too many requests. Please try again later.' });
      return;
    }

    const { order_number, email } = req.body;

    if (!order_number || !email) {
      res.status(400).json({ error: 'order_number and email are required' });
      return;
    }

    const brandId = await resolveBrandId(req);
    const result = await trackingService.lookupByOrder(String(order_number), String(email), brandId);

    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[tracking.controller] POST /lookup error:', message);
    res.status(500).json({ error: 'Failed to look up order' });
  }
});

// ── POST /track — Look up by tracking number ─────────────────────────────

trackingRouter.post('/track', async (req, res) => {
  try {
    const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    const key = `track:${ip}`;

    if (isRateLimited(key, 10, 60 * 1000)) {
      res.status(429).json({ error: 'Too many requests. Please try again later.' });
      return;
    }

    const { tracking_number } = req.body;

    if (!tracking_number) {
      res.status(400).json({ error: 'tracking_number is required' });
      return;
    }

    const brandId = await resolveBrandId(req);
    const result = await trackingService.lookupByTracking(String(tracking_number), brandId);

    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[tracking.controller] POST /track error:', message);
    res.status(500).json({ error: 'Failed to look up tracking number' });
  }
});

// ── GET /widget/config — Widget design configuration ─────────────────────

trackingRouter.get('/widget/config', async (req, res) => {
  try {
    const brandId = await resolveBrandId(req);
    const settings = await trackingSettingsService.getTrackingSettings(brandId);

    res.setHeader('Cache-Control', 'public, max-age=120, stale-while-revalidate=600');
    res.json({ widget_design: settings.widget_design });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[tracking.controller] GET /widget/config error:', message);
    res.status(500).json({ error: 'Failed to get widget config' });
  }
});

// ── GET /admin/settings — Full settings ──────────────────────────────────

trackingRouter.get('/admin/settings', async (req, res) => {
  try {
    const brandId = await resolveBrandId(req);
    const settings = await trackingSettingsService.getTrackingSettings(brandId);
    res.json(settings);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[tracking.controller] GET /admin/settings error:', message);
    res.status(500).json({ error: 'Failed to get tracking settings' });
  }
});

// ── PUT /admin/settings — Update settings (partial) ──────────────────────

trackingRouter.put('/admin/settings', async (req, res) => {
  try {
    const brandId = await resolveBrandId(req);
    const settings = await trackingSettingsService.updateTrackingSettings(brandId, req.body);
    res.json(settings);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[tracking.controller] PUT /admin/settings error:', message);
    res.status(500).json({ error: 'Failed to update tracking settings' });
  }
});

// ── GET /admin/design — Widget design only ───────────────────────────────

trackingRouter.get('/admin/design', async (req, res) => {
  try {
    const brandId = await resolveBrandId(req);
    const settings = await trackingSettingsService.getTrackingSettings(brandId);
    res.json({ widget_design: settings.widget_design });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[tracking.controller] GET /admin/design error:', message);
    res.status(500).json({ error: 'Failed to get widget design' });
  }
});

// ── PUT /admin/design — Update widget design only ────────────────────────

trackingRouter.put('/admin/design', async (req, res) => {
  try {
    const brandId = await resolveBrandId(req);
    const settings = await trackingSettingsService.updateTrackingSettings(brandId, {
      widget_design: req.body,
    });
    res.json({ widget_design: settings.widget_design });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[tracking.controller] PUT /admin/design error:', message);
    res.status(500).json({ error: 'Failed to update widget design' });
  }
});
