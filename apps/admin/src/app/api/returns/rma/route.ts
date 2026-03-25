import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL || process.env.BACKEND_URL || 'http://localhost:3001';

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const action = searchParams.get('action');

  // Test connection
  if (action === 'test-connection') {
    try {
      const res = await fetch(`${BACKEND_URL}/api/rma/test-connection`, {
        headers: { 'x-brand': session.brandId },
      });
      const data = await res.json() as Record<string, unknown>;
      return NextResponse.json(data, { status: res.status });
    } catch (err) {
      return NextResponse.json({ connected: false, error: 'Backend unreachable' }, { status: 503 });
    }
  }

  // Default: return recent sync log from Supabase directly
  const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 200);

  const { data, error } = await supabase
    .from('rma_sync_log')
    .select('*')
    .eq('brand_id', session.brandId)
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ entries: data ?? [], count: (data ?? []).length });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const res = await fetch(`${BACKEND_URL}/api/rma/sync-now`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-brand': session.brandId,
      },
    });
    const data = await res.json() as Record<string, unknown>;
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: 'Failed to trigger sync', details: message }, { status: 503 });
  }
}
