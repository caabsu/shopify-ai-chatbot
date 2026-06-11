import { NextRequest, NextResponse } from 'next/server';
import { getSession, getToken } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

const BACKEND_URL = (process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001').replace(/\/$/, '');

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
      signal: AbortSignal.timeout(90_000), // planner call can take a while
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    console.error('[autopilot-revise] backend call failed:', err);
    return NextResponse.json({ error: 'Revision timed out — try again' }, { status: 502 });
  }
}
