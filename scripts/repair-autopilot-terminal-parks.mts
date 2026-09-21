import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');

const allowedSlugs = new Set(
  (process.env.AUTOPILOT_BRANDS || 'warm-by-design')
    .split(',')
    .map((slug) => slug.trim().toLowerCase())
    .filter(Boolean),
);
const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data: brands, error: brandsError } = await supabase
  .from('brands')
  .select('id, slug')
  .in('slug', [...allowedSlugs]);
if (brandsError) throw new Error(brandsError.message);
const brandIds = (brands ?? [])
  .filter((brand) => allowedSlugs.has(String(brand.slug).toLowerCase()))
  .map((brand) => brand.id as string);

const { data: tickets, error: ticketError } = await supabase
  .from('tickets')
  .select('id, brand_id, ticket_number, metadata')
  .in('brand_id', brandIds)
  .in('status', ['open', 'pending'])
  .filter('metadata->autopilot->>status', 'eq', 'proposed')
  .order('ticket_number');
if (ticketError) throw new Error(ticketError.message);

const candidates = (tickets ?? []).filter((ticket) => (
  ticket.metadata?.autopilot?.prompt_version === 'response-state-park-v1'
));
const { refreshTicketPlan } = await import(
  '../apps/backend/src/services/autopilot.service.js'
);
const results: Array<Record<string, unknown>> = [];
let cursor = 0;
await Promise.all(Array.from({ length: Math.min(4, candidates.length) }, async () => {
  while (cursor < candidates.length) {
    const ticket = candidates[cursor++];
    const previous = ticket.metadata?.autopilot as Record<string, any>;
    const result = await refreshTicketPlan(ticket.id, {
      brandId: ticket.brand_id,
      expected: {
        planId: previous.id,
        revision: previous.revision ?? previous.revision_count ?? 0,
        contextFingerprint: previous.context_fingerprint,
        contextVersion: previous.context_version,
      },
      reason: 'automatic_terminal_awaiting_customer_upgrade',
    });
    results.push({
      ticket_number: ticket.ticket_number,
      refreshed: result.refreshed,
      reason: result.reason,
      status: result.plan?.status,
      prompt_version: result.plan?.prompt_version,
    });
  }
}));

console.log(JSON.stringify({
  candidates: candidates.length,
  terminalized: results.filter((result) => (
    result.status === 'proposed'
    && result.prompt_version === 'response-state-auto-park-v2'
  )).length,
  results,
}, null, 2));
