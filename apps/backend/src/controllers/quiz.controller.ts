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

// POST /api/quiz/render-debug — Full render with debug info (for playground)
quizRouter.post('/render-debug', async (req, res) => {
  try {
    const { image_base64, mime_type, context } = req.body;

    if (!context) {
      res.status(400).json({ error: 'context is required' });
      return;
    }

    const debug: {
      styleKey: string;
      atmosphere: unknown;
      reviewPrompt: string;
      renderPrompt: string;
      generatePrompt: string;
      review: unknown;
      timings: { reviewMs?: number; renderMs?: number; productImageFetchMs?: number; totalMs: number };
      model: { review: string; image: string };
      agentTrace: string[];
      productImages: Array<{ handle: string; title: string; imageUrl: string }>;
    } = {
      styleKey: '',
      atmosphere: null,
      reviewPrompt: '',
      renderPrompt: '',
      generatePrompt: '',
      review: null,
      timings: { totalMs: 0 },
      model: { review: '', image: '' },
      agentTrace: [],
      productImages: [],
    };

    const totalStart = Date.now();

    // Build agent reasoning trace
    debug.agentTrace = quizImage.buildAgentTrace(context, !!image_base64);

    // Get debug info
    const debugInfo = quizImage.getDebugPrompts(context);
    debug.styleKey = debugInfo.styleKey;
    debug.reviewPrompt = debugInfo.reviewPrompt;
    debug.generatePrompt = debugInfo.generatePrompt;
    debug.atmosphere = quizImage.getAtmosphereProfile(context);

    // Import config for model names
    const { config } = await import('../config/env.js');
    debug.model = {
      review: config.gemini.reviewModel,
      image: config.gemini.imageModel,
    };

    // Fetch product reference images from Shopify
    const productHandles = quizImage.getProductSuggestions(context).slice(0, 3);
    let productImages: quizImage.ProductImage[] = [];
    debug.agentTrace.push(`[PRODUCTS] Fetching reference images from Shopify for: ${productHandles.join(', ')}...`);
    const imgFetchStart = Date.now();
    try {
      productImages = await quizImage.fetchProductImages(productHandles);
      debug.timings.productImageFetchMs = Date.now() - imgFetchStart;
      debug.productImages = productImages.map(pi => ({ handle: pi.handle, title: pi.title, imageUrl: pi.imageUrl }));
      debug.agentTrace.push(`[PRODUCTS] Fetched ${productImages.length}/${productHandles.length} product images in ${debug.timings.productImageFetchMs}ms.`);
    } catch (err) {
      debug.timings.productImageFetchMs = Date.now() - imgFetchStart;
      debug.agentTrace.push(`[PRODUCTS] WARNING: Failed to fetch product images in ${debug.timings.productImageFetchMs}ms — continuing without references.`);
    }

    let result: { review: any; render: any };

    if (!image_base64) {
      // Sample room — generate from scratch
      debug.agentTrace.push(`[EXEC] Calling ${config.gemini.imageModel} with generate-from-scratch prompt (${debug.generatePrompt.length} chars) + ${productImages.length} product ref images...`);
      const genStart = Date.now();
      const render = await quizImage.generateFromScratch(context, productImages);
      debug.timings.renderMs = Date.now() - genStart;
      debug.agentTrace.push(`[EXEC] Image generated in ${debug.timings.renderMs}ms.`);
      debug.renderPrompt = debug.generatePrompt;

      result = {
        review: {
          roomType: 'living',
          dimensions: 'Sample room',
          description: 'AI-generated sample room',
          currentLighting: 'None — generated from scratch',
          furniture: [],
          colorPalette: [],
          placements: [],
          ambiance: (debug.atmosphere as any)?.emotionalTone || 'A beautifully lit space.',
          tips: [],
        },
        render,
      };
      debug.review = result.review;
    } else {
      // Real photo — review then render
      debug.agentTrace.push(`[EXEC] Step 1: Calling ${config.gemini.reviewModel} with review prompt (${debug.reviewPrompt.length} chars) + room photo...`);
      const reviewStart = Date.now();
      const review = await quizImage.reviewRoomPhoto(image_base64, mime_type || 'image/jpeg', context);
      debug.timings.reviewMs = Date.now() - reviewStart;
      debug.review = review;
      debug.agentTrace.push(`[EXEC] Review complete in ${debug.timings.reviewMs}ms — room: ${review.roomType}, ${review.placements?.length || 0} placements, furniture: [${review.furniture?.slice(0, 3).join(', ')}].`);

      // Build the actual render prompt using review results
      const actualRenderPrompt = debugInfo.renderPromptBuilder(review);
      debug.renderPrompt = actualRenderPrompt;

      debug.agentTrace.push(`[EXEC] Step 2: Calling ${config.gemini.imageModel} with render prompt (${actualRenderPrompt.length} chars) + room photo + ${productImages.length} product ref images...`);
      const renderStart = Date.now();
      const render = await quizImage.renderVisualization(image_base64, mime_type || 'image/jpeg', review, context, productImages);
      debug.timings.renderMs = Date.now() - renderStart;
      debug.agentTrace.push(`[EXEC] Image rendered in ${debug.timings.renderMs}ms.`);

      result = { review, render };
    }

    debug.timings.totalMs = Date.now() - totalStart;
    debug.agentTrace.push(`[DONE] Total pipeline: ${debug.timings.totalMs}ms. Returning image + ${(quizImage.getProductSuggestions(context)).length} product suggestions.`);

    res.json({
      review: result.review,
      render: {
        imageBase64: result.render.imageBase64,
        mimeType: result.render.mimeType,
      },
      suggestedProducts: quizImage.getProductSuggestions(context),
      debug,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[quiz.controller] POST /render-debug error:', message);
    res.status(500).json({ error: 'Failed to process', details: message });
  }
});

// POST /api/quiz/render — Upload photo and get AI visualization (or generate sample)
quizRouter.post('/render', async (req, res) => {
  try {
    const { session_id, image_base64, mime_type, context } = req.body;

    if (!context) {
      res.status(400).json({ error: 'context is required' });
      return;
    }

    // Update session render status
    if (session_id) {
      await quizService.updateSession(session_id, {
        render_status: 'processing',
        photo_uploaded: !!image_base64,
      });
    }

    const result = await quizImage.processRoomPhoto(image_base64 || '', mime_type || 'image/jpeg', context);

    // Update session with render result
    if (session_id) {
      await quizService.updateSession(session_id, {
        render_status: 'completed',
      });
    }

    res.json({
      review: result.review,
      render: {
        imageBase64: result.render.imageBase64,
        mimeType: result.render.mimeType,
      },
      suggestedProducts: quizImage.getProductSuggestions(context),
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
    const { image_base64, mime_type, context } = req.body;

    if (!context) {
      res.status(400).json({ error: 'context is required' });
      return;
    }

    // If no photo, return a synthetic review (sample room)
    if (!image_base64) {
      const suggestedProducts = quizImage.getProductSuggestions(context);
      res.json({
        review: {
          roomType: 'living',
          dimensions: 'Sample room',
          description: 'AI-generated sample room',
          currentLighting: 'None — sample',
          furniture: [],
          colorPalette: [],
          placements: [],
          ambiance: 'A beautifully lit space tailored to your style.',
          tips: [],
        },
        suggestedProducts,
      });
      return;
    }

    const review = await quizImage.reviewRoomPhoto(image_base64, mime_type || 'image/jpeg', context);
    res.json({
      review,
      suggestedProducts: quizImage.getProductSuggestions(context),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[quiz.controller] POST /review error:', message);
    res.status(500).json({ error: 'Failed to review room photo' });
  }
});

// POST /api/quiz/products — Get product details for suggested handles
quizRouter.post('/products', async (req, res) => {
  try {
    const { handles } = req.body;
    if (!handles || !Array.isArray(handles) || handles.length === 0) {
      res.status(400).json({ error: 'handles array is required' });
      return;
    }

    const brandId = await resolveBrandId(req);

    // Fetch product details from Shopify MCP
    const { searchProducts } = await import('../services/shopify-mcp.service.js');
    const products: Array<{ handle: string; title: string; price: string; image: string; url: string }> = [];

    // Search for each product by handle
    for (const handle of handles.slice(0, 6)) {
      try {
        const result = await searchProducts(
          handle,
          `Looking up product with handle "${handle}" for quiz funnel recommendation`,
          { limit: 1 },
          brandId,
        );
        // Parse MCP result to extract product info
        const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
        // Extract product data from MCP response
        const titleMatch = resultStr.match(/\*\*([^*]+)\*\*/);
        const priceMatch = resultStr.match(/\$[\d,.]+/);
        const imageMatch = resultStr.match(/https:\/\/cdn\.shopify\.com[^\s"')]+/);
        const urlMatch = resultStr.match(/https:\/\/[^\s"']*\/products\/[^\s"')]+/);

        if (titleMatch) {
          products.push({
            handle,
            title: titleMatch[1],
            price: priceMatch ? priceMatch[0] : '',
            image: imageMatch ? imageMatch[0] : '',
            url: urlMatch ? urlMatch[0] : `/products/${handle}`,
          });
        }
      } catch (err) {
        console.error(`[quiz.controller] Failed to fetch product "${handle}":`, err instanceof Error ? err.message : err);
      }
    }

    res.json({ products });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[quiz.controller] POST /products error:', message);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

// GET /api/quiz/search-products — Search Shopify catalog for products
quizRouter.get('/search-products', async (req, res) => {
  try {
    const brandId = await resolveBrandId(req);
    const query = (req.query.q as string) || '';
    const { searchProducts } = await import('../services/shopify-mcp.service.js');

    const result = await searchProducts(
      query || 'light lamp pendant',
      'Browsing product catalog for quiz funnel product pool management',
      { limit: 20 },
      brandId,
    );

    // Parse MCP response to extract structured product data
    const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
    const products: Array<{ handle: string; title: string; price: string; image: string }> = [];

    // Extract products from MCP response (markdown format)
    const productBlocks = resultStr.split(/\n(?=\*\*)/);
    for (const block of productBlocks) {
      const titleMatch = block.match(/\*\*([^*]+)\*\*/);
      const priceMatch = block.match(/\$[\d,.]+/);
      const imageMatch = block.match(/https:\/\/cdn\.shopify\.com[^\s"')]+/);
      const handleMatch = block.match(/\/products\/([a-z0-9-]+)/i);

      if (titleMatch && handleMatch) {
        products.push({
          handle: handleMatch[1],
          title: titleMatch[1],
          price: priceMatch ? priceMatch[0] : '',
          image: imageMatch ? imageMatch[0] : '',
        });
      }
    }

    res.json({ products });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[quiz.controller] GET /search-products error:', message);
    res.status(500).json({ error: 'Failed to search products' });
  }
});

// ── Catalog Sync ────────────────────────────────────────────────────────────

// GET /api/quiz/catalog — Fetch ALL products from Shopify Admin API (paginated)
quizRouter.get('/catalog', async (req, res) => {
  try {
    const brandId = await resolveBrandId(req);
    const { graphql } = await import('../services/shopify-admin.service.js');

    const allProducts: Array<{
      id: string;
      handle: string;
      title: string;
      status: string;
      productType: string;
      tags: string[];
      image: string;
      price: string;
      maxPrice: string;
      currency: string;
      variants: Array<{
        id: string;
        title: string;
        price: string;
        available: boolean;
        image: string;
      }>;
    }> = [];

    let cursor: string | null = null;
    let hasNext = true;

    while (hasNext) {
      const query = `
        query Products($cursor: String) {
          products(first: 50, after: $cursor, sortKey: TITLE) {
            edges {
              node {
                id
                title
                handle
                status
                productType
                tags
                featuredImage { url }
                variants(first: 30) {
                  edges {
                    node {
                      id
                      title
                      price
                      availableForSale
                      image { url }
                    }
                  }
                }
                priceRange {
                  minVariantPrice { amount currencyCode }
                  maxVariantPrice { amount currencyCode }
                }
              }
            }
            pageInfo { hasNextPage endCursor }
          }
        }
      `;

      const data: {
        products: {
          edges: Array<{
            node: {
              id: string;
              title: string;
              handle: string;
              status: string;
              productType: string;
              tags: string[];
              featuredImage: { url: string } | null;
              variants: {
                edges: Array<{
                  node: {
                    id: string;
                    title: string;
                    price: string;
                    availableForSale: boolean;
                    image: { url: string } | null;
                  };
                }>;
              };
              priceRange: {
                minVariantPrice: { amount: string; currencyCode: string };
                maxVariantPrice: { amount: string; currencyCode: string };
              };
            };
          }>;
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
        };
      } = await graphql(query, { cursor }, brandId);

      for (const edge of data.products.edges) {
        const p = edge.node;
        const minPrice = parseFloat(p.priceRange.minVariantPrice.amount);
        const maxPrice = parseFloat(p.priceRange.maxVariantPrice.amount);

        allProducts.push({
          id: p.id,
          handle: p.handle,
          title: p.title,
          status: p.status,
          productType: p.productType,
          tags: p.tags,
          image: p.featuredImage?.url || '',
          price: `$${minPrice % 1 === 0 ? minPrice.toFixed(0) : minPrice.toFixed(2)}`,
          maxPrice: `$${maxPrice % 1 === 0 ? maxPrice.toFixed(0) : maxPrice.toFixed(2)}`,
          currency: p.priceRange.minVariantPrice.currencyCode,
          variants: p.variants.edges.map((v) => ({
            id: v.node.id,
            title: v.node.title,
            price: `$${parseFloat(v.node.price) % 1 === 0 ? parseFloat(v.node.price).toFixed(0) : parseFloat(v.node.price).toFixed(2)}`,
            available: v.node.availableForSale,
            image: v.node.image?.url || '',
          })),
        });
      }

      hasNext = data.products.pageInfo.hasNextPage;
      cursor = data.products.pageInfo.endCursor;
    }

    res.json({
      products: allProducts,
      count: allProducts.length,
      synced_at: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[quiz.controller] GET /catalog error:', message);
    res.status(500).json({ error: 'Failed to fetch product catalog' });
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
