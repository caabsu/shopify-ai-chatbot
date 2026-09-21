import { supabase } from '../config/supabase.js';
import { callSupportRequiredTool } from './support-model-tool.service.js';
import type { RequiredToolDefinition } from './deepseek-tool-call.service.js';
import { recordSupportGenerationRun } from './ai-generation-ledger.service.js';

// ── Analytics Cache ───────────────────────────────────────────────────────

const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

interface AnalyticsCacheEntry {
  data: Record<string, unknown>;
  expiresAt: number;
}

async function getCachedAnalytics(
  brandId: string,
  productId?: string,
): Promise<Record<string, unknown> | null> {
  const cacheKey = productId ? `${brandId}:${productId}` : brandId;

  const { data, error } = await supabase
    .from('review_analytics_cache')
    .select('data, expires_at')
    .eq('cache_key', cacheKey)
    .single();

  if (error || !data) return null;

  const row = data as { data: Record<string, unknown>; expires_at: string };
  if (new Date(row.expires_at).getTime() < Date.now()) return null;

  return row.data;
}

async function setCachedAnalytics(
  brandId: string,
  analysisData: Record<string, unknown>,
  productId?: string,
): Promise<void> {
  const cacheKey = productId ? `${brandId}:${productId}` : brandId;
  const expiresAt = new Date(Date.now() + CACHE_TTL).toISOString();

  await supabase
    .from('review_analytics_cache')
    .upsert(
      {
        cache_key: cacheKey,
        brand_id: brandId,
        product_id: productId ?? null,
        data: analysisData,
        expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'cache_key' },
    );
}

// ── AI Analysis ───────────────────────────────────────────────────────────

interface ReviewAnalysis {
  sentiment_summary: string;
  top_positive_themes: string[];
  top_negative_themes: string[];
  common_keywords: string[];
  improvement_suggestions: string[];
  average_sentiment_score: number;
  review_quality_score: number;
}

const REVIEW_ANALYSIS_TOOL: RequiredToolDefinition = {
  name: 'analyze_customer_reviews',
  description: 'Return structured aggregate analysis of customer reviews.',
  inputSchema: {
    type: 'object',
    required: [
      'sentiment_summary',
      'top_positive_themes',
      'top_negative_themes',
      'common_keywords',
      'improvement_suggestions',
      'average_sentiment_score',
      'review_quality_score',
    ],
    properties: {
      sentiment_summary: { type: 'string' },
      top_positive_themes: { type: 'array', maxItems: 5, items: { type: 'string' } },
      top_negative_themes: { type: 'array', maxItems: 5, items: { type: 'string' } },
      common_keywords: { type: 'array', maxItems: 5, items: { type: 'string' } },
      improvement_suggestions: { type: 'array', maxItems: 5, items: { type: 'string' } },
      average_sentiment_score: { type: 'number', minimum: 0, maximum: 1 },
      review_quality_score: { type: 'number', minimum: 0, maximum: 1 },
    },
  },
};

const REVIEW_REPLY_TOOL: RequiredToolDefinition = {
  name: 'write_review_reply',
  description: 'Return a concise customer-facing review reply.',
  inputSchema: {
    type: 'object',
    required: ['text'],
    properties: { text: { type: 'string' } },
  },
};

export async function analyzeReviews(
  brandId: string,
  productId?: string,
): Promise<ReviewAnalysis> {
  try {
    // Check cache
    const cached = await getCachedAnalytics(brandId, productId);
    if (cached) {
      return cached as unknown as ReviewAnalysis;
    }

    // Fetch reviews
    let query = supabase
      .from('reviews')
      .select('rating, title, body, verified_purchase, helpful_count, submitted_at')
      .eq('brand_id', brandId)
      .eq('status', 'published')
      .order('submitted_at', { ascending: false })
      .limit(200);

    if (productId) {
      query = query.eq('product_id', productId);
    }

    const { data: reviews, error } = await query;

    if (error) throw new Error(`Failed to fetch reviews for analysis: ${error.message}`);

    if (!reviews || reviews.length === 0) {
      const emptyResult: ReviewAnalysis = {
        sentiment_summary: 'No reviews available for analysis.',
        top_positive_themes: [],
        top_negative_themes: [],
        common_keywords: [],
        improvement_suggestions: [],
        average_sentiment_score: 0,
        review_quality_score: 0,
      };
      return emptyResult;
    }

    // Build review text for AI
    const reviewTexts = (reviews as Array<Record<string, unknown>>).map((r, i) => {
      const title = r.title ? ` - Title: "${r.title}"` : '';
      return `Review ${i + 1} (Rating: ${r.rating}/5${title}): "${r.body}"`;
    }).join('\n');

    const systemPrompt = `You are a review analytics assistant. Analyze the provided customer reviews and return a structured JSON analysis.

You MUST respond with valid JSON only. No markdown, no explanation. The JSON must match this exact structure:

{
  "sentiment_summary": "<2-3 sentence summary of overall sentiment>",
  "top_positive_themes": ["<theme1>", "<theme2>", ...],
  "top_negative_themes": ["<theme1>", "<theme2>", ...],
  "common_keywords": ["<keyword1>", "<keyword2>", ...],
  "improvement_suggestions": ["<suggestion1>", "<suggestion2>", ...],
  "average_sentiment_score": <number 0-1, where 1 is most positive>,
  "review_quality_score": <number 0-1, indicating how detailed/helpful reviews are>
}

Limit arrays to 5 items max. Be specific and actionable in suggestions.`;

    const response = await callSupportRequiredTool<Partial<ReviewAnalysis>>({
      tier: 'flash',
      max_tokens: 1_024,
      temperature: 0.3,
      system: systemPrompt,
      user: `Analyze these ${reviews.length} customer reviews:\n\n${reviewTexts}`,
      tool: REVIEW_ANALYSIS_TOOL,
    });
    await recordSupportGenerationRun({
      purpose: 'review_analysis',
      generation: response.generation,
      brandId,
      promptVersion: 'review-analysis-2026-07-v1',
      routerVersion: 'review-analytics-router-v1',
      routerDecision: { tier: 'flash', reason: 'bounded_aggregation' },
      metadata: { review_count: reviews.length, product_id: productId ?? null },
    });
    const analysis = parseAnalysisResponse(JSON.stringify(response.value));

    // Cache the result
    await setCachedAnalytics(brandId, analysis as unknown as Record<string, unknown>, productId);

    return analysis;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[review-analytics] analyzeReviews failed:', message);
    return {
      sentiment_summary: 'Analysis failed. Please try again later.',
      top_positive_themes: [],
      top_negative_themes: [],
      common_keywords: [],
      improvement_suggestions: [],
      average_sentiment_score: 0,
      review_quality_score: 0,
    };
  }
}

function parseAnalysisResponse(responseText: string): ReviewAnalysis {
  try {
    let jsonStr = responseText.trim();

    // Strip markdown code fences if present
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;

    return {
      sentiment_summary: typeof parsed.sentiment_summary === 'string' ? parsed.sentiment_summary : 'No summary available.',
      top_positive_themes: Array.isArray(parsed.top_positive_themes) ? parsed.top_positive_themes as string[] : [],
      top_negative_themes: Array.isArray(parsed.top_negative_themes) ? parsed.top_negative_themes as string[] : [],
      common_keywords: Array.isArray(parsed.common_keywords) ? parsed.common_keywords as string[] : [],
      improvement_suggestions: Array.isArray(parsed.improvement_suggestions) ? parsed.improvement_suggestions as string[] : [],
      average_sentiment_score: typeof parsed.average_sentiment_score === 'number' ? parsed.average_sentiment_score : 0,
      review_quality_score: typeof parsed.review_quality_score === 'number' ? parsed.review_quality_score : 0,
    };
  } catch (err) {
    console.error('[review-analytics] Failed to parse analysis response:', err instanceof Error ? err.message : err);
    console.error('[review-analytics] Raw response:', responseText);
    return {
      sentiment_summary: 'Failed to parse analysis.',
      top_positive_themes: [],
      top_negative_themes: [],
      common_keywords: [],
      improvement_suggestions: [],
      average_sentiment_score: 0,
      review_quality_score: 0,
    };
  }
}

// ── Reply Draft Suggestion ────────────────────────────────────────────────

export async function suggestReplyDraft(
  reviewBody: string,
  rating: number,
  customerName: string,
): Promise<string> {
  try {
    const response = await callSupportRequiredTool<{ text?: string }>({
      tier: 'flash',
      max_tokens: 512,
      temperature: 0.7,
      system: `You are a helpful store owner writing replies to customer reviews.
Write a warm, professional reply that:
- Addresses the customer by name
- Acknowledges their feedback specifically
- For positive reviews (4-5 stars): thank them genuinely
- For negative reviews (1-2 stars): empathize, apologize if warranted, and offer to help
- For mixed reviews (3 stars): thank them and address any concerns
- Keep it concise (2-4 sentences)
- Do NOT use generic phrases like "valued customer"
- Sound human and authentic

Return only the reply through the required tool.`,
      user: `Customer name: ${customerName}\nRating: ${rating}/5\nReview: "${reviewBody}"`,
      tool: REVIEW_REPLY_TOOL,
    });
    await recordSupportGenerationRun({
      purpose: 'review_reply',
      generation: response.generation,
      promptVersion: 'review-reply-2026-07-v1',
      routerVersion: 'review-reply-router-v1',
      routerDecision: { tier: 'flash', reason: 'routine_short_draft' },
    });
    return typeof response.value.text === 'string' ? response.value.text.trim() : '';
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[review-analytics] suggestReplyDraft failed:', message);
    throw new Error(`Failed to generate reply draft: ${message}`);
  }
}

// ── Dashboard Stats ───────────────────────────────────────────────────────

interface ReviewStats {
  total_reviews: number;
  published_reviews: number;
  pending_reviews: number;
  average_rating: number;
  reviews_this_month: number;
  response_rate: number;
  total_products_with_reviews: number;
}

export async function getAnalyticsStats(brandId: string): Promise<ReviewStats> {
  try {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    const [
      totalResult,
      publishedResult,
      pendingResult,
      avgResult,
      monthResult,
      repliedResult,
      productsResult,
    ] = await Promise.all([
      // Total reviews
      supabase
        .from('reviews')
        .select('id', { count: 'exact', head: true })
        .eq('brand_id', brandId),

      // Published reviews
      supabase
        .from('reviews')
        .select('id', { count: 'exact', head: true })
        .eq('brand_id', brandId)
        .eq('status', 'published'),

      // Pending reviews
      supabase
        .from('reviews')
        .select('id', { count: 'exact', head: true })
        .eq('brand_id', brandId)
        .eq('status', 'pending'),

      // Average rating of published reviews
      supabase
        .from('reviews')
        .select('rating')
        .eq('brand_id', brandId)
        .eq('status', 'published'),

      // Reviews this month
      supabase
        .from('reviews')
        .select('id', { count: 'exact', head: true })
        .eq('brand_id', brandId)
        .gte('submitted_at', monthStart),

      // Reviews with replies
      supabase
        .from('review_replies')
        .select('review_id', { count: 'exact', head: true })
        .in(
          'review_id',
          // Supabase doesn't support subquery in .in() directly, so use a join approach
          // Instead, we'll just count all replies for this brand's reviews
          [],
        ),

      // Products with reviews
      supabase
        .from('reviews')
        .select('product_id')
        .eq('brand_id', brandId)
        .eq('status', 'published'),
    ]);

    const totalReviews = totalResult.count ?? 0;
    const publishedReviews = publishedResult.count ?? 0;
    const pendingReviews = pendingResult.count ?? 0;
    const reviewsThisMonth = monthResult.count ?? 0;

    // Calculate average rating
    const ratings = (avgResult.data ?? []) as Array<{ rating: number }>;
    const averageRating = ratings.length > 0
      ? Math.round((ratings.reduce((sum, r) => sum + r.rating, 0) / ratings.length) * 10) / 10
      : 0;

    // Calculate response rate (reviews with replies / total published)
    // Get actual reply count for this brand
    const { count: replyCount } = await supabase
      .from('review_replies')
      .select('id', { count: 'exact', head: true });

    const responseRate = publishedReviews > 0
      ? Math.round(((replyCount ?? 0) / publishedReviews) * 100)
      : 0;

    // Count unique products with reviews
    const productIds = new Set(
      ((productsResult.data ?? []) as Array<{ product_id: string }>).map((r) => r.product_id),
    );

    return {
      total_reviews: totalReviews,
      published_reviews: publishedReviews,
      pending_reviews: pendingReviews,
      average_rating: averageRating,
      reviews_this_month: reviewsThisMonth,
      response_rate: responseRate,
      total_products_with_reviews: productIds.size,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[review-analytics] getAnalyticsStats failed:', message);
    throw new Error(`Failed to get analytics stats: ${message}`);
  }
}
