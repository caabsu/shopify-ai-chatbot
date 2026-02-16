import { config } from '../config/env.js';

let cachedToken: string | null = null;
let tokenExpiresAt = 0;
let refreshInProgress: Promise<string> | null = null;

export async function getToken(): Promise<string> {
  // Return cached token if still valid (with 60s buffer)
  if (cachedToken && Date.now() < tokenExpiresAt - 60_000) {
    return cachedToken;
  }

  // If a refresh is already in progress, wait for it
  if (refreshInProgress) {
    return refreshInProgress;
  }

  refreshInProgress = refreshToken();
  try {
    const token = await refreshInProgress;
    return token;
  } finally {
    refreshInProgress = null;
  }
}

async function refreshToken(retries = 3): Promise<string> {
  const url = `https://${config.shopify.shop}.myshopify.com/admin/oauth/access_token`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const body = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: config.shopify.clientId,
        client_secret: config.shopify.clientSecret,
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

      cachedToken = data.access_token;
      tokenExpiresAt = Date.now() + data.expires_in * 1000;

      console.log(`[shopify-auth] Token refreshed. Scopes: ${data.scope}. Expires in ${data.expires_in}s`);
      return cachedToken;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[shopify-auth] Token refresh attempt ${attempt}/${retries} failed: ${message}`);

      if (attempt < retries) {
        const delay = Math.pow(2, attempt) * 500;
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        throw new Error(`Failed to refresh Shopify token after ${retries} attempts: ${message}`);
      }
    }
  }

  throw new Error('Unreachable');
}
