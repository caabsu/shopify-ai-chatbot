import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');

const ticketNumber = Number(
  process.argv.find((arg) => arg.startsWith('--ticket='))?.slice('--ticket='.length),
);
const instruction = process.argv
  .find((arg) => arg.startsWith('--instruction='))
  ?.slice('--instruction='.length)
  .trim();
if (!Number.isInteger(ticketNumber) || ticketNumber <= 0) {
  throw new Error('--ticket=3226 is required');
}
if (!instruction) throw new Error('--instruction="..." is required');

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

const { reviseTicketPlan } = await import(
  '../apps/backend/src/services/autopilot.service.js'
);
let revised: Awaited<ReturnType<typeof reviseTicketPlan>> = null;
for (let attempt = 1; attempt <= 5 && !revised; attempt += 1) {
  const { data: ticket, error: ticketError } = await supabase
    .from('tickets')
    .select('id, brand_id, ticket_number, context_version, metadata')
    .eq('ticket_number', ticketNumber)
    .in('brand_id', brandIds)
    .single();
  if (ticketError || !ticket) {
    throw new Error(`Ticket #${ticketNumber} was not found in an enabled Autopilot brand`);
  }
  const previous = ticket.metadata?.autopilot as Record<string, any> | undefined;
  if (!previous || previous.status !== 'proposed') {
    throw new Error(`Ticket #${ticketNumber} has no proposed plan to revise`);
  }
  revised = await reviseTicketPlan(ticket.id, instruction, {
    brandId: ticket.brand_id,
    expectedPlanId: previous.id,
    expectedRevision: previous.revision ?? previous.revision_count ?? 0,
    contextFingerprint: previous.context_fingerprint,
    contextVersion: ticket.context_version,
    actorName: 'Autopilot maintenance',
  });
  if (!revised) {
    console.warn(`Revision CAS lost for ticket #${ticketNumber}; retrying (${attempt}/5)`);
  }
}
if (!revised) throw new Error(`Revision for ticket #${ticketNumber} did not persist`);

console.log(JSON.stringify({
  ticket_number: ticketNumber,
  plan_id: revised.id,
  revision: revised.revision,
  prompt_version: revised.prompt_version,
  overall_confidence: revised.analysis.overall_confidence,
  actions: revised.actions.map((action) => ({
    type: action.type,
    title: action.title,
    confidence: action.confidence,
    order_name: action.params.order_name,
    depends_on: action.depends_on,
  })),
}, null, 2));
