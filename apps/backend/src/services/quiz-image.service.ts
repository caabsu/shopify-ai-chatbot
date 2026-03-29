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

// ── Review (Analyze Room Photo) ──────────────────────────────────────────────

export interface RoomReview {
  roomType: string;
  description: string;
  placements: Array<{
    productType: string;
    location: string;
    x: number;
    y: number;
    reasoning: string;
  }>;
  ambiance: string;
  suggestions: string[];
}

export async function reviewRoomPhoto(
  imageBase64: string,
  mimeType: string,
  profileKey: string,
  profileName: string,
): Promise<RoomReview> {
  const client = await getClient();

  const prompt = `You are an expert interior lighting designer. Analyze this room photo and suggest where Outlight lighting products should be placed.

The customer's lighting style profile is: "${profileName}" (key: ${profileKey}).

Return a JSON object with:
- roomType: detected room type (living, bedroom, office, dining, etc.)
- description: brief description of the room and its current lighting
- placements: array of suggested product placements, each with:
  - productType: type of light (floor_lamp, desk_lamp, wall_light, pendant, outdoor_light)
  - location: description of where in the room
  - x: x coordinate (0-100, left to right)
  - y: y coordinate (0-100, top to bottom)
  - reasoning: why this placement works for this style
- ambiance: description of how the suggested lighting transforms the space
- suggestions: array of 2-3 short tips for this style

Return ONLY valid JSON, no markdown.`;

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

  const text = response.text?.trim() ?? '';
  try {
    return JSON.parse(text.replace(/^```json\n?/, '').replace(/\n?```$/, ''));
  } catch {
    console.error('[quiz-image] Failed to parse review response:', text.slice(0, 200));
    return {
      roomType: 'unknown',
      description: 'Unable to analyze room',
      placements: [],
      ambiance: '',
      suggestions: [],
    };
  }
}

// ── Render (Generate Visualization) ──────────────────────────────────────────

export interface RenderResult {
  imageBase64: string;
  mimeType: string;
}

export async function renderVisualization(
  roomImageBase64: string,
  roomMimeType: string,
  review: RoomReview,
  profileName: string,
): Promise<RenderResult> {
  const client = await getClient();

  const placementDesc = review.placements
    .map((p) => `- ${p.productType} at ${p.location} (${p.x}%, ${p.y}%)`)
    .join('\n');

  const prompt = `Generate a photorealistic image of this room with Outlight lighting products added.

Style profile: "${profileName}"
Room type: ${review.roomType}
Room description: ${review.description}

Product placements:
${placementDesc}

Target ambiance: ${review.ambiance}

Generate the same room but with beautiful, warm lighting products placed naturally at the suggested locations. Make the lighting look realistic with proper light emission, shadows, and color temperature. The overall mood should match the "${profileName}" style.`;

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
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  for (const part of parts) {
    if (part.inlineData) {
      return {
        imageBase64: part.inlineData.data,
        mimeType: part.inlineData.mimeType ?? 'image/png',
      };
    }
  }

  throw new Error('No image generated in response');
}

// ── Combined: Review + Render Pipeline ───────────────────────────────────────

export async function processRoomPhoto(
  imageBase64: string,
  mimeType: string,
  profileKey: string,
  profileName: string,
): Promise<{ review: RoomReview; render: RenderResult }> {
  // Step 1: Analyze the room
  const review = await reviewRoomPhoto(imageBase64, mimeType, profileKey, profileName);

  // Step 2: Generate visualization
  const render = await renderVisualization(imageBase64, mimeType, review, profileName);

  return { review, render };
}
