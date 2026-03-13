import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get('content-type') || 'image/jpeg';
    const body = await req.arrayBuffer();

    const res = await fetch(`${BACKEND_URL}/api/returns/upload`, {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body: Buffer.from(body),
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
