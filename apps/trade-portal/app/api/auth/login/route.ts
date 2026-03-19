import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  // Shopify Customer Account API uses shopify.com/{shop_id} for OAuth
  // Shop ID is the myshopify domain handle (e.g., "put1rp-iq")
  const shopId = process.env.SHOPIFY_SHOP_ID || 'put1rp-iq';
  const clientId = process.env.SHOPIFY_CLIENT_ID!;
  const redirectUri = `${req.nextUrl.origin}/api/auth/callback`;

  const authUrl = new URL(`https://shopify.com/${shopId}/auth/oauth/authorize`);
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('scope', 'openid email customer-account-api:full');

  return NextResponse.redirect(authUrl.toString());
}
