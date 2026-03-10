import { supabase } from './supabase.js';
import { config } from './env.js';

export interface BrandShopifyConfig {
  shop: string;
  clientId: string;
  clientSecret: string;
}

// In-memory cache keyed by brand_id, with 5-minute TTL
const cache = new Map<string, { data: BrandShopifyConfig; expiry: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Load Shopify credentials for a brand.
 *
 * Resolution order:
 * 1. If brandId is provided, fetch from the brands table (shopify_shop + settings JSONB)
 * 2. If the brand has no credentials in the DB, fall back to env vars
 * 3. If no brandId is provided at all, use env vars directly
 */
export async function getBrandShopifyConfig(brandId?: string): Promise<BrandShopifyConfig> {
  // No brandId — use global env vars (backward compat)
  if (!brandId) {
    return {
      shop: config.shopify.shop,
      clientId: config.shopify.clientId,
      clientSecret: config.shopify.clientSecret,
    };
  }

  // Check cache
  const cached = cache.get(brandId);
  if (cached && Date.now() < cached.expiry) {
    return cached.data;
  }

  // Fetch from brands table
  const { data: brand, error } = await supabase
    .from('brands')
    .select('shopify_shop, settings')
    .eq('id', brandId)
    .single();

  if (error) {
    console.error(`[brand-shopify] Failed to load brand ${brandId}:`, error.message);
    // Fall back to env vars if DB query fails
    return {
      shop: config.shopify.shop,
      clientId: config.shopify.clientId,
      clientSecret: config.shopify.clientSecret,
    };
  }

  const settings = (brand.settings ?? {}) as Record<string, unknown>;
  const shopifyClientId = settings.shopify_client_id as string | undefined;
  const shopifyClientSecret = settings.shopify_client_secret as string | undefined;
  const shop = brand.shopify_shop as string | undefined;

  // If the brand has all three Shopify credentials, use them
  if (shop && shopifyClientId && shopifyClientSecret) {
    const brandConfig: BrandShopifyConfig = {
      shop,
      clientId: shopifyClientId,
      clientSecret: shopifyClientSecret,
    };
    cache.set(brandId, { data: brandConfig, expiry: Date.now() + CACHE_TTL });
    return brandConfig;
  }

  // Brand exists but lacks credentials — fall back to env vars
  console.warn(`[brand-shopify] Brand ${brandId} missing Shopify credentials, falling back to env vars`);
  const fallback: BrandShopifyConfig = {
    shop: config.shopify.shop,
    clientId: config.shopify.clientId,
    clientSecret: config.shopify.clientSecret,
  };
  cache.set(brandId, { data: fallback, expiry: Date.now() + CACHE_TTL });
  return fallback;
}

/** Invalidate cached config for a specific brand, or all brands if no id provided */
export function invalidateBrandShopifyCache(brandId?: string): void {
  if (brandId) {
    cache.delete(brandId);
  } else {
    cache.clear();
  }
}
