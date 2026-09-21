import { supabase } from '../config/supabase.js';
import * as ticketService from './ticket.service.js';
import * as customerProfileService from './customer-profile.service.js';
import { loadSupportContext } from './support-context.service.js';
import { callSupportRequiredTool } from './support-model-tool.service.js';
import { selectAutopilotModel, type AutopilotModelTier } from './autopilot-model-routing.js';
import type { RequiredToolDefinition } from './deepseek-tool-call.service.js';
import { recordSupportGenerationRun } from './ai-generation-ledger.service.js';

const TEXT_TOOL: RequiredToolDefinition = {
  name: 'write_support_text',
  description: 'Return the requested support text.',
  inputSchema: {
    type: 'object',
    required: ['text'],
    properties: { text: { type: 'string' } },
  },
};

const STEPS_TOOL: RequiredToolDefinition = {
  name: 'suggest_support_steps',
  description: 'Return actionable next steps for the support agent.',
  inputSchema: {
    type: 'object',
    required: ['steps'],
    properties: {
      steps: { type: 'array', minItems: 1, maxItems: 5, items: { type: 'string' } },
    },
  },
};

async function loadBrandVoice(brandId?: string): Promise<string> {
  let query = supabase
    .from('ai_config')
    .select('value')
    .eq('key', 'brand_voice');
  if (brandId) query = query.eq('brand_id', brandId);
  const { data: row } = await query.single();

  return row?.value ?? 'Friendly and helpful. Speak like a knowledgeable store associate.';
}

async function loadTicketContext(ticketId: string, brandId?: string): Promise<{
  ticket: NonNullable<Awaited<ReturnType<typeof ticketService.getTicket>>>;
  messages: Awaited<ReturnType<typeof ticketService.getTicketMessages>>;
  customerProfile: Awaited<ReturnType<typeof customerProfileService.getCustomerByEmail>> | null;
}> {
  const ticket = await ticketService.getTicket(ticketId, brandId);
  if (!ticket) {
    throw new Error(`Ticket not found: ${ticketId}`);
  }

  const messages = await ticketService.getTicketMessages(ticketId, brandId);

  let customerProfile = null;
  if (ticket.customer_email) {
    try {
      customerProfile = await customerProfileService.getCustomerByEmail(ticket.customer_email, ticket.brand_id);
    } catch (err) {
      console.warn('[ai-assistant.service] Could not load customer profile:', err instanceof Error ? err.message : err);
    }
  }

  return { ticket, messages, customerProfile };
}

function buildThreadText(messages: Awaited<ReturnType<typeof ticketService.getTicketMessages>>): string {
  return messages
    .filter((m) => !m.is_internal_note)
    .map((m) => {
      const label = m.sender_type === 'customer' ? 'Customer' : m.sender_type === 'agent' ? 'Agent' : 'System';
      const name = m.sender_name ? ` (${m.sender_name})` : '';
      return `[${label}${name}]: ${m.content}`;
    })
    .join('\n\n');
}

function ticketModelTier(
  ticket: NonNullable<Awaited<ReturnType<typeof ticketService.getTicket>>>,
  threadText: string,
): AutopilotModelTier {
  const triage = (ticket.metadata?.ai_triage ?? {}) as Record<string, unknown>;
  return selectAutopilotModel({
    trigger: 'new_ticket',
    subject: ticket.subject,
    currentThreadText: threadText,
    triageIntent: typeof triage.intent === 'string' ? triage.intent : null,
    authorizedCancellationCount: 0,
    authorizedRefundCount: 0,
    authorizedAddressChangeCount: 0,
    relatedTickets: [],
    knownOrderNames: [],
    previousActionTypes: [],
  }).tier;
}

// ── Draft Reply ────────────────────────────────────────────────────────────
export async function draftReply(ticketId: string, brandId?: string): Promise<string> {
  const { ticket, messages, customerProfile } = await loadTicketContext(ticketId, brandId);
  const brandVoice = await loadBrandVoice(brandId ?? ticket.brand_id);
  const threadText = buildThreadText(messages);
  const supportContext = await loadSupportContext(brandId ?? ticket.brand_id, `${ticket.subject}\n\n${threadText}`).catch(() => '');

  let customerContext = '';
  if (customerProfile) {
    customerContext = `\n\nCustomer Profile:
- Name: ${customerProfile.firstName ?? ''} ${customerProfile.lastName ?? ''}
- Email: ${customerProfile.email ?? ticket.customer_email}
- Total Orders: ${customerProfile.ordersCount}
- Total Spent: ${customerProfile.totalSpent}
- Customer Since: ${customerProfile.createdAt}
- Tags: ${customerProfile.tags.join(', ') || 'none'}`;
  }

  const systemPrompt = `You are a customer support agent drafting a reply to a support ticket.

Brand Voice: ${brandVoice}

Ticket Details:
- Ticket #${ticket.ticket_number}
- Subject: ${ticket.subject}
- Priority: ${ticket.priority}
- Category: ${ticket.category ?? 'General'}
- Customer: ${ticket.customer_name ?? ticket.customer_email}${customerContext}
${supportContext}

Write a professional, empathetic reply that addresses the customer's concern. Be concise but thorough. Do not include any preamble or meta-commentary — just the reply text that would be sent to the customer.`;

  try {
    const tier = ticketModelTier(ticket, threadText);
    const response = await callSupportRequiredTool<{ text?: string }>({
      tier,
      max_tokens: 1_024,
      temperature: 0.7,
      system: systemPrompt,
      user: `Here is the conversation thread so far:\n\n${threadText}\n\nPlease draft a reply to the customer.`,
      tool: TEXT_TOOL,
    });
    await recordSupportGenerationRun({
      purpose: 'ticket_manual_draft',
      generation: response.generation,
      brandId: ticket.brand_id,
      ticketId: ticket.id,
      promptVersion: 'ticket-manual-draft-2026-07-v1',
      routerVersion: 'ticket-assistant-router-v1',
      routerDecision: { tier, reason: tier === 'pro' ? 'mutation_or_policy_risk' : 'routine_draft' },
    });
    const text = typeof response.value.text === 'string' ? response.value.text : '';

    console.log(`[ai-assistant.service] Generated draft reply for ticket #${ticket.ticket_number}`);
    return text || 'Unable to generate a draft reply.';
  } catch (err) {
    console.error('[ai-assistant.service] draftReply error:', err instanceof Error ? err.message : err);
    throw new Error('Failed to generate AI draft reply');
  }
}

// ── Summarize Thread ───────────────────────────────────────────────────────
export async function summarizeThread(ticketId: string, brandId?: string): Promise<string> {
  const { ticket, messages } = await loadTicketContext(ticketId, brandId);
  const threadText = buildThreadText(messages);

  if (messages.length === 0) {
    return 'No messages in this ticket yet.';
  }

  const systemPrompt = `You are a support team assistant. Summarize the following support ticket conversation in 2-3 concise sentences. Focus on: what the customer wants, what has been done so far, and what remains unresolved.`;

  try {
    const response = await callSupportRequiredTool<{ text?: string }>({
      tier: 'flash',
      max_tokens: 256,
      temperature: 0.3,
      system: systemPrompt,
      user: `Ticket #${ticket.ticket_number} — "${ticket.subject}" (${ticket.status}, ${ticket.priority} priority)\n\n${threadText}`,
      tool: TEXT_TOOL,
    });
    await recordSupportGenerationRun({
      purpose: 'ticket_summary',
      generation: response.generation,
      brandId: ticket.brand_id,
      ticketId: ticket.id,
      promptVersion: 'ticket-summary-2026-07-v1',
      routerVersion: 'ticket-assistant-router-v1',
      routerDecision: { tier: 'flash', reason: 'conversation_summarization' },
    });
    const text = typeof response.value.text === 'string' ? response.value.text : '';

    console.log(`[ai-assistant.service] Generated summary for ticket #${ticket.ticket_number}`);
    return text || 'Unable to generate a summary.';
  } catch (err) {
    console.error('[ai-assistant.service] summarizeThread error:', err instanceof Error ? err.message : err);
    throw new Error('Failed to generate AI summary');
  }
}

// ── Suggest Next Steps ─────────────────────────────────────────────────────
export async function suggestNextSteps(ticketId: string, brandId?: string): Promise<string[]> {
  const { ticket, messages, customerProfile } = await loadTicketContext(ticketId, brandId);
  const brandVoice = await loadBrandVoice(brandId ?? ticket.brand_id);
  const threadText = buildThreadText(messages);
  const supportContext = await loadSupportContext(brandId ?? ticket.brand_id, `${ticket.subject}\n\n${threadText}`).catch(() => '');

  let customerContext = '';
  if (customerProfile) {
    customerContext = `\nCustomer has ${customerProfile.ordersCount} orders, total spent: ${customerProfile.totalSpent}. Tags: ${customerProfile.tags.join(', ') || 'none'}.`;
  }

  const systemPrompt = `You are a support team assistant. Based on the ticket conversation, suggest 3-5 actionable next steps the agent should take. Be specific and practical.${customerContext}
${supportContext}

Return 3-5 concise steps through the required tool.`;

  try {
    const tier = ticketModelTier(ticket, threadText);
    const response = await callSupportRequiredTool<{ steps?: unknown }>({
      tier,
      max_tokens: 512,
      temperature: 0.5,
      system: systemPrompt,
      user: `Ticket #${ticket.ticket_number} — "${ticket.subject}" (${ticket.status}, ${ticket.priority} priority)\n\n${threadText}`,
      tool: STEPS_TOOL,
    });
    await recordSupportGenerationRun({
      purpose: 'ticket_next_steps',
      generation: response.generation,
      brandId: ticket.brand_id,
      ticketId: ticket.id,
      promptVersion: 'ticket-next-steps-2026-07-v1',
      routerVersion: 'ticket-assistant-router-v1',
      routerDecision: { tier, reason: tier === 'pro' ? 'mutation_or_policy_risk' : 'routine_safe_actions' },
    });
    const steps = Array.isArray(response.value.steps)
      ? response.value.steps.filter((step): step is string => typeof step === 'string').slice(0, 5)
      : [];
    if (steps.length > 0) {
      console.log(`[ai-assistant.service] Generated ${steps.length} next steps for ticket #${ticket.ticket_number}`);
      return steps;
    }

    return ['Review the customer conversation for any missed details', 'Follow up with the customer for more information', 'Escalate if needed'];
  } catch (err) {
    console.error('[ai-assistant.service] suggestNextSteps error:', err instanceof Error ? err.message : err);
    throw new Error('Failed to generate AI suggestions');
  }
}
