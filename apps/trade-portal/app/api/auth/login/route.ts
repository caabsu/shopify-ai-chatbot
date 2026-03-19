import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';

export async function GET(req: NextRequest) {
  // Shopify Customer Account API OAuth
  // Docs: https://shopify.dev/docs/storefronts/headless/building-with-the-customer-account-api/getting-started
  const shopId = process.env.SHOPIFY_SHOP_ID || 'put1rp-iq';
  const clientId = process.env.SHOPIFY_CLIENT_ID!;
  const redirectUri = `${req.nextUrl.origin}/api/auth/callback`;

  // Generate state and nonce for CSRF and replay protection
  const state = randomBytes(32).toString('hex');
  const nonce = randomBytes(32).toString('hex');

  const authUrl = new URL(`https://shopify.com/authentication/${shopId}/oauth/authorize`);
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('scope', 'openid email customer-account-api:full');
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('nonce', nonce);

  // Store state in cookie for verification on callback
  const response = NextResponse.redirect(authUrl.toString());
  response.cookies.set('oauth_state', state, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 600, // 10 minutes
    path: '/',
  });

  return response;
}
