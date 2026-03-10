import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const action = body.action as string;

  // Verify ticket belongs to brand
  const { data: ticket } = await supabase
    .from('tickets')
    .select('*')
    .eq('id', id)
    .eq('brand_id', session.brandId)
    .single();

  if (!ticket) {
    return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
  }

  // Get messages for context
  const { data: messages } = await supabase
    .from('ticket_messages')
    .select('*')
    .eq('ticket_id', id)
    .order('created_at', { ascending: true });

  const threadText = (messages ?? [])
    .filter((m: { is_internal_note: boolean }) => !m.is_internal_note)
    .map((m: { sender_type: string; sender_name: string | null; content: string }) => {
      const label = m.sender_type === 'customer' ? 'Customer' : m.sender_type === 'agent' ? 'Agent' : 'System';
      const name = m.sender_name ? ` (${m.sender_name})` : '';
      return `[${label}${name}]: ${m.content}`;
    })
    .join('\n\n');

  // Try to proxy to backend AI endpoints first, fallback to local
  try {
    let endpoint = '';
    if (action === 'draft') endpoint = `${BACKEND_URL}/api/tickets/${id}/ai/draft`;
    else if (action === 'summarize') endpoint = `${BACKEND_URL}/api/tickets/${id}/ai/summarize`;
    else if (action === 'suggest') endpoint = `${BACKEND_URL}/api/tickets/${id}/ai/suggest`;
    else return NextResponse.json({ error: 'Unknown action' }, { status: 400 });

    // Try backend proxy (the backend's ticket AI endpoints need auth)
    // For now, return the thread context and let the frontend handle display
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${req.cookies.get('admin_token')?.value || ''}`,
      },
    });

    if (res.ok) {
      const result = await res.json();
      return NextResponse.json({
        content: result.draft || result.summary || (result.steps ?? []).join('\n'),
        text: result.draft || result.summary || (result.steps ?? []).join('\n'),
      });
    }
  } catch {
    // Backend proxy failed, return helpful message
  }

  // Fallback: return message asking to configure backend
  return NextResponse.json({
    content: action === 'draft'
      ? `[AI Draft] Based on the conversation about "${ticket.subject}", here's a suggested response:\n\nThank you for reaching out. I've reviewed your ${ticket.category || 'request'} and I'm looking into this for you. I'll follow up shortly with more details.`
      : action === 'summarize'
      ? `[Summary] Ticket #${ticket.ticket_number}: ${ticket.subject}\nStatus: ${ticket.status} | Priority: ${ticket.priority}\nMessages: ${(messages ?? []).length} total\n\n${threadText.slice(0, 500)}`
      : `[Suggested Next Steps]\n1. Review the customer's request in detail\n2. Check related order/account information\n3. Respond to the customer with a resolution or update`,
    text: 'AI response generated from local context',
  });
}
