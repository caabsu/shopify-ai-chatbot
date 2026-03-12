import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config/env.js';
import { supabase } from '../config/supabase.js';
import type { ReturnRequest, ReturnItem } from '../types/index.js';

const anthropic = new Anthropic({ apiKey: config.anthropic.apiKey });

interface AIRecommendation {
  decision: 'approve' | 'deny' | 'needs_review';
  confidence: number;
  reasoning: string;
  suggested_resolution: 'refund' | 'store_credit' | 'exchange';
}

interface OrderData {
  created_at: string;
  total_price?: number;
  line_items?: Array<Record<string, unknown>>;
  fulfillments?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

interface CustomerHistory {
  past_returns_count?: number;
  lifetime_value?: number;
  [key: string]: unknown;
}

// ── Get AI Recommendation for a Return Request ────────────────────────────
export async function getAIRecommendation(
  returnRequest: ReturnRequest,
  returnItems: ReturnItem[],
  orderData: OrderData,
  customerHistory?: CustomerHistory
): Promise<AIRecommendation> {
  // Load return policy from knowledge base
  let returnPolicy = '';
  try {
    const { data: docs, error } = await supabase
      .from('knowledge_documents')
      .select('title, content')
      .eq('category', 'return_policy')
      .eq('enabled', true)
      .order('priority', { ascending: false });

    if (!error && docs && docs.length > 0) {
      returnPolicy = docs.map((d: { title: string; content: string }) => `### ${d.title}\n${d.content}`).join('\n\n');
    }
  } catch (err) {
    console.error('[return-ai.service] Failed to load return policy:', err instanceof Error ? err.message : err);
  }

  // Build the evaluation prompt
  const systemPrompt = buildSystemPrompt(returnPolicy);
  const userPrompt = buildUserPrompt(returnRequest, returnItems, orderData, customerHistory);

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      temperature: 0.3,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    // Extract text response
    let responseText = '';
    for (const block of response.content) {
      if (block.type === 'text') {
        responseText += block.text;
      }
    }

    // Parse the JSON response
    const recommendation = parseAIResponse(responseText);

    console.log(`[return-ai.service] AI recommendation for return ${returnRequest.id}: ${recommendation.decision} (confidence: ${recommendation.confidence})`);
    return recommendation;
  } catch (err) {
    console.error('[return-ai.service] AI evaluation failed:', err instanceof Error ? err.message : err);
    // Return a safe default on failure
    return {
      decision: 'needs_review',
      confidence: 0,
      reasoning: 'AI evaluation failed — manual review required.',
      suggested_resolution: 'refund',
    };
  }
}

// ── Build System Prompt ───────────────────────────────────────────────────
function buildSystemPrompt(returnPolicy: string): string {
  const policySection = returnPolicy
    ? `\n\n## Store Return Policy\n${returnPolicy}`
    : '\n\n## Store Return Policy\nNo specific return policy found. Use standard e-commerce best practices (30-day return window, items must be unused, etc.).';

  return `You are a return request evaluation assistant. Your job is to analyze return requests and provide a recommendation.

You must evaluate each return based on the store's return policy, order details, and customer history.${policySection}

## Response Format

You MUST respond with a valid JSON object and nothing else. No markdown, no explanation outside the JSON. The JSON must have exactly these fields:

{
  "decision": "approve" | "deny" | "needs_review",
  "confidence": <number between 0 and 1>,
  "reasoning": "<brief explanation of your decision>",
  "suggested_resolution": "refund" | "store_credit" | "exchange"
}

## Decision Guidelines

- **approve**: The return clearly meets all policy requirements. High confidence.
- **deny**: The return clearly violates policy (past return window, excluded category, etc.). High confidence.
- **needs_review**: Ambiguous case, borderline policy match, high-value item, or customer with unusual history. Recommend human review.

## Confidence Scale

- 0.9-1.0: Very clear-cut case
- 0.7-0.89: Fairly confident but some minor considerations
- 0.5-0.69: Moderately confident, some ambiguity
- Below 0.5: Low confidence, should likely be "needs_review"

## Resolution Guidelines

- **refund**: Default for straightforward returns within policy
- **store_credit**: Consider for borderline cases, returns past window (as goodwill), or if store policy prefers it
- **exchange**: When item is defective or wrong item was sent`;
}

// ── Build User Prompt ─────────────────────────────────────────────────────
function buildUserPrompt(
  returnRequest: ReturnRequest,
  returnItems: ReturnItem[],
  orderData: OrderData,
  customerHistory?: CustomerHistory
): string {
  const orderDate = new Date(orderData.created_at);
  const daysSinceOrder = Math.floor(
    (Date.now() - orderDate.getTime()) / (1000 * 60 * 60 * 24)
  );

  const totalReturnAmount = returnItems.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0
  );

  let prompt = `## Return Request Details

- **Return ID**: ${returnRequest.id}
- **Order Number**: ${returnRequest.order_number}
- **Customer**: ${returnRequest.customer_name ?? 'Unknown'} (${returnRequest.customer_email})
- **Order Date**: ${orderDate.toISOString().split('T')[0]}
- **Days Since Order**: ${daysSinceOrder}
- **Total Return Amount**: $${totalReturnAmount.toFixed(2)}

## Items Being Returned

`;

  for (const item of returnItems) {
    prompt += `### ${item.product_title}`;
    if (item.variant_title) prompt += ` (${item.variant_title})`;
    prompt += `\n`;
    prompt += `- Quantity: ${item.quantity}\n`;
    prompt += `- Price: $${item.price.toFixed(2)}\n`;
    prompt += `- Reason: ${item.reason}\n`;
    if (item.reason_details) prompt += `- Details: ${item.reason_details}\n`;
    if (item.photo_urls && item.photo_urls.length > 0) {
      prompt += `- Photos provided: ${item.photo_urls.length} photo(s)\n`;
    }
    prompt += '\n';
  }

  if (orderData.total_price !== undefined) {
    prompt += `## Order Context\n`;
    prompt += `- Order Total: $${orderData.total_price}\n`;
    prompt += `- Return represents ${((totalReturnAmount / orderData.total_price) * 100).toFixed(1)}% of order value\n\n`;
  }

  if (customerHistory) {
    prompt += `## Customer History\n`;
    if (customerHistory.past_returns_count !== undefined) {
      prompt += `- Past Returns: ${customerHistory.past_returns_count}\n`;
    }
    if (customerHistory.lifetime_value !== undefined) {
      prompt += `- Lifetime Value: $${customerHistory.lifetime_value.toFixed(2)}\n`;
    }
    prompt += '\n';
  }

  prompt += `Please evaluate this return request and respond with your JSON recommendation.`;

  return prompt;
}

// ── Parse AI Response ─────────────────────────────────────────────────────
function parseAIResponse(responseText: string): AIRecommendation {
  try {
    // Try to extract JSON from the response (handle potential markdown wrapping)
    let jsonStr = responseText.trim();

    // Strip markdown code fences if present
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;

    // Validate required fields
    const decision = parsed.decision as string;
    if (!['approve', 'deny', 'needs_review'].includes(decision)) {
      throw new Error(`Invalid decision: ${decision}`);
    }

    const confidence = typeof parsed.confidence === 'number'
      ? Math.max(0, Math.min(1, parsed.confidence))
      : 0.5;

    const reasoning = typeof parsed.reasoning === 'string'
      ? parsed.reasoning
      : 'No reasoning provided.';

    const suggestedResolution = parsed.suggested_resolution as string;
    const validResolutions = ['refund', 'store_credit', 'exchange'] as const;
    const resolution = validResolutions.includes(suggestedResolution as typeof validResolutions[number])
      ? suggestedResolution as AIRecommendation['suggested_resolution']
      : 'refund';

    return {
      decision: decision as AIRecommendation['decision'],
      confidence,
      reasoning,
      suggested_resolution: resolution,
    };
  } catch (err) {
    console.error('[return-ai.service] Failed to parse AI response:', err instanceof Error ? err.message : err);
    console.error('[return-ai.service] Raw response:', responseText);
    return {
      decision: 'needs_review',
      confidence: 0,
      reasoning: 'Failed to parse AI response — manual review required.',
      suggested_resolution: 'refund',
    };
  }
}
