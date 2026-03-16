import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

// POST /api/tickets/ai-auto-close — Classify + close all non-support tickets
export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    // Step 1: Get all open/pending unclassified tickets
    const { data: unclassified } = await supabase
      .from('tickets')
      .select('id, ticket_number, subject, customer_email')
      .eq('brand_id', session.brandId)
      .is('classification', null)
      .in('status', ['open', 'pending'])
      .order('created_at', { ascending: false })
      .limit(100);

    const classified: Array<{ id: string; ticketNumber: number; classification: string; confidence: number }> = [];

    // Step 2: Classify each one using the backend AI
    for (const ticket of unclassified ?? []) {
      // Get first customer message
      const { data: messages } = await supabase
        .from('ticket_messages')
        .select('content, sender_type')
        .eq('ticket_id', ticket.id)
        .eq('sender_type', 'customer')
        .order('created_at', { ascending: true })
        .limit(1);

      const body = messages?.[0]?.content || ticket.subject;

      // Call Haiku for classification
      const res = await fetch(`${BACKEND_URL}/api/tickets/ai/classify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: ticket.customer_email,
          subject: ticket.subject,
          body,
        }),
      });

      let classification = 'customer_support';
      let confidence = 0;

      if (res.ok) {
        const data = await res.json();
        classification = data.classification || 'customer_support';
        confidence = data.confidence || 0;
      } else {
        // Fallback: use a simple heuristic inline
        const combined = `${ticket.subject} ${body}`.toLowerCase();
        const promoSignals = ['unsubscribe', 'newsletter', 'promotion', 'sale', 'discount code', 'limited time', 'free shipping', 'click here', 'view in browser'];
        const autoSignals = ['noreply', 'no-reply', 'automated', 'do not reply', 'auto-generated', 'notification'];
        if (promoSignals.some((s) => combined.includes(s))) {
          classification = 'promotional';
          confidence = 0.85;
        } else if (autoSignals.some((s) => combined.includes(s) || ticket.customer_email.includes(s))) {
          classification = 'automated';
          confidence = 0.85;
        } else {
          classification = 'customer_support';
          confidence = 0.5;
        }
      }

      // Update the ticket
      await supabase
        .from('tickets')
        .update({
          classification,
          classification_confidence: confidence,
          updated_at: new Date().toISOString(),
        })
        .eq('id', ticket.id);

      classified.push({
        id: ticket.id,
        ticketNumber: ticket.ticket_number,
        classification,
        confidence,
      });
    }

    // Step 3: Close all non-support tickets
    const { data: nonSupport } = await supabase
      .from('tickets')
      .select('id, ticket_number, subject, classification')
      .eq('brand_id', session.brandId)
      .in('status', ['open', 'pending'])
      .not('classification', 'is', null)
      .neq('classification', 'customer_support')
      .order('created_at', { ascending: false });

    const idsToClose = (nonSupport ?? []).map((t) => t.id);
    let closedCount = 0;

    if (idsToClose.length > 0) {
      const now = new Date().toISOString();
      const { data: closed } = await supabase
        .from('tickets')
        .update({ status: 'closed', closed_at: now, updated_at: now })
        .in('id', idsToClose)
        .eq('brand_id', session.brandId)
        .select('id');

      closedCount = closed?.length ?? 0;

      // Log events
      for (const row of closed ?? []) {
        await supabase.from('ticket_events').insert({
          ticket_id: row.id,
          event_type: 'status_changed',
          actor: 'ai',
          actor_id: session.userId,
          old_value: 'open',
          new_value: 'closed',
          metadata: { reason: 'AI auto-close: non-support email' },
        });
      }
    }

    return NextResponse.json({
      classified: classified.length,
      closed: closedCount,
      closedTickets: (nonSupport ?? []).map((t) => ({
        id: t.id,
        ticketNumber: t.ticket_number,
        subject: t.subject,
        classification: t.classification,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[ai-auto-close] Error:', message);
    return NextResponse.json({ error: 'Failed to auto-close tickets' }, { status: 500 });
  }
}
