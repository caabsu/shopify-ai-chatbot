import { config } from '../config/env.js';

// Lazy-load Gemini client to avoid startup failure when key is not set
let genaiClient: any = null;

async function getClient() {
  if (genaiClient) return genaiClient;
  if (!config.gemini.apiKey) {
    throw new Error('GEMINI_API_KEY is not configured');
  }
  const { GoogleGenAI } = await import('@google/genai');
  genaiClient = new GoogleGenAI({ apiKey: config.gemini.apiKey });
  return genaiClient;
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface QuizContext {
  concept: 'reveal' | 'style-profile';
  // Concept 1: The Reveal
  mood?: string; // e.g. "Cozy & Warm", "Moody & Dramatic"
  // Concept 2: The Style Profile
  who?: string;       // "Just me", "My partner & I", etc.
  track?: string;     // "soft" or "dramatic"
  vibe?: string;      // "Rustic Warm", "Art Deco Warm", etc.
  intensity?: string; // "Understated", "Balanced", "Expressive", "Statement"
  profileName?: string; // Combined: "Soft · Modern Cozy · Balanced"
}

export interface RoomReview {
  roomType: string;
  dimensions: string;
  description: string;
  currentLighting: string;
  furniture: string[];
  colorPalette: string[];
  placements: Array<{
    productType: 'pendant' | 'floor_lamp' | 'table_lamp' | 'wall_sconce' | 'chandelier' | 'ceiling_light';
    suggestedProduct: string;
    location: string;
    x: number;
    y: number;
    reasoning: string;
  }>;
  ambiance: string;
  tips: string[];
}

export interface RenderResult {
  imageBase64: string;
  mimeType: string;
}

// ── Style profile → product mapping ─────────────────────────────────────────

const STYLE_PRODUCT_MAP: Record<string, string[]> = {
  // Concept 1 moods
  'cozy-warm': ['aven', 'cade', 'elm', 'fenn', 'anka', 'aura', 'jules', 'dell', 'isar', 'seren', 'ruvo', 'maren'],
  'bright-open': ['cloud', 'saku', 'brio', 'knoll', 'azura', 'cala', 'sterling', 'blair', 'thorne', 'alba', 'talon', 'gray'],
  'moody-dramatic': ['soren', 'nyra', 'zael', 'slate', 'delos', 'blane', 'aria', 'calix', 'xara', 'york', 'ode', 'vireo'],
  'soft-editorial': ['hollis', 'fable', 'zola', 'galen', 'pallas', 'rowan', 'orin', 'fara', 'olin', 'ostra', 'lane', 'vale'],

  // Concept 2 soft vibes
  'rustic-warm': ['aven', 'cade', 'fenn', 'dell', 'ruvo', 'anka', 'maren', 'rivor', 'vero', 'wren'],
  'bohemian-layered': ['anka', 'saku', 'cielo', 'iven', 'yaro', 'hue', 'caia', 'melo', 'verve', 'loom'],
  'modern-cozy': ['cloud', 'brio', 'knoll', 'azura', 'sterling', 'tava', 'sela', 'daxel', 'ayla', 'elan'],
  'japandi-warm': ['hollis', 'jules', 'elm', 'cade', 'maren', 'ostra', 'olin', 'fable', 'thorne', 'glade'],

  // Concept 2 dramatic vibes
  'art-deco-warm': ['calix', 'cadence', 'zael', 'nyra', 'elys', 'ember', 'jora', 'loom', 'enzo', 'bliss'],
  'dark-luxe': ['soren', 'slate', 'vireo', 'ode', 'xara', 'york', 'nivra', 'ziven', 'rove', 'phel'],
  'warm-industrial': ['blane', 'arvo', 'saro', 'garek', 'vexa', 'sylos', 'kanne', 'haro', 'reed', 'arbor'],
  'moody-maximalist': ['aria', 'delos', 'kismet', 'sia', 'niva', 'calen', 'eira', 'felio', 'aeris', 'lyra'],
};

function getStyleKey(ctx: QuizContext): string {
  if (ctx.concept === 'reveal' && ctx.mood) {
    return ctx.mood.toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '');
  }
  if (ctx.concept === 'style-profile' && ctx.vibe) {
    return ctx.vibe.toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '');
  }
  return 'modern-cozy'; // fallback
}

function getSuggestedProducts(ctx: QuizContext): string[] {
  const key = getStyleKey(ctx);
  return STYLE_PRODUCT_MAP[key] || STYLE_PRODUCT_MAP['modern-cozy'];
}

// ── Build context-aware prompt ──────────────────────────────────────────────

function buildReviewPrompt(ctx: QuizContext): string {
  const products = getSuggestedProducts(ctx);
  const productList = products.slice(0, 6).join(', ');

  let styleDesc = '';
  if (ctx.concept === 'reveal') {
    const moodDescriptions: Record<string, string> = {
      'cozy-warm': 'warm, inviting atmosphere with natural materials, soft textures, and amber-toned lighting that creates an intimate, welcoming feel',
      'bright-open': 'airy, luminous space with clean lines, bright lighting, and a fresh contemporary aesthetic that maximizes openness',
      'moody-dramatic': 'bold, atmospheric space with statement lighting, dramatic contrasts, deep tones, and luxurious materials that command attention',
      'soft-editorial': 'refined, curated aesthetic with minimal, elegant lighting, muted tones, and gallery-quality composition that feels magazine-worthy',
    };
    const key = getStyleKey(ctx);
    styleDesc = moodDescriptions[key] || 'a tastefully lit, modern space';
  } else {
    const trackDesc = ctx.track === 'soft'
      ? 'gentle, organic, and naturally warm'
      : 'bold, sculptural, and dramatically atmospheric';
    const intensityDesc: Record<string, string> = {
      'Understated': 'subtle and restrained — let the architecture speak, lighting should whisper',
      'Balanced': 'harmonious and composed — lighting should complement without dominating',
      'Expressive': 'confident and curated — lighting becomes a design element in its own right',
      'Statement': 'bold and commanding — lighting is the centerpiece, the first thing you notice',
    };
    styleDesc = `${trackDesc}. The user's vibe is "${ctx.vibe || 'Modern'}" at "${ctx.intensity || 'Balanced'}" intensity — ${intensityDesc[ctx.intensity || 'Balanced'] || 'harmoniously balanced'}`;
    if (ctx.who) styleDesc += `. They're designing for: ${ctx.who}`;
  }

  return `You are an expert interior lighting designer for Outlight, a premium modern lighting brand.

STYLE DIRECTION: ${styleDesc}

Analyze this room photo and suggest where Outlight lighting products should be placed to transform the space according to the style direction above.

PRODUCT CATALOG TO DRAW FROM (use these specific names):
${productList}

Product types available: pendant lights, floor lamps, table/desk lamps, wall sconces, chandeliers, ceiling lights.

Return a JSON object with these exact fields:
{
  "roomType": "living" | "bedroom" | "office" | "dining" | "kitchen" | "bathroom" | "hallway" | "outdoor",
  "dimensions": "estimated room size, e.g. '12x15 feet, 9ft ceiling'",
  "description": "2-3 sentence description of the room — its architecture, materials, current state",
  "currentLighting": "describe the existing light sources and their quality",
  "furniture": ["list", "of", "key", "furniture", "pieces"],
  "colorPalette": ["dominant", "colors", "in", "hex"],
  "placements": [
    {
      "productType": "floor_lamp",
      "suggestedProduct": "aven",
      "location": "next to the reading nook, left of the sofa",
      "x": 25,
      "y": 65,
      "reasoning": "The warm wabi-sabi aesthetic of Aven complements the natural wood tones..."
    }
  ],
  "ambiance": "2-3 sentences describing how these products transform the space — the light quality, mood, atmosphere",
  "tips": ["2-3 specific styling tips for this aesthetic"]
}

IMPORTANT:
- Suggest 2-4 placements (don't over-light the space)
- x/y are percentages (0-100) marking where in the image each product goes
- Use ONLY product names from the catalog above in suggestedProduct
- Match product choices to the style direction — every choice should feel intentional
- Be specific about WHY each product works in that location

Return ONLY valid JSON, no markdown fences or extra text.`;
}

function buildRenderPrompt(review: RoomReview, ctx: QuizContext): string {
  const placementDesc = review.placements
    .map((p) => `- ${p.suggestedProduct} (${p.productType}) at ${p.location}`)
    .join('\n');

  let styleDirection = '';
  if (ctx.concept === 'reveal') {
    styleDirection = `"${ctx.mood || 'Modern'}" mood lighting`;
  } else {
    styleDirection = `"${ctx.profileName || ctx.vibe || 'Modern'}" style profile`;
  }

  return `Transform this room photo by adding elegant modern lighting fixtures.

STYLE: ${styleDirection}
ROOM: ${review.roomType}, ${review.dimensions}
CURRENT STATE: ${review.description}
TARGET AMBIANCE: ${review.ambiance}

PRODUCT PLACEMENTS:
${placementDesc}

INSTRUCTIONS:
1. Keep the room EXACTLY as-is — same furniture, colors, angles, perspective
2. ADD the lighting products at the specified locations, naturally integrated
3. Show the LIGHT EMISSION from each fixture — warm pools of light on surfaces, soft shadows, ambient glow
4. The overall lighting mood should shift to match the style direction
5. Products should look photorealistic — proper scale, materials (brass, glass, marble, wood), and proportions
6. Show how the light interacts with the room — reflections on surfaces, depth through shadow, warmth through color temperature
7. Make it feel like a professional interior design photograph

The result should look like this room was photographed AFTER a professional lighting design installation.`;
}

// ── Review (Analyze Room Photo) ──────────────────────────────────────────────

export async function reviewRoomPhoto(
  imageBase64: string,
  mimeType: string,
  ctx: QuizContext,
): Promise<RoomReview> {
  const client = await getClient();
  const prompt = buildReviewPrompt(ctx);

  console.log(`[quiz-image] Reviewing room photo — concept: ${ctx.concept}, style: ${getStyleKey(ctx)}`);

  const response = await client.models.generateContent({
    model: config.gemini.reviewModel,
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType, data: imageBase64 } },
          { text: prompt },
        ],
      },
    ],
  });

  const text = (response.text ?? '').trim();
  try {
    const cleaned = text.replace(/^```json\n?/, '').replace(/\n?```$/, '');
    const parsed = JSON.parse(cleaned);
    console.log(`[quiz-image] Review complete — ${parsed.placements?.length || 0} placements, room: ${parsed.roomType}`);
    return parsed;
  } catch {
    console.error('[quiz-image] Failed to parse review JSON:', text.slice(0, 300));
    return {
      roomType: 'unknown',
      dimensions: 'unknown',
      description: 'Unable to analyze room',
      currentLighting: 'unknown',
      furniture: [],
      colorPalette: [],
      placements: [],
      ambiance: '',
      tips: [],
    };
  }
}

// ── Render (Generate Visualization) ──────────────────────────────────────────

export async function renderVisualization(
  roomImageBase64: string,
  roomMimeType: string,
  review: RoomReview,
  ctx: QuizContext,
): Promise<RenderResult> {
  const client = await getClient();
  const prompt = buildRenderPrompt(review, ctx);

  console.log(`[quiz-image] Generating visualization — ${review.placements.length} products, style: ${getStyleKey(ctx)}`);

  const response = await client.models.generateContent({
    model: config.gemini.imageModel,
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType: roomMimeType, data: roomImageBase64 } },
          { text: prompt },
        ],
      },
    ],
    config: {
      responseModalities: ['IMAGE', 'TEXT'],
    },
  });

  // Extract image from response
  const candidates = response.candidates ?? [];
  for (const candidate of candidates) {
    const parts = candidate.content?.parts ?? [];
    for (const part of parts) {
      if (part.inlineData) {
        console.log('[quiz-image] Visualization generated successfully');
        return {
          imageBase64: part.inlineData.data,
          mimeType: part.inlineData.mimeType ?? 'image/png',
        };
      }
    }
  }

  throw new Error('No image generated in Gemini response');
}

// ── Combined: Review + Render Pipeline ───────────────────────────────────────

export async function processRoomPhoto(
  imageBase64: string,
  mimeType: string,
  ctx: QuizContext,
): Promise<{ review: RoomReview; render: RenderResult }> {
  // Step 1: Analyze the room
  const review = await reviewRoomPhoto(imageBase64, mimeType, ctx);

  // Step 2: Generate visualization
  const render = await renderVisualization(imageBase64, mimeType, review, ctx);

  return { review, render };
}

// ── Get product suggestions for a style ──────────────────────────────────────

export function getProductSuggestions(ctx: QuizContext): string[] {
  return getSuggestedProducts(ctx);
}
