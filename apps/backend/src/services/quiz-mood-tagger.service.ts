import { config } from '../config/env.js';
import { supabase } from '../config/supabase.js';
import { ALL_MOOD_KEYS, MOOD_KEY_LABELS } from './quiz-image.service.js';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ProductMoodTag {
  id: string;
  brand_id: string;
  product_handle: string;
  product_title: string;
  product_image_url: string | null;
  product_type: string | null;
  mood_scores: Record<string, number>;
  tagged_by: 'ai' | 'manual';
  ai_model: string | null;
  ai_analysis: Record<string, unknown> | null;
  tagged_at: string;
  created_at: string;
  updated_at: string;
}

export interface TaggingStatus {
  total: number;
  tagged: number;
  untagged: number;
  lastTaggedAt: string | null;
  inProgress: boolean;
}

export interface TaggingProgress {
  current: number;
  total: number;
  handle: string;
  title: string;
  status: 'processing' | 'done' | 'skipped' | 'error';
  error?: string;
}

// ── Tagging state ────────────────────────────────────────────────────────────

let batchInProgress = false;
let batchProgress: TaggingProgress | null = null;

// ── Lazy Gemini client ──────────────────────────────────────────────────────

let genaiClient: any = null;

async function getClient() {
  if (genaiClient) return genaiClient;
  if (!config.gemini.apiKey) throw new Error('GEMINI_API_KEY is not configured');
  const { GoogleGenAI } = await import('@google/genai');
  genaiClient = new GoogleGenAI({ apiKey: config.gemini.apiKey });
  return genaiClient;
}

// ── Build the tagging prompt ────────────────────────────────────────────────

function buildTaggingPrompt(): string {
  const moodDescriptions = ALL_MOOD_KEYS.map((key) => {
    const info = MOOD_KEY_LABELS[key];
    return `- "${key}" (${info.label}, ${info.track} track)`;
  }).join('\n');

  return `You are classifying a lighting product for Outlight, a premium modern lighting brand with a warm, clean, aesthetic sensibility.

Given this product image, analyze the fixture's form, material, finish, color, and overall feeling, then provide:

1. "product_type": Classify as exactly ONE of: "pendant", "floor_lamp", "table_lamp", "wall_sconce", "chandelier", "ceiling_light", "desk_lamp"

2. "mood_scores": Rate 0.00 to 1.00 how well this product fits each mood. Consider the fixture's aesthetic, material warmth, form factor, and the kind of space/atmosphere it would create:
${moodDescriptions}

Higher scores (0.80+) mean this product is a PERFECT fit for that mood.
Mid scores (0.40-0.70) mean it could work but isn't ideal.
Low scores (0.00-0.30) mean poor fit.

3. "reasoning": 1-2 sentences explaining the classification.

Return ONLY valid JSON with this exact structure:
{
  "product_type": "pendant",
  "mood_scores": {
    "golden-nook": 0.85,
    "layered-warmth": 0.60,
    "soft-modern": 0.45,
    "quiet-glow": 0.30,
    "gilded-evening": 0.70,
    "deep-amber": 0.55,
    "foundry-glow": 0.40,
    "midnight-warmth": 0.65
  },
  "reasoning": "This brass pendant with amber glass..."
}

Return ONLY valid JSON, no markdown fences or extra text.`;
}

// ── Tag a single product ────────────────────────────────────────────────────

export async function tagSingleProduct(
  brandId: string,
  handle: string,
  title: string,
  imageUrl: string,
): Promise<ProductMoodTag | null> {
  const client = await getClient();

  // Download the product image
  let imageBase64: string;
  let imageMimeType: string;
  try {
    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) throw new Error(`HTTP ${imgRes.status}`);
    const buf = Buffer.from(await imgRes.arrayBuffer());
    imageBase64 = buf.toString('base64');
    imageMimeType = (imgRes.headers.get('content-type') || 'image/jpeg').split(';')[0];
  } catch (err) {
    console.error(`[mood-tagger] Failed to download image for "${handle}":`, err instanceof Error ? err.message : err);
    return null;
  }

  // Send to Gemini for classification
  const prompt = buildTaggingPrompt();

  const response = await client.models.generateContent({
    model: config.gemini.reviewModel,
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType: imageMimeType, data: imageBase64 } },
          { text: prompt },
        ],
      },
    ],
  });

  const text = (response.text ?? '').trim();
  let parsed: { product_type: string; mood_scores: Record<string, number>; reasoning: string };
  try {
    const cleaned = text.replace(/^```json\n?/, '').replace(/\n?```$/, '');
    parsed = JSON.parse(cleaned);
  } catch {
    console.error(`[mood-tagger] Failed to parse AI response for "${handle}":`, text.slice(0, 200));
    return null;
  }

  // Validate mood_scores has all keys
  const scores: Record<string, number> = {};
  for (const key of ALL_MOOD_KEYS) {
    scores[key] = typeof parsed.mood_scores?.[key] === 'number'
      ? Math.max(0, Math.min(1, parsed.mood_scores[key]))
      : 0;
  }

  // Upsert into database
  const row = {
    brand_id: brandId,
    product_handle: handle,
    product_title: title,
    product_image_url: imageUrl,
    product_type: parsed.product_type || null,
    mood_scores: scores,
    tagged_by: 'ai' as const,
    ai_model: config.gemini.reviewModel,
    ai_analysis: { reasoning: parsed.reasoning, raw_scores: parsed.mood_scores },
    tagged_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('product_mood_tags')
    .upsert(row, { onConflict: 'brand_id,product_handle' })
    .select()
    .single();

  if (error) {
    console.error(`[mood-tagger] DB upsert failed for "${handle}":`, error.message);
    return null;
  }

  console.log(`[mood-tagger] Tagged "${handle}" → type: ${parsed.product_type}, top mood: ${Object.entries(scores).sort((a, b) => b[1] - a[1])[0]?.[0]}`);
  return data;
}

// ── Batch tag all products ──────────────────────────────────────────────────

export async function batchTagAllProducts(
  brandId: string,
  options?: { force?: boolean; concurrency?: number; delayMs?: number },
): Promise<{ tagged: number; skipped: number; errors: number }> {
  if (batchInProgress) {
    throw new Error('Batch tagging is already in progress');
  }

  batchInProgress = true;
  const force = options?.force ?? false;
  const concurrency = options?.concurrency ?? 2;
  const delayMs = options?.delayMs ?? 500;

  let tagged = 0;
  let skipped = 0;
  let errors = 0;

  try {
    // Fetch all products from Shopify Admin API
    const { graphql } = await import('./shopify-admin.service.js');
    const products: Array<{ handle: string; title: string; imageUrl: string }> = [];

    let cursor: string | null = null;
    let hasNext = true;

    while (hasNext) {
      const query = `
        query Products($cursor: String) {
          products(first: 50, after: $cursor, sortKey: TITLE) {
            edges {
              node { title handle featuredImage { url } }
            }
            pageInfo { hasNextPage endCursor }
          }
        }
      `;

      const data: {
        products: {
          edges: Array<{ node: { title: string; handle: string; featuredImage: { url: string } | null } }>;
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
        };
      } = await graphql(query, { cursor }, brandId);

      for (const edge of data.products.edges) {
        if (edge.node.featuredImage?.url) {
          products.push({
            handle: edge.node.handle,
            title: edge.node.title,
            imageUrl: edge.node.featuredImage.url,
          });
        }
      }

      hasNext = data.products.pageInfo.hasNextPage;
      cursor = data.products.pageInfo.endCursor;
    }

    console.log(`[mood-tagger] Batch tagging ${products.length} products (force=${force})...`);

    // If not forcing, skip already-tagged products
    let toTag = products;
    if (!force) {
      const { data: existing } = await supabase
        .from('product_mood_tags')
        .select('product_handle')
        .eq('brand_id', brandId);

      const taggedHandles = new Set((existing ?? []).map((r) => r.product_handle));
      toTag = products.filter((p) => !taggedHandles.has(p.handle));
      skipped = products.length - toTag.length;
      console.log(`[mood-tagger] Skipping ${skipped} already-tagged products, tagging ${toTag.length} new`);
    }

    // Process in small batches with concurrency
    for (let i = 0; i < toTag.length; i += concurrency) {
      const batch = toTag.slice(i, i + concurrency);

      batchProgress = {
        current: i + 1,
        total: toTag.length,
        handle: batch[0].handle,
        title: batch[0].title,
        status: 'processing',
      };

      const results = await Promise.allSettled(
        batch.map((p) => tagSingleProduct(brandId, p.handle, p.title, p.imageUrl)),
      );

      for (const result of results) {
        if (result.status === 'fulfilled' && result.value) {
          tagged++;
        } else {
          errors++;
        }
      }

      // Delay between batches to avoid rate limits
      if (i + concurrency < toTag.length) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }

    batchProgress = {
      current: toTag.length,
      total: toTag.length,
      handle: '',
      title: '',
      status: 'done',
    };

    console.log(`[mood-tagger] Batch complete: ${tagged} tagged, ${skipped} skipped, ${errors} errors`);
    return { tagged, skipped, errors };
  } finally {
    batchInProgress = false;
  }
}

// ── Query products by mood ──────────────────────────────────────────────────

export async function getProductsByMood(
  brandId: string,
  moodKey: string,
  limit = 12,
  minScore = 0.3,
): Promise<ProductMoodTag[]> {
  // Use raw SQL to order by JSONB value
  const { data, error } = await supabase
    .from('product_mood_tags')
    .select('*')
    .eq('brand_id', brandId)
    .gte(`mood_scores->>${moodKey}`, minScore)
    .order('created_at', { ascending: false })
    .limit(limit * 3); // Fetch more, then sort in JS

  if (error) {
    console.error('[mood-tagger] Failed to query products by mood:', error.message);
    return [];
  }

  // Sort by mood score descending (Supabase doesn't support JSONB ordering natively in PostgREST)
  return (data ?? [])
    .sort((a, b) => ((b.mood_scores as Record<string, number>)?.[moodKey] ?? 0) - ((a.mood_scores as Record<string, number>)?.[moodKey] ?? 0))
    .slice(0, limit);
}

export async function getProductsByMoodGrouped(
  brandId: string,
  moodKey: string,
  perType = 4,
  minScore = 0.3,
): Promise<Record<string, ProductMoodTag[]>> {
  const all = await getProductsByMood(brandId, moodKey, 100, minScore);

  const grouped: Record<string, ProductMoodTag[]> = {};
  for (const tag of all) {
    const type = tag.product_type || 'other';
    if (!grouped[type]) grouped[type] = [];
    if (grouped[type].length < perType) grouped[type].push(tag);
  }

  return grouped;
}

// ── Status ──────────────────────────────────────────────────────────────────

export async function getTaggingStatus(brandId: string): Promise<TaggingStatus> {
  // Count total products with images
  const { graphql } = await import('./shopify-admin.service.js');
  const countQuery = `{ productsCount { count } }`;
  let totalProducts = 0;
  try {
    const countData: { productsCount: { count: number } } = await graphql(countQuery, {}, brandId);
    totalProducts = countData.productsCount.count;
  } catch {
    totalProducts = 0;
  }

  // Count tagged
  const { count: taggedCount } = await supabase
    .from('product_mood_tags')
    .select('id', { count: 'exact', head: true })
    .eq('brand_id', brandId);

  // Last tagged
  const { data: lastRow } = await supabase
    .from('product_mood_tags')
    .select('tagged_at')
    .eq('brand_id', brandId)
    .order('tagged_at', { ascending: false })
    .limit(1)
    .single();

  return {
    total: totalProducts,
    tagged: taggedCount ?? 0,
    untagged: totalProducts - (taggedCount ?? 0),
    lastTaggedAt: lastRow?.tagged_at ?? null,
    inProgress: batchInProgress,
  };
}

export function getBatchProgress(): TaggingProgress | null {
  return batchProgress;
}
