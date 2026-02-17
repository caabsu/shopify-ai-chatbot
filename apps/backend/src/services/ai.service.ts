import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config/env.js';
import { supabase } from '../config/supabase.js';
import { toolDefinitions } from '../tools/definitions.js';
import { executeTool } from '../tools/router.js';
import type { ToolContext } from '../tools/router.js';
import * as knowledgeService from './knowledge.service.js';
import * as conversationService from './conversation.service.js';
import type { AiResponse, NavigationButton, ProductCard, CartData } from '../types/index.js';

const anthropic = new Anthropic({ apiKey: config.anthropic.apiKey });

// Config cache
let configCache: { systemPrompt: string; brandVoice: string } | null = null;
let configCacheExpiry = 0;
const CONFIG_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function loadAiConfig(): Promise<{ systemPrompt: string; brandVoice: string }> {
  if (configCache && Date.now() < configCacheExpiry) {
    return configCache;
  }

  const { data: rows, error } = await supabase
    .from('ai_config')
    .select('key, value')
    .in('key', ['system_prompt', 'brand_voice']);

  if (error) {
    console.error('[ai.service] Failed to load ai_config:', error.message);
    throw new Error('Failed to load AI configuration');
  }

  const configMap = new Map((rows ?? []).map((r: { key: string; value: string }) => [r.key, r.value]));

  configCache = {
    systemPrompt: configMap.get('system_prompt') ?? 'You are a helpful customer support assistant.',
    brandVoice: configMap.get('brand_voice') ?? '',
  };
  configCacheExpiry = Date.now() + CONFIG_CACHE_TTL;

  return configCache;
}

export async function processMessage(
  conversationId: string,
  userMessage: string,
  context?: { customerEmail?: string; pageUrl?: string; cartId?: string }
): Promise<AiResponse> {
  const startTime = Date.now();

  // 1. Load config
  const aiConfig = await loadAiConfig();

  // 2. Load relevant knowledge
  let kbContext = '';
  try {
    const docs = await knowledgeService.searchKnowledge(userMessage);
    if (docs.length > 0) {
      kbContext = '\n\n## Relevant Knowledge Base Information\n' +
        docs.map((d) => `### ${d.title}\n${d.content}`).join('\n\n');
    }
  } catch {
    // Non-critical — continue without KB context
  }

  // 3. Build system prompt
  let systemPrompt = aiConfig.systemPrompt;
  if (aiConfig.brandVoice) {
    systemPrompt += `\n\n## Brand Voice\n${aiConfig.brandVoice}`;
  }
  if (kbContext) {
    systemPrompt += kbContext;
  }
  if (context?.customerEmail) {
    systemPrompt += `\n\n## Session Context\nCustomer email: ${context.customerEmail}`;
  }
  if (context?.pageUrl) {
    systemPrompt += `\nCustomer is currently on: ${context.pageUrl}`;
  }
  if (context?.cartId) {
    systemPrompt += `\nCustomer cart ID: ${context.cartId}`;
  }

  // 4. Load conversation history
  const messages = await conversationService.getMessages(conversationId);
  const claudeMessages: Anthropic.MessageParam[] = messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

  // Add the new user message
  claudeMessages.push({ role: 'user', content: userMessage });

  // 5. Call Claude with tool loop
  const toolContext: ToolContext = {
    conversationId,
    customerEmail: context?.customerEmail,
    pageUrl: context?.pageUrl,
    cartId: context?.cartId,
  };

  const navigationButtons: NavigationButton[] = [];
  const productCards: ProductCard[] = [];
  let cartData: CartData | null = null;
  const toolsUsed: string[] = [];
  let conversationStatus = 'active';
  let totalTokensInput = 0;
  let totalTokensOutput = 0;

  let currentMessages = [...claudeMessages];
  const maxIterations = 10;

  let finalResponse: Anthropic.Message | null = null;

  for (let i = 0; i < maxIterations; i++) {
    const response = await anthropic.messages.create({
      model: config.ai.model,
      max_tokens: config.ai.maxTokens,
      temperature: config.ai.temperature,
      system: systemPrompt,
      messages: currentMessages,
      tools: toolDefinitions,
    });

    totalTokensInput += response.usage.input_tokens;
    totalTokensOutput += response.usage.output_tokens;

    if (response.stop_reason === 'end_turn' || response.stop_reason === 'max_tokens') {
      finalResponse = response;
      break;
    }

    if (response.stop_reason === 'tool_use') {
      // Extract tool_use blocks
      const toolUseBlocks = response.content.filter(
        (block): block is Anthropic.ContentBlockParam & { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> } =>
          block.type === 'tool_use'
      );

      // Add assistant response to messages
      currentMessages.push({ role: 'assistant', content: response.content });

      // Execute each tool and build tool_result blocks
      const toolResults: Array<{
        type: 'tool_result';
        tool_use_id: string;
        content: string;
      }> = [];

      for (const toolUse of toolUseBlocks) {
        toolsUsed.push(toolUse.name);

        const result = await executeTool(
          toolUse.name,
          toolUse.input,
          toolContext
        );

        // Extract navigation buttons, product cards, cart data from results
        if (result.success && result.data) {
          const data = result.data as Record<string, unknown>;

          if (data.type === 'navigation') {
            navigationButtons.push({
              url: data.url as string,
              label: data.label as string,
            });
          }

          if (data.type === 'escalation') {
            conversationStatus = 'escalated';
          }

          // Check for product data
          if (toolUse.name === 'search_products' && data.products) {
            const products = data.products as Array<Record<string, unknown>>;
            for (const p of products) {
              const priceRange = p.price_range as Record<string, string> | undefined;
              productCards.push({
                id: (p.product_id as string) || (p.id as string) || '',
                title: (p.title as string) || '',
                description: ((p.description as string) || '').slice(0, 200),
                price: priceRange?.min || (p.price as string) || '',
                currency: priceRange?.currency || (p.currency as string) || 'USD',
                imageUrl: (p.image_url as string) || (p.imageUrl as string) || '',
                productUrl: (p.url as string) || (p.productUrl as string) || '',
                available: (p.available as boolean) ?? true,
              });
            }
          }

          // Check for cart data
          if ((toolUse.name === 'manage_cart' || toolUse.name === 'get_cart') && data) {
            try {
              cartData = data as unknown as CartData;
            } catch {
              // Cart data shape may vary
            }
          }
        }

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: JSON.stringify(result),
        });
      }

      // Add tool results as a user message
      currentMessages.push({ role: 'user', content: toolResults });

      continue;
    }

    // Unexpected stop reason
    finalResponse = response;
    break;
  }

  // 6. Extract final text
  let responseText = '';
  if (finalResponse) {
    for (const block of finalResponse.content) {
      if (block.type === 'text') {
        responseText += block.text;
      }
    }
  }

  if (!responseText) {
    responseText = "I'm sorry, I wasn't able to generate a response. Please try again.";
  }

  const latencyMs = Date.now() - startTime;

  return {
    response: responseText,
    navigationButtons,
    productCards,
    cartData,
    toolsUsed: [...new Set(toolsUsed)],
    conversationStatus,
    metadata: {
      model: config.ai.model,
      tokensInput: totalTokensInput,
      tokensOutput: totalTokensOutput,
      latencyMs,
    },
  };
}
