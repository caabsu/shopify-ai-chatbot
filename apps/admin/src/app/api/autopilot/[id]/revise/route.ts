import { NextRequest, NextResponse } from 'next/server';
import { getSession, getToken } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

const BACKEND_URL = (process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001').replace(/\/$/, '');
const BACKEND_TIMEOUT_MS = 110_000;

export const runtime = 'nodejs';
export const maxDuration = 120;

async function readBackendJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  if (!text) return {};

  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {
      error: res.ok ? 'Invalid response from backend' : 'Autopilot revision backend returned a non-JSON error',
      details: text.slice(0, 500),
    };
  }
}

/**
 * Operator instruction → plan revision. The planner lives on the backend
 * (it owns the context pipeline), so this forwards the instruction with the
 * session token and returns the freshly revised plan.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const { instruction } = await req.json();
  if (typeof instruction !== 'string' || !instruction.trim()) {
    return NextResponse.json({ error: 'Instruction is required' }, { status: 400 });
  }

  // Brand ownership check before forwarding
  const { data: ticket } = await supabase
    .from('tickets')
    .select('id')
    .eq('id', id)
    .eq('brand_id', session.brandId)
    .single();
  if (!ticket) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });

  const token = await getToken();
  try {
    const res = await fetch(`${BACKEND_URL}/api/tickets/${id}/autopilot/revise`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ instruction: instruction.trim() }),
      signal: AbortSignal.timeout(BACKEND_TIMEOUT_MS), // planner call can take a while
    });

    const data = await readBackendJson(res);
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[autopilot-revise] backend call failed:', message);
    return NextResponse.json({ error: 'Failed to revise ticket', details: message }, { status: 502 });
  }
}
