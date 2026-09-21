import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
}

const brandSlug = process.argv
  .find((arg) => arg.startsWith('--brand='))
  ?.slice('--brand='.length)
  .trim()
  .toLowerCase() || 'warm-by-design';
const ticketNumbers = [
  ...(process.env.AUDIT_TICKETS || '').split(','),
  ...process.argv
    .filter((arg) => arg.startsWith('--ticket='))
    .map((arg) => arg.slice('--ticket='.length)),
]
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isInteger(value) && value > 0);

if (ticketNumbers.length === 0) {
  throw new Error('AUDIT_TICKETS=3001,3161 or repeated --ticket arguments are required');
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data: brand, error: brandError } = await supabase
  .from('brands')
  .select('id')
  .eq('slug', brandSlug)
  .single();
if (brandError || !brand) {
  throw new Error(`Brand ${brandSlug} was not found`);
}

const { data: tickets, error: ticketsError } = await supabase
  .from('tickets')
  .select('ticket_number, status, metadata')
  .eq('brand_id', brand.id)
  .in('ticket_number', ticketNumbers)
  .order('ticket_number');
if (ticketsError) throw ticketsError;

const highImpactTypes = new Set([
  'cancel_order',
  'refund_order',
  'update_shipping_address',
]);

for (const ticket of tickets || []) {
  const plan = ticket.metadata?.autopilot as Record<string, any> | undefined;
  const highImpactActions = (plan?.actions || [])
    .filter((action: Record<string, any>) => highImpactTypes.has(action.type))
    .map((action: Record<string, any>) => ({
      type: action.type,
      order: action.params?.order_name || action.params?.order_id,
      binding: action.params?.order_identity_binding,
      has_evidence_hash: Boolean(action.params?.evidence_order_hash),
    }));
  console.log(JSON.stringify({
    ticket_number: ticket.ticket_number,
    ticket_status: ticket.status,
    plan_status: plan?.status,
    revision: plan?.revision,
    overall_confidence: plan?.analysis?.overall_confidence,
    high_impact_actions: highImpactActions,
  }));
}
