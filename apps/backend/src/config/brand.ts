import { Request } from 'express';
import { supabase } from './supabase.js';
import type { Brand } from '../types/index.js';

// Default brand ID (Outlight) for backward compat
const DEFAULT_BRAND_ID = '883e4a28-9f2e-4850-a527-29f297d8b6f8';

// In-memory brand cache
let brandsCache: Brand[] | null = null;
let brandsCacheExpiry = 0;
const BRANDS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function normalizeShopifyShop(shop: string): string {
  return shop
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .replace(/\.myshopify\.com$/i, '')
    .toLowerCase();
}

function normalizeHost(value: string): string {
  return value
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .toLowerCase();
}

async function loadBrands(): Promise<Brand[]> {
  if (brandsCache && Date.now() < brandsCacheExpiry) {
    return brandsCache;
  }

  const { data: rows, error } = await supabase
    .from('brands')
    .select('*')
    .eq('enabled', true);

  if (error) {
    console.error('[brand] Failed to load brands:', error.message);
    // Return cached data if available, even if expired
    if (brandsCache) return brandsCache;
    throw new Error('Failed to load brands');
  }

  brandsCache = (rows ?? []) as Brand[];
  brandsCacheExpiry = Date.now() + BRANDS_CACHE_TTL;
  return brandsCache;
}

/**
 * Resolve the brand_id from a request. Strategy:
 * 1. Authenticated agent brand, when route auth has populated req.agent
 * 2. Query param ?brand=<slug>
 * 3. X-Brand or X-Brand-Id header (slug or id)
 * 4. Shopify webhook shop-domain header
 * 5. Origin/Referer header matched against brands.shopify_shop or brands.settings.domain
 * 6. Default to Outlight
 */
export async function resolveBrandId(req: Request): Promise<string> {
  if (req.agent?.brandId) {
    return req.agent.brandId;
  }

  const brands = await loadBrands();

  // 2. Query param ?brand=<slug>
  const brandParam = req.query.brand as string | undefined;
  if (brandParam) {
    const match = brands.find(
      (b) => b.slug === brandParam || b.id === brandParam
    );
    if (match) return match.id;
  }

  // 3. X-Brand / X-Brand-Id header
  const brandHeader = (req.headers['x-brand'] ?? req.headers['x-brand-id']) as string | undefined;
  if (brandHeader) {
    const match = brands.find(
      (b) => b.slug === brandHeader || b.id === brandHeader
    );
    if (match) return match.id;
  }

  // 4. Shopify webhook shop-domain header
  const shopDomainHeader = req.headers['x-shopify-shop-domain'] as string | undefined;
  if (shopDomainHeader) {
    const normalizedShop = normalizeShopifyShop(shopDomainHeader);
    const match = brands.find((b) => normalizeShopifyShop(b.shopify_shop) === normalizedShop);
    if (match) return match.id;
  }

  // 5. Origin/Referer to match shopify_shop or settings.domain
  const origin = req.headers.origin || req.headers.referer || '';
  if (origin) {
    const normalizedOrigin = normalizeHost(origin);
    for (const b of brands) {
      // Match shopify_shop domain
      const shopDomain = `${normalizeShopifyShop(b.shopify_shop)}.myshopify.com`;
      if (normalizedOrigin.includes(shopDomain)) {
        return b.id;
      }
      // Match custom domain from settings
      const domain = (b.settings as Record<string, unknown> | null)?.domain as string | undefined;
      if (domain && normalizedOrigin.includes(normalizeHost(domain))) {
        return b.id;
      }
    }
  }

  // 6. Default to Outlight
  return DEFAULT_BRAND_ID;
}

/** Get the slug for a brand by ID (uses cache) */
export async function getBrandSlug(brandId: string): Promise<string | null> {
  const brands = await loadBrands();
  const brand = brands.find((b) => b.id === brandId);
  return brand?.slug ?? null;
}

/** Get the display name for a brand by ID (uses cache) */
export async function getBrandName(brandId: string): Promise<string | null> {
  const brands = await loadBrands();
  const brand = brands.find((b) => b.id === brandId);
  return brand?.name ?? null;
}

/** Get the full brand object by ID (uses cache) */
export async function getBrand(brandId: string): Promise<Brand | null> {
  const brands = await loadBrands();
  return brands.find((b) => b.id === brandId) ?? null;
}

/** Get the widget JS URL for a brand. Falls back to default widget paths. */
export async function getBrandWidgetUrl(brandId: string, widgetType: 'chatbot' | 'returns' | 'contact' | 'reviews' | 'tracking' | 'contactForm'): Promise<string> {
  const brand = await getBrand(brandId);
  const settings = brand?.settings as Record<string, unknown> | null;
  const widgetUrls = settings?.widgetUrls as Record<string, string> | undefined;

  if (widgetUrls?.[widgetType]) {
    return widgetUrls[widgetType];
  }

  // Default widget paths (Outlight/Misu shared widget)
  const defaults: Record<string, string> = {
    chatbot: '/widget/widget.js',
    returns: '/widget/returns-portal.js',
    contact: '/widget/contact-form.js',
    contactForm: '/widget/contact-form.js',
    reviews: '/widget/review-widget.js',
    tracking: '/widget/tracking-widget.js',
  };

  return defaults[widgetType] || '/widget/widget.js';
}

/** Invalidate cached brands (useful after brand updates) */
export function invalidateBrandsCache(): void {
  brandsCache = null;
  brandsCacheExpiry = 0;
}
