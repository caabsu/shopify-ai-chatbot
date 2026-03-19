import { NextRequest, NextResponse } from 'next/server';
import { createSession } from '@/lib/auth';
import { cookies } from 'next/headers';
import { decodeJwt } from 'jose';

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  if (!code) {
    return NextResponse.redirect(new URL('/login?error=no_code', req.nextUrl.origin));
  }

  try {
    // Exchange code for tokens with Shopify Customer Account API
    const tokenRes = await fetch('https://account.outlight.us/authentication/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${process.env.SHOPIFY_CLIENT_ID}:${process.env.SHOPIFY_CLIENT_SECRET}`).toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        redirect_uri: `${req.nextUrl.origin}/api/auth/callback`,
        code,
      }),
    });

    if (!tokenRes.ok) {
      const tokenError = await tokenRes.text();
      console.error('[auth/callback] Token exchange failed:', tokenRes.status, tokenError);
      return NextResponse.redirect(new URL('/login?error=token_failed', req.nextUrl.origin));
    }

    const tokenData = await tokenRes.json();
    console.log('[auth/callback] Token exchange succeeded. Has id_token:', !!tokenData.id_token, 'Has access_token:', !!tokenData.access_token);

    // Decode the id_token to get customer email (it's a JWT with email claim)
    let email: string | undefined;

    if (tokenData.id_token) {
      const claims = decodeJwt(tokenData.id_token);
      email = claims.email as string;
      console.log('[auth/callback] Decoded id_token email:', email);
    }

    if (!email) {
      console.error('[auth/callback] No email found in id_token');
      return NextResponse.redirect(new URL('/login?error=no_email', req.nextUrl.origin));
    }

    // Send email to backend for trade member verification (instead of Shopify token)
    const verifyRes = await fetch(`${process.env.BACKEND_URL}/api/trade/portal/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });

    const verifyText = await verifyRes.text();
    console.log('[auth/callback] Backend verify response:', verifyRes.status, verifyText);

    if (!verifyRes.ok) {
      let errorCode = 'auth_failed';
      try {
        const verifyData = JSON.parse(verifyText);
        errorCode = verifyData.code || verifyData.error || 'auth_failed';
      } catch {}
      return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(errorCode)}`, req.nextUrl.origin));
    }

    const verifyData = JSON.parse(verifyText);

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
      maxAge: 86400,
      path: '/',
    });

    return NextResponse.redirect(new URL('/', req.nextUrl.origin));
  } catch (err) {
    console.error('[auth/callback] Unexpected error:', err);
    return NextResponse.redirect(new URL('/login?error=unknown', req.nextUrl.origin));
  }
}
