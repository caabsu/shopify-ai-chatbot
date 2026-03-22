import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await req.json();

    if (!body.csv_text || typeof body.csv_text !== 'string') {
      return NextResponse.json({ error: 'csv_text is required' }, { status: 400 });
    }

    const res = await fetch(`${BACKEND_URL}/api/reviews/admin/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        csv_text: body.csv_text,
        brand_id: session.brandId,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      return NextResponse.json(data, { status: res.status });
    }

    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
