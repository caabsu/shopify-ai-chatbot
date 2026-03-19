import { NextRequest, NextResponse } from 'next/server';
import { createSession } from '@/lib/auth';
import { cookies } from 'next/headers';

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  if (!code) {
    return NextResponse.redirect(new URL('/login?error=no_code', req.nextUrl.origin));
  }

  try {
    // Exchange code for access token with Shopify Customer Account API
    const shopId = process.env.SHOPIFY_SHOP_ID || 'put1rp-iq';
    const tokenRes = await fetch(`https://shopify.com/${shopId}/auth/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: process.env.SHOPIFY_CLIENT_ID!,
        client_secret: process.env.SHOPIFY_CLIENT_SECRET!,
        redirect_uri: `${req.nextUrl.origin}/api/auth/callback`,
        code,
      }),
    });

    if (!tokenRes.ok) {
      return NextResponse.redirect(new URL('/login?error=token_failed', req.nextUrl.origin));
    }

    const tokenData = await tokenRes.json();

    // Send token to backend for verification
    const verifyRes = await fetch(`${process.env.BACKEND_URL}/api/trade/portal/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shopify_access_token: tokenData.access_token }),
    });

    const verifyData = await verifyRes.json();

    if (!verifyRes.ok) {
      const errorCode = verifyData.code || 'auth_failed';
      return NextResponse.redirect(new URL(`/login?error=${errorCode}`, req.nextUrl.origin));
    }

    // Create session and set cookie
    const sessionToken = await createSession({
      member_id: verifyData.member.id,
      customer_id: verifyData.member.shopify_customer_id,
      email: verifyData.member.email,
      company_name: verifyData.member.company_name,
      brand_id: verifyData.member.brand_id,
    });

    const cookieStore = await cookies();
    cookieStore.set('portal_session', sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 86400, // 24 hours
      path: '/',
    });

    return NextResponse.redirect(new URL('/', req.nextUrl.origin));
  } catch (err) {
    console.error('Auth callback error:', err);
    return NextResponse.redirect(new URL('/login?error=unknown', req.nextUrl.origin));
  }
}
