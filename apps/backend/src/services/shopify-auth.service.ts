import { getBrandShopifyConfig } from '../config/brand-shopify.js';

interface CachedToken {
  token: string;
  expiresAt: number;
  refreshInProgress: Promise<string> | null;
}

// Per-brand token cache, keyed by shop domain (e.g. "put1rp-iq")
const tokenCache = new Map<string, CachedToken>();

/**
 * Get a valid Shopify access token for a specific brand.
 * Loads the brand's credentials from the DB (or env vars as fallback),
 * caches tokens per shop domain, and auto-refreshes before expiry.
 */
export async function getTokenForBrand(brandId?: string): Promise<string> {
  const brandConfig = await getBrandShopifyConfig(brandId);
  const cacheKey = brandConfig.shop;

  let entry = tokenCache.get(cacheKey);

  // Return cached token if still valid (with 60s buffer)
  if (entry && entry.token && Date.now() < entry.expiresAt - 60_000) {
    return entry.token;
  }

  // If a refresh is already in progress for this shop, wait for it
  if (entry?.refreshInProgress) {
    return entry.refreshInProgress;
  }

  // Initialize cache entry if needed
  if (!entry) {
    entry = { token: '', expiresAt: 0, refreshInProgress: null };
    tokenCache.set(cacheKey, entry);
  }

  const refreshPromise = refreshToken(brandConfig.shop, brandConfig.clientId, brandConfig.clientSecret);
  entry.refreshInProgress = refreshPromise;

  try {
    const token = await refreshPromise;
    return token;
  } finally {
    // Clear the in-progress flag (entry still exists in the map)
    const current = tokenCache.get(cacheKey);
    if (current) {
      current.refreshInProgress = null;
    }
  }
}

/**
 * Backward-compatible wrapper. Calls getTokenForBrand with no brandId,
 * which falls back to env vars.
 */
export async function getToken(): Promise<string> {
  return getTokenForBrand(undefined);
}

async function refreshToken(
  shop: string,
  clientId: string,
  clientSecret: string,
  retries = 3
): Promise<string> {
  const url = `https://${shop}.myshopify.com/admin/oauth/access_token`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const body = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
      });

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Token request failed (${res.status}): ${text}`);
      }

      const data = (await res.json()) as {
        access_token: string;
        scope: string;
        expires_in: number;
      };

      // Update the cache entry
      const entry = tokenCache.get(shop);
      if (entry) {
        entry.token = data.access_token;
        entry.expiresAt = Date.now() + data.expires_in * 1000;
      } else {
        tokenCache.set(shop, {
          token: data.access_token,
          expiresAt: Date.now() + data.expires_in * 1000,
          refreshInProgress: null,
        });
      }

      console.log(`[shopify-auth] Token refreshed for shop=${shop}. Scopes: ${data.scope}. Expires in ${data.expires_in}s`);
      return data.access_token;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[shopify-auth] Token refresh attempt ${attempt}/${retries} for shop=${shop} failed: ${message}`);

      if (attempt < retries) {
        const delay = Math.pow(2, attempt) * 500;
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        throw new Error(`Failed to refresh Shopify token for shop=${shop} after ${retries} attempts: ${message}`);
      }
    }
  }

  throw new Error('Unreachable');
}
