import { NextRequest, NextResponse } from 'next/server';
import { getSession, getToken } from '@/lib/auth';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const token = await getToken();
  const { id } = await params;
  const body = await req.json();

  try {
    const res = await fetch(`${BACKEND_URL}/api/returns/${id}/deny`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-brand': session.brandId,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: 'Failed to deny return', details: message }, { status: 503 });
  }
}
