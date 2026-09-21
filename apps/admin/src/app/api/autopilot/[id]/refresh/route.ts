import { NextRequest, NextResponse } from 'next/server';
import { getSession, getToken } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

const BACKEND_URL = (process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001').replace(/\/$/, '');
const BACKEND_TIMEOUT_MS = 240_000;

export const runtime = 'nodejs';
export const maxDuration = 300;

async function readBackendJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {
      error: res.ok
        ? 'Invalid response from backend'
        : 'Autopilot refresh backend returned a non-JSON error',
      details: text.slice(0, 500),
    };
  }
}

/**
 * Replace a stale plan from current Shopify, customer-history, knowledge, and
 * learning context. This endpoint never approves or executes the replacement.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;

  const { data: ticket } = await supabase
    .from('tickets')
    .select('id')
    .eq('id', id)
    .eq('brand_id', session.brandId)
    .single();
  if (!ticket) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });

  const token = await getToken();
  try {
    const res = await fetch(`${BACKEND_URL}/api/tickets/${id}/autopilot/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        plan_id: typeof body.plan_id === 'string' ? body.plan_id : undefined,
        plan_revision: Number.isInteger(body.plan_revision) ? body.plan_revision : undefined,
        context_fingerprint: typeof body.context_fingerprint === 'string'
          ? body.context_fingerprint
          : undefined,
        context_version: Number.isInteger(body.context_version) ? body.context_version : undefined,
        reason: typeof body.reason === 'string' ? body.reason.slice(0, 120) : 'stale_evidence',
      }),
      signal: AbortSignal.timeout(BACKEND_TIMEOUT_MS),
    });
    const data = await readBackendJson(res);
    return NextResponse.json(data, { status: res.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[autopilot-refresh] backend call failed:', message);
    return NextResponse.json({
      error: 'Autopilot could not rebuild this plan right now.',
      details: message,
    }, { status: 502 });
  }
}
