import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
}

const ticketNumber = Number(
  process.argv.find((arg) => arg.startsWith('--ticket='))?.slice('--ticket='.length),
);
const reason = process.argv
  .find((arg) => arg.startsWith('--reason='))
  ?.slice('--reason='.length)
  .trim() || 'terminal_execution_recovery';
const brandSlug = process.argv
  .find((arg) => arg.startsWith('--brand='))
  ?.slice('--brand='.length)
  .trim()
  .toLowerCase() || 'warm-by-design';
const customerReplyReplan = process.argv.includes('--customer-reply');

if (!Number.isInteger(ticketNumber) || ticketNumber <= 0) {
  throw new Error('--ticket=3102 is required');
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data: brand, error: brandError } = await supabase
  .from('brands')
  .select('id, slug')
  .eq('slug', brandSlug)
  .eq('enabled', true)
  .single();
if (brandError || !brand) {
  throw new Error(`Enabled brand ${brandSlug} was not found`);
}

const { data: ticket, error: ticketError } = await supabase
  .from('tickets')
  .select('id, brand_id, ticket_number, context_version, metadata')
  .eq('brand_id', brand.id)
  .eq('ticket_number', ticketNumber)
  .single();
if (ticketError || !ticket) {
  throw new Error(`Ticket #${ticketNumber} was not found for ${brandSlug}`);
}

const previous = ticket.metadata?.autopilot as Record<string, any> | undefined;
if (!previous) throw new Error(`Ticket #${ticketNumber} has no Autopilot plan`);

const { proposeForTicket, refreshTicketPlan } = await import(
  '../apps/backend/src/services/autopilot.service.js'
);
const result = customerReplyReplan
  ? {
      plan: await proposeForTicket(ticket.id, 'customer_reply'),
      refreshed: true,
      reason: 'customer_reply_replan',
    }
  : await refreshTicketPlan(ticket.id, {
      brandId: brand.id,
      recoverTerminal: true,
      reason,
      expected: {
        planId: previous.id,
        revision: previous.revision ?? previous.revision_count ?? 0,
        contextFingerprint: previous.context_fingerprint,
        contextVersion: previous.context_version,
      },
    });
if (!result.plan || !result.refreshed) {
  throw new Error(
    `Recovery for ticket #${ticketNumber} did not persist (${result.reason})`,
  );
}

console.log(JSON.stringify({
  ticket_number: ticketNumber,
  plan_id: result.plan.id,
  revision: result.plan.revision,
  status: result.plan.status,
  prompt_version: result.plan.prompt_version,
  model: result.plan.model,
  overall_confidence: result.plan.analysis.overall_confidence,
  actions: result.plan.actions.map((action) => ({
    id: action.id,
    type: action.type,
    title: action.title,
    confidence: action.confidence,
    order_name: action.params.order_name,
    depends_on: action.depends_on,
  })),
}, null, 2));
