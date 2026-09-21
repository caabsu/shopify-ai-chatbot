import { createClient } from '@supabase/supabase-js';
import { lookupOrder } from '../apps/backend/src/services/shopify-admin.service.js';
import { loadCustomerSupportContext } from '../apps/backend/src/services/customer-support-context.service.js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');

const requested = process.argv
  .find((arg) => arg.startsWith('--tickets='))
  ?.slice('--tickets='.length)
  .split(',')
  .map((value) => Number(value.trim()))
  .filter(Number.isInteger) ?? [];
const fallbackMode = process.argv.includes('--fallbacks');
const queueMode = process.argv.includes('--queue');
const allOpenMode = process.argv.includes('--all-open');
const requestedBrand = process.argv
  .find((arg) => arg.startsWith('--brand='))
  ?.slice('--brand='.length)
  .trim()
  .toLowerCase();
if (requested.length === 0 && !fallbackMode && !queueMode && !allOpenMode) {
  throw new Error('--tickets=3102,3128, --fallbacks, --queue, or --all-open is required');
}
const includeMessages = process.argv.includes('--include-messages');
const includeLiveOrders = process.argv.includes('--live-orders');
const includePlanLedgers = process.argv.includes('--ledgers');
const qualitySummary = process.argv.includes('--quality-summary');
const numbersOnly = process.argv.includes('--numbers-only');

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
let ticketQuery = supabase
  .from('tickets')
  .select('id, brand_id, brands(slug), ticket_number, subject, status, customer_name, customer_email, order_id, context_version, metadata')
  .order('ticket_number');
ticketQuery = fallbackMode
  ? ticketQuery
    .in('status', ['open', 'pending'])
    .eq('metadata->autopilot->>prompt_version', 'deterministic-nonblocking-fallback-v1')
    : queueMode
    ? ticketQuery
      .in('status', ['open', 'pending'])
      .filter('metadata->autopilot->>status', 'in', '(proposed,executing)')
    : allOpenMode
      ? ticketQuery.in('status', ['open', 'pending'])
      : ticketQuery.in('ticket_number', requested);
const { data, error } = await ticketQuery;
if (error) throw new Error(error.message);

const queueTickets = (data ?? []).filter((ticket) => (
  (
    !queueMode
    || !['response-state-park-v1', 'response-state-auto-park-v2'].includes(
      String(ticket.metadata?.autopilot?.prompt_version ?? ''),
    )
  )
  && (
    !requestedBrand
    || String(
      Array.isArray(ticket.brands) ? ticket.brands[0]?.slug : ticket.brands?.slug,
    ).toLowerCase() === requestedBrand
  )
));
if (numbersOnly) {
  console.log(queueTickets.map((ticket) => ticket.ticket_number).join(','));
  process.exit(0);
}
const ticketIds = queueTickets.map((ticket) => ticket.id);
const messagesByTicket = new Map<string, Array<Record<string, unknown>>>();
if ((includeMessages || includeLiveOrders) && ticketIds.length > 0) {
  const { data: messageRows, error: messageError } = await supabase
    .from('ticket_messages')
    .select('ticket_id, sender_type, sender_name, content, is_internal_note, created_at, metadata')
    .in('ticket_id', ticketIds)
    .order('created_at');
  if (messageError) throw new Error(messageError.message);
  for (const message of messageRows ?? []) {
    const messages = messagesByTicket.get(message.ticket_id) ?? [];
    messages.push(message);
    messagesByTicket.set(message.ticket_id, messages);
  }
}

const planIds = queueTickets
  .map((ticket) => ticket.metadata?.autopilot?.id)
  .filter((id): id is string => typeof id === 'string');
const receiptsByPlan = new Map<string, Array<Record<string, unknown>>>();
const ledgersByTicket = new Map<string, Array<Record<string, unknown>>>();
if (includePlanLedgers && ticketIds.length > 0) {
  const { data: ledgerRows, error: ledgerError } = await supabase
    .from('ticket_action_plans')
    .select('id, ticket_id, revision, status, proposed_at, updated_at')
    .in('ticket_id', ticketIds)
    .order('revision', { ascending: false });
  if (ledgerError) throw new Error(ledgerError.message);
  for (const ledger of ledgerRows ?? []) {
    const rows = ledgersByTicket.get(ledger.ticket_id) ?? [];
    rows.push(ledger);
    ledgersByTicket.set(ledger.ticket_id, rows);
  }
}
if (planIds.length > 0) {
  const { data: receiptRows, error: receiptError } = await supabase
    .from('autopilot_action_executions')
    .select('id, plan_id, action_id, action_type, status, result, error, provider_reference, started_at, completed_at, failure_reconcile_after')
    .in('plan_id', planIds)
    .order('started_at');
  if (receiptError) throw new Error(receiptError.message);
  for (const receipt of receiptRows ?? []) {
    const receipts = receiptsByPlan.get(receipt.plan_id) ?? [];
    receipts.push(receipt);
    receiptsByPlan.set(receipt.plan_id, receipts);
  }
}

const liveOrdersByTicket = new Map<string, unknown>();
if (includeLiveOrders) {
  for (const ticket of queueTickets) {
    const plan = ticket.metadata?.autopilot;
    const actionOrderNames = (
      (plan?.actions ?? [])
        .map((action: Record<string, any>) => action.params?.order_name)
        .filter((value: unknown): value is string => typeof value === 'string' && value.trim().length > 0)
    );
    const searchableText = [
      ticket.subject,
      plan?.analysis?.summary,
      ...(messagesByTicket.get(ticket.id) ?? []).map((message) => message.content),
    ].filter((value): value is string => typeof value === 'string').join('\n');
    const textOrderNames = Array.from(searchableText.matchAll(/(?:order\s*)?#(\d{3,})\b/gi))
      .map((match) => `#${match[1]}`);
    const orderNames = Array.from(new Set([...actionOrderNames, ...textOrderNames]));
    const lookups = [];
    for (const orderName of orderNames) {
      lookups.push({
        order_name: orderName,
        result: await lookupOrder(
          orderName,
          ticket.customer_email ?? undefined,
          undefined,
          ticket.brand_id,
          true,
        ),
      });
    }
    liveOrdersByTicket.set(ticket.id, lookups);
  }
}

const customerContextByTicket = new Map<string, Awaited<ReturnType<typeof loadCustomerSupportContext>>>();
if (qualitySummary) {
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(6, queueTickets.length) }, async () => {
    while (cursor < queueTickets.length) {
      const ticket = queueTickets[cursor++];
      if (!ticket.customer_email) continue;
      const context = await loadCustomerSupportContext({
        brandId: ticket.brand_id,
        customerEmail: ticket.customer_email,
        currentTicketId: ticket.id,
      });
      customerContextByTicket.set(ticket.id, context);
    }
  }));
}

if (qualitySummary) {
  console.log(JSON.stringify(queueTickets.map((ticket) => {
    const plan = ticket.metadata?.autopilot ?? {};
    const context = customerContextByTicket.get(ticket.id);
    const currentThread = context?.tickets.find((thread) => thread.id === ticket.id);
    const latestCustomer = [...(currentThread?.messages ?? [])]
      .reverse()
      .find((message) => message.sender_type === 'customer');
    const latestAgent = [...(currentThread?.messages ?? [])]
      .reverse()
      .find((message) => message.sender_type === 'agent');
    const reply = (plan.actions ?? []).find((action: Record<string, any>) => action.type === 'send_reply');
    const sameCaseThreads = (context?.tickets ?? []).filter((thread) => (
      thread.id !== ticket.id
      && (thread.status === 'open' || thread.status === 'pending')
      && !thread.merged_into_ticket_id
      && Boolean(thread.relatedness?.deterministic || Number(thread.relatedness?.score ?? 0) >= 0.74)
    ));
    return {
      ticket_number: ticket.ticket_number,
      subject: ticket.subject,
      customer: ticket.customer_name || ticket.customer_email,
      model: plan.generation?.model ?? 'deterministic/no-model',
      plan_status: plan.status,
      response_state: currentThread?.response_state ?? null,
      customer_thread_count: context?.coverage.ticket_count ?? 0,
      customer_message_count: context?.coverage.ticket_message_count ?? 0,
      history_hash_current: Boolean(
        context?.hash
        && context.hash === plan.evidence?.customer_history?.hash,
      ),
      same_case_open_tickets: sameCaseThreads.map((thread) => thread.ticket_number),
      consolidates_ticket_ids: (plan.actions ?? [])
        .filter((action: Record<string, any>) => action.type === 'consolidate_related_tickets')
        .flatMap((action: Record<string, any>) => action.params?.related_ticket_ids ?? []),
      action_types: (plan.actions ?? []).map((action: Record<string, any>) => action.type),
      latest_customer_message: latestCustomer?.content?.slice(0, 500) ?? null,
      latest_agent_message: latestAgent?.content?.slice(0, 350) ?? null,
      reply_draft: typeof reply?.params?.reply_text === 'string'
        ? reply.params.reply_text.slice(0, 900)
        : null,
    };
  }), null, 2));
} else {
console.log(JSON.stringify(queueTickets.map((ticket) => {
  const plan = ticket.metadata?.autopilot ?? {};
  return {
    ticket_number: ticket.ticket_number,
    brand: Array.isArray(ticket.brands)
      ? ticket.brands[0]?.slug
      : ticket.brands?.slug,
    subject: ticket.subject,
    ticket_status: ticket.status,
    customer_name: ticket.customer_name,
    customer_email: ticket.customer_email,
    order_id: ticket.order_id,
    context_version: ticket.context_version,
    ledgers: includePlanLedgers ? ledgersByTicket.get(ticket.id) ?? [] : undefined,
    live_orders: includeLiveOrders ? liveOrdersByTicket.get(ticket.id) : undefined,
    ...(includeMessages ? {
      messages: (messagesByTicket.get(ticket.id) ?? []).map((message) => ({
        sender_type: message.sender_type,
        sender_name: message.sender_name,
        created_at: message.created_at,
        is_internal_note: message.is_internal_note,
        content: typeof message.content === 'string'
          ? message.content.slice(0, 4_000)
          : message.content,
        email_status: (
          message.metadata
          && typeof message.metadata === 'object'
          && 'email_status' in message.metadata
        )
          ? message.metadata.email_status
          : undefined,
      })),
    } : {}),
    plan: {
      id: plan.id,
      revision: plan.revision,
      status: plan.status,
      proposed_at: plan.proposed_at,
      plan_context_version: plan.context_version,
      planner_version: plan.planner_version,
      prompt_version: plan.prompt_version,
      operator_instruction: plan.operator_instruction,
      revision_count: plan.revision_count,
      model: plan.generation?.model ?? 'deterministic/no-model',
      generation: plan.generation,
      summary: plan.analysis?.summary,
      reasoning: plan.analysis?.reasoning,
      review_reason: plan.analysis?.review_reason,
      validation_error: plan.analysis?.validation_error,
      planner_retry_after: plan.analysis?.planner_retry_after,
      overall_confidence: plan.analysis?.overall_confidence,
      review_only: plan.analysis?.review_only === true,
      actions: (plan.actions ?? []).map((action: Record<string, any>) => ({
        type: action.type,
        title: action.title,
        confidence: action.confidence,
        order_name: action.params?.order_name,
        order_id: action.params?.order_id,
        amount: action.params?.amount,
        address: action.params?.address,
        tags: action.params?.tags,
        priority: action.params?.priority,
        related_ticket_ids: action.params?.related_ticket_ids,
        reply_text: typeof action.params?.reply_text === 'string'
          ? action.params.reply_text.slice(0, 2_000)
          : undefined,
        depends_on: action.depends_on,
      })),
      execution_receipts: receiptsByPlan.get(plan.id) ?? [],
    },
  };
}), null, 2));
}
