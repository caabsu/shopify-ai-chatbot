import { supabase } from '../config/supabase.js';
import { evaluateReview } from './review-moderation.service.js';
import { getReviewSettings } from './review-settings.service.js';
import type { Review, ReviewSummary, ReviewReply, Product } from '../types/index.js';

interface GetReviewsOptions {
  page?: number;
  perPage?: number;
  sort?: 'newest' | 'oldest' | 'highest' | 'lowest' | 'most_helpful';
  rating?: number;
  verified?: boolean;
  status?: string;
}

export async function getReviewsByProduct(
  handle: string,
  brandId: string,
  opts: GetReviewsOptions = {},
): Promise<{ reviews: Review[]; total: number; page: number; perPage: number }> {
  try {
    const page = opts.page ?? 1;
    const perPage = opts.perPage ?? 10;
    const offset = (page - 1) * perPage;
    const status = opts.status ?? 'published';

    // Resolve product by handle
    const { data: product, error: prodErr } = await supabase
      .from('products')
      .select('id')
      .eq('handle', handle)
      .eq('brand_id', brandId)
      .single();

    if (prodErr || !product) {
      return { reviews: [], total: 0, page, perPage };
    }

    // Build query
    let query = supabase
      .from('reviews')
      .select('*, review_media(*), review_replies(*)', { count: 'exact' })
      .eq('product_id', product.id)
      .eq('brand_id', brandId)
      .eq('status', status);

    if (opts.rating) {
      query = query.eq('rating', opts.rating);
    }

    if (opts.verified !== undefined) {
      query = query.eq('verified_purchase', opts.verified);
    }

    // Sorting
    switch (opts.sort) {
      case 'oldest':
        query = query.order('submitted_at', { ascending: true });
        break;
      case 'highest':
        query = query.order('rating', { ascending: false }).order('submitted_at', { ascending: false });
        break;
      case 'lowest':
        query = query.order('rating', { ascending: true }).order('submitted_at', { ascending: false });
        break;
      case 'most_helpful':
        query = query.order('helpful_count', { ascending: false }).order('submitted_at', { ascending: false });
        break;
      case 'newest':
      default:
        query = query.order('submitted_at', { ascending: false });
        break;
    }

    query = query.range(offset, offset + perPage - 1);

    const { data, error, count } = await query;

    if (error) throw new Error(`Failed to fetch reviews: ${error.message}`);

    const reviews = (data ?? []).map((row: Record<string, unknown>) => ({
      ...row,
      media: row.review_media ?? [],
      reply: Array.isArray(row.review_replies) && (row.review_replies as unknown[]).length > 0
        ? (row.review_replies as unknown[])[0]
        : null,
      review_media: undefined,
      review_replies: undefined,
    })) as unknown as Review[];

    return { reviews, total: count ?? 0, page, perPage };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[review.service] getReviewsByProduct failed:', message);
    throw new Error(`Failed to get reviews: ${message}`);
  }
}

export async function getReviewSummary(handle: string, brandId: string): Promise<ReviewSummary> {
  try {
    // Resolve product by handle
    const { data: product, error: prodErr } = await supabase
      .from('products')
      .select('id')
      .eq('handle', handle)
      .eq('brand_id', brandId)
      .single();

    if (prodErr || !product) {
      return { average_rating: 0, total_count: 0, verified_count: 0, distribution: [] };
    }

    const { data: reviews, error } = await supabase
      .from('reviews')
      .select('rating, verified_purchase')
      .eq('product_id', product.id)
      .eq('brand_id', brandId)
      .eq('status', 'published');

    if (error) throw new Error(`Failed to fetch review summary: ${error.message}`);

    const rows = (reviews ?? []) as Array<{ rating: number; verified_purchase: boolean }>;
    const totalCount = rows.length;

    if (totalCount === 0) {
      return {
        average_rating: 0,
        total_count: 0,
        verified_count: 0,
        distribution: [
          { stars: 5, count: 0 },
          { stars: 4, count: 0 },
          { stars: 3, count: 0 },
          { stars: 2, count: 0 },
          { stars: 1, count: 0 },
        ],
      };
    }

    const verifiedCount = rows.filter((r) => r.verified_purchase).length;
    const sum = rows.reduce((acc, r) => acc + r.rating, 0);
    const averageRating = Math.round((sum / totalCount) * 10) / 10;

    const distribution = [5, 4, 3, 2, 1].map((stars) => ({
      stars,
      count: rows.filter((r) => r.rating === stars).length,
    }));

    return { average_rating: averageRating, total_count: totalCount, verified_count: verifiedCount, distribution };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[review.service] getReviewSummary failed:', message);
    throw new Error(`Failed to get review summary: ${message}`);
  }
}

interface SubmitReviewData {
  product_handle: string;
  customer_email: string;
  customer_name: string;
  customer_nickname?: string;
  rating: number;
  title?: string;
  body: string;
  variant_title?: string;
  brand_id: string;
  token?: string; // review request token for verified purchase
  media_urls?: string[];
}

export async function submitReview(data: SubmitReviewData): Promise<Review> {
  try {
    // Validate rating
    if (!data.rating || data.rating < 1 || data.rating > 5) {
      throw new Error('Rating must be between 1 and 5');
    }

    if (!data.body || data.body.trim().length === 0) {
      throw new Error('Review body is required');
    }

    if (!data.customer_email) {
      throw new Error('Customer email is required');
    }

    if (!data.customer_name) {
      throw new Error('Customer name is required');
    }

    // Resolve product
    const { data: product, error: prodErr } = await supabase
      .from('products')
      .select('id, shopify_product_id')
      .eq('handle', data.product_handle)
      .eq('brand_id', data.brand_id)
      .single();

    if (prodErr || !product) {
      throw new Error(`Product not found: ${data.product_handle}`);
    }

    // Check for verified purchase via review request token
    let verifiedPurchase = false;
    let shopifyOrderId: string | null = null;
    let source: 'email_request' | 'organic' = 'organic';

    if (data.token) {
      const { data: request, error: reqErr } = await supabase
        .from('review_requests')
        .select('*')
        .eq('token', data.token)
        .eq('brand_id', data.brand_id)
        .in('status', ['sent', 'reminded'])
        .single();

      if (!reqErr && request) {
        verifiedPurchase = true;
        shopifyOrderId = request.shopify_order_id;
        source = 'email_request';

        // Mark request as completed
        await supabase
          .from('review_requests')
          .update({ status: 'completed', completed_at: new Date().toISOString() })
          .eq('id', request.id);
      }
    }

    // Load settings for moderation
    const settings = await getReviewSettings(data.brand_id);

    // Run moderation
    const moderationResult = evaluateReview(
      {
        rating: data.rating,
        body: data.body,
        title: data.title ?? null,
        verified_purchase: verifiedPurchase,
      },
      settings,
    );

    const status = moderationResult.action === 'publish' ? 'published' : moderationResult.action === 'reject' ? 'rejected' : 'pending';

    const reviewRow = {
      product_id: product.id,
      shopify_product_id: product.shopify_product_id,
      shopify_order_id: shopifyOrderId,
      customer_email: data.customer_email,
      customer_name: data.customer_name,
      customer_nickname: data.customer_nickname ?? null,
      rating: data.rating,
      title: data.title ?? null,
      body: data.body.trim(),
      status,
      verified_purchase: verifiedPurchase,
      incentivized: false,
      variant_title: data.variant_title ?? null,
      source,
      import_source_id: null,
      featured: false,
      helpful_count: 0,
      report_count: 0,
      published_at: status === 'published' ? new Date().toISOString() : null,
      submitted_at: new Date().toISOString(),
      brand_id: data.brand_id,
    };

    const { data: created, error: createErr } = await supabase
      .from('reviews')
      .insert(reviewRow)
      .select()
      .single();

    if (createErr) throw new Error(`Failed to create review: ${createErr.message}`);

    // Insert media if provided
    if (data.media_urls && data.media_urls.length > 0) {
      const mediaRows = data.media_urls.map((url, index) => ({
        review_id: (created as Record<string, unknown>).id,
        storage_path: url,
        url,
        media_type: 'image' as const,
        sort_order: index,
        file_size: null,
        width: null,
        height: null,
      }));

      const { error: mediaErr } = await supabase
        .from('review_media')
        .insert(mediaRows);

      if (mediaErr) {
        console.error('[review.service] Failed to insert media:', mediaErr.message);
      }
    }

    console.log(`[review.service] Review submitted for product ${data.product_handle}, status: ${status}, reasons: ${moderationResult.reasons.join('; ')}`);
    return created as Review;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[review.service] submitReview failed:', message);
    throw err;
  }
}

export async function getReviewById(id: string): Promise<Review | null> {
  try {
    const { data, error } = await supabase
      .from('reviews')
      .select('*, review_media(*), review_replies(*), products(*)')
      .eq('id', id)
      .single();

    if (error && error.code === 'PGRST116') return null;
    if (error) throw new Error(`Failed to fetch review: ${error.message}`);

    const row = data as Record<string, unknown>;
    return {
      ...row,
      media: row.review_media ?? [],
      reply: Array.isArray(row.review_replies) && (row.review_replies as unknown[]).length > 0
        ? (row.review_replies as unknown[])[0]
        : null,
      product: row.products ?? undefined,
      review_media: undefined,
      review_replies: undefined,
      products: undefined,
    } as unknown as Review;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[review.service] getReviewById failed:', message);
    throw new Error(`Failed to get review: ${message}`);
  }
}

const ALLOWED_UPDATE_FIELDS = new Set([
  'status', 'featured', 'rating', 'title', 'body', 'verified_purchase',
  'incentivized', 'customer_nickname',
]);

export async function updateReview(
  id: string,
  updates: Partial<Review>,
): Promise<Review> {
  try {
    const filtered: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(updates)) {
      if (ALLOWED_UPDATE_FIELDS.has(key)) {
        filtered[key] = value;
      }
    }

    if (Object.keys(filtered).length === 0) {
      throw new Error('No valid fields to update');
    }

    // Set published_at when status changes to published
    if (filtered.status === 'published') {
      filtered.published_at = new Date().toISOString();
    }

    filtered.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('reviews')
      .update(filtered)
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(`Failed to update review: ${error.message}`);
    return data as Review;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[review.service] updateReview failed:', message);
    throw err;
  }
}

export async function deleteReview(id: string): Promise<void> {
  try {
    const { error } = await supabase
      .from('reviews')
      .delete()
      .eq('id', id);

    if (error) throw new Error(`Failed to delete review: ${error.message}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[review.service] deleteReview failed:', message);
    throw new Error(`Failed to delete review: ${message}`);
  }
}

export async function bulkAction(
  ids: string[],
  action: 'publish' | 'reject' | 'archive' | 'delete' | 'feature' | 'unfeature',
): Promise<{ updated: number }> {
  try {
    if (ids.length === 0) return { updated: 0 };

    if (action === 'delete') {
      const { error, count } = await supabase
        .from('reviews')
        .delete()
        .in('id', ids);

      if (error) throw new Error(`Bulk delete failed: ${error.message}`);
      return { updated: count ?? ids.length };
    }

    const updatePayload: Record<string, unknown> = { updated_at: new Date().toISOString() };

    switch (action) {
      case 'publish':
        updatePayload.status = 'published';
        updatePayload.published_at = new Date().toISOString();
        break;
      case 'reject':
        updatePayload.status = 'rejected';
        break;
      case 'archive':
        updatePayload.status = 'archived';
        break;
      case 'feature':
        updatePayload.featured = true;
        break;
      case 'unfeature':
        updatePayload.featured = false;
        break;
    }

    const { error, count } = await supabase
      .from('reviews')
      .update(updatePayload)
      .in('id', ids);

    if (error) throw new Error(`Bulk ${action} failed: ${error.message}`);
    return { updated: count ?? ids.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[review.service] bulkAction failed:', message);
    throw new Error(`Bulk action failed: ${message}`);
  }
}

export async function markHelpful(id: string): Promise<{ helpful_count: number }> {
  try {
    // Use RPC or manual increment
    const { data: current, error: fetchErr } = await supabase
      .from('reviews')
      .select('helpful_count')
      .eq('id', id)
      .eq('status', 'published')
      .single();

    if (fetchErr) throw new Error(`Review not found: ${fetchErr.message}`);

    const newCount = ((current as Record<string, unknown>).helpful_count as number) + 1;

    const { error } = await supabase
      .from('reviews')
      .update({ helpful_count: newCount, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (error) throw new Error(`Failed to update helpful count: ${error.message}`);
    return { helpful_count: newCount };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[review.service] markHelpful failed:', message);
    throw new Error(`Failed to mark helpful: ${message}`);
  }
}

export async function reportReview(id: string): Promise<{ report_count: number }> {
  try {
    const { data: current, error: fetchErr } = await supabase
      .from('reviews')
      .select('report_count, status')
      .eq('id', id)
      .eq('status', 'published')
      .single();

    if (fetchErr) throw new Error(`Review not found: ${fetchErr.message}`);

    const row = current as Record<string, unknown>;
    const newCount = (row.report_count as number) + 1;

    const updatePayload: Record<string, unknown> = {
      report_count: newCount,
      updated_at: new Date().toISOString(),
    };

    // Auto-flag for moderation at 3+ reports
    if (newCount >= 3) {
      updatePayload.status = 'pending';
    }

    const { error } = await supabase
      .from('reviews')
      .update(updatePayload)
      .eq('id', id);

    if (error) throw new Error(`Failed to update report count: ${error.message}`);
    return { report_count: newCount };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[review.service] reportReview failed:', message);
    throw new Error(`Failed to report review: ${message}`);
  }
}

export async function createReply(
  reviewId: string,
  authorName: string,
  body: string,
  authorEmail?: string,
): Promise<ReviewReply> {
  try {
    // Upsert on review_id (one reply per review)
    const { data, error } = await supabase
      .from('review_replies')
      .upsert(
        {
          review_id: reviewId,
          author_name: authorName,
          author_email: authorEmail ?? null,
          body,
          published: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'review_id' },
      )
      .select()
      .single();

    if (error) throw new Error(`Failed to create reply: ${error.message}`);
    return data as ReviewReply;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[review.service] createReply failed:', message);
    throw new Error(`Failed to create reply: ${message}`);
  }
}

export async function deleteReply(reviewId: string): Promise<void> {
  try {
    const { error } = await supabase
      .from('review_replies')
      .delete()
      .eq('review_id', reviewId);

    if (error) throw new Error(`Failed to delete reply: ${error.message}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[review.service] deleteReply failed:', message);
    throw new Error(`Failed to delete reply: ${message}`);
  }
}
