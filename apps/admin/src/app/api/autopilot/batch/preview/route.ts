import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import {
  selectAutopilotBatch,
  validateAutopilotBatchSettings,
} from '@/lib/autopilot-batch-policy';
import { autopilotPlanFingerprint } from '@/lib/autopilot-plan-fingerprint';
import { supabase } from '@/lib/supabase';
import type { Ticket } from '@/lib/types';

export const runtime = 'nodejs';

const MAX_QUEUE_SCAN = 500;
const PREVIEW_TTL_MS = 5 * 60_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const AUTOMATIC_AWAITING_CUSTOMER_PROMPT_VERSIONS = new Set([
  'response-state-park-v1',
  'response-state-auto-park-v2',
]);

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role !== 'admin') {
    return NextResponse.json({
      error: 'Batch threshold approval requires an administrator.',
    }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'A JSON request body is required.' }, { status: 400 });
  }
  const request = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  const validated = validateAutopilotBatchSettings(request.settings);
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });
  const blockedValues = request.exclude_ticket_ids;
  if (blockedValues !== undefined && !Array.isArray(blockedValues)) {
    return NextResponse.json({ error: 'exclude_ticket_ids must be an array.' }, { status: 400 });
  }
  const blockedTicketIds = new Set<string>();
  for (const value of (blockedValues ?? []) as unknown[]) {
    if (typeof value !== 'string' || !UUID_PATTERN.test(value) || blockedTicketIds.has(value)) {
      return NextResponse.json({ error: 'exclude_ticket_ids contains an invalid or duplicate ticket ID.' }, { status: 400 });
    }
    if (blockedTicketIds.size >= 500) {
      return NextResponse.json({ error: 'At most 500 locally edited tickets can be excluded.' }, { status: 400 });
    }
    blockedTicketIds.add(value);
  }

  const { data, error, count } = await supabase
    .from('tickets')
    .select('*', { count: 'exact' })
    .eq('brand_id', session.brandId)
    .in('status', ['open', 'pending'])
    .filter('metadata->autopilot->>status', 'in', '(proposed,executing)')
    .order('created_at', { ascending: true })
    .limit(MAX_QUEUE_SCAN);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const queueTickets = ((data ?? []) as Ticket[]).filter((ticket) => (
    !AUTOMATIC_AWAITING_CUSTOMER_PROMPT_VERSIONS.has(String(
      (ticket.metadata?.autopilot as { prompt_version?: string } | undefined)
        ?.prompt_version ?? '',
    ))
  ));
  const hiddenAutomaticParks = (data?.length ?? 0) - queueTickets.length;
  const generatedAt = new Date();
  const selection = selectAutopilotBatch({
    tickets: queueTickets,
    settings: validated.value,
    now: generatedAt,
    blockedTicketIds,
    fingerprintPlan: autopilotPlanFingerprint,
  });
  const preview = {
    previewId: randomUUID(),
    generatedAt: generatedAt.toISOString(),
    expiresAt: new Date(generatedAt.getTime() + PREVIEW_TTL_MS).toISOString(),
    totalQueue: Math.max(0, (count ?? data?.length ?? 0) - hiddenAutomaticParks),
    scannedQueue: queueTickets.length,
    truncated: (count ?? 0) > MAX_QUEUE_SCAN,
    settings: validated.value,
    ...selection,
  };

  console.info('[autopilot-batch-preview]', {
    brand_id: session.brandId,
    total_queue: preview.totalQueue,
    scanned_queue: preview.scannedQueue,
    eligible: preview.eligible.length,
    excluded_counts: preview.excludedCounts,
    settings: {
      min_confidence_percent: preview.settings.minConfidencePercent,
      max_confidence_percent: preview.settings.maxConfidencePercent,
      max_plans: preview.settings.maxPlans,
      concurrency: preview.settings.concurrency,
      require_calibrated: preview.settings.requireCalibrated,
      include_high_impact: preview.settings.includeHighImpact,
    },
  });

  return NextResponse.json(preview, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
