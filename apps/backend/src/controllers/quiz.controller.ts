import { Router } from 'express';
import { resolveBrandId } from '../config/brand.js';
import * as quizService from '../services/quiz.service.js';
import * as quizAnalytics from '../services/quiz-analytics.service.js';
import * as quizRecommendation from '../services/quiz-recommendation.service.js';
import * as quizImage from '../services/quiz-image.service.js';
import { supabase } from '../config/supabase.js';

export const quizRouter = Router();

// ── Sessions ─────────────────────────────────────────────────────────────────

// POST /api/quiz/sessions — Create a new quiz session
quizRouter.post('/sessions', async (req, res) => {
  try {
    const brandId = await resolveBrandId(req);
    const { session_id, concept, device_type, referrer, utm_source, utm_medium, utm_campaign } = req.body;

    if (!session_id || !concept) {
      res.status(400).json({ error: 'session_id and concept are required' });
      return;
    }

    const session = await quizService.createSession({
      brand_id: brandId,
      session_id,
      concept,
      device_type,
      referrer,
      utm_source,
      utm_medium,
      utm_campaign,
    });

    res.status(201).json(session);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[quiz.controller] POST /sessions error:', message);
    res.status(500).json({ error: 'Failed to create quiz session' });
  }
});

// GET /api/quiz/sessions — List sessions (dashboard)
quizRouter.get('/sessions', async (req, res) => {
  try {
    const brandId = await resolveBrandId(req);
    const { status, concept, search, page, per_page } = req.query;

    const result = await quizService.listSessions(brandId, {
      status: status as string | undefined,
      concept: concept as string | undefined,
      search: search as string | undefined,
      page: page ? parseInt(page as string) : undefined,
      perPage: per_page ? parseInt(per_page as string) : undefined,
    });

    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[quiz.controller] GET /sessions error:', message);
    res.status(500).json({ error: 'Failed to list sessions' });
  }
});

// GET /api/quiz/sessions/:sessionId — Get session detail
quizRouter.get('/sessions/:sessionId', async (req, res) => {
  try {
    const session = await quizService.getSession(req.params.sessionId);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    // Also fetch events for this session
    const events = await quizService.getSessionEvents(req.params.sessionId);

    res.json({ ...session, events });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[quiz.controller] GET /sessions/:id error:', message);
    res.status(500).json({ error: 'Failed to get session' });
  }
});

// PATCH /api/quiz/sessions/:sessionId — Update session
quizRouter.patch('/sessions/:sessionId', async (req, res) => {
  try {
    const session = await quizService.updateSession(req.params.sessionId, req.body);
    res.json(session);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[quiz.controller] PATCH /sessions/:id error:', message);
    res.status(500).json({ error: 'Failed to update session' });
  }
});

// ── Events ───────────────────────────────────────────────────────────────────

// POST /api/quiz/events — Track event(s)
quizRouter.post('/events', async (req, res) => {
  try {
    const brandId = await resolveBrandId(req);
    const { events, ...singleEvent } = req.body;

    if (Array.isArray(events)) {
      await quizService.trackEvents(events.map((e: { session_id: string; event_type: string; step?: string; data?: Record<string, unknown>; duration_ms?: number }) => ({ ...e, brand_id: brandId })));
    } else {
      await quizService.trackEvent({ ...singleEvent, brand_id: brandId } as { brand_id: string; session_id: string; event_type: string; step?: string; data?: Record<string, unknown>; duration_ms?: number });
    }

    res.status(201).json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[quiz.controller] POST /events error:', message);
    res.status(500).json({ error: 'Failed to track event' });
  }
});

// ── Analytics ────────────────────────────────────────────────────────────────

// GET /api/quiz/analytics/overview
quizRouter.get('/analytics/overview', async (req, res) => {
  try {
    const brandId = await resolveBrandId(req);
    const days = req.query.days ? parseInt(req.query.days as string) : 30;
    const stats = await quizAnalytics.getOverviewStats(brandId, days);
    res.json(stats);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[quiz.controller] GET /analytics/overview error:', message);
    res.status(500).json({ error: 'Failed to get analytics' });
  }
});

// GET /api/quiz/analytics/comparison — A/B test comparison
quizRouter.get('/analytics/comparison', async (req, res) => {
  try {
    const brandId = await resolveBrandId(req);
    const days = req.query.days ? parseInt(req.query.days as string) : 30;
    const data = await quizAnalytics.getConceptComparison(brandId, days);
    res.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[quiz.controller] GET /analytics/comparison error:', message);
    res.status(500).json({ error: 'Failed to get comparison' });
  }
});

// GET /api/quiz/analytics/funnel — Step funnel
quizRouter.get('/analytics/funnel', async (req, res) => {
  try {
    const brandId = await resolveBrandId(req);
    const days = req.query.days ? parseInt(req.query.days as string) : 30;
    const concept = req.query.concept as string | undefined;
    const data = await quizAnalytics.getStepFunnel(brandId, concept, days);
    res.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[quiz.controller] GET /analytics/funnel error:', message);
    res.status(500).json({ error: 'Failed to get funnel data' });
  }
});

// GET /api/quiz/analytics/profiles — Profile distribution
quizRouter.get('/analytics/profiles', async (req, res) => {
  try {
    const brandId = await resolveBrandId(req);
    const days = req.query.days ? parseInt(req.query.days as string) : 30;
    const data = await quizAnalytics.getProfileDistribution(brandId, days);
    res.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[quiz.controller] GET /analytics/profiles error:', message);
    res.status(500).json({ error: 'Failed to get profile data' });
  }
});

// GET /api/quiz/analytics/daily — Daily time series
quizRouter.get('/analytics/daily', async (req, res) => {
  try {
    const brandId = await resolveBrandId(req);
    const days = req.query.days ? parseInt(req.query.days as string) : 30;
    const data = await quizAnalytics.getDailySessionCounts(brandId, days);
    res.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[quiz.controller] GET /analytics/daily error:', message);
    res.status(500).json({ error: 'Failed to get daily data' });
  }
});

// GET /api/quiz/analytics/durations — Step durations
quizRouter.get('/analytics/durations', async (req, res) => {
  try {
    const brandId = await resolveBrandId(req);
    const days = req.query.days ? parseInt(req.query.days as string) : 30;
    const data = await quizAnalytics.getAverageStepDurations(brandId, days);
    res.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[quiz.controller] GET /analytics/durations error:', message);
    res.status(500).json({ error: 'Failed to get duration data' });
  }
});

// GET /api/quiz/analytics/devices
quizRouter.get('/analytics/devices', async (req, res) => {
  try {
    const brandId = await resolveBrandId(req);
    const days = req.query.days ? parseInt(req.query.days as string) : 30;
    const data = await quizAnalytics.getDeviceBreakdown(brandId, days);
    res.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[quiz.controller] GET /analytics/devices error:', message);
    res.status(500).json({ error: 'Failed to get device data' });
  }
});

// GET /api/quiz/analytics/utm
quizRouter.get('/analytics/utm', async (req, res) => {
  try {
    const brandId = await resolveBrandId(req);
    const days = req.query.days ? parseInt(req.query.days as string) : 30;
    const data = await quizAnalytics.getUtmBreakdown(brandId, days);
    res.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[quiz.controller] GET /analytics/utm error:', message);
    res.status(500).json({ error: 'Failed to get UTM data' });
  }
});

// ── Product Pools ────────────────────────────────────────────────────────────

// GET /api/quiz/product-pools
quizRouter.get('/product-pools', async (req, res) => {
  try {
    const brandId = await resolveBrandId(req);
    const pools = await quizRecommendation.listPools(brandId);
    res.json(pools);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[quiz.controller] GET /product-pools error:', message);
    res.status(500).json({ error: 'Failed to list product pools' });
  }
});

// POST /api/quiz/product-pools
quizRouter.post('/product-pools', async (req, res) => {
  try {
    const brandId = await resolveBrandId(req);
    const { name, description, profile_keys, product_handles, priority } = req.body;

    if (!name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }

    const pool = await quizRecommendation.createPool({
      brand_id: brandId,
      name,
      description,
      profile_keys,
      product_handles,
      priority,
    });

    res.status(201).json(pool);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[quiz.controller] POST /product-pools error:', message);
    res.status(500).json({ error: 'Failed to create product pool' });
  }
});

// PUT /api/quiz/product-pools/:id
quizRouter.put('/product-pools/:id', async (req, res) => {
  try {
    const pool = await quizRecommendation.updatePool(req.params.id, req.body);
    res.json(pool);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[quiz.controller] PUT /product-pools/:id error:', message);
    res.status(500).json({ error: 'Failed to update product pool' });
  }
});

// DELETE /api/quiz/product-pools/:id
quizRouter.delete('/product-pools/:id', async (req, res) => {
  try {
    await quizRecommendation.deletePool(req.params.id);
    res.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[quiz.controller] DELETE /product-pools/:id error:', message);
    res.status(500).json({ error: 'Failed to delete product pool' });
  }
});

// GET /api/quiz/recommendations/:profileKey — Get product recommendations
quizRouter.get('/recommendations/:profileKey', async (req, res) => {
  try {
    const brandId = await resolveBrandId(req);
    const handles = await quizRecommendation.getRecommendations(brandId, req.params.profileKey);
    res.json({ handles });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[quiz.controller] GET /recommendations error:', message);
    res.status(500).json({ error: 'Failed to get recommendations' });
  }
});

// ── Image Processing ─────────────────────────────────────────────────────────

// POST /api/quiz/render — Upload photo and get AI visualization
quizRouter.post('/render', async (req, res) => {
  try {
    const { session_id, image_base64, mime_type, profile_key, profile_name } = req.body;

    if (!image_base64 || !profile_key || !profile_name) {
      res.status(400).json({ error: 'image_base64, profile_key, and profile_name are required' });
      return;
    }

    // Update session render status
    if (session_id) {
      await quizService.updateSession(session_id, {
        render_status: 'processing',
        photo_uploaded: true,
      });
    }

    const result = await quizImage.processRoomPhoto(image_base64, mime_type || 'image/jpeg', profile_key, profile_name);

    // Update session with render result
    if (session_id) {
      await quizService.updateSession(session_id, {
        render_status: 'completed',
        render_url: `data:${result.render.mimeType};base64,${result.render.imageBase64.slice(0, 50)}...`,
      });
    }

    res.json({
      review: result.review,
      render: {
        imageBase64: result.render.imageBase64,
        mimeType: result.render.mimeType,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[quiz.controller] POST /render error:', message);

    const session_id = req.body?.session_id;
    if (session_id) {
      await quizService.updateSession(session_id, { render_status: 'failed' }).catch(() => {});
    }

    res.status(500).json({ error: 'Failed to process room photo' });
  }
});

// POST /api/quiz/review — Analyze room only (no render)
quizRouter.post('/review', async (req, res) => {
  try {
    const { image_base64, mime_type, profile_key, profile_name } = req.body;

    if (!image_base64 || !profile_key || !profile_name) {
      res.status(400).json({ error: 'image_base64, profile_key, and profile_name are required' });
      return;
    }

    const review = await quizImage.reviewRoomPhoto(image_base64, mime_type || 'image/jpeg', profile_key, profile_name);
    res.json(review);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[quiz.controller] POST /review error:', message);
    res.status(500).json({ error: 'Failed to review room photo' });
  }
});

// ── Config ───────────────────────────────────────────────────────────────────

// GET /api/quiz/config — Get all quiz config
quizRouter.get('/config', async (req, res) => {
  try {
    const brandId = await resolveBrandId(req);
    const { data: rows, error } = await supabase
      .from('quiz_config')
      .select('key, value')
      .eq('brand_id', brandId);

    if (error) throw error;

    const configMap: Record<string, unknown> = {};
    for (const row of (rows ?? [])) {
      configMap[row.key] = row.value;
    }

    res.json(configMap);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[quiz.controller] GET /config error:', message);
    res.status(500).json({ error: 'Failed to get quiz config' });
  }
});

// PUT /api/quiz/config — Update quiz config
quizRouter.put('/config', async (req, res) => {
  try {
    const brandId = await resolveBrandId(req);
    const updates = req.body as Record<string, unknown>;

    for (const [key, value] of Object.entries(updates)) {
      await supabase
        .from('quiz_config')
        .upsert({
          brand_id: brandId,
          key,
          value: JSON.stringify(value),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'brand_id,key' });
    }

    res.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[quiz.controller] PUT /config error:', message);
    res.status(500).json({ error: 'Failed to update quiz config' });
  }
});
