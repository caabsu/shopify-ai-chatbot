import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { getCustomerByEmail, getCustomerOrders } from '@/lib/shopify';
import type { CustomerProfile, OrderSummary } from '@/lib/shopify';

const anthropic = new Anthropic();
const AI_MODEL = 'claude-sonnet-4-6';

function buildOrderContext(orders: OrderSummary[]): string {
  if (orders.length === 0) return 'No orders found for this customer.';

  return orders.map((o) => {
    const items = o.lineItems.map((li) =>
      `${li.title}${li.variantTitle ? ` (${li.variantTitle})` : ''} x${li.quantity}`
    ).join(', ');

    const tracking = o.tracking.length > 0
      ? o.tracking.map((t) => `${t.company || 'Carrier'}: ${t.number}${t.url ? ` (${t.url})` : ''}`).join('; ')
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

function buildCustomerContext(profile: CustomerProfile | null): string {
  if (!profile) return 'No Shopify customer profile found.';
  return `Customer: ${profile.firstName || ''} ${profile.lastName || ''} (${profile.email})
  - Total Orders: ${profile.ordersCount}
  - Lifetime Value: $${parseFloat(profile.totalSpent).toFixed(2)}
  - Customer Since: ${new Date(profile.createdAt).toLocaleDateString()}
  - Account Status: ${profile.state}
  - Tags: ${profile.tags.length > 0 ? profile.tags.join(', ') : 'none'}${profile.note ? `\n  - Internal Note: ${profile.note}` : ''}`;
}

async function loadKnowledgeBase(brandId: string, query?: string): Promise<string> {
  let q = supabase
    .from('knowledge_documents')
    .select('title, content, category')
    .eq('brand_id', brandId)
    .eq('enabled', true)
    .order('priority', { ascending: false })
    .limit(10);

  if (query) {
    q = supabase
      .from('knowledge_documents')
      .select('title, content, category')
      .eq('brand_id', brandId)
      .eq('enabled', true)
      .or(`title.ilike.%${query}%,content.ilike.%${query}%`)
      .order('priority', { ascending: false })
      .limit(10);
  }

  const { data } = await q;
  if (!data || data.length === 0) return '';

  return '\n\nKnowledge Base Articles:\n' + data.map((d) =>
    `[${d.category}] ${d.title}:\n${d.content}`
  ).join('\n\n---\n\n');
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

  // Load messages
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

  // Fetch Shopify customer data + orders
  let customerProfile: CustomerProfile | null = null;
  let customerOrders: OrderSummary[] = [];

  if (ticket.customer_email) {
    try {
      [customerProfile, customerOrders] = await Promise.all([
        getCustomerByEmail(ticket.customer_email).catch(() => null),
        getCustomerOrders(ticket.customer_email, 5).catch(() => []),
      ]);
    } catch {
      // continue without Shopify data
    }
  }

  const customerContext = buildCustomerContext(customerProfile);
  const orderContext = buildOrderContext(customerOrders);

  // Load knowledge base
  const kbContent = await loadKnowledgeBase(
    session.brandId,
    ticket.subject
  ).catch(() => '');

  try {
    if (action === 'draft') {
      return await handleDraft(ticket, threadText, customerContext, orderContext, customerProfile, kbContent);
    } else if (action === 'summarize') {
      return await handleSummarize(ticket, threadText, customerContext, orderContext);
    } else {
      return await handleSuggest(ticket, threadText, customerContext, orderContext, kbContent);
    }
  } catch (err) {
    console.error(`[tickets/ai] ${action} error:`, err instanceof Error ? err.message : err);
    return NextResponse.json({ error: `AI ${action} failed` }, { status: 500 });
  }
}

async function handleDraft(
  ticket: Record<string, unknown>,
  threadText: string,
  customerContext: string,
  orderContext: string,
  customerProfile: CustomerProfile | null,
  kbContent: string
) {
  const customerFirstName = customerProfile?.firstName
    || (ticket.customer_name as string)?.split(' ')[0]
    || 'there';

  const systemPrompt = `You are a professional customer support agent for Outlight, an outdoor lighting company.

Your task: Write a reply to a support ticket. The reply will be sent directly to the customer — output ONLY the email body, no meta-commentary.

RULES:
1. Start with "Hi ${customerFirstName}," as the greeting
2. Be warm, professional, and empathetic
3. Be concise but thorough — address the customer's concern directly
4. If the customer asks "where is my order" or about shipping/tracking, use the order and tracking data provided to give specific, helpful information
5. If the customer asks about assembly or product instructions, help to the best of your ability with the product knowledge available
6. If you have knowledge base articles relevant to the inquiry, incorporate that information naturally
7. ALWAYS end the email with exactly:

Best Regards,
[YOUR NAME]
Outlight Customer Support Team

CONTEXT:
${customerContext}

ORDERS:
${orderContext}
${kbContent}`;

  const response = await anthropic.messages.create({
    model: AI_MODEL,
    max_tokens: 1024,
    temperature: 0.7,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: `Ticket #${ticket.ticket_number} — "${ticket.subject}" (${ticket.status}, ${ticket.priority} priority)\n\nConversation:\n${threadText}\n\nWrite a reply to the customer.`,
      },
    ],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');

  return NextResponse.json({ content: text, text });
}

async function handleSummarize(
  ticket: Record<string, unknown>,
  threadText: string,
  customerContext: string,
  orderContext: string
) {
  if (!threadText.trim()) {
    return NextResponse.json({ content: 'No messages in this ticket yet.', text: 'No messages in this ticket yet.' });
  }

  const systemPrompt = `You are a support team assistant. Summarize the support ticket conversation concisely in 2-4 sentences.

Focus on:
- What the customer wants
- What has been done so far
- What remains unresolved
- Any relevant order/account details

CONTEXT:
${customerContext}

ORDERS:
${orderContext}`;

  const response = await anthropic.messages.create({
    model: AI_MODEL,
    max_tokens: 300,
    temperature: 0.3,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: `Ticket #${ticket.ticket_number} — "${ticket.subject}" (${ticket.status}, ${ticket.priority} priority)\n\n${threadText}`,
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
  threadText: string,
  customerContext: string,
  orderContext: string,
  kbContent: string
) {
  const systemPrompt = `You are a support team assistant. Based on the ticket conversation, customer data, and order information, suggest 3-5 specific, actionable next steps the agent should take to resolve this ticket.

Be practical and specific — reference actual order numbers, tracking info, or policies when relevant.

Respond with ONLY a JSON array of strings, e.g.: ["Step 1", "Step 2", "Step 3"]. No other text.

CONTEXT:
${customerContext}

ORDERS:
${orderContext}
${kbContent}`;

  const response = await anthropic.messages.create({
    model: AI_MODEL,
    max_tokens: 512,
    temperature: 0.5,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: `Ticket #${ticket.ticket_number} — "${ticket.subject}" (${ticket.status}, ${ticket.priority} priority)\n\n${threadText}`,
      },
    ],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');

  // Try to parse as JSON array
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
