import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config/env.js';
import { supabase } from '../config/supabase.js';
import { getTicketMessages } from './ticket.service.js';
import { getCustomerByEmail, getCustomerOrders } from './customer-profile.service.js';
import { searchKnowledge } from './knowledge.service.js';
import { loadSupportContext } from './support-context.service.js';
import type { Ticket } from '../types/index.js';

/**
 * Autopilot — the AI action-recommendation pipeline.
 *
 * Every inbound ticket for an enabled brand is analyzed automatically (at email
 * sync, with a periodic sweep as backstop). The planner produces an ACTION PLAN
 * — close-as-non-support, a fully drafted reply grounded in KB/support facts and
 * the customer's live Shopify orders, order cancellation, address change, etc. —
 * each action carrying a confidence score. Plans are stored on the ticket
 * (metadata.autopilot) and surface in the admin's Autopilot review queue, where
 * a human approves before anything executes. Execution happens in the admin
 * (apps/admin .../api/autopilot) using its proven Shopify/email libraries.
 *
 * Brand rollout is config-driven: AUTOPILOT_BRANDS env (comma-separated slugs),
 * default warm-by-design.
 */

const anthropic = new Anthropic({ apiKey: config.anthropic.apiKey });

const PLANNER_MODEL = 'claude-sonnet-4-6';

const ENABLED_BRAND_SLUGS = (process.env.AUTOPILOT_BRANDS || 'warm-by-design')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

export type AutopilotActionType =
  | 'close_not_support'
  | 'send_reply'
  | 'resolve'
  | 'set_priority'
  | 'add_tags'
  | 'cancel_order'
  | 'refund_order'
  | 'update_shipping_address'
  | 'escalate_human';

export interface AutopilotAction {
  id: string;
  type: AutopilotActionType;
  title: string;
  detail: string;
  params: Record<string, unknown>;
  confidence: number;
  status: 'proposed' | 'approved' | 'skipped' | 'executed' | 'failed';
  result?: string | null;
}

export interface AutopilotPlan {
  version: 1;
  status: 'proposed' | 'approved' | 'executing' | 'executed' | 'partially_executed' | 'failed' | 'dismissed';
  trigger: 'new_ticket' | 'customer_reply' | 'sweep' | 'revision';
  proposed_at: string;
  decided_at?: string;
  decided_by?: string;
  executed_at?: string;
  /** Operator feedback that produced this plan (revision flow). */
  operator_instruction?: string;
  revision_count?: number;
  analysis: {
    summary: string;
    reasoning: string;
    overall_confidence: number;
  };
  actions: AutopilotAction[];
}

// ── brand gating ─────────────────────────────────────────────────────────────

let enabledBrandIds: Set<string> | null = null;
let enabledBrandIdsAt = 0;

async function getEnabledBrandIds(): Promise<Set<string>> {
  if (enabledBrandIds && Date.now() - enabledBrandIdsAt < 5 * 60 * 1000) return enabledBrandIds;
  const { data } = await supabase.from('brands').select('id, slug').in('slug', ENABLED_BRAND_SLUGS);
  enabledBrandIds = new Set((data ?? []).map((b) => b.id as string));
  enabledBrandIdsAt = Date.now();
  return enabledBrandIds;
}

export async function isAutopilotBrand(brandId: string | null | undefined): Promise<boolean> {
  if (!brandId) return false;
  return (await getEnabledBrandIds()).has(brandId);
}

// ── entry points ─────────────────────────────────────────────────────────────

/** Build (or rebuild) the action plan for a ticket. Fire-and-forget from intake. */
export async function proposeForTicket(
  ticketId: string,
  trigger: AutopilotPlan['trigger']
): Promise<AutopilotPlan | null> {
  try {
    const { data: ticket } = await supabase.from('tickets').select('*').eq('id', ticketId).single();
    if (!ticket) return null;
    const t = ticket as Ticket;

    if (!(await isAutopilotBrand(t.brand_id))) return null;
    if (t.status === 'closed' || (t.status === 'resolved' && trigger !== 'customer_reply')) return null;

    const meta = (t.metadata as Record<string, unknown>) || {};
    const existing = meta.autopilot as AutopilotPlan | undefined;

    // Don't re-plan on sweeps if a plan already exists in any state; a customer
    // reply invalidates a pending/executed plan and triggers a fresh one.
    if (existing && trigger !== 'customer_reply') return null;

    const plan = t.classification && t.classification !== 'customer_support'
      ? buildNonSupportPlan(t, trigger)
      : await buildSupportPlan(t, trigger);

    if (!plan) return null;

    await persistPlan(t, plan, existing);
    console.log(
      `[autopilot] Proposed plan for ticket #${t.ticket_number} (${trigger}): ` +
      plan.actions.map((a) => `${a.type}@${a.confidence.toFixed(2)}`).join(', ')
    );
    return plan;
  } catch (err) {
    console.error('[autopilot] proposeForTicket failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

/** Sweep backstop: plan recent tickets that slipped past the event hook. */
export async function proposeForRecentTickets(limit = 6): Promise<number> {
  const brandIds = [...(await getEnabledBrandIds())];
  if (brandIds.length === 0) return 0;

  const since = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString();
  const { data } = await supabase
    .from('tickets')
    .select('id, metadata')
    .in('brand_id', brandIds)
    .in('status', ['open', 'pending'])
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(50);

  const unplanned = (data ?? []).filter((t) => !((t.metadata as Record<string, unknown>) || {}).autopilot);
  let planned = 0;
  for (const t of unplanned.slice(0, limit)) {
    const plan = await proposeForTicket(t.id as string, 'sweep');
    if (plan) planned++;
  }
  return planned;
}

/** A customer reply makes any pending/executed plan stale — rebuild it. */
export async function replanOnCustomerReply(ticketId: string): Promise<void> {
  await proposeForTicket(ticketId, 'customer_reply');
}

/**
 * Operator-guided revision: the reviewer typed an instruction — extra context
 * only they know ("the replacement ships Friday"), a correction, or a change
 * request ("shorter, and offer a refund instead"). Re-run the planner with the
 * previous plan and the instruction front and center.
 */
export async function reviseTicketPlan(ticketId: string, instruction: string): Promise<AutopilotPlan | null> {
  const { data: ticket } = await supabase.from('tickets').select('*').eq('id', ticketId).single();
  if (!ticket) return null;
  const t = ticket as Ticket;
  if (!(await isAutopilotBrand(t.brand_id))) return null;

  const meta = (t.metadata as Record<string, unknown>) || {};
  const previous = meta.autopilot as AutopilotPlan | undefined;
  if (!previous || previous.status !== 'proposed') return null;

  const plan = await buildSupportPlan(t, 'revision', { previousPlan: previous, instruction });
  if (!plan) return null;

  plan.operator_instruction = instruction;
  plan.revision_count = (previous.revision_count ?? 0) + 1;

  await persistPlan(t, plan, previous);
  console.log(`[autopilot] Revised plan for ticket #${t.ticket_number} (rev ${plan.revision_count}): ${plan.actions.map((a) => a.type).join(', ')}`);
  return plan;
}

// ── plan builders ────────────────────────────────────────────────────────────

function buildNonSupportPlan(t: Ticket, trigger: AutopilotPlan['trigger']): AutopilotPlan {
  const cls = t.classification ?? 'non-support';
  const confidence = typeof t.classification_confidence === 'number' ? t.classification_confidence : 0.7;
  return {
    version: 1,
    status: 'proposed',
    trigger,
    proposed_at: new Date().toISOString(),
    analysis: {
      summary: `Classified as ${cls.replace(/_/g, ' ')} — not a customer support request.`,
      reasoning: `The email classifier labeled this "${cls}" (confidence ${(confidence * 100).toFixed(0)}%). No reply is needed; closing keeps the queue clean. Nothing is sent to the sender.`,
      overall_confidence: confidence,
    },
    actions: [
      {
        id: 'a1',
        type: 'close_not_support',
        title: `Close as ${cls.replace(/_/g, ' ')}`,
        detail: 'Mark the ticket closed without replying. The sender receives nothing.',
        params: { classification: cls },
        confidence,
        status: 'proposed',
      },
    ],
  };
}

interface PlannerContext {
  threadText: string;
  customerBlock: string;
  ordersBlock: string;
  orders: Array<{ id: string; name: string; financialStatus: string; fulfillmentStatus: string; totalPrice: string }>;
  kbBlock: string;
  supportContext: string;
}

async function gatherContext(t: Ticket): Promise<PlannerContext> {
  const messages = await getTicketMessages(t.id);
  const threadText = messages
    .filter((m) => !m.is_internal_note)
    .map((m) => `[${m.sender_type === 'customer' ? 'Customer' : m.sender_type === 'agent' ? 'Agent' : 'System'}] ${m.content}`)
    .join('\n\n')
    .slice(-6000);

  let customerBlock = 'No Shopify customer profile found for this email.';
  let ordersBlock = 'No orders found for this customer.';
  let orders: PlannerContext['orders'] = [];
  if (t.customer_email) {
    try {
      const profile = await getCustomerByEmail(t.customer_email, t.brand_id);
      if (profile) {
        customerBlock = `Name: ${profile.firstName ?? ''} ${profile.lastName ?? ''} | Orders: ${profile.ordersCount} | Lifetime spent: ${profile.totalSpent} | Customer since: ${profile.createdAt.slice(0, 10)} | Tags: ${profile.tags.join(', ') || 'none'}`;
      }
      const orderList = await getCustomerOrders(t.customer_email, 5, t.brand_id);
      if (orderList.length > 0) {
        orders = orderList.map((o) => ({
          id: o.id,
          name: o.name,
          financialStatus: o.financialStatus,
          fulfillmentStatus: o.fulfillmentStatus,
          totalPrice: o.totalPrice,
        }));
        ordersBlock = orderList
          .map(
            (o) =>
              `- ${o.name} (order_id: ${o.id}) | ${o.totalPrice} | payment: ${o.financialStatus} | fulfillment: ${o.fulfillmentStatus} | placed ${o.createdAt.slice(0, 10)} | items: ${o.lineItems.map((li) => `${li.title} x${li.quantity}`).join(', ')}${o.tracking.length ? ` | tracking: ${o.tracking.map((tr) => tr.number).join(', ')}` : ''}`
          )
          .join('\n');
      }
    } catch (err) {
      console.warn('[autopilot] Shopify context unavailable:', err instanceof Error ? err.message : err);
    }
  }

  let kbBlock = '';
  try {
    const docs = await searchKnowledge(`${t.subject} ${threadText.slice(0, 300)}`, t.brand_id);
    kbBlock = docs
      .slice(0, 3)
      .map((d) => `### ${d.title}\n${d.content.slice(0, 1200)}`)
      .join('\n\n');
  } catch { /* KB optional */ }

  const supportContext = await loadSupportContext(t.brand_id, `${t.subject}\n${threadText}`).catch(() => '');

  return { threadText, customerBlock, ordersBlock, orders, kbBlock, supportContext };
}

const PLAN_TOOL: Anthropic.Tool = {
  name: 'propose_action_plan',
  description: 'Propose the action plan for this support ticket.',
  input_schema: {
    type: 'object' as const,
    required: ['summary', 'reasoning', 'overall_confidence', 'actions'],
    properties: {
      summary: { type: 'string', description: 'What the customer needs, 1-2 sentences.' },
      reasoning: { type: 'string', description: 'Why these actions, 1-3 sentences, written for the human reviewer.' },
      overall_confidence: { type: 'number', description: '0-1 calibrated confidence in the whole plan.' },
      actions: {
        type: 'array',
        items: {
          type: 'object',
          required: ['type', 'title', 'detail', 'confidence', 'params'],
          properties: {
            type: {
              type: 'string',
              enum: ['send_reply', 'resolve', 'set_priority', 'add_tags', 'cancel_order', 'refund_order', 'update_shipping_address', 'escalate_human', 'close_not_support'],
            },
            title: { type: 'string', description: 'Short imperative card title, e.g. "Reply: confirm cancellation".' },
            detail: { type: 'string', description: 'One or two sentences telling the reviewer exactly what will happen.' },
            confidence: { type: 'number', description: '0-1 calibrated confidence for this specific action.' },
            params: {
              type: 'object',
              description:
                'Machine parameters. send_reply: {reply_text}. set_priority: {priority}. add_tags: {tags: string[]}. cancel_order: {order_id, order_name, reason}. refund_order: {order_id, order_name, amount}. update_shipping_address: {order_id, order_name, address: {name, address1, address2, city, province, zip, country, phone}}. escalate_human: {reason}. resolve/close_not_support: {}.',
            },
          },
        },
      },
    },
  },
};

async function buildSupportPlan(
  t: Ticket,
  trigger: AutopilotPlan['trigger'],
  revision?: { previousPlan: AutopilotPlan; instruction: string }
): Promise<AutopilotPlan | null> {
  const ctx = await gatherContext(t);

  const system = `You are the Autopilot planner for Warm by Design customer support (a Shopify home-lighting brand). You analyze one support ticket and propose a concrete action plan that a HUMAN OPERATOR will review and approve before anything runs. Your job: be genuinely useful, precise, and calibrated.

## Locked brand rules and support facts
${ctx.supportContext || '(none loaded)'}

## Knowledge base excerpts (may be relevant)
${ctx.kbBlock || '(no matching articles)'}

## Shopify customer
${ctx.customerBlock}

## Customer's recent orders (THE ONLY ORDERS THAT EXIST — never invent others)
${ctx.ordersBlock}

## Action rules — follow exactly
- send_reply: write the COMPLETE customer-facing reply in params.reply_text. CONCISE IS MANDATORY: answer exactly what the customer asked and stop — typically a greeting, 1-3 short paragraphs (2-4 sentences total for simple matters), and the sign-off. No unsolicited options, no unasked-for information, no padding, no repeated apologies (one brief sincere apology at most when we're at fault). Never volunteer cancellation, refunds, or alternatives the customer didn't ask about. Match tone to context: warmer for upset customers, brisk and helpful for simple questions — sincere and professional always. Plain text only — no markdown, no bullet asterisks, no [text](url) links, never include any email address. Ground every claim in the thread, orders, KB, or locked rules above; if the customer's order is not in the list, say you could not locate it and ask for details — never guess. Sign off exactly:\n\nBest Regards,\nWarm by Design Customer Support Team
- resolve: include ONLY together with a send_reply that fully answers the request (nothing left to do after the reply).
- cancel_order: ONLY if the customer explicitly asked to cancel AND the order is in the list AND its fulfillment is UNFULFILLED. Use the exact order_id from the list. params.reason is always "CUSTOMER". Cancelling auto-refunds and restocks.
- refund_order: ONLY if the customer explicitly asked for a refund (without return) AND payment status is PAID or PARTIALLY_PAID. amount must not exceed the order total.
- update_shipping_address: ONLY if the customer provided a complete new address in the thread AND the order is UNFULFILLED. Copy the address fields exactly as the customer wrote them.
- set_priority / add_tags: housekeeping when clearly warranted (e.g. priority "urgent" for an angry customer with money at risk; tags like "shipping-delay").
- escalate_human: when the situation is sensitive, ambiguous, legal/chargeback-related, or you are below 0.6 confidence — explain why in params.reason and detail. Prefer this over guessing.
- close_not_support: only if this is clearly not a customer support request.

## Confidence calibration
Confidence = the probability the action is exactly right as specified. Be honest: 0.95+ only for trivially clear cases; uncertainty about identity, order matching, or intent should push you toward escalate_human. A reply that answers a clear question with documented facts: 0.85-0.95. Shopify mutations (cancel/refund/address): only when explicitly requested and verifiable, typically 0.7-0.9.

Order actions matter: put send_reply LAST so the reply can reference completed actions (e.g. cancel_order then a reply confirming the cancellation).`;

  const revisionBlock = revision
    ? `

## OPERATOR INSTRUCTION — HIGHEST PRIORITY
The human reviewer looked at your previous plan and gave you this instruction. It overrides everything except the safety rules above. Treat any facts the operator states as true and incorporate them; apply any change requests exactly.

Operator says: "${revision.instruction.slice(0, 1500)}"

## Your previous plan (being revised)
${JSON.stringify({ analysis: revision.previousPlan.analysis, actions: revision.previousPlan.actions.map((a) => ({ type: a.type, title: a.title, detail: a.detail, confidence: a.confidence, params: a.type === 'send_reply' ? { reply_text: String(a.params.reply_text ?? '').slice(0, 1500) } : a.params })) }, null, 1).slice(0, 5000)}

Produce the FULL revised plan (all actions, not a diff). Keep what the operator didn't ask to change. If the operator supplied facts that resolve your earlier uncertainty, raise confidence accordingly.`
    : '';

  const userMsg = `Ticket #${t.ticket_number} — "${t.subject}" (priority: ${t.priority}, status: ${t.status}, source: ${t.source})

## Conversation thread
${ctx.threadText || '(no messages)'}${revisionBlock}

Propose the action plan.`;

  const response = await anthropic.messages.create({
    model: PLANNER_MODEL,
    max_tokens: 2500,
    temperature: 0.2,
    system,
    messages: [{ role: 'user', content: userMsg }],
    tools: [PLAN_TOOL],
    tool_choice: { type: 'tool', name: 'propose_action_plan' },
  });

  const toolUse = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
  if (!toolUse) return null;

  const raw = toolUse.input as {
    summary?: string;
    reasoning?: string;
    overall_confidence?: number;
    actions?: Array<{ type?: string; title?: string; detail?: string; confidence?: number; params?: Record<string, unknown> }>;
  };

  const actions = validateActions(raw.actions ?? [], ctx);
  if (actions.length === 0) return null;

  return {
    version: 1,
    status: 'proposed',
    trigger,
    proposed_at: new Date().toISOString(),
    analysis: {
      summary: (raw.summary || '').slice(0, 400),
      reasoning: (raw.reasoning || '').slice(0, 700),
      overall_confidence: clamp01(raw.overall_confidence ?? 0.5),
    },
    actions,
  };
}

// ── deterministic validators ─────────────────────────────────────────────────
// The planner is good but not trusted: every Shopify mutation is checked against
// the gathered context. Invalid proposals degrade to an escalate_human card that
// explains what failed, so the reviewer still sees the intent.

const VALID_TYPES: AutopilotActionType[] = [
  'close_not_support', 'send_reply', 'resolve', 'set_priority', 'add_tags',
  'cancel_order', 'refund_order', 'update_shipping_address', 'escalate_human',
];

function validateActions(
  raw: Array<{ type?: string; title?: string; detail?: string; confidence?: number; params?: Record<string, unknown> }>,
  ctx: PlannerContext
): AutopilotAction[] {
  const out: AutopilotAction[] = [];

  for (const a of raw.slice(0, 6)) {
    if (!a.type || !VALID_TYPES.includes(a.type as AutopilotActionType)) continue;
    const action: AutopilotAction = {
      id: `a${out.length + 1}`,
      type: a.type as AutopilotActionType,
      title: (a.title || a.type).slice(0, 120),
      detail: (a.detail || '').slice(0, 500),
      params: a.params ?? {},
      confidence: clamp01(a.confidence ?? 0.5),
      status: 'proposed',
    };

    const invalid = validateOne(action, ctx);
    if (invalid) {
      out.push({
        ...action,
        type: 'escalate_human',
        title: `Needs human: ${action.title}`.slice(0, 120),
        detail: `Autopilot proposed "${action.type}" but validation failed: ${invalid}. Review manually.`,
        params: { reason: invalid, original_type: action.type, original_params: action.params },
        confidence: Math.min(action.confidence, 0.5),
      });
      continue;
    }
    out.push(action);
  }

  // Dedup: at most one reply, one resolve
  const seen = new Set<string>();
  return out.filter((a) => {
    if (a.type === 'send_reply' || a.type === 'resolve') {
      if (seen.has(a.type)) return false;
      seen.add(a.type);
    }
    return true;
  });
}

function validateOne(a: AutopilotAction, ctx: PlannerContext): string | null {
  const orderById = new Map(ctx.orders.map((o) => [o.id, o]));

  switch (a.type) {
    case 'send_reply': {
      let text = String(a.params.reply_text ?? '').trim();
      if (!text) return 'empty reply text';
      // Enforce plain text: strip markdown links and stray email addresses.
      text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$1');
      text = text.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, 'our support team');
      a.params.reply_text = text;
      return null;
    }
    case 'set_priority':
      return ['low', 'medium', 'high', 'urgent'].includes(String(a.params.priority)) ? null : 'invalid priority';
    case 'add_tags':
      return Array.isArray(a.params.tags) && a.params.tags.length > 0 ? null : 'no tags given';
    case 'cancel_order': {
      const o = orderById.get(String(a.params.order_id));
      if (!o) return 'order_id not in the customer\'s order list';
      if (!String(o.fulfillmentStatus).toUpperCase().startsWith('UNFULFILLED')) return `order ${o.name} is ${o.fulfillmentStatus}, not UNFULFILLED`;
      a.params.order_name = o.name;
      return null;
    }
    case 'refund_order': {
      const o = orderById.get(String(a.params.order_id));
      if (!o) return 'order_id not in the customer\'s order list';
      if (!['PAID', 'PARTIALLY_PAID', 'PARTIALLY_REFUNDED'].includes(String(o.financialStatus).toUpperCase())) {
        return `order ${o.name} payment status is ${o.financialStatus}`;
      }
      const amount = Number(a.params.amount);
      const total = Number.parseFloat(String(o.totalPrice));
      if (!Number.isFinite(amount) || amount <= 0) return 'invalid refund amount';
      if (Number.isFinite(total) && amount > total + 0.01) return `refund ${amount} exceeds order total ${o.totalPrice}`;
      a.params.order_name = o.name;
      return null;
    }
    case 'update_shipping_address': {
      const o = orderById.get(String(a.params.order_id));
      if (!o) return 'order_id not in the customer\'s order list';
      if (!String(o.fulfillmentStatus).toUpperCase().startsWith('UNFULFILLED')) return `order ${o.name} is ${o.fulfillmentStatus}, not UNFULFILLED`;
      const addr = (a.params.address ?? {}) as Record<string, unknown>;
      for (const field of ['address1', 'city', 'country']) {
        if (!String(addr[field] ?? '').trim()) return `address is missing ${field}`;
      }
      a.params.order_name = o.name;
      return null;
    }
    default:
      return null;
  }
}

function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.5;
}

// ── persistence ──────────────────────────────────────────────────────────────

async function persistPlan(t: Ticket, plan: AutopilotPlan, previous?: AutopilotPlan): Promise<void> {
  // Fresh read to minimize clobbering concurrent metadata writers (triage).
  const { data: fresh } = await supabase.from('tickets').select('metadata').eq('id', t.id).single();
  const meta = { ...(((fresh?.metadata as Record<string, unknown>) ?? {}) || {}) };

  if (previous) {
    const history = Array.isArray(meta.autopilot_history) ? (meta.autopilot_history as unknown[]) : [];
    meta.autopilot_history = [...history.slice(-2), previous];
  }
  meta.autopilot = plan;

  await supabase
    .from('tickets')
    .update({ metadata: meta, updated_at: new Date().toISOString() })
    .eq('id', t.id);

  await supabase.from('ticket_events').insert({
    ticket_id: t.id,
    event_type: 'autopilot_proposed',
    actor: 'ai',
    new_value: plan.actions.map((a) => a.type).join(','),
    metadata: { trigger: plan.trigger, overall_confidence: plan.analysis.overall_confidence },
  });
}
