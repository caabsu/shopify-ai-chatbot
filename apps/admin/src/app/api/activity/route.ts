import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  process.env.BACKEND_URL ||
  'https://shopify-ai-chatbot-production-9ab4.up.railway.app';

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const type = req.nextUrl.searchParams.get('type') || undefined;
  const limit = req.nextUrl.searchParams.get('limit') || '200';

  try {
    const url = new URL('/api/activity', BACKEND_URL);
    if (type) url.searchParams.set('type', type);
    url.searchParams.set('limit', limit);

    const res = await fetch(url.toString(), { cache: 'no-store' });
    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to fetch activity';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
