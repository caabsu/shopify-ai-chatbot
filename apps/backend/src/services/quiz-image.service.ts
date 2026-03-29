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
  return 'modern-cozy';
}

function getSuggestedProducts(ctx: QuizContext): string[] {
  const key = getStyleKey(ctx);
  return STYLE_PRODUCT_MAP[key] || STYLE_PRODUCT_MAP['modern-cozy'];
}

// ── Deep mood/style atmosphere definitions ──────────────────────────────────
// These are the core differentiation layer — they make each mood VISIBLY different

interface AtmosphereProfile {
  colorTemp: string;
  lightQuality: string;
  shadowStyle: string;
  materialTones: string;
  emotionalTone: string;
  renderDirective: string;
}

const MOOD_ATMOSPHERES: Record<string, AtmosphereProfile> = {
  // ─── Concept 1: The Reveal moods ───
  'cozy-warm': {
    colorTemp: '2200K–2700K — deep amber, honey gold, candlelight warmth',
    lightQuality: 'Soft, diffused, pooling. Light should gather in warm pockets — beside the sofa, under a pendant, around a reading nook. No harsh edges. Everything should feel like golden hour indoors.',
    shadowStyle: 'Deep, soft-edged shadows with warm undertones. Shadows should feel enveloping, not dark — more like a gentle dimming. Shadow color: warm umber/sienna, never cool gray.',
    materialTones: 'Favor brass, aged bronze, warm wood, cream linen shades, amber glass. Fixtures feel collected, organic, lived-in.',
    emotionalTone: 'Intimate, nurturing, deeply comfortable. The room should feel like a hug. Think: rainy Sunday afternoon, candles lit, blanket wrapped.',
    renderDirective: 'Make the entire room feel bathed in warm amber light. The color temperature should shift the whole scene toward golden tones. Walls should pick up warm reflections. Furniture should look more inviting. The air itself should almost glow. Reduce any blue/cool tones in the existing scene. Add visible warm light pools on floors and walls near each fixture. Light should feel like it\'s melting into the surfaces.',
  },
  'bright-open': {
    colorTemp: '3500K–4500K — bright white with warm undertones, daylight-balanced, clean',
    lightQuality: 'Crisp, even, expansive. Light should fill the room uniformly, eliminating dark corners. Think architectural lighting — clean, purposeful, making the space feel larger and airier. Some fixtures provide directed task light.',
    shadowStyle: 'Minimal, sharp-edged shadows. Where shadows exist, they should be crisp and geometric. Shadow color: neutral/light gray. The overall impression is brightness and openness.',
    materialTones: 'Favor brushed nickel, matte white, clear glass, polished chrome, light oak. Fixtures should feel sleek, minimal, almost invisible — letting the room breathe.',
    emotionalTone: 'Energizing, clear-headed, optimistic. The room should feel like a bright spring morning. Think: fresh air, productivity, clean surfaces catching light.',
    renderDirective: 'Brighten the entire scene significantly. The room should feel flooded with clean, natural-feeling light. Reduce all dark corners — light reaches everywhere. The color palette should shift slightly cooler and brighter. White surfaces should glow. The space should feel 30% larger due to the light. Add visible brightness on walls, ceiling bounce light, and make windows appear to let in more light. The overall feel is AIRY and SPACIOUS.',
  },
  'moody-dramatic': {
    colorTemp: '1800K–2500K — deep amber to warm tungsten, mixed with focused spots',
    lightQuality: 'Theatrical, directional, high-contrast. Light should sculpt the room — dramatic downlights creating focused pools, uplights casting wall washes, statement pendants drawing the eye. Some areas purposefully left in rich shadow.',
    shadowStyle: 'Bold, deep, intentional shadows. Strong contrast between lit and unlit areas. Shadow color: rich charcoal/deep umber with warmth. Shadows are a design element — they create depth, mystery, and drama.',
    materialTones: 'Favor dark brass, matte black, smoked glass, dark marble, blackened steel. Fixtures should be sculptural, commanding — objects of desire.',
    emotionalTone: 'Powerful, seductive, atmospheric. The room should feel like a boutique hotel bar or a private gallery. Think: late evening, cocktails, low music, deliberate luxury.',
    renderDirective: 'DARKEN the overall scene significantly — this is moody lighting. Create strong contrast pools: bright focused light surrounded by deep shadow. Specific areas get dramatically lit while others fall into rich darkness. Add warm downlight cones from pendants, focused spots highlighting art or features. The room should feel like NIGHT — even if the original photo was daytime, shift the entire mood to evening. Make metals gleam. Make glass catch light. Every shadow should feel intentional.',
  },
  'soft-editorial': {
    colorTemp: '2800K–3200K — neutral warm, gallery-quality, precise',
    lightQuality: 'Refined, precise, considered. Every light source has a purpose. Soft diffused ambient from ceiling, targeted accent light for features. Nothing is overlighting — there\'s restraint. The quality of light itself should feel expensive.',
    shadowStyle: 'Subtle, graduated shadows with neutral tones. Shadows create gentle depth without drama. Shadow transitions are smooth and sophisticated. Think: museum lighting — controlled, flattering, intentional.',
    materialTones: 'Favor matte brass, opaline glass, natural stone, linen, matte ceramics. Fixtures should feel curated, gallery-worthy — beautiful objects that happen to be functional.',
    emotionalTone: 'Elevated, serene, intellectual. The room should feel like a design magazine spread — every element considered, nothing accidental. Think: quiet Sunday morning at a beautiful home, coffee in hand, perfectly composed.',
    renderDirective: 'Create refined, even lighting with subtle warmth. The scene should look like a professional interior photography shoot — perfect exposure, no harsh spots, flattering light on every surface. Add gentle ambient glow that makes textures visible. Walls should have smooth, even illumination. The overall palette should feel muted and sophisticated — not dramatic, not bright, but PERFECTLY balanced. Add subtle light/shadow gradients on walls. Make fabrics and surfaces look tactile.',
  },

  // ─── Concept 2: Soft Track vibes ───
  'rustic-warm': {
    colorTemp: '2200K–2700K — deep honey amber, firelight',
    lightQuality: 'Organic, uneven, natural. Light should feel like it comes from lived-in sources — a well-worn lamp, a pendant over the dining table. Warmth should radiate outward in soft halos.',
    shadowStyle: 'Soft, warm-toned shadows that create a sense of age and texture. Think: late afternoon light through old windows.',
    materialTones: 'Weathered brass, reclaimed wood, aged iron, linen, woven textures. Nothing should look new — everything should feel found, collected.',
    emotionalTone: 'Grounded, authentic, nostalgic. A farmhouse kitchen, a cottage reading corner.',
    renderDirective: 'Shift the scene to warm amber tones throughout. Add texture-enhancing light that shows wood grain, fabric weave, surface imperfections as beautiful. Light should pool warmly near fixtures. The overall image should feel like a warm vintage photograph — not filtered, but genuinely warm-lit.',
  },
  'bohemian-layered': {
    colorTemp: '2400K–3000K — warm with pockets of varied color temperature',
    lightQuality: 'Layered, eclectic, abundant. Multiple light sources at different heights creating a rich tapestry of illumination. Some pooling, some ambient, some accent — nothing matches perfectly and that\'s the point.',
    shadowStyle: 'Complex, overlapping shadows from multiple sources. Creates depth and visual richness. Warm undertones.',
    materialTones: 'Mixed materials: rattan, colored glass, macramé, mixed metals, ceramic. Fixtures should feel collected from travels — each one unique.',
    emotionalTone: 'Free-spirited, artistic, warm chaos. Think: a well-traveled creative\'s studio apartment.',
    renderDirective: 'Add MULTIPLE light sources creating overlapping warm pools. Each fixture should cast its own distinct glow. The scene should feel richly layered — some areas brighter, some dimmer, all warm. Show light interacting with different textures and surfaces. The overall effect is ABUNDANCE of warm light, not uniformity.',
  },
  'modern-cozy': {
    colorTemp: '2700K–3200K — warm white, clean but not cold',
    lightQuality: 'Clean, deliberate warmth. Modern fixtures providing warm but defined light. Ambient + task layering. No clutter, but still inviting.',
    shadowStyle: 'Clean, defined shadows with warm edges. Geometric where possible. Refined but not severe.',
    materialTones: 'Matte white, brushed brass, frosted glass, light walnut, concrete. Fixtures are modern with organic touches.',
    emotionalTone: 'Approachable luxury. Think: a well-designed Scandinavian-influenced home that still feels warm and lived-in.',
    renderDirective: 'Add clean, warm light that modernizes the space. Balance between bright functionality and warm comfort. Show defined light zones — a reading light, a pendant over a surface, ambient from a floor lamp. Everything should feel intentional but comfortable. The palette stays warm but clean.',
  },
  'japandi-warm': {
    colorTemp: '2700K–3000K — soft neutral warm, like natural daylight filtered through rice paper',
    lightQuality: 'Minimal, diffused, zen-like. Light should feel filtered, indirect, gentle. Think: paper lanterns, diffused pendants, light that seems to float.',
    shadowStyle: 'Very soft, almost imperceptible gradients. No hard lines. Shadow and light blend gently like watercolor.',
    materialTones: 'Light wood, paper, linen, matte ceramic, simple brass. Fixtures should be minimal, sculptural, art-objects with restraint.',
    emotionalTone: 'Serene, meditative, perfectly balanced. Think: a Japanese tea room meets Scandinavian cabin.',
    renderDirective: 'Create the most SUBTLE, refined lighting. Everything should feel soft and diffused — as if light is passing through rice paper. No harsh pools or bright spots. The entire room should glow gently and evenly with warm undertones. Reduce contrast. Make everything feel calm, quiet, and perfectly harmonious.',
  },

  // ─── Concept 2: Dramatic Track vibes ───
  'art-deco-warm': {
    colorTemp: '2500K–3000K — warm gold, champagne',
    lightQuality: 'Geometric, glamorous, structured. Light should feel like it\'s at a 1930s cocktail party — warm metallics catching light, crystal refracting it, geometric patterns cast on walls.',
    shadowStyle: 'Geometric shadow patterns from structured fixtures. Sharp lines mixed with warm pools. Drama through geometry.',
    materialTones: 'Gold, polished brass, crystal, smoked mirror, lacquer, marble. Fixtures should feel LUXURIOUS — geometric, ornate, precious.',
    emotionalTone: 'Glamorous, confident, celebrating. Think: a Manhattan penthouse, champagne on a gallery night.',
    renderDirective: 'Add GOLDEN light with geometric quality. Show fixtures that create patterned shadows on walls. Metals should GLEAM — warm gold reflections on surfaces. The scene should feel richer, more luxurious. Add warm accent light highlighting architectural features. Everything should feel elevated and intentionally glamorous.',
  },
  'dark-luxe': {
    colorTemp: '1800K–2400K — ultra-warm amber, dimmed, intimate',
    lightQuality: 'Minimal, focused, seductive. Very few light sources, each one creating an intimate island of warm light in surrounding darkness. Less is more — the darkness itself is the design.',
    shadowStyle: 'DEEP, rich shadows. Most of the room should be in elegant shadow. Only key features are illuminated. Shadow color: deep charcoal/warm black.',
    materialTones: 'Black brass, dark bronze, onyx, dark glass, black marble. Fixtures should be barely visible — dark objects that emit warm light.',
    emotionalTone: 'Mysterious, intimate, powerfully quiet. Think: a members-only speakeasy, a luxury hotel room at midnight.',
    renderDirective: 'SIGNIFICANTLY darken the entire scene. This is DARK luxe — most of the room should be in shadow. Only 20-30% of the space should be illuminated, and that illumination should be deep amber/gold. Create extreme contrast. Make dark surfaces look rich, not muddy. Add just a few warm focal points of light. The air should feel thick with atmosphere. This should look like NIGHT, candles, intimacy.',
  },
  'warm-industrial': {
    colorTemp: '2500K–3000K — warm with raw, slightly unfinished quality',
    lightQuality: 'Functional, honest, warm. Light should feel purposeful — pendant over work surface, exposed bulb in socket, clip lamp on shelf. No pretense, but real warmth.',
    shadowStyle: 'Hard-edged shadows from directional fixtures. Industrial character. Strong and honest like exposed brick and steel beams.',
    materialTones: 'Raw steel, aged iron, copper patina, exposed filament bulbs, concrete, canvas. Fixtures should look like they were made in a workshop — functional beauty.',
    emotionalTone: 'Authentic, hardworking, warm underneath. Think: a converted warehouse loft, a coffee roaster\'s studio.',
    renderDirective: 'Add warm, directional light with industrial character. Show visible light sources — exposed bulbs, industrial pendants casting defined pools. Add warm light reflecting off metal and concrete surfaces. The scene should feel raw but inviting — warm light humanizing hard materials. Show hard shadows but with warm color.',
  },
  'moody-maximalist': {
    colorTemp: '2200K–2800K — rich warm, layered from many sources',
    lightQuality: 'Abundant, layered, theatrical. Multiple dramatic fixtures all creating their own atmosphere. Light from every angle — pendants, sconces, floor lamps, table lamps — each one contributing to a rich, immersive experience.',
    shadowStyle: 'Complex, dramatic, overlapping. Multiple light sources create intricate shadow play. Deep and theatrical.',
    materialTones: 'Mixed: dark metals, colored glass, ornate detailing, velvet, jewel tones. Fixtures should be STATEMENT pieces — conversation starters, design objects.',
    emotionalTone: 'Maximalist, immersive, electric. Think: a collector\'s living room, an art-filled salon, a Wes Anderson set.',
    renderDirective: 'Add MULTIPLE dramatic fixtures creating a rich, layered lighting scene. Every corner should have something interesting happening with light. Show warm pools overlapping, fixtures reflecting in surfaces, dramatic shadows mixing. The scene should feel FULL of light and character — not bright, but richly saturated with warm illumination from many sources. More is more.',
  },
};

// ── Build context-aware review prompt ────────────────────────────────────────

function buildReviewPrompt(ctx: QuizContext): string {
  const products = getSuggestedProducts(ctx);
  const productList = products.slice(0, 6).join(', ');
  const key = getStyleKey(ctx);
  const atmo = MOOD_ATMOSPHERES[key];

  let styleDesc = '';
  if (ctx.concept === 'reveal') {
    styleDesc = `Mood: "${ctx.mood || 'Modern'}"\n`;
  } else {
    const trackLabel = ctx.track === 'soft' ? 'Soft & Cozy' : 'Dramatic & Moody';
    styleDesc = `Track: ${trackLabel}, Vibe: "${ctx.vibe || 'Modern'}", Intensity: ${ctx.intensity || 'Balanced'}\n`;
    if (ctx.who) styleDesc += `Designing for: ${ctx.who}\n`;
  }

  if (atmo) {
    styleDesc += `Color temperature: ${atmo.colorTemp}\n`;
    styleDesc += `Light quality: ${atmo.lightQuality}\n`;
    styleDesc += `Material direction: ${atmo.materialTones}\n`;
    styleDesc += `Emotional tone: ${atmo.emotionalTone}`;
  }

  return `You are an expert interior lighting designer for Outlight, a premium modern lighting brand.

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

  let styleLabel = '';
  if (ctx.concept === 'reveal') {
    styleLabel = `"${ctx.mood || 'Modern'}" mood`;
  } else {
    styleLabel = `"${ctx.profileName || ctx.vibe || 'Modern'}" style (${ctx.intensity || 'Balanced'} intensity)`;
  }

  // Build the atmosphere-specific rendering instructions
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

  let styleLabel = '';
  if (ctx.concept === 'reveal') {
    styleLabel = `"${ctx.mood || 'Modern'}" mood`;
  } else {
    styleLabel = `"${ctx.profileName || ctx.vibe || 'Modern'}" style (${ctx.intensity || 'Balanced'} intensity)`;
  }

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
  productImages?: ProductImage[],
): Promise<RenderResult> {
  const client = await getClient();
  const prompt = buildRenderPrompt(review, ctx);

  console.log(`[quiz-image] Generating visualization — ${review.placements.length} products, style: ${getStyleKey(ctx)}, ${productImages?.length || 0} product ref images`);

  // Build parts: room photo first, then product reference images, then prompt text
  const parts: Array<{ inlineData: { mimeType: string; data: string } } | { text: string }> = [
    { inlineData: { mimeType: roomMimeType, data: roomImageBase64 } },
  ];

  // Add product reference images so Gemini can see the actual fixture designs
  if (productImages && productImages.length > 0) {
    for (const pi of productImages) {
      parts.push({ inlineData: { mimeType: pi.mimeType, data: pi.base64 } });
      parts.push({ text: `[Product reference: "${pi.title}" (handle: ${pi.handle}) — use this exact fixture design]` });
    }
  }

  parts.push({ text: prompt });

  const response = await client.models.generateContent({
    model: config.gemini.imageModel,
    contents: [
      {
        role: 'user',
        parts,
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

// ── Generate from scratch (no room photo — sample rooms) ─────────────────────

export async function generateFromScratch(ctx: QuizContext, productImages?: ProductImage[]): Promise<RenderResult> {
  const client = await getClient();
  const prompt = buildGeneratePrompt(ctx);

  console.log(`[quiz-image] Generating sample room from scratch — style: ${getStyleKey(ctx)}, ${productImages?.length || 0} product ref images`);

  // Build parts: product reference images first, then prompt text
  const parts: Array<{ inlineData: { mimeType: string; data: string } } | { text: string }> = [];

  // Add product reference images so Gemini can see the actual fixture designs
  if (productImages && productImages.length > 0) {
    for (const pi of productImages) {
      parts.push({ inlineData: { mimeType: pi.mimeType, data: pi.base64 } });
      parts.push({ text: `[Product reference: "${pi.title}" (handle: ${pi.handle}) — use this exact fixture design in the generated room]` });
    }
  }

  parts.push({ text: prompt });

  const response = await client.models.generateContent({
    model: config.gemini.imageModel,
    contents: [
      {
        role: 'user',
        parts,
      },
    ],
    config: {
      responseModalities: ['IMAGE', 'TEXT'],
    },
  });

  const candidates = response.candidates ?? [];
  for (const candidate of candidates) {
    const parts = candidate.content?.parts ?? [];
    for (const part of parts) {
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
  // Fetch product reference images from Shopify
  const productHandles = getSuggestedProducts(ctx).slice(0, 3);
  let productImages: ProductImage[] = [];
  try {
    console.log(`[quiz-image] Fetching product reference images for: ${productHandles.join(', ')}`);
    productImages = await fetchProductImages(productHandles);
  } catch (err) {
    console.error('[quiz-image] Failed to fetch product images (continuing without):', err instanceof Error ? err.message : err);
  }

  // If no photo provided, generate from scratch
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

  // Normal flow: Review + Render
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

  // Step 1: Context interpretation
  if (ctx.concept === 'reveal') {
    trace.push(`[CONTEXT] User selected concept "The Reveal" with mood "${ctx.mood || 'unknown'}".`);
  } else {
    trace.push(`[CONTEXT] User selected concept "The Style Profile".`);
    trace.push(`[CONTEXT] Track: ${ctx.track === 'soft' ? 'Soft & Cozy' : 'Dramatic & Moody'}, Vibe: "${ctx.vibe}", Intensity: ${ctx.intensity}.`);
    if (ctx.who) trace.push(`[CONTEXT] Designing for: ${ctx.who}.`);
    if (ctx.profileName) trace.push(`[CONTEXT] Combined profile name: "${ctx.profileName}".`);
  }

  // Step 2: Style key resolution
  trace.push(`[RESOLVE] Input "${ctx.mood || ctx.vibe || ''}" → style key "${key}".`);
  if (atmo) {
    trace.push(`[ATMOSPHERE] Matched atmosphere profile. Color temp: ${atmo.colorTemp.split('—')[0].trim()}, emotional tone: "${atmo.emotionalTone.split('.')[0]}".`);
  } else {
    trace.push(`[ATMOSPHERE] WARNING: No atmosphere profile found for key "${key}" — using defaults.`);
  }

  // Step 3: Product pool selection
  const poolHit = STYLE_PRODUCT_MAP[key] ? 'direct match' : 'fallback to modern-cozy';
  trace.push(`[PRODUCTS] Pool lookup: "${key}" → ${poolHit}. ${products.length} products available.`);
  trace.push(`[PRODUCTS] Top picks for prompts: ${products.slice(0, 6).join(', ')}.`);

  // Step 4: Pipeline decision
  if (hasPhoto) {
    trace.push(`[PIPELINE] Photo provided → two-step pipeline: Review (analyze room) → Render (transform image).`);
    trace.push(`[PIPELINE] Step 1: Send photo + review prompt to review model. AI will analyze room layout, furniture, lighting, and suggest product placements.`);
    trace.push(`[PIPELINE] Step 2: Send photo + render prompt (including review results) to image model. AI will generate transformed room with fixtures + mood lighting.`);
  } else {
    trace.push(`[PIPELINE] No photo provided → single-step: Generate sample room from scratch.`);
    trace.push(`[PIPELINE] AI will create a photorealistic room image with fixtures placed and mood lighting applied, purely from text description.`);
  }

  // Step 5: Prompt strategy
  if (atmo) {
    trace.push(`[PROMPT] Injecting full atmosphere block into prompt: colorTemp, lightQuality, shadowStyle, materialTones, emotionalTone, renderDirective.`);
    trace.push(`[PROMPT] Render directive emphasis: "${atmo.renderDirective.slice(0, 100)}..."`);
  }

  // Step 6: Model selection
  trace.push(`[MODELS] Review model: ${config.gemini.reviewModel} (text analysis).`);
  trace.push(`[MODELS] Image model: ${config.gemini.imageModel} (image generation with responseModalities: IMAGE+TEXT).`);

  return trace;
}
