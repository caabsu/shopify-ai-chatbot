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
  productType: string; // e.g. "floor lamp", "pendant light", "wall sconce"
}

const PRODUCT_TYPE_LABELS: Record<string, string> = {
  floor_lamp: 'floor lamp',
  table_lamp: 'table lamp',
  desk_lamp: 'desk lamp',
  wall_sconce: 'wall sconce',
  chandelier: 'chandelier',
  pendant: 'pendant light',
  ceiling_light: 'ceiling light',
};

/** Fetch product images from Shopify Admin API by handles, then download as base64.
 *  Also looks up AI-classified product type from mood tags. */
export async function fetchProductImages(handles: string[], brandId?: string): Promise<ProductImage[]> {
  if (handles.length === 0) return [];

  const { graphql } = await import('./shopify-admin.service.js');
  const { supabase } = await import('../config/supabase.js');

  // Fetch product type from mood tags (AI-classified, more reliable than Shopify productType)
  const { data: moodTags } = await supabase
    .from('product_mood_tags')
    .select('product_handle, product_type')
    .in('product_handle', handles.slice(0, 4));
  const typeByHandle = new Map((moodTags || []).map(t => [t.product_handle, t.product_type]));

  // Build aliased GraphQL query to fetch all products in one call
  const fragments = handles.slice(0, 4).map((h, i) =>
    `p${i}: productByHandle(handle: "${h.replace(/"/g, '')}") { title handle productType featuredImage { url } }`
  ).join('\n');

  const query = `{ ${fragments} }`;

  let data: Record<string, { title: string; handle: string; productType: string; featuredImage: { url: string } | null } | null>;
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

      // Use AI-classified type from mood tags, fall back to Shopify productType
      const rawType = typeByHandle.get(product.handle) || product.productType || '';
      const typeLabel = PRODUCT_TYPE_LABELS[rawType] || rawType.replace(/_/g, ' ') || 'lighting fixture';

      results.push({
        handle: product.handle,
        title: product.title,
        imageUrl: product.featuredImage.url,
        base64: buf.toString('base64'),
        mimeType: contentType.split(';')[0],
        productType: typeLabel,
      });
    } catch (err) {
      console.error(`[quiz-image] Failed to download image for "${product.handle}":`, err instanceof Error ? err.message : err);
    }
  }

  console.log(`[quiz-image] Fetched ${results.length}/${handles.slice(0, 4).length} product images from Shopify`);
  return results;
}

/**
 * Select 1-3 products for AI placement following strict rules:
 * - ALWAYS include a floor lamp (from floor-table-lamps collection)
 * - If 2: floor lamp + desk/table lamp
 * - If 3: floor lamp + desk/table lamp + pendant or chandelier
 * - NEVER two products from the same collection
 *
 * For AI-mode: picks 3 products. User-curated mode uses user's selection.
 */
function selectProductsForRender(allHandles: string[], typeByHandle: Map<string, string>): string[] {
  // Categorize available handles by type
  const floorLamps: string[] = [];
  const deskTableLamps: string[] = [];
  const overheadLights: string[] = []; // pendants, chandeliers, ceiling

  for (const handle of allHandles) {
    const ptype = typeByHandle.get(handle) || '';
    if (ptype === 'floor_lamp') floorLamps.push(handle);
    else if (ptype === 'desk_lamp' || ptype === 'table_lamp') deskTableLamps.push(handle);
    else if (ptype === 'pendant' || ptype === 'chandelier' || ptype === 'ceiling_light') overheadLights.push(handle);
  }

  const selected: string[] = [];

  // 1. Always pick a floor lamp
  if (floorLamps.length > 0) {
    selected.push(floorLamps[Math.floor(Math.random() * floorLamps.length)]);
  } else if (allHandles.length > 0) {
    // Fallback: just pick the first handle
    selected.push(allHandles[0]);
  }

  // 2. Add desk/table lamp if available
  if (deskTableLamps.length > 0) {
    selected.push(deskTableLamps[Math.floor(Math.random() * deskTableLamps.length)]);
  }

  // 3. Add pendant or chandelier if available
  if (overheadLights.length > 0) {
    selected.push(overheadLights[Math.floor(Math.random() * overheadLights.length)]);
  }

  // If we still only have 1 and there are more products, try to add any non-duplicate
  if (selected.length === 1 && allHandles.length > 1) {
    const remaining = allHandles.filter(h => !selected.includes(h));
    if (remaining.length > 0) selected.push(remaining[0]);
  }

  return selected.slice(0, 3);
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

function buildReviewPrompt(ctx: QuizContext, productImages?: ProductImage[]): string {
  const products = getSuggestedProducts(ctx);
  const key = getStyleKey(ctx);
  const atmo = MOOD_ATMOSPHERES[key];

  // Build product list with explicit types from DB so the review AI can't misclassify
  let productList: string;
  if (productImages && productImages.length > 0) {
    // Use the raw DB type key (e.g., "floor_lamp") so it maps directly to the JSON productType enum
    productList = productImages.map(p => {
      // Find the raw key that maps to this label, for the JSON enum
      const rawKey = Object.entries(PRODUCT_TYPE_LABELS).find(([, v]) => v === p.productType)?.[0] || p.productType.replace(/ /g, '_');
      return `- ${p.handle} → type: "${rawKey}" (${p.productType})`;
    }).join('\n');
  } else {
    productList = products.slice(0, 6).map(h => `- ${h}`).join('\n');
  }

  const vibeLabel = ctx.vibe || 'Soft Modern';
  const moodLine = atmo ? `${atmo.colorTemp.split('—')[0].trim()} warmth. ${atmo.emotionalTone.split('.')[0]}.` : '';

  const numProducts = productImages?.length || products.slice(0, 3).length;

  return `You are a professional interior lighting designer working for Outlight, a premium warm modern lighting brand. Your job is to analyze this room photo like a real designer would — studying the architecture, ceiling height, furniture layout, natural light sources, and spatial flow — then recommend exactly where to place each Outlight fixture for maximum aesthetic and functional impact.

Mood: "${vibeLabel}" — ${moodLine}

Here are the ${numProducts} Outlight fixtures to place. Each product's type is listed — you MUST use that exact type in your placement. Do not reclassify.

${productList}

DESIGN PRINCIPLES — think like a professional:
- Floor lamps belong BESIDE seating (next to a sofa arm, beside an armchair, flanking a reading nook). They should be placed where someone would actually read or relax. Never in the middle of a room or blocking a walkway.
- Table/desk lamps go ON a visible surface — a side table, console table, nightstand, or desk. Pick the most natural surface visible in the photo.
- Pendants and chandeliers hang FROM THE CEILING — over a dining table, kitchen island, or as a room centerpiece. Consider the ceiling height.
- Wall sconces mount on walls — flanking a mirror, beside a bed headboard, along a hallway, or beside artwork.
- Study the room's spatial balance. Don't cluster all lights in one corner — distribute them to create layered lighting.
- x/y coordinates are percentages of the image (0-100). Be PRECISE — place the fixture exactly where it should appear visually in the photograph.

Return ONLY valid JSON:
{
  "roomType": "living"|"bedroom"|"office"|"dining"|"kitchen"|"hallway",
  "dimensions": "e.g. 12x15ft, 9ft ceiling",
  "description": "Brief room description",
  "currentLighting": "Existing light sources in the photo",
  "furniture": ["key furniture pieces visible"],
  "colorPalette": ["dominant hex colors"],
  "placements": [
    {
      "productType": "floor_lamp"|"table_lamp"|"wall_sconce"|"pendant"|"chandelier"|"ceiling_light"|"desk_lamp",
      "suggestedProduct": "handle_name",
      "location": "Very specific: e.g. 'to the right of the gray sofa arm, on the hardwood floor'",
      "x": 25,
      "y": 65,
      "reasoning": "Why this location works (lighting balance, functionality, aesthetics)"
    }
  ],
  "ambiance": "How these fixtures transform the room's mood",
  "tips": ["1-2 pro lighting tips"]
}

Rules:
- Place ALL ${numProducts} fixtures. Do not skip any.
- Use ONLY products from the catalog. Each productType MUST match the catalog listing.
- x/y must be PRECISE image coordinates where the fixture base/mount point would appear in the photo.`;
}

// ── Build concise render prompt with clear ref image mapping ────────────────

function buildRenderPrompt(review: RoomReview, ctx: QuizContext, productImages?: ProductImage[]): string {
  const key = getStyleKey(ctx);
  const atmo = MOOD_ATMOSPHERES[key];
  const vibeLabel = ctx.vibe || 'Soft Modern';

  // Build placement instructions using ACTUAL product type from DB, not review AI's guess
  const placementLines = review.placements.map((p, i) => {
    // Look up the real product type from our reference images (DB-sourced), not the review AI's classification
    const refMatch = productImages?.find(pi => pi.handle === p.suggestedProduct);
    const refIdx = refMatch ? productImages!.indexOf(refMatch) + 1 : null;
    const actualType = refMatch?.productType || PRODUCT_TYPE_LABELS[p.productType] || p.productType.replace(/_/g, ' ');

    if (refIdx) {
      return `- Place Ref #${refIdx} ("${refMatch!.title}"), which is a ${actualType}, ${p.location}. Look at Ref Image #${refIdx} carefully — reproduce that exact fixture.`;
    }
    return `- Place "${p.suggestedProduct}" (${actualType}) ${p.location}.`;
  }).join('\n');

  // Build atmosphere paragraph
  let atmosParagraph = '';
  if (atmo) {
    atmosParagraph = `Set the overall lighting mood to "${vibeLabel}" — color temperature around ${atmo.colorTemp.split('—')[0].trim()}. ${atmo.renderDirective}`;
  }

  const numFixtures = review.placements.length;

  return `You are editing a photo of a ${review.roomType}. Your job is to transform this room's lighting using Outlight fixtures to achieve a "${vibeLabel}" mood.

STEP 1 — REMOVE ALL EXISTING LIGHT SOURCES:
Before adding anything new, remove every existing light source from the room — all lamps (floor, table, desk), all overhead/ceiling lights, all pendants, chandeliers, wall sconces, and any visible light fixtures. The room should have no lighting except what you add below.

STEP 2 — ADD THESE ${numFixtures} OUTLIGHT FIXTURES:

${placementLines}

You MUST place ALL ${numFixtures} fixtures listed above. Every single one must be clearly visible in the final image. Do not omit any.

STEP 3 — SET THE MOOD:
${atmosParagraph}
Each fixture must emit realistic warm light — visible pools on nearby walls, floors, and surfaces, with soft ambient glow and natural shadows.

PRODUCT FIDELITY (CRITICAL):
Study each reference image carefully. Every fixture you place MUST have the EXACT same silhouette, shade shape, arm geometry, base form, material finish, and color as its reference image. Do not simplify or approximate — if a reference shows a conical linen shade, use that exact shade, not a generic dome. Do not invent any fixture design.

Keep all furniture, walls, objects, and the room's perspective exactly as they are. The only changes should be: existing lights removed, new Outlight fixtures added, and the overall lighting mood transformed.`;
}

// ── Build generation-from-scratch prompt (for sample rooms) ─────────────────

function buildGeneratePrompt(ctx: QuizContext, productImages?: ProductImage[]): string {
  const key = getStyleKey(ctx);
  const atmo = MOOD_ATMOSPHERES[key];
  const vibeLabel = ctx.vibe || 'Soft Modern';

  // Build product placement instructions with types
  let productSection: string;
  if (productImages && productImages.length > 0) {
    productSection = productImages.map((p, i) =>
      `- Ref #${i + 1}: "${p.title}" — this is a ${p.productType}. Look at Ref Image #${i + 1} and reproduce this exact fixture design. Place it naturally in the room (${p.productType === 'floor lamp' ? 'beside seating on the floor' : p.productType === 'pendant light' ? 'hanging from the ceiling over a table or seating area' : p.productType === 'table lamp' ? 'on a side table or console' : p.productType === 'wall sconce' ? 'mounted on the wall at eye level' : p.productType === 'chandelier' ? 'hanging from the ceiling as a centerpiece' : 'in an appropriate location'}).`
    ).join('\n');
  } else {
    const products = getSuggestedProducts(ctx).slice(0, 3);
    productSection = products.map(p => `- "${p}" — place naturally in the room`).join('\n');
  }

  // Atmosphere paragraph
  let atmosParagraph = '';
  if (atmo) {
    atmosParagraph = `The lighting mood is "${vibeLabel}" — color temperature around ${atmo.colorTemp.split('—')[0].trim()}. ${atmo.renderDirective}`;
  }

  const numFixtures = productImages?.length || 3;

  return `Generate a photorealistic, square (1:1 aspect ratio) interior photograph of a beautiful living room featuring Outlight lighting fixtures. This should look like a professional interior design photo — aspirational but believable. The room should have NO lighting except the Outlight fixtures below.

Include ALL ${numFixtures} of these fixtures from the Outlight brand:

${productSection}

Every single fixture listed above MUST be clearly visible in the generated image. Do not omit any.

${atmosParagraph}

Each fixture must emit realistic warm light with visible pools on nearby walls and surfaces, soft ambient glow, and natural shadows.

PRODUCT FIDELITY (CRITICAL):
Study each reference image carefully. Every fixture MUST have the EXACT same silhouette, shade shape, arm geometry, base form, material finish, and color as its reference. Do not simplify or approximate. Do not invent any fixture design.`;
}

// ── Review (Analyze Room Photo) ──────────────────────────────────────────────

export async function reviewRoomPhoto(
  imageBase64: string,
  mimeType: string,
  ctx: QuizContext,
  productImages?: ProductImage[],
): Promise<RoomReview> {
  const client = await getClient();
  const prompt = buildReviewPrompt(ctx, productImages);

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
  const prompt = buildRenderPrompt(review, ctx, productImages);

  console.log(`[quiz-image] Generating visualization — ${review.placements.length} products, style: ${getStyleKey(ctx)}, ${productImages?.length || 0} product ref images`);

  // Build parts: room photo first, then numbered product reference images, then prompt
  const parts: Array<{ inlineData: { mimeType: string; data: string } } | { text: string }> = [
    { inlineData: { mimeType: roomMimeType, data: roomImageBase64 } },
  ];

  if (productImages && productImages.length > 0) {
    for (let i = 0; i < productImages.length; i++) {
      const pi = productImages[i];
      parts.push({ inlineData: { mimeType: pi.mimeType, data: pi.base64 } });
      parts.push({ text: `[REF IMAGE #${i + 1}: "${pi.title}" — this is a ${pi.productType}. STUDY THIS IMAGE CAREFULLY. You MUST reproduce this EXACT fixture design — identical silhouette, shade shape, arm geometry, base form, materials, and color. Do NOT substitute a generic fixture.]` });
    }
  }

  parts.push({ text: prompt });

  const response = await client.models.generateContent({
    model: config.gemini.imageModel,
    contents: [{ role: 'user', parts }],
    config: { responseModalities: ['IMAGE', 'TEXT'], imageConfig: { aspectRatio: '1:1' } },
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
  const prompt = buildGeneratePrompt(ctx, productImages);

  console.log(`[quiz-image] Generating sample room from scratch — style: ${getStyleKey(ctx)}, ${productImages?.length || 0} product ref images`);

  const parts: Array<{ inlineData: { mimeType: string; data: string } } | { text: string }> = [];

  if (productImages && productImages.length > 0) {
    for (let i = 0; i < productImages.length; i++) {
      const pi = productImages[i];
      parts.push({ inlineData: { mimeType: pi.mimeType, data: pi.base64 } });
      parts.push({ text: `[REF IMAGE #${i + 1}: "${pi.title}" — this is a ${pi.productType}. STUDY THIS IMAGE CAREFULLY. You MUST reproduce this EXACT fixture design — identical silhouette, shade shape, arm geometry, base form, materials, and color. Do NOT substitute a generic fixture.]` });
    }
  }

  parts.push({ text: prompt });

  const response = await client.models.generateContent({
    model: config.gemini.imageModel,
    contents: [{ role: 'user', parts }],
    config: { responseModalities: ['IMAGE', 'TEXT'], imageConfig: { aspectRatio: '1:1' } },
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
  const { supabase } = await import('../config/supabase.js');

  // Get the full pool of suggested product handles
  const allSuggested = getSuggestedProducts(ctx);

  // For user-curated mode, use their exact selection (up to 4)
  // For AI mode, apply the floor-lamp-first selection logic
  let productHandles: string[];
  if (ctx.selectedProducts && ctx.selectedProducts.length > 0) {
    productHandles = ctx.selectedProducts.slice(0, 4);
  } else {
    // Fetch types for the pool to make intelligent selection
    const poolHandles = allSuggested.slice(0, 10);
    const { data: poolTags } = await supabase
      .from('product_mood_tags')
      .select('product_handle, product_type')
      .in('product_handle', poolHandles);
    const poolTypes = new Map((poolTags || []).map(t => [t.product_handle, t.product_type]));
    productHandles = selectProductsForRender(poolHandles, poolTypes);
    console.log(`[quiz-image] AI product selection: ${productHandles.join(', ')} (from pool of ${poolHandles.length})`);
  }

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

  const review = await reviewRoomPhoto(imageBase64, mimeType, ctx, productImages);
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
    renderPromptBuilder: (review: RoomReview) => buildRenderPrompt(review, ctx, undefined),
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
