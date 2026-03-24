import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';

const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const res = await fetch(`${backendUrl}/api/tracking/admin/settings`, {
    headers: { 'x-brand-id': session.brandId },
  });

  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}

export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();

  const res = await fetch(`${backendUrl}/api/tracking/admin/settings`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'x-brand-id': session.brandId,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
