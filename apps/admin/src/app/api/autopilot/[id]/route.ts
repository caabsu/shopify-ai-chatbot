import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { sendTicketReplyEmail } from '@/lib/email';
import { maybeSendCsatRequest } from '@/lib/csat';
import { cancelOrder, refundOrder, updateOrderShippingAddress, getOrderDetails, type ShippingAddressInput } from '@/lib/shopify';
import type { AutopilotAction, AutopilotPlan } from '@/lib/types';

/**
 * Decide on an Autopilot plan: dismiss it, or approve (a subset of) its actions
 * and execute them right here using the admin's proven Shopify/email libraries.
 * Per-action results land back on the plan so the review card shows exactly
 * what ran and what failed.
 *
 * Body: { decision: 'approve' | 'dismiss',
 *         actions?: [{ id, approved: boolean, reply_text?: string }] }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const decision = body.decision as 'approve' | 'dismiss';
  if (decision !== 'approve' && decision !== 'dismiss') {
    return NextResponse.json({ error: 'decision must be approve or dismiss' }, { status: 400 });
  }

  const { data: ticket } = await supabase
    .from('tickets')
    .select('*')
    .eq('id', id)
    .eq('brand_id', session.brandId)
    .single();
  if (!ticket) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });

  const metadata = (ticket.metadata as Record<string, unknown>) || {};
  const plan = metadata.autopilot as AutopilotPlan | undefined;
  if (!plan || plan.status !== 'proposed') {
    return NextResponse.json({ error: 'No pending Autopilot plan on this ticket' }, { status: 409 });
  }

  const now = new Date().toISOString();
  const deciderName = session.name || 'admin';

  if (decision === 'dismiss') {
    plan.status = 'dismissed';
    plan.decided_at = now;
    plan.decided_by = deciderName;
    await supabase.from('tickets').update({ metadata: { ...metadata, autopilot: plan }, updated_at: now }).eq('id', id);
    await supabase.from('ticket_events').insert({
      ticket_id: id, event_type: 'autopilot_dismissed', actor: 'agent', actor_id: session.userId ?? null,
    });
    return NextResponse.json({ plan });
  }

  // ── approve & execute ──────────────────────────────────────────────────────
  const overrides = new Map<string, { approved: boolean; reply_text?: string }>(
    Array.isArray(body.actions) ? body.actions.map((a: { id: string; approved: boolean; reply_text?: string }) => [a.id, a]) : []
  );

  plan.status = 'executing';
  plan.decided_at = now;
  plan.decided_by = deciderName;
  await supabase.from('tickets').update({ metadata: { ...metadata, autopilot: plan } }).eq('id', id);
  await supabase.from('ticket_events').insert({
    ticket_id: id, event_type: 'autopilot_approved', actor: 'agent', actor_id: session.userId ?? null,
    new_value: plan.actions.filter((a) => overrides.get(a.id)?.approved !== false).map((a) => a.type).join(','),
  });

  let executed = 0;
  let failed = 0;

  for (const action of plan.actions) {
    const override = overrides.get(action.id);
    if (override?.approved === false) {
      action.status = 'skipped';
      continue;
    }
    if (action.type === 'send_reply' && typeof override?.reply_text === 'string' && override.reply_text.trim()) {
      action.params.reply_text = override.reply_text.trim();
      (action.params as Record<string, unknown>).edited_by_reviewer = true;
    }

    try {
      action.result = await executeAction(action, ticket, session);
      action.status = 'executed';
      executed++;
    } catch (err) {
      action.status = 'failed';
      action.result = err instanceof Error ? err.message : 'Execution failed';
      failed++;
      console.error(`[autopilot] action ${action.type} failed on ticket ${ticket.ticket_number}:`, action.result);
    }
  }

  plan.status = failed === 0 ? 'executed' : executed > 0 ? 'partially_executed' : 'failed';
  plan.executed_at = new Date().toISOString();

  // Refresh metadata — execution steps may have updated the ticket row.
  const { data: freshTicket } = await supabase.from('tickets').select('metadata').eq('id', id).single();
  const freshMeta = ((freshTicket?.metadata as Record<string, unknown>) ?? metadata) || {};
  await supabase
    .from('tickets')
    .update({ metadata: { ...freshMeta, autopilot: plan }, updated_at: new Date().toISOString() })
    .eq('id', id);

  await supabase.from('ticket_events').insert({
    ticket_id: id, event_type: 'autopilot_executed', actor: 'agent', actor_id: session.userId ?? null,
    new_value: plan.status,
    metadata: { executed, failed, skipped: plan.actions.filter((a) => a.status === 'skipped').length },
  });

  return NextResponse.json({ plan });
}

// ── action executors ─────────────────────────────────────────────────────────

type SessionInfo = NonNullable<Awaited<ReturnType<typeof getSession>>>;
type TicketRow = Record<string, unknown> & {
  id: string; ticket_number: number; subject: string; status: string; source: string;
  customer_email: string | null; customer_name: string | null; first_response_at: string | null;
  tags: string[] | null; metadata: Record<string, unknown> | null;
};

async function executeAction(action: AutopilotAction, ticket: TicketRow, session: SessionInfo): Promise<string> {
  const now = new Date().toISOString();

  switch (action.type) {
    case 'close_not_support': {
      await supabase.from('tickets').update({ status: 'closed', closed_at: now, updated_at: now }).eq('id', ticket.id);
      await supabase.from('ticket_events').insert({
        ticket_id: ticket.id, event_type: 'status_changed', actor: 'ai',
        old_value: ticket.status, new_value: 'closed', metadata: { via: 'autopilot' },
      });
      return 'Ticket closed (no reply sent)';
    }

    case 'send_reply': {
      const replyText = String(action.params.reply_text ?? '').trim();
      if (!replyText) throw new Error('Empty reply text');
      if (!ticket.customer_email) throw new Error('Ticket has no customer email');

      const { data: message, error } = await supabase
        .from('ticket_messages')
        .insert({
          ticket_id: ticket.id,
          sender_type: 'agent',
          sender_name: session.name || 'Autopilot',
          sender_email: session.email ?? null,
          content: replyText,
          ai_generated: true,
          metadata: { via: 'autopilot' },
        })
        .select()
        .single();
      if (error) throw new Error(`Failed to save reply: ${error.message}`);

      const updates: Record<string, unknown> = { updated_at: now };
      if (!ticket.first_response_at) updates.first_response_at = now;
      await supabase.from('tickets').update(updates).eq('id', ticket.id);
      await supabase.from('ticket_events').insert({
        ticket_id: ticket.id, event_type: 'message_added', actor: 'ai', actor_id: session.userId ?? null,
        new_value: 'agent', metadata: { via: 'autopilot' },
      });

      const { data: customerMsgs } = await supabase
        .from('ticket_messages')
        .select('content, email_message_id, metadata')
        .eq('ticket_id', ticket.id)
        .eq('sender_type', 'customer')
        .order('created_at', { ascending: false })
        .limit(1);
      const latest = customerMsgs?.[0];

      const result = await sendTicketReplyEmail({
        to: ticket.customer_email,
        customerName: ticket.customer_name || undefined,
        ticketNumber: ticket.ticket_number,
        subject: ticket.subject,
        replyContent: replyText,
        brandName: session.brandName,
        brandSlug: session.brandSlug,
        inReplyToMessageId:
          latest?.email_message_id ||
          ((latest?.metadata as Record<string, unknown>)?.email_message_id as string) ||
          undefined,
        originalMessage: latest?.content?.slice(0, 1000) || undefined,
      });

      if (result.error) {
        await supabase.from('ticket_messages')
          .update({ metadata: { via: 'autopilot', email_status: 'failed', email_error: result.error } })
          .eq('id', message.id);
        throw new Error(`Email send failed: ${result.error}`);
      }
      await supabase.from('ticket_messages')
        .update({ email_message_id: result.messageId, metadata: { via: 'autopilot', email_status: 'sent' } })
        .eq('id', message.id);
      return `Reply emailed to ${ticket.customer_email}`;
    }

    case 'resolve': {
      await supabase.from('tickets').update({ status: 'resolved', resolved_at: now, updated_at: now }).eq('id', ticket.id);
      await supabase.from('ticket_events').insert({
        ticket_id: ticket.id, event_type: 'status_changed', actor: 'ai',
        old_value: ticket.status, new_value: 'resolved', metadata: { via: 'autopilot' },
      });
      const { data: fresh } = await supabase.from('tickets').select('*').eq('id', ticket.id).single();
      if (fresh) await maybeSendCsatRequest(fresh, session);
      return 'Ticket resolved';
    }

    case 'set_priority': {
      const priority = String(action.params.priority);
      await supabase.from('tickets').update({ priority, updated_at: now }).eq('id', ticket.id);
      await supabase.from('ticket_events').insert({
        ticket_id: ticket.id, event_type: 'priority_changed', actor: 'ai',
        old_value: String(ticket.priority ?? ''), new_value: priority, metadata: { via: 'autopilot' },
      });
      return `Priority set to ${priority}`;
    }

    case 'add_tags': {
      const newTags = (action.params.tags as string[]).filter((t) => typeof t === 'string');
      const merged = [...new Set([...(ticket.tags ?? []), ...newTags])];
      await supabase.from('tickets').update({ tags: merged, updated_at: now }).eq('id', ticket.id);
      return `Tags added: ${newTags.join(', ')}`;
    }

    case 'cancel_order': {
      const orderId = String(action.params.order_id);
      // Re-validate against live Shopify state — the plan may be hours old.
      const detail = await getOrderDetails(orderId, session.brandSlug);
      if (detail.cancelledAt) throw new Error(`Order ${detail.name} is already cancelled`);
      if (detail.fulfillmentStatus !== 'UNFULFILLED') throw new Error(`Order ${detail.name} is ${detail.fulfillmentStatus} — cannot cancel`);
      const res = await cancelOrder(orderId, String(action.params.reason || 'CUSTOMER'), true, true, session.brandSlug);
      if (!res.success) throw new Error(res.message);
      await supabase.from('ticket_events').insert({
        ticket_id: ticket.id, event_type: 'order_cancelled', actor: 'ai', actor_id: session.userId ?? null,
        new_value: detail.name, metadata: { via: 'autopilot', order_id: orderId },
      });
      return `Order ${detail.name} cancelled (refund + restock)`;
    }

    case 'refund_order': {
      const orderId = String(action.params.order_id);
      const amount = Number(action.params.amount);
      const detail = await getOrderDetails(orderId, session.brandSlug);
      const refundable = parseFloat(detail.totalPrice) - parseFloat(detail.totalRefunded || '0');
      if (!Number.isFinite(amount) || amount <= 0) throw new Error('Invalid refund amount');
      if (amount > refundable + 0.01) throw new Error(`Refund $${amount} exceeds refundable $${refundable.toFixed(2)} on ${detail.name}`);
      const res = await refundOrder(orderId, amount, 'Autopilot: customer requested refund', true, session.brandSlug);
      if (!res.success) throw new Error(res.message);
      await supabase.from('ticket_events').insert({
        ticket_id: ticket.id, event_type: 'order_refunded', actor: 'ai', actor_id: session.userId ?? null,
        new_value: `${detail.name}: $${amount.toFixed(2)}`, metadata: { via: 'autopilot', order_id: orderId },
      });
      return `Refunded $${amount.toFixed(2)} on ${detail.name}`;
    }

    case 'update_shipping_address': {
      const orderId = String(action.params.order_id);
      const detail = await getOrderDetails(orderId, session.brandSlug);
      if (detail.cancelledAt) throw new Error(`Order ${detail.name} is cancelled`);
      if (detail.fulfillmentStatus !== 'UNFULFILLED') throw new Error(`Order ${detail.name} is ${detail.fulfillmentStatus} — address can no longer change`);
      const address = action.params.address as ShippingAddressInput;
      const res = await updateOrderShippingAddress(orderId, address, session.brandSlug);
      if (!res.success) throw new Error(res.message);
      await supabase.from('ticket_events').insert({
        ticket_id: ticket.id, event_type: 'order_address_updated', actor: 'ai', actor_id: session.userId ?? null,
        new_value: detail.name, metadata: { via: 'autopilot', order_id: orderId },
      });
      return `Shipping address updated on ${detail.name}`;
    }

    case 'escalate_human': {
      // Informational card — approving it just tags the ticket for follow-up.
      const merged = [...new Set([...(ticket.tags ?? []), 'needs-human'])];
      await supabase.from('tickets').update({ tags: merged, updated_at: now }).eq('id', ticket.id);
      return 'Tagged needs-human for manual follow-up';
    }

    default:
      throw new Error(`Unknown action type: ${action.type}`);
  }
}
