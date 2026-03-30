import { config } from '../config/env.js';
import { supabase } from '../config/supabase.js';
import { ALL_MOOD_KEYS } from './quiz-image.service.js';

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
  return `You are classifying a lighting product for Outlight, a premium modern lighting brand. Your goal is to assign the product to the 1-2 moods it fits BEST from the 8 options below.

Each mood has a SPECIFIC visual identity. Read the descriptions carefully — they define what materials, forms, and aesthetics qualify:

SOFT TRACK (warm, approachable):
- "golden-nook": Intimate candlelight warmth. Brass, aged bronze, amber glass, cream linen shades. Fixtures feel collected, organic, lived-in. Soft diffused pooling light.
- "layered-warmth": Abundant layered lighting from mixed sources. Rattan, tinted glass, textured ceramics, mixed metals (brass+copper). Eclectic, collected, full of personality.
- "soft-modern": Clean Scandinavian warmth. Matte white, brushed brass, frosted glass, light walnut, concrete. Modern minimal fixtures with organic touches. Intentional, purposeful lighting.
- "quiet-glow": Zen-like, minimal, diffused. Light wood, paper, linen, matte ceramic. Sculptural minimal fixtures — art objects with restraint. Japanese/Scandinavian calm.

DRAMATIC TRACK (warm with depth and contrast):
- "gilded-evening": Glamorous, geometric, opulent. GOLD, polished brass, crystal, smoked glass, lacquer, warm marble. Fixtures are luxurious, geometric, ornate, precious. Art deco, cocktail party elegance.
- "deep-amber": Intimate, focused, few light sources. Dark brass, aged bronze, amber glass, dark wood, dark marble. Dark-toned fixtures that emit deep warm light. Moody, hotel-lounge luxury.
- "foundry-glow": Raw, industrial, honest. Raw steel, aged iron, copper patina, exposed filament bulbs, concrete. Workshop-made, functional beauty. Industrial pendants, cage lights, pipe fixtures.
- "midnight-warmth": Theatrical maximalism. Mixed warm metals, tinted glass, ornate detailing, velvet, jewel tones. STATEMENT fixtures — large chandeliers, dramatic multi-arm pieces, conversation starters.

SCORING RULES:
- Each product should score 0.50+ on exactly 1-2 moods (its BEST fits)
- Score 0.30-0.49 for 1-2 secondary moods at most
- Score 0.00-0.29 for all others
- NEVER give 0.50+ to more than 2 moods

CRITICAL: The dramatic track moods are NOT rare. ANY product with dark/black finishes, industrial materials, geometric/ornate forms, or statement-piece proportions belongs in the dramatic track, NOT the soft track. A black metal fixture is foundry-glow or deep-amber, NOT soft-modern. A geometric gold fixture is gilded-evening, NOT golden-nook. A large ornate chandelier is midnight-warmth, NOT layered-warmth.

Also provide:
1. "product_type": Classify as exactly ONE of: "pendant", "floor_lamp", "table_lamp", "wall_sconce", "chandelier", "ceiling_light", "desk_lamp"
2. "reasoning": 1-2 sentences explaining your mood choice.

Return ONLY valid JSON:
{
  "product_type": "pendant",
  "mood_scores": {
    "golden-nook": 0.10,
    "layered-warmth": 0.15,
    "soft-modern": 0.05,
    "quiet-glow": 0.05,
    "gilded-evening": 0.80,
    "deep-amber": 0.35,
    "foundry-glow": 0.10,
    "midnight-warmth": 0.20
  },
  "reasoning": "This geometric gold pendant with crystal accents is quintessential gilded-evening — glamorous, opulent, art-deco inspired."
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
              node { title handle status featuredImage { url } }
            }
            pageInfo { hasNextPage endCursor }
          }
        }
      `;

      const data: {
        products: {
          edges: Array<{ node: { title: string; handle: string; status: string; featuredImage: { url: string } | null } }>;
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
        };
      } = await graphql(query, { cursor }, brandId);

      for (const edge of data.products.edges) {
        if (edge.node.status === 'ACTIVE' && edge.node.featuredImage?.url) {
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

    // Post-processing: ensure minimum coverage per mood
    if (tagged > 0) {
      const promoted = await ensureMinimumCoverage(brandId);
      console.log(`[mood-tagger] Post-processing promoted ${promoted} product-mood scores to meet minimums`);
    }

    return { tagged, skipped, errors };
  } finally {
    batchInProgress = false;
  }
}

// ── Post-processing: ensure minimum products per mood × product type ─────

const MIN_PER_MOOD_TYPE = 4; // Minimum products per mood per product type
const PROMOTE_THRESHOLD = 0.50;

const COLLECTION_PRODUCT_TYPES = ['pendant', 'floor_lamp', 'desk_lamp', 'wall_sconce', 'chandelier'];

async function ensureMinimumCoverage(brandId: string): Promise<number> {
  const { data: allTags, error } = await supabase
    .from('product_mood_tags')
    .select('*')
    .eq('brand_id', brandId);

  if (error || !allTags || allTags.length === 0) return 0;

  let totalPromoted = 0;

  for (const moodKey of ALL_MOOD_KEYS) {
    for (const productType of COLLECTION_PRODUCT_TYPES) {
      // Products of this type
      const typeProducts = allTags.filter((t) => t.product_type === productType);
      if (typeProducts.length === 0) continue;

      // Already tagged for this mood
      const tagged = typeProducts.filter(
        (t) => ((t.mood_scores as Record<string, number>)?.[moodKey] ?? 0) >= PROMOTE_THRESHOLD,
      );

      if (tagged.length >= MIN_PER_MOOD_TYPE) continue;

      // Promote candidates: same type, below threshold, sorted by score desc
      const candidates = typeProducts
        .filter((t) => {
          const score = (t.mood_scores as Record<string, number>)?.[moodKey] ?? 0;
          return score < PROMOTE_THRESHOLD;
        })
        .sort((a, b) => {
          const sa = (a.mood_scores as Record<string, number>)?.[moodKey] ?? 0;
          const sb = (b.mood_scores as Record<string, number>)?.[moodKey] ?? 0;
          return sb - sa;
        });

      const needed = MIN_PER_MOOD_TYPE - tagged.length;
      const toPromote = candidates.slice(0, needed);

      for (const tag of toPromote) {
        const updatedScores = { ...(tag.mood_scores as Record<string, number>) };
        updatedScores[moodKey] = PROMOTE_THRESHOLD;

        const { error: updateErr } = await supabase
          .from('product_mood_tags')
          .update({ mood_scores: updatedScores, updated_at: new Date().toISOString() })
          .eq('id', tag.id);

        if (!updateErr) totalPromoted++;
      }

      if (toPromote.length > 0) {
        console.log(`[mood-tagger] ${moodKey}×${productType}: promoted ${toPromote.length} (had ${tagged.length}, need ${MIN_PER_MOOD_TYPE})`);
      }
    }
  }

  return totalPromoted;
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
