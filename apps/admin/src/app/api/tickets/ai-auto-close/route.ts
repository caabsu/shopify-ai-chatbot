import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

// Collect all own support addresses from env vars
function getOwnSupportAddresses(): Set<string> {
  const addresses = new Set<string>();
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('EMAIL_FROM_ADDRESS') && value) {
      const match = value.match(/<(.+?)>/);
      if (match) addresses.add(match[1].toLowerCase());
      else if (value.includes('@')) addresses.add(value.toLowerCase().trim());
    }
  }
  return addresses;
}

// POST /api/tickets/ai-auto-close — Classify + close all non-support tickets + self-emails
export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const ownAddresses = getOwnSupportAddresses();
    let totalClassified = 0;

    // Step 1: Close all tickets FROM own support addresses immediately (loop artifacts)
    let selfClosedCount = 0;
    if (ownAddresses.size > 0) {
      for (const addr of ownAddresses) {
        const { data: selfTickets } = await supabase
          .from('tickets')
          .select('id')
          .eq('brand_id', session.brandId)
          .eq('customer_email', addr)
          .in('status', ['open', 'pending']);

        if (selfTickets && selfTickets.length > 0) {
          const now = new Date().toISOString();
          const ids = selfTickets.map((t) => t.id);
          // Supabase .in() supports up to 300 at once; batch if needed
          for (let i = 0; i < ids.length; i += 200) {
            const batch = ids.slice(i, i + 200);
            const { data: closed } = await supabase
              .from('tickets')
              .update({ status: 'closed', closed_at: now, updated_at: now, classification: 'automated', classification_confidence: 1 })
              .in('id', batch)
              .eq('brand_id', session.brandId)
              .select('id');

            selfClosedCount += closed?.length ?? 0;

            for (const row of closed ?? []) {
              await supabase.from('ticket_events').insert({
                ticket_id: row.id,
                event_type: 'status_changed',
                actor: 'ai',
                actor_id: session.userId,
                old_value: 'open',
                new_value: 'closed',
                metadata: { reason: 'AI auto-close: email from own support address (loop artifact)' },
              });
            }
          }
        }
      }
    }

    // Step 2: Get ALL open/pending unclassified tickets (paginate, no limit)
    let offset = 0;
    const pageSize = 500;
    let hasMore = true;

    while (hasMore) {
      const { data: unclassified } = await supabase
        .from('tickets')
        .select('id, ticket_number, subject, customer_email')
        .eq('brand_id', session.brandId)
        .is('classification', null)
        .in('status', ['open', 'pending'])
        .order('created_at', { ascending: false })
        .range(offset, offset + pageSize - 1);

      if (!unclassified || unclassified.length === 0) {
        hasMore = false;
        break;
      }

      for (const ticket of unclassified) {
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
          // Fallback heuristic
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

        // Also auto-classify as automated if from own address
        if (ownAddresses.has(ticket.customer_email.toLowerCase())) {
          classification = 'automated';
          confidence = 1;
        }

        await supabase
          .from('tickets')
          .update({
            classification,
            classification_confidence: confidence,
            updated_at: new Date().toISOString(),
          })
          .eq('id', ticket.id);

        totalClassified++;
      }

      if (unclassified.length < pageSize) {
        hasMore = false;
      } else {
        offset += pageSize;
      }
    }

    // Step 3: Close ALL non-support tickets (paginate)
    let totalNonSupportClosed = 0;
    let closeOffset = 0;
    let closeHasMore = true;

    while (closeHasMore) {
      const { data: nonSupport } = await supabase
        .from('tickets')
        .select('id, ticket_number, subject, classification')
        .eq('brand_id', session.brandId)
        .in('status', ['open', 'pending'])
        .not('classification', 'is', null)
        .neq('classification', 'customer_support')
        .order('created_at', { ascending: false })
        .range(closeOffset, closeOffset + 499);

      if (!nonSupport || nonSupport.length === 0) {
        closeHasMore = false;
        break;
      }

      const ids = nonSupport.map((t) => t.id);
      const now = new Date().toISOString();

      for (let i = 0; i < ids.length; i += 200) {
        const batch = ids.slice(i, i + 200);
        const { data: closed } = await supabase
          .from('tickets')
          .update({ status: 'closed', closed_at: now, updated_at: now })
          .in('id', batch)
          .eq('brand_id', session.brandId)
          .select('id');

        totalNonSupportClosed += closed?.length ?? 0;

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

      // Since we're closing them, they won't appear in the next query — no need to increment offset
      // But break if we got less than a full page
      if (nonSupport.length < 500) {
        closeHasMore = false;
      }
    }

    return NextResponse.json({
      classified: totalClassified,
      selfClosed: selfClosedCount,
      closed: totalNonSupportClosed + selfClosedCount,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[ai-auto-close] Error:', message);
    return NextResponse.json({ error: 'Failed to auto-close tickets' }, { status: 500 });
  }
}
