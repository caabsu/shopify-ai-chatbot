import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Record the result of an ambiguous provider operation after a human checks
 * Shopify/Resend. This never repeats the side effect; it only resolves the
 * durable receipt so the original execution attempt can safely resume.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role !== 'admin') {
    return NextResponse.json({ error: 'Only an admin can reconcile an ambiguous provider action.' }, { status: 403 });
  }

  const { id: ticketId } = await params;
  const body = await req.json();
  const receiptId = typeof body.receipt_id === 'string' ? body.receipt_id : '';
  const outcome = body.outcome === 'executed' || body.outcome === 'failed' ? body.outcome : null;
  const providerReference = typeof body.provider_reference === 'string' ? body.provider_reference.trim() : '';
  const note = typeof body.note === 'string' ? body.note.trim() : '';
  const providerVerified = body.provider_verified === true;
  if (!UUID_PATTERN.test(receiptId) || !outcome || !providerVerified || (!providerReference && !note)) {
    return NextResponse.json({
      error: 'receipt_id, outcome, provider_verified=true, and a provider reference or verification note are required.',
    }, { status: 400 });
  }

  const { data: receipt } = await supabase
    .from('autopilot_action_executions')
    .select('id, ticket_id, brand_id, status')
    .eq('id', receiptId)
    .eq('ticket_id', ticketId)
    .eq('brand_id', session.brandId)
    .maybeSingle();
  if (!receipt) return NextResponse.json({ error: 'Action receipt not found.' }, { status: 404 });

  const { data, error } = await supabase.rpc('reconcile_autopilot_action_execution', {
    p_receipt_id: receiptId,
    p_brand_id: session.brandId,
    p_outcome: outcome,
    p_provider_reference: providerReference || null,
    p_note: note || null,
    p_actor_id: session.userId ?? null,
    p_provider_verified: true,
    // Server time is the attestation time. Client-supplied timestamps are not
    // trusted for the post-deadline quiescence check.
    p_provider_checked_at: new Date().toISOString(),
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 409 });
  const { data: releaseData, error: releaseError } = await supabase.rpc(
    'release_autopilot_execution_scopes',
    {
      p_receipt_id: receiptId,
      p_brand_id: session.brandId,
      // Reconciliation is an admin-attested terminal transition, not a
      // continuation of the expired worker. The release RPC authorizes cleanup
      // from the now-terminal receipt rather than from its old worker token.
      p_worker_token: randomUUID(),
    },
  );
  if (releaseError) {
    console.warn(
      '[autopilot] reconciled receipt scope cleanup warning:',
      releaseError.message,
    );
  }
  return NextResponse.json({
    ...((data && typeof data === 'object') ? data : { reconciled: true }),
    execution_scopes_released: !releaseError
      && (releaseData as Record<string, unknown> | null)?.released === true,
  });
}
