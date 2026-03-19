import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const shopifyStoreUrl = process.env.SHOPIFY_STORE_URL!;
  const clientId = process.env.SHOPIFY_CLIENT_ID!;
  const redirectUri = `${req.nextUrl.origin}/api/auth/callback`;

  const authUrl = new URL(`${shopifyStoreUrl}/auth/oauth/authorize`);
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('scope', 'openid email customer-account-api:full');

  return NextResponse.redirect(authUrl.toString());
}
