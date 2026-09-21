import { createClient } from '@supabase/supabase-js';
import {
  DEFAULT_AUTOPILOT_BATCH_SETTINGS,
  selectAutopilotBatch,
} from '../apps/admin/src/lib/autopilot-batch-policy.js';
import { autopilotPlanFingerprint } from '../apps/admin/src/lib/autopilot-plan-fingerprint.js';
import type { Ticket } from '../apps/admin/src/lib/types.js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');

function numericArg(name: string, fallback: number): number {
  const prefix = `--${name}=`;
  const raw = process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

const brandSlug = process.argv.find((arg) => arg.startsWith('--brand='))?.slice('--brand='.length)
  ?? 'warm-by-design';
const minConfidencePercent = numericArg('min', 85);
const maxConfidencePercent = numericArg('max', 100);
const includeHighImpact = process.argv.includes('--include-high-impact');
const requireCalibrated = process.argv.includes('--require-calibrated');
const maxPlans = Math.min(50, numericArg('max-plans', 50));

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data: brand, error: brandError } = await supabase
  .from('brands')
  .select('id, slug')
  .eq('slug', brandSlug)
  .single();
if (brandError || !brand) throw new Error(`brand: ${brandError?.message ?? 'not found'}`);

const { data, error } = await supabase
  .from('tickets')
  .select('*')
  .eq('brand_id', brand.id)
  .in('status', ['open', 'pending'])
  .filter('metadata->autopilot->>status', 'in', '(proposed,executing)')
  .order('created_at', { ascending: true })
  .limit(500);
if (error) throw new Error(`tickets: ${error.message}`);

const preview = selectAutopilotBatch({
  tickets: (data ?? []) as Ticket[],
  settings: {
    ...DEFAULT_AUTOPILOT_BATCH_SETTINGS,
    minConfidencePercent,
    maxConfidencePercent,
    maxPlans,
    requireCalibrated,
    includeHighImpact,
  },
  fingerprintPlan: autopilotPlanFingerprint,
});

console.log(JSON.stringify({
  brand: brandSlug,
  range: [minConfidencePercent, maxConfidencePercent],
  include_high_impact: includeHighImpact,
  require_calibrated: requireCalibrated,
  total_queue: data?.length ?? 0,
  eligible: preview.eligible.map((candidate) => ({
    ticket_number: candidate.ticketNumber,
    confidence: candidate.effectiveConfidencePercent,
    action_types: candidate.actionTypes,
  })),
  excluded_counts: preview.excludedCounts,
  excluded: preview.excluded.map((item) => ({
    ticket_number: item.ticketNumber,
    reason: item.reason,
    detail: item.detail,
  })),
}, null, 2));
