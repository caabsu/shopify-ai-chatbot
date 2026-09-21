import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface ManualLinkResult {
  executed: boolean;
  replayed: boolean;
  merged: number;
  into: number;
  source_context_after: number;
  primary_context_after: number;
}

function isManualLinkResult(value: unknown): value is ManualLinkResult {
  if (!value || typeof value !== 'object') return false;
  const result = value as Record<string, unknown>;
  return result.executed === true
    && typeof result.replayed === 'boolean'
    && typeof result.merged === 'number'
    && typeof result.into === 'number'
    && Number.isSafeInteger(result.source_context_after)
    && Number.isSafeInteger(result.primary_context_after);
}

/**
 * Link another same-customer ticket into this canonical ticket. Source
 * messages remain immutable on their original ticket. The database RPC owns
 * every validation and write so a merge either commits completely or not at
 * all.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: primaryId } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'A JSON request body is required' }, { status: 400 });
  }
  const sourceId = body && typeof body === 'object'
    ? (body as Record<string, unknown>).source_id
    : null;

  if (typeof sourceId !== 'string' || !UUID_PATTERN.test(sourceId)) {
    return NextResponse.json({ error: 'source_id must be a valid ticket id' }, { status: 400 });
  }
  if (!UUID_PATTERN.test(primaryId)) {
    return NextResponse.json({ error: 'Invalid target ticket id' }, { status: 400 });
  }
  if (sourceId.toLowerCase() === primaryId.toLowerCase()) {
    return NextResponse.json({ error: 'Cannot link a ticket into itself' }, { status: 400 });
  }

  // These versions are optimistic fences only. The RPC re-reads and locks the
  // complete rows, validates customer identity/status/Autopilot state, and
  // builds metadata from the locked source row.
  const [primaryResult, sourceResult] = await Promise.all([
    supabase
      .from('tickets')
      .select('id, context_version')
      .eq('id', primaryId)
      .eq('brand_id', session.brandId)
      .maybeSingle(),
    supabase
      .from('tickets')
      .select('id, context_version')
      .eq('id', sourceId)
      .eq('brand_id', session.brandId)
      .maybeSingle(),
  ]);

  if (primaryResult.error || sourceResult.error) {
    console.error('[ticket-merge] Failed to load context fences', {
      primaryId,
      sourceId,
      primaryError: primaryResult.error?.message,
      sourceError: sourceResult.error?.message,
    });
    return NextResponse.json({ error: 'Could not validate tickets for linking' }, { status: 500 });
  }
  if (!primaryResult.data || !sourceResult.data) {
    return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
  }

  const primaryContext = Number(primaryResult.data.context_version);
  const sourceContext = Number(sourceResult.data.context_version);
  if (!Number.isSafeInteger(primaryContext) || primaryContext < 0
      || !Number.isSafeInteger(sourceContext) || sourceContext < 0) {
    console.error('[ticket-merge] Invalid ticket context version', {
      primaryId,
      sourceId,
      primaryContext: primaryResult.data.context_version,
      sourceContext: sourceResult.data.context_version,
    });
    return NextResponse.json({ error: 'Ticket concurrency state is invalid' }, { status: 500 });
  }

  const { data, error } = await supabase.rpc('execute_manual_ticket_link', {
    p_primary_id: primaryId,
    p_source_id: sourceId,
    p_brand_id: session.brandId,
    p_expected_primary_context: primaryContext,
    p_expected_source_context: sourceContext,
    p_actor_id: session.userId ?? null,
  });

  if (error) {
    const missingRpc = error.code === 'PGRST202' || /execute_manual_ticket_link/i.test(error.message || '');
    const status = error.code === 'P0002' ? 404
      : error.code === '40001' ? 409
        : missingRpc ? 503
          : 500;
    if (status === 500) {
      console.error('[ticket-merge] Atomic link failed', {
        primaryId,
        sourceId,
        code: error.code,
        message: error.message,
      });
    }
    return NextResponse.json({
      error: missingRpc
        ? 'Atomic ticket linking is unavailable. Apply migration 014 and retry.'
        : status === 500 ? 'Ticket linking failed' : error.message,
    }, { status });
  }
  if (!isManualLinkResult(data)) {
    console.error('[ticket-merge] Atomic link returned an invalid result', { primaryId, sourceId });
    return NextResponse.json({ error: 'Ticket linking returned an invalid result' }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    replayed: data.replayed,
    merged: data.merged,
    into: data.into,
    source_context_after: data.source_context_after,
    primary_context_after: data.primary_context_after,
  });
}
