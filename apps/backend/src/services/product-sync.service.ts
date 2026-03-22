import { config } from '../config/env.js';
import { supabase } from '../config/supabase.js';
import { getTokenForBrand } from './shopify-auth.service.js';
import { getBrandShopifyConfig } from '../config/brand-shopify.js';
import type { Product, ProductVariant } from '../types/index.js';

function extractNumericId(gid: string): string {
  const match = gid.match(/\/(\d+)$/);
  return match ? match[1] : gid;
}

interface ShopifyProductNode {
  id: string;
  title: string;
  handle: string;
  productType: string;
  vendor: string;
  status: string;
  tags: string[];
  featuredImage: { url: string } | null;
  variants: {
    edges: Array<{
      node: {
        id: string;
        title: string;
        price: string;
        sku: string | null;
      };
    }>;
  };
}

interface ProductsQueryResult {
  products: {
    edges: Array<{
      node: ShopifyProductNode;
      cursor: string;
    }>;
    pageInfo: {
      hasNextPage: boolean;
    };
  };
}

const PRODUCTS_QUERY = `
  query Products($first: Int!, $after: String) {
    products(first: $first, after: $after) {
      edges {
        node {
          id
          title
          handle
          productType
          vendor
          status
          tags
          featuredImage {
            url
          }
          variants(first: 100) {
            edges {
              node {
                id
                title
                price
                sku
              }
            }
          }
        }
        cursor
      }
      pageInfo {
        hasNextPage
      }
    }
  }
`;

async function shopifyGraphql<T>(query: string, variables: Record<string, unknown>, brandId?: string): Promise<T> {
  const token = await getTokenForBrand(brandId);
  const brandConfig = await getBrandShopifyConfig(brandId);
  const url = `https://${brandConfig.shop}.myshopify.com/admin/api/${config.shopify.apiVersion}/graphql.json`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Shopify Admin API error (${res.status}): ${text}`);
  }

  const json = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };

  if (json.errors && json.errors.length > 0) {
    const messages = json.errors.map((e) => e.message).join('; ');
    throw new Error(`Shopify GraphQL error: ${messages}`);
  }

  if (!json.data) {
    throw new Error('Shopify GraphQL returned no data');
  }

  return json.data;
}

function mapShopifyProduct(node: ShopifyProductNode, brandId: string): Omit<Product, 'id' | 'created_at' | 'updated_at' | 'review_count' | 'average_rating'> {
  const variants: ProductVariant[] = node.variants.edges.map((e) => ({
    id: extractNumericId(e.node.id),
    title: e.node.title,
    price: e.node.price,
    sku: e.node.sku,
  }));

  return {
    shopify_product_id: extractNumericId(node.id),
    title: node.title,
    handle: node.handle,
    product_type: node.productType || null,
    vendor: node.vendor || null,
    status: node.status.toLowerCase(),
    featured_image_url: node.featuredImage?.url ?? null,
    variants,
    tags: node.tags,
    synced_at: new Date().toISOString(),
    brand_id: brandId,
  };
}

export async function fullSync(brandId: string): Promise<{ synced: number }> {
  try {
    let hasNextPage = true;
    let afterCursor: string | null = null;
    let totalSynced = 0;

    while (hasNextPage) {
      const variables: Record<string, unknown> = { first: 50 };
      if (afterCursor) variables.after = afterCursor;

      const data = await shopifyGraphql<ProductsQueryResult>(PRODUCTS_QUERY, variables, brandId);

      const edges = data.products.edges;
      if (edges.length === 0) break;

      const products = edges.map((e) => mapShopifyProduct(e.node, brandId));

      // Upsert batch
      for (const product of products) {
        const { error } = await supabase
          .from('products')
          .upsert(
            {
              ...product,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'shopify_product_id' },
          );

        if (error) {
          console.error(`[product-sync] Failed to upsert product ${product.shopify_product_id}:`, error.message);
        } else {
          totalSynced++;
        }
      }

      hasNextPage = data.products.pageInfo.hasNextPage;
      afterCursor = edges[edges.length - 1].cursor;

      console.log(`[product-sync] Synced ${totalSynced} products so far for brand ${brandId}`);
    }

    console.log(`[product-sync] Full sync complete for brand ${brandId}: ${totalSynced} products`);
    return { synced: totalSynced };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[product-sync] Full sync failed:', message);
    throw new Error(`Product sync failed: ${message}`);
  }
}

export async function handleProductWebhook(
  topic: string,
  payload: Record<string, unknown>,
  brandId: string,
): Promise<void> {
  try {
    const shopifyProductId = String(payload.id);

    if (topic === 'products/delete') {
      const { error } = await supabase
        .from('products')
        .delete()
        .eq('shopify_product_id', shopifyProductId)
        .eq('brand_id', brandId);

      if (error) {
        console.error('[product-sync] Failed to delete product:', error.message);
      } else {
        console.log(`[product-sync] Deleted product ${shopifyProductId} for brand ${brandId}`);
      }
      return;
    }

    // products/create or products/update
    const variants: ProductVariant[] = Array.isArray(payload.variants)
      ? (payload.variants as Array<Record<string, unknown>>).map((v) => ({
          id: String(v.id),
          title: String(v.title || 'Default'),
          price: String(v.price || '0.00'),
          sku: v.sku ? String(v.sku) : null,
        }))
      : [];

    const tags: string[] = typeof payload.tags === 'string'
      ? (payload.tags as string).split(',').map((t) => t.trim()).filter(Boolean)
      : [];

    const imageUrl = payload.image
      ? (payload.image as Record<string, unknown>).src as string | null
      : null;

    const productData = {
      shopify_product_id: shopifyProductId,
      title: String(payload.title || ''),
      handle: String(payload.handle || ''),
      product_type: payload.product_type ? String(payload.product_type) : null,
      vendor: payload.vendor ? String(payload.vendor) : null,
      status: String(payload.status || 'active').toLowerCase(),
      featured_image_url: imageUrl ?? null,
      variants,
      tags,
      synced_at: new Date().toISOString(),
      brand_id: brandId,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from('products')
      .upsert(productData, { onConflict: 'shopify_product_id' });

    if (error) {
      console.error(`[product-sync] Failed to upsert product ${shopifyProductId}:`, error.message);
      throw new Error(`Failed to upsert product: ${error.message}`);
    }

    console.log(`[product-sync] ${topic} handled for product ${shopifyProductId} brand ${brandId}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[product-sync] Webhook handling failed:', message);
    throw new Error(`Product webhook handling failed: ${message}`);
  }
}

export async function getProducts(brandId: string): Promise<Product[]> {
  try {
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .eq('brand_id', brandId)
      .order('title', { ascending: true });

    if (error) throw new Error(`Failed to fetch products: ${error.message}`);
    return (data ?? []) as Product[];
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[product-sync] getProducts failed:', message);
    throw new Error(`Failed to get products: ${message}`);
  }
}

export async function registerWebhooks(brandId?: string): Promise<void> {
  const brandConfig = await getBrandShopifyConfig(brandId);
  // Railway sets RAILWAY_PUBLIC_DOMAIN automatically
  const railwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN;
  const callbackBase = railwayDomain
    ? `https://${railwayDomain}`
    : config.server.nodeEnv === 'production'
      ? 'https://shopify-ai-chatbot-production-9ab4.up.railway.app'
      : `http://localhost:${config.server.port}`;

  const topics = [
    { topic: 'PRODUCTS_CREATE', path: '/api/reviews/webhooks/shopify/products' },
    { topic: 'PRODUCTS_UPDATE', path: '/api/reviews/webhooks/shopify/products' },
    { topic: 'PRODUCTS_DELETE', path: '/api/reviews/webhooks/shopify/products' },
    { topic: 'ORDERS_FULFILLED', path: '/api/reviews/webhooks/shopify/orders' },
  ];

  for (const { topic, path } of topics) {
    const callbackUrl = `${callbackBase}${path}`;
    try {
      const mutation = `
        mutation webhookSubscriptionCreate($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
          webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
            webhookSubscription { id }
            userErrors { field message }
          }
        }
      `;

      const result = await shopifyGraphql<{
        webhookSubscriptionCreate: {
          webhookSubscription: { id: string } | null;
          userErrors: Array<{ field: string[]; message: string }>;
        };
      }>(mutation, {
        topic,
        webhookSubscription: {
          callbackUrl,
          format: 'JSON',
        },
      }, brandId);

      const errors = result.webhookSubscriptionCreate.userErrors;
      if (errors.length > 0) {
        // "already exists" is fine
        const msg = errors.map(e => e.message).join('; ');
        if (msg.toLowerCase().includes('already exists') || msg.toLowerCase().includes('has already been taken')) {
          console.log(`[product-sync] Webhook ${topic}: already registered`);
        } else {
          console.warn(`[product-sync] Webhook ${topic} registration warning: ${msg}`);
        }
      } else {
        console.log(`[product-sync] Webhook ${topic}: registered → ${callbackUrl}`);
      }
    } catch (err) {
      console.error(`[product-sync] Failed to register webhook ${topic}:`, err instanceof Error ? err.message : String(err));
    }
  }
}

export async function getProductByHandle(handle: string, brandId: string): Promise<Product | null> {
  try {
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .eq('handle', handle)
      .eq('brand_id', brandId)
      .single();

    if (error && error.code === 'PGRST116') return null;
    if (error) throw new Error(`Failed to fetch product: ${error.message}`);
    return data as Product;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[product-sync] getProductByHandle failed:', message);
    throw new Error(`Failed to get product by handle: ${message}`);
  }
}
