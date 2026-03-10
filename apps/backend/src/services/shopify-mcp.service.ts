import { config } from '../config/env.js';
import { getBrandShopifyConfig } from '../config/brand-shopify.js';

let rpcId = 1;

async function getMcpUrl(brandId?: string): Promise<string> {
  if (brandId) {
    const brandConfig = await getBrandShopifyConfig(brandId);
    return `https://${brandConfig.shop}.myshopify.com/api/mcp`;
  }
  return `https://${config.shopify.shop}.myshopify.com/api/mcp`;
}

async function mcpCall<T = unknown>(toolName: string, args: Record<string, unknown>, brandId?: string): Promise<T> {
  const url = await getMcpUrl(brandId);

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'tools/call',
      id: rpcId++,
      params: {
        name: toolName,
        arguments: args,
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`MCP request failed (${res.status}): ${text}`);
  }

  const json = (await res.json()) as {
    result?: { content?: Array<{ type: string; text: string }> };
    error?: { code: number; message: string };
  };

  if (json.error) {
    throw new Error(`MCP error (${json.error.code}): ${json.error.message}`);
  }

  // Extract text content from the MCP response
  const textContent = json.result?.content
    ?.filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n');

  if (!textContent) {
    return {} as T;
  }

  try {
    return JSON.parse(textContent) as T;
  } catch {
    return textContent as T;
  }
}

export interface McpProduct {
  id: string;
  title: string;
  description: string;
  price: string;
  currency: string;
  imageUrl: string;
  productUrl: string;
  available: boolean;
  variants?: Array<{
    id: string;
    title: string;
    price: string;
    available: boolean;
  }>;
}

export async function searchProducts(
  query: string,
  context: string,
  options?: { filters?: Record<string, unknown>; limit?: number; country?: string; language?: string; after?: string },
  brandId?: string
): Promise<unknown> {
  const args: Record<string, unknown> = { query, context };
  if (options?.filters) args.filters = options.filters;
  if (options?.limit) args.limit = options.limit;
  if (options?.country) args.country = options.country;
  if (options?.language) args.language = options.language;
  if (options?.after) args.after = options.after;

  // Return the full MCP response — the AI interprets it directly
  return mcpCall('search_shop_catalog', args, brandId);
}

export async function getProductDetails(
  productId: string,
  options?: { country?: string; language?: string },
  brandId?: string
): Promise<unknown> {
  const args: Record<string, unknown> = { product_id: productId };
  if (options?.country) args.country = options.country;
  if (options?.language) args.language = options.language;

  return mcpCall('get_product_details', args, brandId);
}

export async function searchPolicies(query: string, context: string, brandId?: string): Promise<string> {
  const result = await mcpCall<string>('search_shop_policies_and_faqs', { query, context }, brandId);
  return typeof result === 'string' ? result : JSON.stringify(result);
}

export async function createOrUpdateCart(options: {
  cart_id?: string;
  add_items?: Array<{ product_variant_id: string; quantity: number }>;
  update_items?: Array<{ id: string; quantity: number }>;
  remove_line_ids?: string[];
  discount_codes?: string[];
}, brandId?: string): Promise<unknown> {
  const args: Record<string, unknown> = {};
  if (options.cart_id) args.cart_id = options.cart_id;
  if (options.add_items) args.add_items = options.add_items;
  if (options.update_items) args.update_items = options.update_items;
  if (options.remove_line_ids) args.remove_line_ids = options.remove_line_ids;
  if (options.discount_codes) args.discount_codes = options.discount_codes;

  return mcpCall('update_cart', args, brandId);
}

export async function getCart(cartId: string, brandId?: string): Promise<unknown> {
  return mcpCall('get_cart', { cart_id: cartId }, brandId);
}
