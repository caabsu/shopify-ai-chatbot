import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

export async function GET(_req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const brandId = session.brandId;

  // ── Return email stats (approximated from return_requests) ──
  const { data: returnRows } = await supabase
    .from('return_requests')
    .select('status')
    .eq('brand_id', brandId);

  const returnCounts = { total: 0, confirmation: 0, approved: 0, denied: 0, refunded: 0 };
  if (returnRows) {
    returnCounts.total = returnRows.length;
    for (const row of returnRows) {
      returnCounts.confirmation++;
      if (row.status === 'approved' || row.status === 'label_created' || row.status === 'shipped' || row.status === 'received') returnCounts.approved++;
      if (row.status === 'denied') returnCounts.denied++;
      if (row.status === 'refunded') returnCounts.refunded++;
    }
  }
  const returnEmailsEstimate =
    returnCounts.confirmation + returnCounts.approved + returnCounts.denied + returnCounts.refunded;

  // ── Review email stats (from review_requests) ──
  // First fetch lightweight rows for stats (no line_items — too large for bulk fetch)
  const { data: reviewRows } = await supabase
    .from('review_requests')
    .select('id, status, scheduled_for, sent_at, reminder_sent_at, reminder_scheduled_for, customer_email, customer_name, shopify_order_id, product_ids, created_at, completed_at')
    .eq('brand_id', brandId)
    .order('created_at', { ascending: false });

  // Fetch line_items only for the most recent 200 entries (for activity log variant display)
  const recentIds = (reviewRows ?? []).slice(0, 200).map((r) => r.id as string);
  const lineItemsMap: Record<string, unknown[]> = {};
  if (recentIds.length > 0) {
    const { data: lineItemRows } = await supabase
      .from('review_requests')
      .select('id, line_items')
      .in('id', recentIds)
      .not('line_items', 'is', null);
    if (lineItemRows) {
      for (const r of lineItemRows) {
        lineItemsMap[r.id as string] = r.line_items as unknown[];
      }
    }
  }

  const reviewCounts = { total: 0, scheduled: 0, sent: 0, reminded: 0, bounced: 0, expired: 0 };
  const queuedEmails: Array<{
    scheduled_for: string;
    status: string;
    customer_email: string;
    customer_name: string | null;
    order_id: string;
    type: 'request' | 'reminder';
  }> = [];

  // Daily email activity (last 30 days)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const dailyActivity: Record<string, { sent: number; reminded: number; bounced: number }> = {};
  for (let i = 0; i < 30; i++) {
    const d = new Date(thirtyDaysAgo.getTime() + i * 24 * 60 * 60 * 1000);
    dailyActivity[d.toISOString().slice(0, 10)] = { sent: 0, reminded: 0, bounced: 0 };
  }

  if (reviewRows) {
    reviewCounts.total = reviewRows.length;
    for (const row of reviewRows) {
      const s = row.status as string;
      if (s === 'scheduled') {
        reviewCounts.scheduled++;
        queuedEmails.push({
          scheduled_for: row.scheduled_for,
          status: s,
          customer_email: row.customer_email,
          customer_name: row.customer_name,
          order_id: row.shopify_order_id,
          type: 'request',
        });
      }
      if (s === 'sent') {
        reviewCounts.sent++;
        // Also queue reminder if it's pending
        if (row.reminder_scheduled_for && !row.reminder_sent_at) {
          queuedEmails.push({
            scheduled_for: row.reminder_scheduled_for,
            status: 'scheduled_reminder',
            customer_email: row.customer_email,
            customer_name: row.customer_name,
            order_id: row.shopify_order_id,
            type: 'reminder',
          });
        }
      }
      if (s === 'reminded') reviewCounts.reminded++;
      if (s === 'bounced') reviewCounts.bounced++;
      if (s === 'expired') reviewCounts.expired++;

      // Track daily activity
      if (row.sent_at) {
        const dateKey = row.sent_at.slice(0, 10);
        if (dailyActivity[dateKey]) dailyActivity[dateKey].sent++;
      }
      if (row.reminder_sent_at) {
        const dateKey = row.reminder_sent_at.slice(0, 10);
        if (dailyActivity[dateKey]) dailyActivity[dateKey].reminded++;
      }
      if (s === 'bounced' && row.sent_at) {
        const dateKey = row.sent_at.slice(0, 10);
        if (dailyActivity[dateKey]) dailyActivity[dateKey].bounced++;
      }
    }
  }
  const reviewEmailsSent = reviewCounts.sent + reviewCounts.reminded;

  // Sort queued emails by scheduled_for (soonest first)
  queuedEmails.sort((a, b) => new Date(a.scheduled_for).getTime() - new Date(b.scheduled_for).getTime());

  // ── Review conversion stats ──
  // Count reviews that came from emails (match by customer_email)
  const emailCustomerEmails = (reviewRows ?? [])
    .filter((r) => ['sent', 'reminded'].includes(r.status as string))
    .map((r) => r.customer_email as string);

  let reviewsFromEmails = 0;
  if (emailCustomerEmails.length > 0) {
    const uniqueEmails = [...new Set(emailCustomerEmails)];
    const { count } = await supabase
      .from('reviews')
      .select('id', { count: 'exact', head: true })
      .eq('brand_id', brandId)
      .in('customer_email', uniqueEmails.slice(0, 100));
    reviewsFromEmails = count ?? 0;
  }

  const conversionRate = reviewEmailsSent > 0
    ? ((reviewsFromEmails / reviewEmailsSent) * 100)
    : 0;

  // ── Build full activity log from ALL review_requests ──
  // Resolve product titles for display
  const allProductIds = new Set<string>();
  for (const row of reviewRows ?? []) {
    const pids = row.product_ids as string[] | null;
    if (pids) pids.forEach((pid: string) => allProductIds.add(pid));
  }

  const productTitleMap: Record<string, string> = {};
  if (allProductIds.size > 0) {
    const { data: productRows } = await supabase
      .from('products')
      .select('id, title')
      .in('id', [...allProductIds].slice(0, 200));
    if (productRows) {
      for (const p of productRows) {
        productTitleMap[p.id as string] = p.title as string;
      }
    }
  }

  // Build activity log for the most recent 200 entries
  const activityLog = (reviewRows ?? []).slice(0, 200).map((row) => {
    // Prefer line_items for variant-aware titles, fall back to product_ids
    const lineItems = (lineItemsMap[row.id as string] ?? null) as Array<{ product_title?: string; variant_title?: string | null; sku?: string | null }> | null;
    let productTitles: string;
    if (lineItems && lineItems.length > 0) {
      productTitles = lineItems.map((li) => {
        let name = li.product_title || 'Unknown';
        if (li.variant_title && li.variant_title !== 'Default Title') {
          name += ` — ${li.variant_title}`;
        }
        if (li.sku) {
          name += ` (${li.sku})`;
        }
        return name;
      }).join(', ');
    } else {
      const pids = (row.product_ids as string[] | null) ?? [];
      productTitles = pids.map((pid: string) => productTitleMap[pid] || 'Unknown product').join(', ');
    }
    return {
      id: row.id,
      status: row.status,
      customer_email: row.customer_email,
      customer_name: row.customer_name,
      order_id: row.shopify_order_id,
      product_titles: productTitles || null,
      created_at: row.created_at,
      scheduled_for: row.scheduled_for,
      sent_at: row.sent_at,
      reminder_scheduled_for: row.reminder_scheduled_for,
      reminder_sent_at: row.reminder_sent_at,
    };
  });

  return NextResponse.json({
    returns: {
      totalRequests: returnCounts.total,
      emailsEstimate: returnEmailsEstimate,
      byType: {
        confirmation: returnCounts.confirmation,
        approved: returnCounts.approved,
        denied: returnCounts.denied,
        refunded: returnCounts.refunded,
      },
    },
    reviews: {
      totalRequests: reviewCounts.total,
      emailsSent: reviewEmailsSent,
      queued: reviewCounts.scheduled,
      sent: reviewCounts.sent,
      reminded: reviewCounts.reminded,
      bounced: reviewCounts.bounced,
      expired: reviewCounts.expired,
      reviewsCollected: reviewsFromEmails,
      conversionRate: Math.round(conversionRate * 10) / 10,
      queuedEmails: queuedEmails.slice(0, 30),
      dailyActivity: Object.entries(dailyActivity).map(([date, counts]) => ({
        date,
        ...counts,
      })),
      activityLog,
    },
  });
}
