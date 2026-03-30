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

// ── Product image fetching ───────────────────────────────────────────────

export interface ProductImage {
  handle: string;
  title: string;
  imageUrl: string;
  base64: string;
  mimeType: string;
}

/** Fetch product images from Shopify Admin API by handles, then download as base64 */
export async function fetchProductImages(handles: string[], brandId?: string): Promise<ProductImage[]> {
  if (handles.length === 0) return [];

  const { graphql } = await import('./shopify-admin.service.js');

  // Build aliased GraphQL query to fetch all products in one call
  const fragments = handles.slice(0, 4).map((h, i) =>
    `p${i}: productByHandle(handle: "${h.replace(/"/g, '')}") { title handle featuredImage { url } }`
  ).join('\n');

  const query = `{ ${fragments} }`;

  let data: Record<string, { title: string; handle: string; featuredImage: { url: string } | null } | null>;
  try {
    data = await graphql(query, {}, brandId);
  } catch (err) {
    console.error('[quiz-image] Failed to fetch product data from Shopify:', err instanceof Error ? err.message : err);
    return [];
  }

  // Download each product image as base64
  const results: ProductImage[] = [];
  for (const key of Object.keys(data)) {
    const product = data[key];
    if (!product?.featuredImage?.url) continue;

    try {
      const imgRes = await fetch(product.featuredImage.url);
      if (!imgRes.ok) continue;
      const buf = Buffer.from(await imgRes.arrayBuffer());
      const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
      results.push({
        handle: product.handle,
        title: product.title,
        imageUrl: product.featuredImage.url,
        base64: buf.toString('base64'),
        mimeType: contentType.split(';')[0],
      });
    } catch (err) {
      console.error(`[quiz-image] Failed to download image for "${product.handle}":`, err instanceof Error ? err.message : err);
    }
  }

  console.log(`[quiz-image] Fetched ${results.length}/${handles.slice(0, 4).length} product images from Shopify`);
  return results;
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface QuizContext {
  concept: 'style-profile'; // Focused on style-profile; A/B framework kept for future concepts
  who?: string;       // "Just me", "My partner & I", etc.
  track?: string;     // "soft" or "dramatic"
  vibe?: string;      // "Golden Nook", "Layered Warmth", "Soft Modern", etc.
  intensity?: string; // "Understated", "Balanced", "Expressive", "Statement"
  profileName?: string; // Combined: "Soft · Soft Modern · Balanced"
  selectedProducts?: string[]; // User-selected products from the selection step
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

// ── Legacy key mapping ──────────────────────────────────────────────────────
// Maps old mood/vibe keys to new warm-corridor vibe keys

const LEGACY_KEY_MAP: Record<string, string> = {
  // Old Reveal moods → closest Style Profile vibe
  'cozy-warm': 'golden-nook',
  'bright-open': 'soft-modern',
  'moody-dramatic': 'deep-amber',
  'soft-editorial': 'quiet-glow',
  // Old Style Profile vibes → new keys
  'rustic-warm': 'golden-nook',
  'bohemian-layered': 'layered-warmth',
  'modern-cozy': 'soft-modern',
  'japandi-warm': 'quiet-glow',
  'art-deco-warm': 'gilded-evening',
  'dark-luxe': 'deep-amber',
  'warm-industrial': 'foundry-glow',
  'moody-maximalist': 'midnight-warmth',
};

// ── Style profile → product fallback mapping ────────────────────────────────
// Used when DB-backed mood tags are not yet available

const STYLE_PRODUCT_MAP: Record<string, string[]> = {
  // ── Soft Track ──
  'golden-nook': ['aven', 'cade', 'fenn', 'dell', 'ruvo', 'anka', 'maren', 'rivor', 'vero', 'wren'],
  'layered-warmth': ['anka', 'saku', 'cielo', 'iven', 'yaro', 'hue', 'caia', 'melo', 'verve', 'loom'],
  'soft-modern': ['cloud', 'brio', 'knoll', 'azura', 'sterling', 'tava', 'sela', 'daxel', 'ayla', 'elan'],
  'quiet-glow': ['hollis', 'jules', 'elm', 'cade', 'maren', 'ostra', 'olin', 'fable', 'thorne', 'glade'],

  // ── Dramatic Track ──
  'gilded-evening': ['calix', 'cadence', 'zael', 'nyra', 'elys', 'ember', 'jora', 'loom', 'enzo', 'bliss'],
  'deep-amber': ['soren', 'slate', 'vireo', 'ode', 'xara', 'york', 'nivra', 'ziven', 'rove', 'phel'],
  'foundry-glow': ['blane', 'arvo', 'saro', 'garek', 'vexa', 'sylos', 'kanne', 'haro', 'reed', 'arbor'],
  'midnight-warmth': ['aria', 'delos', 'kismet', 'sia', 'niva', 'calen', 'eira', 'felio', 'aeris', 'lyra'],
};

function getStyleKey(ctx: QuizContext): string {
  const raw = (ctx.vibe || '').toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '');
  // Check legacy mapping first, then use raw key
  return LEGACY_KEY_MAP[raw] || (STYLE_PRODUCT_MAP[raw] ? raw : 'soft-modern');
}

function getSuggestedProducts(ctx: QuizContext): string[] {
  // If user manually selected products, use those
  if (ctx.selectedProducts && ctx.selectedProducts.length > 0) return ctx.selectedProducts;
  const key = getStyleKey(ctx);
  return STYLE_PRODUCT_MAP[key] || STYLE_PRODUCT_MAP['soft-modern'];
}

// ── Atmosphere profiles ─────────────────────────────────────────────────────
// All profiles stay within Outlight's warm, clean, aesthetic corridor.
// Differences are subtle: color temperature, shadow depth, light distribution.

interface AtmosphereProfile {
  colorTemp: string;
  lightQuality: string;
  shadowStyle: string;
  materialTones: string;
  emotionalTone: string;
  renderDirective: string;
}

const MOOD_ATMOSPHERES: Record<string, AtmosphereProfile> = {
  // ─── Soft Track ───

  'golden-nook': {
    colorTemp: '2200K–2700K — deep amber, honey gold, candlelight warmth',
    lightQuality: 'Soft, diffused, pooling. Light gathers in warm pockets — beside the sofa, under a pendant, around a reading nook. No harsh edges. Everything feels like golden hour indoors.',
    shadowStyle: 'Deep, soft-edged shadows with warm undertones. Shadows feel enveloping, not dark — more like a gentle dimming. Shadow color: warm umber/sienna, never cool gray.',
    materialTones: 'Brass, aged bronze, warm wood, cream linen shades, amber glass. Fixtures feel collected, organic, lived-in.',
    emotionalTone: 'Intimate, nurturing, deeply comfortable. The room feels like a hug. Think: rainy Sunday afternoon, candles lit, blanket wrapped.',
    renderDirective: 'Bathe the entire room in warm amber light. Shift the whole scene toward golden tones. Walls pick up warm reflections. Add visible warm light pools on floors and walls near each fixture. Reduce any blue/cool tones. Light should feel like it\'s melting into the surfaces. The air itself should almost glow.',
  },

  'layered-warmth': {
    colorTemp: '2400K–3000K — warm with richly varied pools of light',
    lightQuality: 'Layered, abundant, textured. Multiple light sources at different heights creating a rich tapestry of warm illumination. Some pooling, some ambient, some accent — the interplay creates depth.',
    shadowStyle: 'Complex, overlapping shadows from multiple warm sources. Creates visual richness and dimension. All shadow tones stay warm — no cool grays.',
    materialTones: 'Mixed warm materials: rattan, tinted glass, textured ceramics, mixed metals (brass + copper), linen. Fixtures feel collected, each one adding its own character.',
    emotionalTone: 'Warm abundance, creative, inviting. A space that feels richly lived-in and full of personality. Think: a well-curated home full of warmth and character.',
    renderDirective: 'Add MULTIPLE warm light sources creating overlapping pools. Each fixture casts its own distinct warm glow. Some areas brighter, some dimmer, all warm. Show light interacting with different textures and surfaces. The effect is ABUNDANCE of warm light with dimension, not uniformity.',
  },

  'soft-modern': {
    colorTemp: '2700K–3200K — warm white, clean but never cold',
    lightQuality: 'Clean, deliberate warmth. Modern fixtures providing warm but defined light. Ambient + task layering. No clutter, but still inviting. Every light has a purpose.',
    shadowStyle: 'Clean, defined shadows with warm edges. Geometric where possible. Refined but not severe. Shadows add structure without drama.',
    materialTones: 'Matte white, brushed brass, frosted glass, light walnut, concrete. Fixtures are modern with organic touches — clean lines softened by warm materials.',
    emotionalTone: 'Approachable luxury. A well-designed Scandinavian-influenced home that still feels warm and lived-in. Modern ease meets honest warmth.',
    renderDirective: 'Add clean, warm light that modernizes the space. Balance bright functionality with warm comfort. Show defined light zones — a reading light, a pendant over a surface, ambient from a floor lamp. Everything intentional but comfortable. The palette stays warm but clean. No cool tones.',
  },

  'quiet-glow': {
    colorTemp: '2700K–3000K — soft neutral warm, like natural daylight filtered through rice paper',
    lightQuality: 'Minimal, diffused, zen-like. Light feels filtered, indirect, gentle. Think: paper lanterns, diffused pendants, light that seems to float. Every source contributes to a calm, even glow.',
    shadowStyle: 'Very soft, almost imperceptible warm gradients. No hard lines. Shadow and light blend gently like watercolor. Everything feels unified.',
    materialTones: 'Light wood, paper, linen, matte ceramic, simple brass. Fixtures are minimal, sculptural — art objects with restraint.',
    emotionalTone: 'Serene, meditative, perfectly balanced. A space designed for calm. Think: a Japanese tea room meets Scandinavian cabin.',
    renderDirective: 'Create the most SUBTLE, refined warm lighting. Everything feels soft and diffused — as if light passes through rice paper. No harsh pools or bright spots. The entire room glows gently and evenly with warm undertones. Reduce contrast. Make everything feel calm, quiet, and harmonious.',
  },

  // ─── Dramatic Track ───
  // Still warm — just deeper, more contrast, more intentional shadow.

  'gilded-evening': {
    colorTemp: '2500K–3000K — warm gold, champagne, aged brass reflections',
    lightQuality: 'Geometric, glamorous, structured. Light feels like a golden-hour cocktail party — warm metallics catching light, glass refracting it, patterns cast on walls. Precise but opulent.',
    shadowStyle: 'Geometric shadow patterns from structured fixtures. Sharp warm lines mixed with golden pools. Drama through geometry, not darkness.',
    materialTones: 'Gold, polished brass, crystal, smoked glass, lacquer, warm marble. Fixtures feel LUXURIOUS — geometric, ornate, precious.',
    emotionalTone: 'Glamorous, confident, celebrating. A Manhattan penthouse, champagne on a gallery night. Warmth elevated to glamour.',
    renderDirective: 'Add GOLDEN light with geometric quality. Show fixtures creating patterned warm shadows on walls. Metals GLEAM — warm gold reflections on surfaces. The scene feels richer, more luxurious. Add warm accent light highlighting architectural features. Everything elevated and intentionally glamorous. Still warm — never cold or clinical.',
  },

  'deep-amber': {
    colorTemp: '2000K–2500K — ultra-warm amber, dimmed candlelight, intimate',
    lightQuality: 'Minimal, focused, intimate. Few light sources, each creating an island of deep warm light. Less is more — shadow itself is a design element. What IS lit glows with rich amber.',
    shadowStyle: 'Deep, warm shadows. Most of the room in elegant warm shadow. Only key features illuminated. Shadow color: warm charcoal/deep umber, never cool black.',
    materialTones: 'Dark brass, aged bronze, amber glass, warm dark wood, dark marble. Fixtures barely visible — dark objects that emit deep warm light.',
    emotionalTone: 'Intimate, powerful, quietly luxurious. A members-only lounge, a luxury hotel room at dusk. Warmth concentrated and precious.',
    renderDirective: 'Darken the overall scene while keeping everything WARM. Most of the room should be in warm shadow. Only 30-40% illuminated, and that illumination should be deep amber/gold. Create contrast but keep shadow tones warm (never cool gray/blue). A few warm focal points of light. The air feels thick with warm atmosphere.',
  },

  'foundry-glow': {
    colorTemp: '2500K–3000K — warm with raw, honest, directional quality',
    lightQuality: 'Functional, honest, warm. Light feels purposeful — pendant over work surface, visible filament, directional task light. No pretense, but genuine warmth beneath the rawness.',
    shadowStyle: 'Hard-edged warm shadows from directional fixtures. Honest character. Strong and warm — like sunlight through industrial windows, not cold fluorescent.',
    materialTones: 'Raw steel, aged iron, copper patina, exposed warm-filament bulbs, concrete, canvas. Fixtures look workshop-made — functional beauty with warm soul.',
    emotionalTone: 'Authentic, hardworking, warm at core. A converted warehouse loft on a Sunday morning, warm coffee, honest light. Raw materials humanized by warmth.',
    renderDirective: 'Add warm, directional light with honest character. Show visible light sources — exposed warm bulbs, industrial pendants casting defined warm pools. Warm light reflecting off metal and concrete. The scene feels raw but inviting — warm light humanizing hard materials. Hard shadows but always warm-toned.',
  },

  'midnight-warmth': {
    colorTemp: '2200K–2800K — rich warm, layered from many sources at varied heights',
    lightQuality: 'Abundant, layered, theatrical. Multiple fixtures all creating their own warm atmosphere. Light from every angle — pendants, sconces, floor lamps, table lamps — each contributing to a rich, immersive warm experience.',
    shadowStyle: 'Complex, overlapping warm shadows. Multiple warm light sources create intricate shadow play. Deep and theatrical but fundamentally warm throughout.',
    materialTones: 'Mixed warm metals, tinted glass, ornate warm detailing, velvet, jewel tones warmed by amber light. Fixtures are STATEMENT pieces — conversation starters.',
    emotionalTone: 'Immersive, expressive, warm maximalism. A collector\'s living room, an art-filled salon. Every corner alive with warm light and character.',
    renderDirective: 'Add MULTIPLE warm fixtures creating a rich, layered lighting scene. Every corner should have something warm and interesting happening. Show warm pools overlapping, fixtures reflecting in surfaces, warm shadows mixing. The scene should feel FULL of warm light and character — richly saturated from many sources. More is more, but always warm.',
  },
};

// ── All mood keys (for batch tagging, admin UI, etc.) ────────────────────────

export const ALL_MOOD_KEYS = Object.keys(MOOD_ATMOSPHERES);

export const MOOD_KEY_LABELS: Record<string, { label: string; track: 'soft' | 'dramatic' }> = {
  'golden-nook': { label: 'Golden Nook', track: 'soft' },
  'layered-warmth': { label: 'Layered Warmth', track: 'soft' },
  'soft-modern': { label: 'Soft Modern', track: 'soft' },
  'quiet-glow': { label: 'Quiet Glow', track: 'soft' },
  'gilded-evening': { label: 'Gilded Evening', track: 'dramatic' },
  'deep-amber': { label: 'Deep Amber', track: 'dramatic' },
  'foundry-glow': { label: 'Foundry Glow', track: 'dramatic' },
  'midnight-warmth': { label: 'Midnight Warmth', track: 'dramatic' },
};

// ── Build context-aware review prompt ────────────────────────────────────────

function buildReviewPrompt(ctx: QuizContext): string {
  const products = getSuggestedProducts(ctx);
  const productList = products.slice(0, 6).join(', ');
  const key = getStyleKey(ctx);
  const atmo = MOOD_ATMOSPHERES[key];

  const trackLabel = ctx.track === 'dramatic' ? 'Dramatic & Warm' : 'Soft & Cozy';
  let styleDesc = `Track: ${trackLabel}, Vibe: "${ctx.vibe || 'Soft Modern'}", Intensity: ${ctx.intensity || 'Balanced'}\n`;
  if (ctx.who) styleDesc += `Designing for: ${ctx.who}\n`;

  if (atmo) {
    styleDesc += `Color temperature: ${atmo.colorTemp}\n`;
    styleDesc += `Light quality: ${atmo.lightQuality}\n`;
    styleDesc += `Material direction: ${atmo.materialTones}\n`;
    styleDesc += `Emotional tone: ${atmo.emotionalTone}`;
  }

  return `You are an expert interior lighting designer for Outlight, a premium modern lighting brand with a warm, clean, aesthetic sensibility.

STYLE DIRECTION:
${styleDesc}

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
  "ambiance": "2-3 sentences describing how these products transform the space — the light quality, mood, atmosphere. Be SPECIFIC about the emotional shift.",
  "tips": ["2-3 specific styling tips for this aesthetic"]
}

IMPORTANT:
- Suggest 2-4 placements (don't over-light the space)
- x/y are percentages (0-100) marking where in the image each product goes
- Use ONLY product names from the catalog above in suggestedProduct
- Match product choices to the style direction — every choice should feel intentional
- Be specific about WHY each product works in that location
- The ambiance field should describe the TRANSFORMED mood in vivid, sensory terms

Return ONLY valid JSON, no markdown fences or extra text.`;
}

// ── Build deeply mood-specific render prompt ────────────────────────────────

function buildRenderPrompt(review: RoomReview, ctx: QuizContext): string {
  const key = getStyleKey(ctx);
  const atmo = MOOD_ATMOSPHERES[key];
  const placementDesc = review.placements
    .map((p) => `- ${p.suggestedProduct} (${p.productType.replace(/_/g, ' ')}) at ${p.location} — ${p.reasoning}`)
    .join('\n');

  const styleLabel = `"${ctx.profileName || ctx.vibe || 'Soft Modern'}" style (${ctx.intensity || 'Balanced'} intensity)`;

  let atmosphereBlock = '';
  if (atmo) {
    atmosphereBlock = `
ATMOSPHERE — THIS IS CRITICAL:
Color Temperature: ${atmo.colorTemp}
Light Quality: ${atmo.lightQuality}
Shadow Treatment: ${atmo.shadowStyle}
Materials & Finishes: ${atmo.materialTones}
Emotional Goal: ${atmo.emotionalTone}

SPECIFIC RENDERING DIRECTION:
${atmo.renderDirective}`;
  }

  return `Transform this room photograph by adding modern lighting fixtures and COMPLETELY changing the lighting atmosphere.

STYLE: ${styleLabel}
ROOM: ${review.roomType}, ${review.dimensions}
CURRENT STATE: ${review.description}
TARGET AMBIANCE: ${review.ambiance}
${atmosphereBlock}

PRODUCT PLACEMENTS (add these fixtures):
${placementDesc}

CRITICAL INSTRUCTIONS:
1. Keep the room structure, furniture, and architecture EXACTLY as-is — same layout, same perspective, same items
2. ADD the lighting products at the specified locations — they should look physically present and photorealistic (proper scale, real materials, correct proportions)
3. TRANSFORM THE ENTIRE LIGHTING of the scene according to the atmosphere direction above:
   - Shift the color temperature of ALL light in the image to match the target
   - Adjust overall brightness/darkness to match the emotional goal
   - Create the specified shadow treatment throughout the room
   - Show realistic light emission: pools of light on floors/walls, glow around fixtures, reflected light on surfaces
4. The MOOD SHIFT should be DRAMATIC and OBVIOUS — someone comparing the before and after should immediately feel the emotional difference
5. Every material surface should respond to the new lighting — wood should catch warm light, metal should gleam, fabric should show new shadow folds
6. The result should look like a professional interior design photograph taken AFTER a complete lighting redesign

The transformation should be so clear that even without labels, a viewer could identify the specific mood just from the lighting quality.

IMPORTANT: Product reference images are provided alongside this prompt. Use EXACTLY these product designs — their shapes, materials, finishes, and proportions — when placing fixtures in the scene. Do NOT invent generic fixtures.`;
}

// ── Build generation-from-scratch prompt (for sample rooms) ─────────────────

function buildGeneratePrompt(ctx: QuizContext): string {
  const products = getSuggestedProducts(ctx).slice(0, 3);
  const key = getStyleKey(ctx);
  const atmo = MOOD_ATMOSPHERES[key];

  const styleLabel = `"${ctx.profileName || ctx.vibe || 'Soft Modern'}" style (${ctx.intensity || 'Balanced'} intensity)`;

  let atmosphereBlock = '';
  if (atmo) {
    atmosphereBlock = `
ATMOSPHERE:
Color Temperature: ${atmo.colorTemp}
Light Quality: ${atmo.lightQuality}
Shadow Treatment: ${atmo.shadowStyle}
Materials & Finishes: ${atmo.materialTones}
Emotional Goal: ${atmo.emotionalTone}

SPECIFIC DIRECTION:
${atmo.renderDirective}`;
  }

  return `Generate a photorealistic interior photograph of a beautifully designed living room, styled with ${styleLabel} lighting.

The room should feature modern Outlight lighting fixtures: ${products.join(', ')} — show them as elegant, premium lighting products naturally integrated into the space.
${atmosphereBlock}

REQUIREMENTS:
1. Photorealistic — should look like a professional interior design photograph
2. The lighting atmosphere MUST clearly convey the ${styleLabel} direction
3. Show 2-3 lighting fixtures that feel naturally placed
4. Show realistic light emission from each fixture — pools of light, ambient glow, surface reflections
5. The room should feel aspirational but believable — a real home, beautifully lit
6. High quality, detailed, magazine-worthy composition

This image should make someone think: "I want my room to feel like this."

IMPORTANT: Product reference images are provided alongside this prompt. Use EXACTLY these product designs — their shapes, materials, finishes, and proportions — when placing fixtures in the room. Do NOT invent generic fixtures. The lighting products in the generated image must visually match the reference photos.`;
}

// ── Review (Analyze Room Photo) ──────────────────────────────────────────────

export async function reviewRoomPhoto(
  imageBase64: string,
  mimeType: string,
  ctx: QuizContext,
): Promise<RoomReview> {
  const client = await getClient();
  const prompt = buildReviewPrompt(ctx);

  console.log(`[quiz-image] Reviewing room photo — style: ${getStyleKey(ctx)}`);

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
  productImages?: ProductImage[],
): Promise<RenderResult> {
  const client = await getClient();
  const prompt = buildRenderPrompt(review, ctx);

  console.log(`[quiz-image] Generating visualization — ${review.placements.length} products, style: ${getStyleKey(ctx)}, ${productImages?.length || 0} product ref images`);

  // Build parts: room photo first, then product reference images, then prompt text
  const parts: Array<{ inlineData: { mimeType: string; data: string } } | { text: string }> = [
    { inlineData: { mimeType: roomMimeType, data: roomImageBase64 } },
  ];

  if (productImages && productImages.length > 0) {
    for (const pi of productImages) {
      parts.push({ inlineData: { mimeType: pi.mimeType, data: pi.base64 } });
      parts.push({ text: `[Product reference: "${pi.title}" (handle: ${pi.handle}) — use this exact fixture design]` });
    }
  }

  parts.push({ text: prompt });

  const response = await client.models.generateContent({
    model: config.gemini.imageModel,
    contents: [{ role: 'user', parts }],
    config: { responseModalities: ['IMAGE', 'TEXT'] },
  });

  const candidates = response.candidates ?? [];
  for (const candidate of candidates) {
    const cParts = candidate.content?.parts ?? [];
    for (const part of cParts) {
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

// ── Generate from scratch (no room photo — sample rooms) ─────────────────────

export async function generateFromScratch(ctx: QuizContext, productImages?: ProductImage[]): Promise<RenderResult> {
  const client = await getClient();
  const prompt = buildGeneratePrompt(ctx);

  console.log(`[quiz-image] Generating sample room from scratch — style: ${getStyleKey(ctx)}, ${productImages?.length || 0} product ref images`);

  const parts: Array<{ inlineData: { mimeType: string; data: string } } | { text: string }> = [];

  if (productImages && productImages.length > 0) {
    for (const pi of productImages) {
      parts.push({ inlineData: { mimeType: pi.mimeType, data: pi.base64 } });
      parts.push({ text: `[Product reference: "${pi.title}" (handle: ${pi.handle}) — use this exact fixture design in the generated room]` });
    }
  }

  parts.push({ text: prompt });

  const response = await client.models.generateContent({
    model: config.gemini.imageModel,
    contents: [{ role: 'user', parts }],
    config: { responseModalities: ['IMAGE', 'TEXT'] },
  });

  const candidates = response.candidates ?? [];
  for (const candidate of candidates) {
    const cParts = candidate.content?.parts ?? [];
    for (const part of cParts) {
      if (part.inlineData) {
        console.log('[quiz-image] Sample room generated successfully');
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
  const productHandles = getSuggestedProducts(ctx).slice(0, 3);
  let productImages: ProductImage[] = [];
  try {
    console.log(`[quiz-image] Fetching product reference images for: ${productHandles.join(', ')}`);
    productImages = await fetchProductImages(productHandles);
  } catch (err) {
    console.error('[quiz-image] Failed to fetch product images (continuing without):', err instanceof Error ? err.message : err);
  }

  if (!imageBase64) {
    console.log('[quiz-image] No photo provided — generating sample room from scratch');
    const render = await generateFromScratch(ctx, productImages);
    const key = getStyleKey(ctx);
    const atmo = MOOD_ATMOSPHERES[key];
    return {
      review: {
        roomType: 'living',
        dimensions: 'Sample room',
        description: 'AI-generated sample room',
        currentLighting: 'None — generated from scratch',
        furniture: [],
        colorPalette: [],
        placements: [],
        ambiance: atmo?.emotionalTone || 'A beautifully lit space tailored to your style.',
        tips: [],
      },
      render,
    };
  }

  const review = await reviewRoomPhoto(imageBase64, mimeType, ctx);
  const render = await renderVisualization(imageBase64, mimeType, review, ctx, productImages);
  return { review, render };
}

// ── Get product suggestions for a style ──────────────────────────────────────

export function getProductSuggestions(ctx: QuizContext): string[] {
  return getSuggestedProducts(ctx);
}

// ── Debug helpers (for playground) ────────────────────────────────────────

export function getAtmosphereProfile(ctx: QuizContext): AtmosphereProfile | null {
  const key = getStyleKey(ctx);
  return MOOD_ATMOSPHERES[key] || null;
}

export function getDebugPrompts(ctx: QuizContext): { reviewPrompt: string; generatePrompt: string; renderPromptBuilder: (review: RoomReview) => string; styleKey: string } {
  return {
    reviewPrompt: buildReviewPrompt(ctx),
    generatePrompt: buildGeneratePrompt(ctx),
    renderPromptBuilder: (review: RoomReview) => buildRenderPrompt(review, ctx),
    styleKey: getStyleKey(ctx),
  };
}

/** Build a structured trace of the AI agent's reasoning process */
export function buildAgentTrace(ctx: QuizContext, hasPhoto: boolean): string[] {
  const trace: string[] = [];
  const key = getStyleKey(ctx);
  const atmo = MOOD_ATMOSPHERES[key];
  const products = getSuggestedProducts(ctx);

  trace.push(`[CONTEXT] Style Profile quiz.`);
  trace.push(`[CONTEXT] Track: ${ctx.track === 'dramatic' ? 'Dramatic & Warm' : 'Soft & Cozy'}, Vibe: "${ctx.vibe}", Intensity: ${ctx.intensity}.`);
  if (ctx.who) trace.push(`[CONTEXT] Designing for: ${ctx.who}.`);
  if (ctx.profileName) trace.push(`[CONTEXT] Combined profile name: "${ctx.profileName}".`);
  if (ctx.selectedProducts?.length) trace.push(`[CONTEXT] User selected ${ctx.selectedProducts.length} specific products.`);

  trace.push(`[RESOLVE] Input "${ctx.vibe || ''}" → style key "${key}".`);
  if (atmo) {
    trace.push(`[ATMOSPHERE] Matched atmosphere profile. Color temp: ${atmo.colorTemp.split('—')[0].trim()}, emotional tone: "${atmo.emotionalTone.split('.')[0]}".`);
  } else {
    trace.push(`[ATMOSPHERE] WARNING: No atmosphere profile found for key "${key}" — using defaults.`);
  }

  const poolHit = STYLE_PRODUCT_MAP[key] ? 'direct match' : 'fallback to soft-modern';
  const productSource = ctx.selectedProducts?.length ? 'user-selected' : poolHit;
  trace.push(`[PRODUCTS] Source: ${productSource}. ${products.length} products available.`);
  trace.push(`[PRODUCTS] Top picks for prompts: ${products.slice(0, 6).join(', ')}.`);

  if (hasPhoto) {
    trace.push(`[PIPELINE] Photo provided → two-step pipeline: Review (analyze room) → Render (transform image).`);
    trace.push(`[PIPELINE] Step 1: Send photo + review prompt to review model. AI will analyze room layout, furniture, lighting, and suggest product placements.`);
    trace.push(`[PIPELINE] Step 2: Send photo + render prompt (including review results) to image model. AI will generate transformed room with fixtures + mood lighting.`);
  } else {
    trace.push(`[PIPELINE] No photo provided → single-step: Generate sample room from scratch.`);
    trace.push(`[PIPELINE] AI will create a photorealistic room image with fixtures placed and mood lighting applied, purely from text description.`);
  }

  if (atmo) {
    trace.push(`[PROMPT] Injecting full atmosphere block into prompt: colorTemp, lightQuality, shadowStyle, materialTones, emotionalTone, renderDirective.`);
    trace.push(`[PROMPT] Render directive emphasis: "${atmo.renderDirective.slice(0, 100)}..."`);
  }

  trace.push(`[MODELS] Review model: ${config.gemini.reviewModel} (text analysis).`);
  trace.push(`[MODELS] Image model: ${config.gemini.imageModel} (image generation with responseModalities: IMAGE+TEXT).`);

  return trace;
}
