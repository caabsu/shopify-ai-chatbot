import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config/env.js';
import { supabase } from '../config/supabase.js';
import { toolDefinitions } from '../tools/definitions.js';
import { executeTool } from '../tools/router.js';
import type { ToolContext } from '../tools/router.js';
import { getBrand } from '../config/brand.js';
import { graphql } from './shopify-admin.service.js';
import * as knowledgeService from './knowledge.service.js';
import * as conversationService from './conversation.service.js';
import type { AiResponse, NavigationButton, ProductCard, CartData } from '../types/index.js';

const anthropic = new Anthropic({ apiKey: config.anthropic.apiKey });

// Per-brand config cache
type AiConfigData = { systemPrompt: string; brandVoice: string; promotions: string };
const configCacheMap = new Map<string, { data: AiConfigData; expiry: number }>();
const CONFIG_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function loadAiConfig(brandId?: string): Promise<AiConfigData> {
  const cacheKey = brandId ?? '_default';
  const cached = configCacheMap.get(cacheKey);
  if (cached && Date.now() < cached.expiry) {
    return cached.data;
  }

  let query = supabase
    .from('ai_config')
    .select('key, value')
    .in('key', ['system_prompt', 'brand_voice', 'promotions']);

  if (brandId) {
    query = query.eq('brand_id', brandId);
  }

  const { data: rows, error } = await query;

  if (error) {
    console.error('[ai.service] Failed to load ai_config:', error.message);
    throw new Error('Failed to load AI configuration');
  }

  const configMap = new Map((rows ?? []).map((r: { key: string; value: string }) => [r.key, r.value]));

  const data: AiConfigData = {
    systemPrompt: configMap.get('system_prompt') ?? 'You are a helpful customer support assistant.',
    brandVoice: configMap.get('brand_voice') ?? '',
    promotions: configMap.get('promotions') ?? '',
  };
  configCacheMap.set(cacheKey, { data, expiry: Date.now() + CONFIG_CACHE_TTL });

  return data;
}

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeDomain(value: string): string {
  return value
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '');
}

function formatMoney(amount?: string, currencyCode?: string): string | null {
  if (!amount) return null;
  const parsed = Number.parseFloat(amount);
  if (!Number.isFinite(parsed)) return null;
  return `${currencyCode === 'USD' ? '$' : `${currencyCode ?? ''} `}${parsed.toFixed(2)}`.trim();
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function productText(value: unknown): string {
  if (typeof value === 'string') return stripHtml(value);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const html = asText(record.html);
    if (html) return stripHtml(html);
    const text = asText(record.text);
    if (text) return stripHtml(text);
  }
  return '';
}

function formatCatalogMinorMoney(value: unknown, currency?: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const currencyCode = typeof currency === 'string' ? currency : 'USD';
  const amount = value / 100;
  return `${currencyCode === 'USD' ? '$' : `${currencyCode} `}${amount.toFixed(2)}`;
}

function formatCatalogPrice(product: Record<string, unknown>): string {
  const priceRange = product.price_range as Record<string, unknown> | undefined;
  const min = priceRange?.min as Record<string, unknown> | undefined;
  const max = priceRange?.max as Record<string, unknown> | undefined;
  const minPrice = formatCatalogMinorMoney(min?.amount, min?.currency);
  const maxPrice = formatCatalogMinorMoney(max?.amount, max?.currency);

  if (minPrice && maxPrice && minPrice !== maxPrice) return `${minPrice} - ${maxPrice}`;
  if (minPrice) return minPrice;

  const price = product.price as Record<string, unknown> | string | undefined;
  if (typeof price === 'string') return price;
  if (price && typeof price === 'object') {
    return formatCatalogMinorMoney(price.amount, price.currency) ?? '';
  }

  return '';
}

function firstCatalogImage(product: Record<string, unknown>): string {
  const direct = asText(product.image_url) ?? asText(product.imageUrl);
  if (direct) return direct;

  const media = product.media as Array<Record<string, unknown>> | undefined;
  const mediaUrl = media?.map((item) => asText(item.url)).find(Boolean);
  if (mediaUrl) return mediaUrl;

  const variants = product.variants as Array<Record<string, unknown>> | undefined;
  for (const variant of variants ?? []) {
    const variantMedia = variant.media as Array<Record<string, unknown>> | undefined;
    const variantUrl = variantMedia?.map((item) => asText(item.url)).find(Boolean);
    if (variantUrl) return variantUrl;
  }

  return '';
}

function catalogAvailability(product: Record<string, unknown>): boolean {
  if (typeof product.available === 'boolean') return product.available;

  const variants = product.variants as Array<Record<string, unknown>> | undefined;
  const availableVariant = variants?.some((variant) => {
    const availability = variant.availability as Record<string, unknown> | undefined;
    return availability?.available === true || variant.available === true;
  });

  return availableVariant ?? true;
}

function decodeHandle(handle: string): string {
  try {
    return decodeURIComponent(handle);
  } catch {
    return handle;
  }
}

async function loadBrandContext(brandId?: string): Promise<string> {
  if (!brandId) return '';

  try {
    const brand = await getBrand(brandId);
    if (!brand) return '';

    const settings = (brand.settings ?? {}) as Record<string, unknown>;
    const domain =
      asText(settings.domain) ??
      asText(settings.storefront_domain) ??
      asText(settings.storefrontDomain) ??
      `${normalizeDomain(brand.shopify_shop)}${brand.shopify_shop.includes('.myshopify.com') ? '' : '.myshopify.com'}`;
    const supportEmail =
      asText(settings.support_email) ??
      asText(settings.supportEmail) ??
      asText(settings.contact_email) ??
      asText(settings.contactEmail);
    const description =
      asText(settings.ai_context) ??
      asText(settings.aiContext) ??
      asText(settings.brand_context) ??
      asText(settings.brandContext) ??
      asText(settings.description);

    const lines = [
      '## Brand Context',
      `Brand: ${brand.name}`,
      `Brand slug: ${brand.slug}`,
      `Storefront domain: ${domain}`,
      `Shopify shop: ${normalizeDomain(brand.shopify_shop)}`,
    ];

    if (supportEmail) lines.push(`Support email: ${supportEmail}`);
    if (description) lines.push(`Brand notes: ${description}`);

    if (brand.slug === 'warm-by-design') {
      lines.push(
        'Warm by Design sells lighting and related home design products.',
        'For Warm by Design product questions, use the live Shopify catalog tools instead of guessing product names, prices, variants, finishes, dimensions, delivery timing, or availability.',
        'If a customer needs human support, use support@warmbydesign.com unless a newer brand setting says otherwise.'
      );
    }

    return lines.join('\n');
  } catch (err) {
    console.error('[ai.service] Failed to load brand context:', err instanceof Error ? err.message : err);
    return '';
  }
}

interface ShopifyProductPageContext {
  productByHandle: {
    id: string;
    title: string;
    handle: string;
    description: string | null;
    vendor: string | null;
    productType: string | null;
    tags: string[];
    onlineStoreUrl: string | null;
    featuredImage: { url: string; altText: string | null } | null;
    priceRange: {
      minVariantPrice: { amount: string; currencyCode: string };
      maxVariantPrice: { amount: string; currencyCode: string };
    };
    options: Array<{ name: string; values: string[] }>;
    variants: {
      edges: Array<{
        node: {
          id: string;
          title: string;
          availableForSale: boolean;
          price: string;
          selectedOptions: Array<{ name: string; value: string }>;
        };
      }>;
    };
    metafields: {
      edges: Array<{ node: { namespace: string; key: string; value: string; type: string } }>;
    };
  } | null;
}

interface ShopifyCollectionPageContext {
  collectionByHandle: {
    title: string;
    handle: string;
    description: string | null;
    products: {
      edges: Array<{
        node: {
          title: string;
          handle: string;
          status: string;
          onlineStoreUrl: string | null;
          priceRange: { minVariantPrice: { amount: string; currencyCode: string } };
        };
      }>;
    };
  } | null;
}

async function loadProductPageContext(handle: string, brandId?: string): Promise<string> {
  if (!brandId) return '';

  try {
    const data = await graphql<ShopifyProductPageContext>(
      `query ProductPageContext($handle: String!) {
        productByHandle(handle: $handle) {
          id
          title
          handle
          description
          vendor
          productType
          tags
          onlineStoreUrl
          featuredImage { url altText }
          priceRange {
            minVariantPrice { amount currencyCode }
            maxVariantPrice { amount currencyCode }
          }
          options { name values }
          variants(first: 8) {
            edges {
              node {
                id
                title
                availableForSale
                price
                selectedOptions { name value }
              }
            }
          }
          metafields(first: 20) {
            edges {
              node { namespace key value type }
            }
          }
        }
      }`,
      { handle },
      brandId
    );

    const product = data.productByHandle;
    if (!product) {
      return `## Current Page Product\nProduct handle: ${handle}\nNo matching active Shopify product was found for this handle.`;
    }

    const min = formatMoney(product.priceRange?.minVariantPrice?.amount, product.priceRange?.minVariantPrice?.currencyCode);
    const max = formatMoney(product.priceRange?.maxVariantPrice?.amount, product.priceRange?.maxVariantPrice?.currencyCode);
    const price = min && max && min !== max ? `${min} - ${max}` : min ?? max ?? 'Unavailable';
    const options = product.options
      .filter((option) => option.values.length > 0)
      .map((option) => `${option.name}: ${option.values.join(', ')}`)
      .join('; ');
    const variants = product.variants.edges
      .map(({ node }) => `${node.title} (${node.availableForSale ? 'available' : 'unavailable'}, ${formatMoney(node.price, product.priceRange.minVariantPrice.currencyCode) ?? node.price})`)
      .join('; ');
    const metafields = product.metafields.edges
      .filter(({ node }) => node.value && !node.key.toLowerCase().includes('json'))
      .slice(0, 10)
      .map(({ node }) => `${node.namespace}.${node.key}: ${node.value}`)
      .join('\n');

    const description = product.description?.trim()
      ? product.description.trim().replace(/\s+/g, ' ').slice(0, 1200)
      : '';

    const lines = [
      '## Current Page Product',
      `The customer is viewing this Shopify product. Treat references like "this", "it", or "the lamp" as this product unless the customer says otherwise.`,
      `Product: ${product.title}`,
      `Handle: ${product.handle}`,
      `Product ID: ${product.id}`,
      `Price: ${price}`,
    ];

    if (product.vendor) lines.push(`Vendor: ${product.vendor}`);
    if (product.productType) lines.push(`Product type: ${product.productType}`);
    if (product.tags.length > 0) lines.push(`Tags: ${product.tags.join(', ')}`);
    if (product.onlineStoreUrl) lines.push(`URL: ${product.onlineStoreUrl}`);
    if (description) lines.push(`Description: ${description}`);
    if (options) lines.push(`Options: ${options}`);
    if (variants) lines.push(`Variants: ${variants}`);
    if (metafields) lines.push(`Metafields:\n${metafields}`);

    return lines.join('\n');
  } catch (err) {
    console.error('[ai.service] Failed to load product page context:', err instanceof Error ? err.message : err);
    return `## Current Page Product\nProduct handle: ${handle}\nProduct details could not be loaded automatically. Use search_products and get_product_details before answering product-specific questions.`;
  }
}

async function loadCollectionPageContext(handle: string, brandId?: string): Promise<string> {
  if (!brandId) return '';

  try {
    const data = await graphql<ShopifyCollectionPageContext>(
      `query CollectionPageContext($handle: String!) {
        collectionByHandle(handle: $handle) {
          title
          handle
          description
          products(first: 6, sortKey: BEST_SELLING) {
            edges {
              node {
                title
                handle
                status
                onlineStoreUrl
                priceRange { minVariantPrice { amount currencyCode } }
              }
            }
          }
        }
      }`,
      { handle },
      brandId
    );

    const collection = data.collectionByHandle;
    if (!collection) {
      return `## Current Page Collection\nCollection handle: ${handle}\nNo matching Shopify collection was found for this handle.`;
    }

    const products = collection.products.edges
      .filter(({ node }) => node.status === 'ACTIVE')
      .map(({ node }) => {
        const price = formatMoney(node.priceRange.minVariantPrice.amount, node.priceRange.minVariantPrice.currencyCode);
        return `- ${node.title} (${price ?? 'price unavailable'}): ${node.onlineStoreUrl ?? `/products/${node.handle}`}`;
      })
      .join('\n');

    const lines = [
      '## Current Page Collection',
      `The customer is viewing collection: ${collection.title}`,
      `Handle: ${collection.handle}`,
    ];
    if (collection.description) lines.push(`Description: ${collection.description.replace(/\s+/g, ' ').slice(0, 800)}`);
    if (products) lines.push(`Representative products:\n${products}`);

    return lines.join('\n');
  } catch (err) {
    console.error('[ai.service] Failed to load collection page context:', err instanceof Error ? err.message : err);
    return `## Current Page Collection\nCollection handle: ${handle}\nCollection details could not be loaded automatically. Use search_products before answering collection-specific product questions.`;
  }
}

async function loadPageContext(pageUrl?: string, brandId?: string): Promise<string> {
  if (!pageUrl) return '';

  let url: URL;
  try {
    url = new URL(pageUrl);
  } catch {
    return `## Page Context\nCurrent page: ${pageUrl}`;
  }

  const path = url.pathname.replace(/\/+$/, '') || '/';
  const productMatch = path.match(/^\/products\/([^/]+)$/);
  const collectionMatch = path.match(/^\/collections\/([^/]+)$/);
  const pageMatch = path.match(/^\/pages\/([^/]+)$/);

  if (productMatch) {
    return loadProductPageContext(decodeHandle(productMatch[1]), brandId);
  }

  if (collectionMatch) {
    return loadCollectionPageContext(decodeHandle(collectionMatch[1]), brandId);
  }

  if (pageMatch) {
    return [
      '## Page Context',
      `Current page URL: ${pageUrl}`,
      `Shopify page handle: ${decodeHandle(pageMatch[1])}`,
      'If the customer asks about content on this page and the answer is not in the conversation, use answer_store_policy or search_knowledge_base before guessing.',
    ].join('\n');
  }

  return [
    '## Page Context',
    `Current page URL: ${pageUrl}`,
    `Current path: ${path}`,
  ].join('\n');
}

export async function processMessage(
  conversationId: string,
  userMessage: string,
  context?: { customerEmail?: string; pageUrl?: string; cartId?: string; brandId?: string }
): Promise<AiResponse> {
  const startTime = Date.now();

  // 1. Load config
  const [aiConfig, brandContext, pageContext] = await Promise.all([
    loadAiConfig(context?.brandId),
    loadBrandContext(context?.brandId),
    loadPageContext(context?.pageUrl, context?.brandId),
  ]);

  // 2. Load relevant knowledge
  let kbContext = '';
  try {
    const docs = await knowledgeService.searchKnowledge(userMessage, context?.brandId);
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
  if (brandContext) {
    systemPrompt += `\n\n${brandContext}`;
  }
  if (pageContext) {
    systemPrompt += `\n\n${pageContext}`;
  }
  if (kbContext) {
    systemPrompt += kbContext;
  }
  if (aiConfig.promotions) {
    systemPrompt += `\n\n## Active Promotions\n${aiConfig.promotions}`;
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
  systemPrompt += [
    '\n\n## Catalog Access Rules',
    'Use search_products before answering any product catalog, recommendation, price, stock, variant, finish, size, material, delivery-time, or compatibility question unless the needed detail is already present in Current Page Product.',
    'Use get_product_details after search_products when the customer asks for specifications, delivery timing, measurements, finish, light source, installation details, reviews, or variants for a specific product.',
    'Never invent product names, prices, availability, variants, or specifications. If live catalog data is unavailable, say that you need to check with support and offer escalation.',
  ].join('\n');

  // Check if customer is a trade program member
  if (context?.customerEmail && context?.brandId) {
    try {
      const { getMemberByEmail } = await import('./trade.service.js');
      const tradeMember = await getMemberByEmail(context.customerEmail, context.brandId);
      if (tradeMember && tradeMember.status === 'active') {
        systemPrompt += `\n\n## Trade Program Member`;
        systemPrompt += `\nThis customer is an ACTIVE TRADE PROGRAM MEMBER.`;
        systemPrompt += `\nCompany: ${tradeMember.company_name}`;
        systemPrompt += `\nBusiness type: ${tradeMember.business_type}`;
        systemPrompt += `\nPayment terms: ${tradeMember.payment_terms}`;
        systemPrompt += `\nTrade discount code: TRADE30 (30% off, applied automatically when logged in)`;
        systemPrompt += `\nProvide concierge-level service. Address them by name. Reference their company when relevant.`;
        systemPrompt += `\nIf they need help with orders, projects, or have questions, treat them as a VIP.`;
        systemPrompt += `\nFor complex requests, offer to create a priority support ticket on their behalf.`;
      }
    } catch (err) {
      // Non-fatal - continue without trade context
    }
  }

  // 4. Load conversation history
  const messages = await conversationService.getMessages(conversationId);
  const claudeMessages: Anthropic.MessageParam[] = messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

  // Chat controller stores the user message before this call. Append only when
  // processMessage is used directly and the current turn is not already saved.
  const lastConversationMessage = messages[messages.length - 1];
  if (!(lastConversationMessage?.role === 'user' && lastConversationMessage.content === userMessage)) {
    claudeMessages.push({ role: 'user', content: userMessage });
  }

  // 5. Call Claude with tool loop
  const toolContext: ToolContext = {
    conversationId,
    customerEmail: context?.customerEmail,
    pageUrl: context?.pageUrl,
    cartId: context?.cartId,
    brandId: context?.brandId,
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
              productCards.push({
                id: (p.product_id as string) || (p.id as string) || '',
                title: (p.title as string) || '',
                description: productText(p.description).slice(0, 200),
                price: formatCatalogPrice(p),
                currency: (p.currency as string) || 'USD',
                imageUrl: firstCatalogImage(p),
                productUrl: (p.url as string) || (p.productUrl as string) || '',
                available: catalogAvailability(p),
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

          // Extract customer identity from verified order lookups
          if (toolUse.name === 'lookup_order' && data.found && data.customerEmail) {
            try {
              const conv = await conversationService.getConversation(conversationId);
              if (conv && !conv.customer_email) {
                await conversationService.updateConversation(conversationId, {
                  customer_email: data.customerEmail as string,
                  customer_phone: (data.customerPhone as string) || undefined,
                });
                toolContext.customerEmail = data.customerEmail as string;
              }
            } catch (err) {
              console.error('[ai.service] Failed to update customer identity:', err instanceof Error ? err.message : err);
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
