import { Request } from 'express';
import { supabase } from './supabase.js';
import type { Brand } from '../types/index.js';

// Default brand ID (Outlight) for backward compat
const DEFAULT_BRAND_ID = '883e4a28-9f2e-4850-a527-29f297d8b6f8';

// In-memory brand cache
let brandsCache: Brand[] | null = null;
let brandsCacheExpiry = 0;
const BRANDS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

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
 * 1. Query param ?brand=<slug>
 * 2. X-Brand header (slug or id)
 * 3. Origin/Referer header matched against brands.shopify_shop or brands.settings.domain
 * 4. Default to Outlight
 */
export async function resolveBrandId(req: Request): Promise<string> {
  const brands = await loadBrands();

  // 1. Query param ?brand=<slug>
  const brandParam = req.query.brand as string | undefined;
  if (brandParam) {
    const match = brands.find(
      (b) => b.slug === brandParam || b.id === brandParam
    );
    if (match) return match.id;
  }

  // 2. X-Brand header
  const brandHeader = req.headers['x-brand'] as string | undefined;
  if (brandHeader) {
    const match = brands.find(
      (b) => b.slug === brandHeader || b.id === brandHeader
    );
    if (match) return match.id;
  }

  // 3. Origin/Referer to match shopify_shop or settings.domain
  const origin = req.headers.origin || req.headers.referer || '';
  if (origin) {
    for (const b of brands) {
      // Match shopify_shop domain
      if (origin.includes(`${b.shopify_shop}.myshopify.com`)) {
        return b.id;
      }
      // Match custom domain from settings
      const domain = (b.settings as Record<string, unknown> | null)?.domain as string | undefined;
      if (domain && origin.includes(domain)) {
        return b.id;
      }
    }
  }

  // 4. Default to Outlight
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

/** Invalidate cached brands (useful after brand updates) */
export function invalidateBrandsCache(): void {
  brandsCache = null;
  brandsCacheExpiry = 0;
}
