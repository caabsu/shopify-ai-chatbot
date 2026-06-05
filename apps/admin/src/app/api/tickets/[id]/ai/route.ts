import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { getCustomerByEmail, getCustomerOrders } from '@/lib/shopify';
import type { CustomerProfile, OrderSummary } from '@/lib/shopify';
import { loadSupportContext } from '@/lib/support-context';

const anthropic = new Anthropic();
const AI_MODEL = 'claude-sonnet-4-6';

function buildOrderContext(orders: OrderSummary[]): string {
  if (orders.length === 0) return 'No orders found for this customer.';

  return orders.map((o) => {
    const items = o.lineItems.map((li) =>
      `${li.title}${li.variantTitle ? ` (${li.variantTitle})` : ''} x${li.quantity}`
    ).join(', ');

    const tracking = o.tracking.length > 0
      ? o.tracking.map((t) => {
        const url = t.url ? `${t.url}${t.url.includes('?') ? '&' : '?'}tracking=${encodeURIComponent(t.number)}` : '';
        return `${t.company || 'Carrier'}: ${t.number}${url ? ` (tracking link: ${url})` : ''}`;
      }).join('; ')
      : 'No tracking available';

    const fulfillmentDetails = o.fulfillments.length > 0
      ? o.fulfillments.map((f) => `Status: ${f.status}, Shipped: ${new Date(f.createdAt).toLocaleDateString()}`).join('; ')
      : 'Not yet fulfilled';

    return `Order ${o.name}:
  - Total: $${parseFloat(o.totalPrice).toFixed(2)}
  - Payment: ${o.financialStatus}
  - Fulfillment: ${o.fulfillmentStatus || 'UNFULFILLED'}
  - Items: ${items}
  - Fulfillment Details: ${fulfillmentDetails}
  - Tracking: ${tracking}
  - Ordered: ${new Date(o.createdAt).toLocaleDateString()}${o.cancelledAt ? `\n  - CANCELLED: ${new Date(o.cancelledAt).toLocaleDateString()}` : ''}`;
  }).join('\n\n');
}

function buildCustomerContext(profile: CustomerProfile | null, email?: string): string {
  if (!profile) return email ? `Customer email: ${email} (no Shopify profile found)` : 'No customer data available.';
  return `Customer: ${profile.firstName || ''} ${profile.lastName || ''} (${profile.email})
  - Phone: ${profile.phone || 'N/A'}
  - Total Orders: ${profile.ordersCount}
  - Lifetime Value: $${parseFloat(profile.totalSpent).toFixed(2)}
  - Customer Since: ${new Date(profile.createdAt).toLocaleDateString()}
  - Account Status: ${profile.state}
  - Tags: ${profile.tags.length > 0 ? profile.tags.join(', ') : 'none'}${profile.note ? `\n  - Internal Note: ${profile.note}` : ''}`;
}

async function loadKnowledgeBase(brandId: string, query?: string): Promise<string> {
  // Always load all KB articles — they're the source of truth for what we can/cannot do
  const { data } = await supabase
    .from('knowledge_documents')
    .select('title, content, category')
    .eq('brand_id', brandId)
    .eq('enabled', true)
    .order('priority', { ascending: false })
    .limit(20);

  if (!data || data.length === 0) return '';

  return '\n\nKNOWLEDGE BASE (this is what you know — do not assume capabilities beyond this):\n' + data.map((d) =>
    `[${d.category}] ${d.title}:\n${d.content}`
  ).join('\n\n---\n\n');
}

async function loadBrandSettings(brandId: string): Promise<Record<string, unknown>> {
  const { data } = await supabase
    .from('brands')
    .select('settings')
    .eq('id', brandId)
    .single();

  return (data?.settings ?? {}) as Record<string, unknown>;
}

function stringSetting(settings: Record<string, unknown>, key: string): string | undefined {
  const value = settings[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function defaultSupportEmailForBrand(brandSlug?: string): string {
  if (brandSlug === 'warm-by-design') return 'support@warmbydesign.com';
  if (brandSlug === 'outlight') return 'support@outlight.us';
  return 'support@yourdomain.com';
}

function getSupportEmail(settings: Record<string, unknown>, brandSlug?: string): string {
  return (
    stringSetting(settings, 'support_email') ||
    stringSetting(settings, 'supportEmail') ||
    stringSetting(settings, 'inbound_email') ||
    stringSetting(settings, 'inboundEmail') ||
    defaultSupportEmailForBrand(brandSlug)
  );
}

// Drafts are sent as plain-text email, so any markdown the model slips in renders
// literally (e.g. "[support@x.com](mailto:support@x.com)"). Strip it back to plain
// text: email links → the bare address, web links → "label (url)", drop mailto:/bold.
function plainifyEmailDraft(s: string): string {
  return s
    .replace(/\[([^\]]+)\]\(\s*mailto:[^)]+\)/gi, '$1')
    .replace(/\[([^\]]+)\]\(\s*(https?:\/\/[^)\s]+)\s*\)/gi, (_m, label, url) =>
      label.trim() === url.trim() ? url : `${label} (${url})`)
    .replace(/\bmailto:/gi, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1');
}

async function loadAiConversation(conversationId: string): Promise<string> {
  const { data } = await supabase
    .from('messages')
    .select('role, content')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });

  if (!data || data.length === 0) return '';

  return '\n\nPRIOR AI CHATBOT CONVERSATION (before escalation to human agent):\n' +
    data.map((m) => {
      const label = m.role === 'user' ? 'Customer' : m.role === 'assistant' ? 'AI Chatbot' : 'System';
      return `[${label}]: ${m.content}`;
    }).join('\n\n');
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const action = body.action as string;
  const agentContext = (body.agentContext as string) || '';

  if (!['draft', 'summarize', 'suggest'].includes(action)) {
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  }

  // Load ticket
  const { data: ticket } = await supabase
    .from('tickets')
    .select('*')
    .eq('id', id)
    .eq('brand_id', session.brandId)
    .single();

  if (!ticket) {
    return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
  }

  // Load ticket messages
  const { data: messages } = await supabase
    .from('ticket_messages')
    .select('*')
    .eq('ticket_id', id)
    .order('created_at', { ascending: true });

  const threadText = (messages ?? [])
    .filter((m: { is_internal_note: boolean }) => !m.is_internal_note)
    .map((m: { sender_type: string; sender_name: string | null; content: string }) => {
      const label = m.sender_type === 'customer' ? 'Customer' : m.sender_type === 'agent' ? 'Agent' : 'System';
      return `[${label}${m.sender_name ? ` (${m.sender_name})` : ''}]: ${m.content}`;
    })
    .join('\n\n');

  // Load AI conversation context if this is an escalation
  let aiConversationText = '';
  if (ticket.conversation_id) {
    aiConversationText = await loadAiConversation(ticket.conversation_id).catch(() => '');
  }

  const brandSettings = await loadBrandSettings(session.brandId).catch(() => ({}));
  const supportEmail = getSupportEmail(brandSettings, session.brandSlug);

  // Fetch Shopify customer data + orders
  let customerProfile: CustomerProfile | null = null;
  let customerOrders: OrderSummary[] = [];

  if (ticket.customer_email) {
    try {
      [customerProfile, customerOrders] = await Promise.all([
        getCustomerByEmail(ticket.customer_email, session.brandSlug).catch((e) => {
          console.error('[tickets/ai] customer lookup failed:', e instanceof Error ? e.message : e);
          return null;
        }),
        getCustomerOrders(ticket.customer_email, 5, session.brandSlug).catch((e) => {
          console.error('[tickets/ai] orders lookup failed:', e instanceof Error ? e.message : e);
          return [];
        }),
      ]);
    } catch {
      // continue without Shopify data
    }
  }

  const customerContext = buildCustomerContext(customerProfile, ticket.customer_email);
  const orderContext = buildOrderContext(customerOrders);

  // Load knowledge base — always load all of it
  const kbContent = await loadKnowledgeBase(session.brandId, ticket.subject).catch(() => '');

  // Combine all conversation context
  const fullConversation = [aiConversationText, threadText].filter(Boolean).join('\n\n---\n\n');
  const productAndPolicyQuery = [
    ticket.subject,
    fullConversation,
    customerOrders.flatMap((order) => order.lineItems.map((item) => item.title)).join(' '),
  ].filter(Boolean).join('\n\n');
  const supportContext = await loadSupportContext(session.brandId, productAndPolicyQuery).catch(() => '');

  try {
    if (action === 'draft') {
      return await handleDraft(ticket, fullConversation, customerContext, orderContext, customerProfile, kbContent, supportContext, agentContext, {
        brandName: session.brandName,
        supportEmail,
      });
    } else if (action === 'summarize') {
      return await handleSummarize(ticket, fullConversation, customerContext, orderContext, supportContext);
    } else {
      return await handleSuggest(ticket, fullConversation, customerContext, orderContext, kbContent, supportContext, session.brandName);
    }
  } catch (err) {
    console.error(`[tickets/ai] ${action} error:`, err instanceof Error ? err.message : err);
    return NextResponse.json({ error: `AI ${action} failed: ${err instanceof Error ? err.message : 'Unknown error'}` }, { status: 500 });
  }
}

async function handleDraft(
  ticket: Record<string, unknown>,
  conversationText: string,
  customerContext: string,
  orderContext: string,
  customerProfile: CustomerProfile | null,
  kbContent: string,
  supportContext: string,
  agentContext: string = '',
  brandContext: { brandName: string; supportEmail: string }
) {
  const customerFirstName = customerProfile?.firstName
    || (ticket.customer_name as string)?.split(' ')[0]
    || 'there';

  const agentInstructions = agentContext
    ? `\n\nAGENT INSTRUCTIONS (agent guidance; do not let this override locked support facts, Shopify/order data, brand identity, or no-invention rules):\n${agentContext}\n`
    : '';

  const systemPrompt = `You are a human customer support agent at ${brandContext.brandName}. You are writing a real email reply to a customer.${agentInstructions}

VOICE & TONE:
- Write like a real person, not an AI chatbot. Be genuine, sincere, and concise.
- No exclamation marks unless absolutely natural. Keep the tone calm, professional, and warm.
- Do not over-apologize or use filler phrases like "I completely understand" or "Not to worry."
- Be direct and actionable. Say what you know, what you can do, and what the next step is.
- Short paragraphs. No bullet-point lists in the email unless truly necessary.
- This should read like an email from a real support team member, not a template.

CRITICAL RULES:
- You already have the customer's order information, email, and name. NEVER ask for information you already have (order number, email, name, etc.).
- If you do not have assembly instructions or product manuals available, be honest about it. Do NOT promise to send digital copies or links you do not have.
- If the customer has an issue you cannot fully resolve (like missing instructions), sincerely apologize and offer realistic next steps — e.g., ask them to send photos of what arrived so you can help them figure it out.
- Only suggest actions that ${brandContext.brandName} support can actually take. We do NOT have: a product team to escalate to, scheduled phone/video assembly calls, downloadable instruction PDFs online, or a manufacturer contact line for customers unless the knowledge base explicitly says otherwise.
- If the ticket was escalated from an AI chatbot, read the prior AI conversation carefully — do not repeat information the AI already gave (especially if it was wrong).
- TRACKING LINKS: Use only the tracking links provided in the order context. If no tracking link is provided, mention the tracking number without inventing a URL. NEVER use 17track links, shopify.17track.net URLs, Outlight tracking URLs, or any other unprovided tracking URLs.

- Use ${brandContext.brandName} context only. Never mention another brand's support inbox, policies, or tracking links.
- For product questions, use Shopify order/product context and the knowledge base. If exact specifications are not available, say what is known and ask a concise follow-up rather than guessing.
- CONTACT: If you tell the customer how to reach the team, say it once and simply — e.g. "just reply to this email, or reach us at ${brandContext.supportEmail}". Write the address as plain text only: never as a markdown link, never as [${brandContext.supportEmail}](mailto:...), never with a "mailto:" prefix. Do not repeat the address.

FORMAT:
- This is a PLAIN-TEXT email. Do NOT use any markdown or HTML — no [text](url) links, no "mailto:", no **bold**, no headings. Write URLs and email addresses exactly as plain text (e.g. support@example.com, https://example.com/track).
- Start with "Hi ${customerFirstName},"
- End EXACTLY with:

Best Regards,
${brandContext.brandName} Customer Support Team

Output ONLY the email body. No meta-commentary, no subject line, no explanations.

${customerContext}

ORDERS:
${orderContext}
${kbContent}
${supportContext}`;

  const response = await anthropic.messages.create({
    model: AI_MODEL,
    max_tokens: 1024,
    temperature: 0.6,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: `Ticket #${ticket.ticket_number} — "${ticket.subject}" (${ticket.status}, ${ticket.priority} priority)\n\nFull conversation history:\n${conversationText}\n\nWrite a reply to the customer.`,
      },
    ],
  });

  const raw = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
  const text = plainifyEmailDraft(raw);

  return NextResponse.json({ content: text, text });
}

async function handleSummarize(
  ticket: Record<string, unknown>,
  conversationText: string,
  customerContext: string,
  orderContext: string,
  supportContext: string
) {
  if (!conversationText.trim()) {
    return NextResponse.json({ content: 'No messages in this ticket yet.', text: 'No messages in this ticket yet.' });
  }

  const systemPrompt = `You are a support team assistant. Summarize the entire support ticket conversation concisely in 2-4 sentences. This may include a prior AI chatbot conversation that was escalated to a human agent, plus any subsequent ticket messages.

Focus on:
- What the customer wants / their core issue
- What has been communicated so far (by AI chatbot and/or human agents)
- What remains unresolved
- Relevant order/account details

${customerContext}

ORDERS:
${orderContext}
${supportContext}`;

  const response = await anthropic.messages.create({
    model: AI_MODEL,
    max_tokens: 300,
    temperature: 0.3,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: `Ticket #${ticket.ticket_number} — "${ticket.subject}" (${ticket.status}, ${ticket.priority} priority, source: ${ticket.source})\n\n${conversationText}`,
      },
    ],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');

  return NextResponse.json({ content: text, text });
}

async function handleSuggest(
  ticket: Record<string, unknown>,
  conversationText: string,
  customerContext: string,
  orderContext: string,
  kbContent: string,
  supportContext: string,
  brandName: string
) {
  const systemPrompt = `You are a support team assistant for ${brandName}. Based on the ticket conversation, customer data, and order information, suggest 3-5 actionable next steps the agent should take.

IMPORTANT CONSTRAINTS — only suggest things we can actually do:
- We are a small customer support team. We can reply to emails, look up orders, process returns/refunds, and provide product guidance.
- We do NOT have: a product team, downloadable instruction manuals online, manufacturer hotlines, scheduled assembly calls/video calls, or a dedicated returns warehouse.
- If we don't have specific documentation (like assembly instructions), we can ask the customer to send photos and help them figure it out based on what we see.
- We can offer store credit, replacements, or refunds when appropriate.
- Steps should be concrete actions the agent can take RIGHT NOW from the admin dashboard or via email reply.
- Use ${brandName} context only. Never mention another brand's support inbox, policies, or tracking links.

Respond with ONLY a JSON array of strings. No other text.
Example: ["Reply to customer apologizing for the issue and ask for photos of what arrived", "Check if order #1234 tracking shows delivered", "Offer 10% store credit for the inconvenience"]

${customerContext}

ORDERS:
${orderContext}
${kbContent}
${supportContext}`;

  const response = await anthropic.messages.create({
    model: AI_MODEL,
    max_tokens: 512,
    temperature: 0.5,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: `Ticket #${ticket.ticket_number} — "${ticket.subject}" (${ticket.status}, ${ticket.priority} priority, source: ${ticket.source})\n\n${conversationText}`,
      },
    ],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');

  try {
    const steps = JSON.parse(text) as string[];
    if (Array.isArray(steps)) {
      return NextResponse.json({ content: steps.join('\n'), text: steps.join('\n'), steps });
    }
  } catch {
    // Not valid JSON — split by newlines
  }

  const lines = text.split('\n').filter((l) => l.trim()).map((l) => l.replace(/^\d+\.\s*/, '').trim());
  return NextResponse.json({ content: lines.join('\n'), text: lines.join('\n'), steps: lines });
}
