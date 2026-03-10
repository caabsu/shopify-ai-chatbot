import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config/env.js';
import { supabase } from '../config/supabase.js';
import * as ticketService from './ticket.service.js';
import * as customerProfileService from './customer-profile.service.js';

const anthropic = new Anthropic({ apiKey: config.anthropic.apiKey });

const AI_MODEL = 'claude-sonnet-4-20250514';

async function loadBrandVoice(): Promise<string> {
  const { data: row } = await supabase
    .from('ai_config')
    .select('value')
    .eq('key', 'brand_voice')
    .single();

  return row?.value ?? 'Friendly and helpful. Speak like a knowledgeable store associate.';
}

async function loadTicketContext(ticketId: string): Promise<{
  ticket: NonNullable<Awaited<ReturnType<typeof ticketService.getTicket>>>;
  messages: Awaited<ReturnType<typeof ticketService.getTicketMessages>>;
  customerProfile: Awaited<ReturnType<typeof customerProfileService.getCustomerByEmail>> | null;
}> {
  const ticket = await ticketService.getTicket(ticketId);
  if (!ticket) {
    throw new Error(`Ticket not found: ${ticketId}`);
  }

  const messages = await ticketService.getTicketMessages(ticketId);

  let customerProfile = null;
  if (ticket.customer_email) {
    try {
      customerProfile = await customerProfileService.getCustomerByEmail(ticket.customer_email);
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

// ── Draft Reply ────────────────────────────────────────────────────────────
export async function draftReply(ticketId: string): Promise<string> {
  const { ticket, messages, customerProfile } = await loadTicketContext(ticketId);
  const brandVoice = await loadBrandVoice();
  const threadText = buildThreadText(messages);

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

Write a professional, empathetic reply that addresses the customer's concern. Be concise but thorough. Do not include any preamble or meta-commentary — just the reply text that would be sent to the customer.`;

  try {
    const response = await anthropic.messages.create({
      model: AI_MODEL,
      max_tokens: 1024,
      temperature: 0.7,
      system: systemPrompt,
      messages: [
        { role: 'user', content: `Here is the conversation thread so far:\n\n${threadText}\n\nPlease draft a reply to the customer.` },
      ],
    });

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');

    console.log(`[ai-assistant.service] Generated draft reply for ticket #${ticket.ticket_number}`);
    return text || 'Unable to generate a draft reply.';
  } catch (err) {
    console.error('[ai-assistant.service] draftReply error:', err instanceof Error ? err.message : err);
    throw new Error('Failed to generate AI draft reply');
  }
}

// ── Summarize Thread ───────────────────────────────────────────────────────
export async function summarizeThread(ticketId: string): Promise<string> {
  const { ticket, messages } = await loadTicketContext(ticketId);
  const threadText = buildThreadText(messages);

  if (messages.length === 0) {
    return 'No messages in this ticket yet.';
  }

  const systemPrompt = `You are a support team assistant. Summarize the following support ticket conversation in 2-3 concise sentences. Focus on: what the customer wants, what has been done so far, and what remains unresolved.`;

  try {
    const response = await anthropic.messages.create({
      model: AI_MODEL,
      max_tokens: 256,
      temperature: 0.3,
      system: systemPrompt,
      messages: [
        { role: 'user', content: `Ticket #${ticket.ticket_number} — "${ticket.subject}" (${ticket.status}, ${ticket.priority} priority)\n\n${threadText}` },
      ],
    });

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');

    console.log(`[ai-assistant.service] Generated summary for ticket #${ticket.ticket_number}`);
    return text || 'Unable to generate a summary.';
  } catch (err) {
    console.error('[ai-assistant.service] summarizeThread error:', err instanceof Error ? err.message : err);
    throw new Error('Failed to generate AI summary');
  }
}

// ── Suggest Next Steps ─────────────────────────────────────────────────────
export async function suggestNextSteps(ticketId: string): Promise<string[]> {
  const { ticket, messages, customerProfile } = await loadTicketContext(ticketId);
  const brandVoice = await loadBrandVoice();
  const threadText = buildThreadText(messages);

  let customerContext = '';
  if (customerProfile) {
    customerContext = `\nCustomer has ${customerProfile.ordersCount} orders, total spent: ${customerProfile.totalSpent}. Tags: ${customerProfile.tags.join(', ') || 'none'}.`;
  }

  const systemPrompt = `You are a support team assistant. Based on the ticket conversation, suggest 3-5 actionable next steps the agent should take. Be specific and practical.${customerContext}

Respond with ONLY a JSON array of strings, like: ["Step 1", "Step 2", "Step 3"]. No other text.`;

  try {
    const response = await anthropic.messages.create({
      model: AI_MODEL,
      max_tokens: 512,
      temperature: 0.5,
      system: systemPrompt,
      messages: [
        { role: 'user', content: `Ticket #${ticket.ticket_number} — "${ticket.subject}" (${ticket.status}, ${ticket.priority} priority)\n\n${threadText}` },
      ],
    });

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');

    try {
      const steps = JSON.parse(text) as string[];
      if (Array.isArray(steps)) {
        console.log(`[ai-assistant.service] Generated ${steps.length} next steps for ticket #${ticket.ticket_number}`);
        return steps;
      }
    } catch {
      // If JSON parsing fails, try to extract lines
      const lines = text.split('\n').filter((l) => l.trim().length > 0).map((l) => l.replace(/^\d+\.\s*/, '').trim());
      if (lines.length > 0) return lines;
    }

    return ['Review the customer conversation for any missed details', 'Follow up with the customer for more information', 'Escalate if needed'];
  } catch (err) {
    console.error('[ai-assistant.service] suggestNextSteps error:', err instanceof Error ? err.message : err);
    throw new Error('Failed to generate AI suggestions');
  }
}
