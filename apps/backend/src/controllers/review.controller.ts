import { Router } from 'express';
import crypto from 'crypto';
import { resolveBrandId } from '../config/brand.js';
import { config } from '../config/env.js';
import { supabase } from '../config/supabase.js';
import * as reviewService from '../services/review.service.js';
import * as reviewSettingsService from '../services/review-settings.service.js';
import * as reviewEmailService from '../services/review-email.service.js';
import * as reviewAnalyticsService from '../services/review-analytics.service.js';
import * as reviewImportService from '../services/review-import.service.js';
import * as productSyncService from '../services/product-sync.service.js';

export const reviewRouter = Router();

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

// ── GET /product/:handle — Published reviews (paginated) ──────────────────

reviewRouter.get('/product/:handle', async (req, res) => {
  try {
    const brandId = await resolveBrandId(req);
    const { handle } = req.params;
    const page = parseInt(req.query.page as string, 10) || 1;
    const perPage = Math.min(parseInt(req.query.per_page as string, 10) || 10, 50);
    const sort = (req.query.sort as string) || 'newest';
    const rating = req.query.rating ? parseInt(req.query.rating as string, 10) : undefined;
    const verified = req.query.verified === 'true' ? true : req.query.verified === 'false' ? false : undefined;

    const result = await reviewService.getReviewsByProduct(handle, brandId, {
      page,
      perPage,
      sort: sort as 'newest' | 'oldest' | 'highest' | 'lowest' | 'most_helpful',
      rating,
      verified,
    });

    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[review.controller] GET /product/:handle error:', message);
    res.status(500).json({ error: 'Failed to get reviews' });
  }
});

// ── GET /product/:handle/summary — Rating summary ────────────────────────

reviewRouter.get('/product/:handle/summary', async (req, res) => {
  try {
    const brandId = await resolveBrandId(req);
    const { handle } = req.params;

    const summary = await reviewService.getReviewSummary(handle, brandId);

    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    res.json(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[review.controller] GET /product/:handle/summary error:', message);
    res.status(500).json({ error: 'Failed to get review summary' });
  }
});

// ── POST /submit — Submit a review ────────────────────────────────────────

reviewRouter.post('/submit', async (req, res) => {
  try {
    const brandId = await resolveBrandId(req);
    const {
      product_handle,
      customer_email,
      customer_name,
      customer_nickname,
      rating,
      title,
      body,
      variant_title,
      token,
      media_urls,
    } = req.body;

    if (!product_handle || !customer_email || !customer_name || !rating || !body) {
      res.status(400).json({
        error: 'product_handle, customer_email, customer_name, rating, and body are required',
      });
      return;
    }

    const review = await reviewService.submitReview({
      product_handle,
      customer_email,
      customer_name,
      customer_nickname,
      rating,
      title,
      body,
      variant_title,
      brand_id: brandId,
      token,
      media_urls,
    });

    res.status(201).json(review);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[review.controller] POST /submit error:', message);

    if (message.includes('not found') || message.includes('required') || message.includes('must be')) {
      res.status(400).json({ error: message });
      return;
    }

    res.status(500).json({ error: 'Failed to submit review' });
  }
});

// ── POST /upload — Upload review media (base64) ──────────────────────────

reviewRouter.post('/upload', async (req, res) => {
  try {
    const { file, content_type } = req.body;

    if (!file || !content_type) {
      res.status(400).json({ error: 'file (base64) and content_type are required' });
      return;
    }

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm', 'video/quicktime'];
    if (!allowedTypes.includes(content_type)) {
      res.status(400).json({ error: 'Unsupported file type' });
      return;
    }

    const buffer = Buffer.from(file, 'base64');

    if (buffer.length === 0) {
      res.status(400).json({ error: 'Empty file' });
      return;
    }

    const isVideo = content_type.startsWith('video/');
    const maxSize = isVideo ? 50 * 1024 * 1024 : 10 * 1024 * 1024;
    if (buffer.length > maxSize) {
      res.status(400).json({ error: `File too large (max ${isVideo ? '50' : '10'}MB)` });
      return;
    }

    const ext = content_type.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
    const filename = `uploads/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

    const { error } = await supabase.storage
      .from('review-media')
      .upload(filename, buffer, { contentType: content_type, upsert: false });

    if (error) {
      console.error('[review.controller] Storage upload error:', error.message);
      res.status(500).json({ error: 'Failed to upload file' });
      return;
    }

    const { data: urlData } = supabase.storage
      .from('review-media')
      .getPublicUrl(filename);

    res.json({ url: urlData.publicUrl, path: filename });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[review.controller] POST /upload error:', message);
    res.status(500).json({ error: 'Failed to upload file' });
  }
});

// ── POST /helpful/:id — Mark review as helpful ───────────────────────────

reviewRouter.post('/helpful/:id', async (req, res) => {
  try {
    const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    const key = `helpful:${req.params.id}:${ip}`;

    if (isRateLimited(key, 1, 60 * 60 * 1000)) {
      res.status(429).json({ error: 'You have already marked this review as helpful' });
      return;
    }

    const result = await reviewService.markHelpful(req.params.id);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[review.controller] POST /helpful/:id error:', message);
    res.status(500).json({ error: 'Failed to mark review as helpful' });
  }
});

// ── POST /report/:id — Report a review ───────────────────────────────────

reviewRouter.post('/report/:id', async (req, res) => {
  try {
    const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    const key = `report:${req.params.id}:${ip}`;

    if (isRateLimited(key, 1, 24 * 60 * 60 * 1000)) {
      res.status(429).json({ error: 'You have already reported this review' });
      return;
    }

    const result = await reviewService.reportReview(req.params.id);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[review.controller] POST /report/:id error:', message);
    res.status(500).json({ error: 'Failed to report review' });
  }
});

// ── GET /widget/config — Widget design configuration ─────────────────────

reviewRouter.get('/widget/config', async (req, res) => {
  try {
    const brandId = await resolveBrandId(req);
    const settings = await reviewSettingsService.getReviewSettings(brandId);

    res.setHeader('Cache-Control', 'public, max-age=120, stale-while-revalidate=600');
    res.json({
      widget_design: settings.widget_design,
      reviews_per_page: settings.reviews_per_page,
      default_sort: settings.default_sort,
      show_verified_badge: settings.show_verified_badge,
      show_incentivized_disclosure: settings.show_incentivized_disclosure,
      incentivized_disclosure_text: settings.incentivized_disclosure_text,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[review.controller] GET /widget/config error:', message);
    res.status(500).json({ error: 'Failed to get widget config' });
  }
});

// ── Admin endpoints ───────────────────────────────────────────────────────

// GET /admin/reviews — List all reviews for brand (admin)
reviewRouter.get('/admin/reviews', async (req, res) => {
  try {
    const brandId = await resolveBrandId(req);
    const page = parseInt(req.query.page as string, 10) || 1;
    const perPage = Math.min(parseInt(req.query.per_page as string, 10) || 20, 100);
    const status = (req.query.status as string) || undefined;
    const sort = (req.query.sort as string) || 'newest';

    // Use a broader query for admin (not filtered by product handle)
    let query = supabase
      .from('reviews')
      .select('*, review_media(*), review_replies(*), products(id, title, handle, featured_image_url)', { count: 'exact' })
      .eq('brand_id', brandId);

    if (status) {
      query = query.eq('status', status);
    }

    switch (sort) {
      case 'oldest':
        query = query.order('submitted_at', { ascending: true });
        break;
      case 'highest':
        query = query.order('rating', { ascending: false });
        break;
      case 'lowest':
        query = query.order('rating', { ascending: true });
        break;
      default:
        query = query.order('submitted_at', { ascending: false });
    }

    const offset = (page - 1) * perPage;
    query = query.range(offset, offset + perPage - 1);

    const { data, error, count } = await query;

    if (error) throw new Error(`Failed to fetch reviews: ${error.message}`);

    const reviews = (data ?? []).map((row: Record<string, unknown>) => ({
      ...row,
      media: row.review_media ?? [],
      reply: Array.isArray(row.review_replies) && (row.review_replies as unknown[]).length > 0
        ? (row.review_replies as unknown[])[0]
        : null,
      product: row.products ?? undefined,
      review_media: undefined,
      review_replies: undefined,
      products: undefined,
    }));

    res.json({ reviews, total: count ?? 0, page, perPage });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[review.controller] GET /admin/reviews error:', message);
    res.status(500).json({ error: 'Failed to get reviews' });
  }
});

// GET /admin/reviews/:id — Single review detail
reviewRouter.get('/admin/reviews/:id', async (req, res) => {
  try {
    const review = await reviewService.getReviewById(req.params.id);
    if (!review) {
      res.status(404).json({ error: 'Review not found' });
      return;
    }
    res.json(review);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[review.controller] GET /admin/reviews/:id error:', message);
    res.status(500).json({ error: 'Failed to get review' });
  }
});

// PATCH /admin/reviews/:id — Update review
reviewRouter.patch('/admin/reviews/:id', async (req, res) => {
  try {
    const review = await reviewService.updateReview(req.params.id, req.body);
    res.json(review);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('No valid fields')) {
      res.status(400).json({ error: message });
      return;
    }
    console.error('[review.controller] PATCH /admin/reviews/:id error:', message);
    res.status(500).json({ error: 'Failed to update review' });
  }
});

// DELETE /admin/reviews/:id — Delete review
reviewRouter.delete('/admin/reviews/:id', async (req, res) => {
  try {
    await reviewService.deleteReview(req.params.id);
    res.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[review.controller] DELETE /admin/reviews/:id error:', message);
    res.status(500).json({ error: 'Failed to delete review' });
  }
});

// POST /admin/reviews/bulk — Bulk action
reviewRouter.post('/admin/reviews/bulk', async (req, res) => {
  try {
    const { ids, action } = req.body;
    if (!ids || !Array.isArray(ids) || !action) {
      res.status(400).json({ error: 'ids (array) and action are required' });
      return;
    }

    const validActions = ['publish', 'reject', 'archive', 'delete', 'feature', 'unfeature'];
    if (!validActions.includes(action)) {
      res.status(400).json({ error: `Invalid action. Must be one of: ${validActions.join(', ')}` });
      return;
    }

    const result = await reviewService.bulkAction(ids, action);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[review.controller] POST /admin/reviews/bulk error:', message);
    res.status(500).json({ error: 'Failed to perform bulk action' });
  }
});

// POST /admin/reviews/:id/reply — Create or update reply
reviewRouter.post('/admin/reviews/:id/reply', async (req, res) => {
  try {
    const { author_name, body, author_email } = req.body;
    if (!author_name || !body) {
      res.status(400).json({ error: 'author_name and body are required' });
      return;
    }

    const reply = await reviewService.createReply(req.params.id, author_name, body, author_email);
    res.json(reply);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[review.controller] POST /admin/reviews/:id/reply error:', message);
    res.status(500).json({ error: 'Failed to create reply' });
  }
});

// DELETE /admin/reviews/:id/reply — Delete reply
reviewRouter.delete('/admin/reviews/:id/reply', async (req, res) => {
  try {
    await reviewService.deleteReply(req.params.id);
    res.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[review.controller] DELETE /admin/reviews/:id/reply error:', message);
    res.status(500).json({ error: 'Failed to delete reply' });
  }
});

// POST /admin/reviews/:id/suggest-reply — AI reply suggestion
reviewRouter.post('/admin/reviews/:id/suggest-reply', async (req, res) => {
  try {
    const review = await reviewService.getReviewById(req.params.id);
    if (!review) {
      res.status(404).json({ error: 'Review not found' });
      return;
    }

    const draft = await reviewAnalyticsService.suggestReplyDraft(
      review.body,
      review.rating,
      review.customer_name,
    );

    res.json({ draft });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[review.controller] POST /admin/reviews/:id/suggest-reply error:', message);
    res.status(500).json({ error: 'Failed to generate reply suggestion' });
  }
});

// GET /admin/settings — Review settings
reviewRouter.get('/admin/settings', async (req, res) => {
  try {
    const brandId = await resolveBrandId(req);
    const settings = await reviewSettingsService.getReviewSettings(brandId);
    res.json(settings);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[review.controller] GET /admin/settings error:', message);
    res.status(500).json({ error: 'Failed to get review settings' });
  }
});

// PUT /admin/settings — Update review settings
reviewRouter.put('/admin/settings', async (req, res) => {
  try {
    const brandId = await resolveBrandId(req);
    const settings = await reviewSettingsService.updateReviewSettings(brandId, req.body);
    res.json(settings);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[review.controller] PUT /admin/settings error:', message);
    res.status(500).json({ error: 'Failed to update review settings' });
  }
});

// GET /admin/email-templates — List email templates
reviewRouter.get('/admin/email-templates', async (req, res) => {
  try {
    const brandId = await resolveBrandId(req);
    const templates = await reviewEmailService.getEmailTemplates(brandId);
    res.json({ templates });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[review.controller] GET /admin/email-templates error:', message);
    res.status(500).json({ error: 'Failed to get email templates' });
  }
});

// PUT /admin/email-templates/:type — Update email template
reviewRouter.put('/admin/email-templates/:type', async (req, res) => {
  try {
    const validTypes = ['request', 'reminder', 'thank_you'];
    if (!validTypes.includes(req.params.type)) {
      res.status(400).json({ error: 'Invalid template type' });
      return;
    }

    const brandId = await resolveBrandId(req);
    const template = await reviewEmailService.updateEmailTemplate(
      brandId,
      req.params.type as 'request' | 'reminder' | 'thank_you',
      req.body,
    );
    res.json(template);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[review.controller] PUT /admin/email-templates/:type error:', message);
    res.status(500).json({ error: 'Failed to update email template' });
  }
});

// POST /admin/import — Import reviews from CSV
reviewRouter.post('/admin/import', async (req, res) => {
  try {
    const csv = req.body.csv || req.body.csv_text;
    if (!csv || typeof csv !== 'string') {
      res.status(400).json({ error: 'csv or csv_text (string) is required in request body' });
      return;
    }

    const brandId = await resolveBrandId(req);
    const result = await reviewImportService.importLooxCSV(csv, brandId);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[review.controller] POST /admin/import error:', message);
    res.status(500).json({ error: 'Failed to import reviews' });
  }
});

// GET /admin/analytics — AI-powered analytics
reviewRouter.get('/admin/analytics', async (req, res) => {
  try {
    const brandId = await resolveBrandId(req);
    const productId = req.query.product_id as string | undefined;
    const analysis = await reviewAnalyticsService.analyzeReviews(brandId, productId);
    res.json(analysis);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[review.controller] GET /admin/analytics error:', message);
    res.status(500).json({ error: 'Failed to get analytics' });
  }
});

// GET /admin/stats — Dashboard stats
reviewRouter.get('/admin/stats', async (req, res) => {
  try {
    const brandId = await resolveBrandId(req);
    const stats = await reviewAnalyticsService.getAnalyticsStats(brandId);
    res.json(stats);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[review.controller] GET /admin/stats error:', message);
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

// POST /admin/products/sync — Full product sync
reviewRouter.post('/admin/products/sync', async (req, res) => {
  try {
    const brandId = await resolveBrandId(req);
    const result = await productSyncService.fullSync(brandId);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[review.controller] POST /admin/products/sync error:', message);
    res.status(500).json({ error: 'Failed to sync products' });
  }
});

// GET /admin/products — List products
reviewRouter.get('/admin/products', async (req, res) => {
  try {
    const brandId = await resolveBrandId(req);
    const products = await productSyncService.getProducts(brandId);
    res.json({ products });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[review.controller] GET /admin/products error:', message);
    res.status(500).json({ error: 'Failed to get products' });
  }
});

// ── Webhooks ──────────────────────────────────────────────────────────────

function verifyShopifyHmac(body: string, hmacHeader: string, secret: string): boolean {
  const hash = crypto
    .createHmac('sha256', secret)
    .update(body, 'utf8')
    .digest('base64');
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(hmacHeader));
}

// POST /webhooks/shopify/products — Product create/update/delete
reviewRouter.post('/webhooks/shopify/products', async (req, res) => {
  try {
    const hmac = req.headers['x-shopify-hmac-sha256'] as string;
    const topic = req.headers['x-shopify-topic'] as string;
    const rawBody = JSON.stringify(req.body);

    if (!hmac || !verifyShopifyHmac(rawBody, hmac, config.shopify.clientSecret)) {
      res.status(401).json({ error: 'Invalid HMAC signature' });
      return;
    }

    const brandId = await resolveBrandId(req);
    await productSyncService.handleProductWebhook(topic, req.body, brandId);

    res.status(200).json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[review.controller] POST /webhooks/shopify/products error:', message);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// POST /webhooks/shopify/orders — Fulfilled order → schedule review request
reviewRouter.post('/webhooks/shopify/orders', async (req, res) => {
  try {
    const hmac = req.headers['x-shopify-hmac-sha256'] as string;
    const rawBody = JSON.stringify(req.body);

    if (!hmac || !verifyShopifyHmac(rawBody, hmac, config.shopify.clientSecret)) {
      res.status(401).json({ error: 'Invalid HMAC signature' });
      return;
    }

    const brandId = await resolveBrandId(req);
    const payload = req.body;

    // Only process fulfilled orders
    const fulfillmentStatus = payload.fulfillment_status;
    if (fulfillmentStatus !== 'fulfilled') {
      res.status(200).json({ ok: true, message: 'Order not fulfilled, skipping' });
      return;
    }

    const customerEmail = payload.email || payload.contact_email;
    if (!customerEmail) {
      res.status(200).json({ ok: true, message: 'No customer email, skipping' });
      return;
    }

    // Collect product IDs from line items
    const lineItems = payload.line_items as Array<Record<string, unknown>> | undefined;
    const productIds: string[] = [];

    if (lineItems) {
      for (const item of lineItems) {
        const productId = String(item.product_id);
        if (productId && productId !== 'null') {
          // Find internal product ID
          const { data: product } = await supabase
            .from('products')
            .select('id')
            .eq('shopify_product_id', productId)
            .eq('brand_id', brandId)
            .single();

          if (product) {
            productIds.push((product as Record<string, unknown>).id as string);
          }
        }
      }
    }

    if (productIds.length === 0) {
      res.status(200).json({ ok: true, message: 'No matching products found, skipping' });
      return;
    }

    const customerName = payload.customer
      ? `${(payload.customer as Record<string, unknown>).first_name ?? ''} ${(payload.customer as Record<string, unknown>).last_name ?? ''}`.trim()
      : null;

    await reviewEmailService.scheduleReviewRequest(
      {
        shopify_order_id: String(payload.id),
        shopify_customer_id: payload.customer ? String((payload.customer as Record<string, unknown>).id) : null,
        customer_email: customerEmail,
        customer_name: customerName,
        product_ids: productIds,
      },
      brandId,
    );

    res.status(200).json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[review.controller] POST /webhooks/shopify/orders error:', message);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});
