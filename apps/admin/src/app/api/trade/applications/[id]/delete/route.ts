import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { cookies } from 'next/headers';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  const cookieStore = await cookies();
  const token = cookieStore.get('admin_token')?.value;

  const BACKEND_URL =
    process.env.BACKEND_URL || 'https://shopify-ai-chatbot-production-9ab4.up.railway.app';

  const res = await fetch(`${BACKEND_URL}/api/trade/applications/${id}`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });

  const data = await res.json().catch(() => ({ error: 'Invalid response from backend' }));
  return NextResponse.json(data, { status: res.status });
}
