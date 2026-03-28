import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { getCustomerByEmail, getCustomerOrders } from '@/lib/shopify';

// Emails that are system/notification addresses, not real customers
const SYSTEM_EMAILS = ['mailer@shopify.com', 'noreply@shopify.com'];

// Names that are generic/system and should be replaced with Shopify data
const GENERIC_NAMES = ['unknown', 'outlight (shopify)', ''];

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  const { data: ticket } = await supabase
    .from('tickets')
    .select('id, customer_email, customer_name, conversation_id')
    .eq('id', id)
    .eq('brand_id', session.brandId)
    .single();

  if (!ticket) {
    return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
  }

  if (!ticket.customer_email || SYSTEM_EMAILS.includes(ticket.customer_email.toLowerCase())) {
    return NextResponse.json({ profile: null, orders: [] });
  }

  try {
    const [profile, orders] = await Promise.all([
      getCustomerByEmail(ticket.customer_email).catch(() => null),
      getCustomerOrders(ticket.customer_email, 5).catch(() => []),
    ]);

    // Auto-update ticket customer_name from Shopify if it's missing or generic
    if (profile) {
      const shopifyName = `${profile.firstName || ''} ${profile.lastName || ''}`.trim();
      const currentName = ticket.customer_name?.trim() || '';
      const shouldUpdate = !currentName || GENERIC_NAMES.includes(currentName.toLowerCase());

      if (shouldUpdate && shopifyName) {
        // Update ticket record with Shopify customer name
        await supabase
          .from('tickets')
          .update({ customer_name: shopifyName })
          .eq('id', id);

        // Also update the linked conversation if it's an AI escalation
        if (ticket.conversation_id) {
          await supabase
            .from('conversations')
            .update({ customer_name: shopifyName })
            .eq('id', ticket.conversation_id);
        }
      }
    }

    return NextResponse.json({ profile, orders });
  } catch (err) {
    console.error(`[tickets/${id}/customer] Shopify fetch failed:`, err instanceof Error ? err.message : err);
    return NextResponse.json({ profile: null, orders: [], error: err instanceof Error ? err.message : 'Unknown error' });
  }
}
