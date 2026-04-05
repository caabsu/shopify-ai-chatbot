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
  const { data: reviewRows } = await supabase
    .from('review_requests')
    .select('id, status, scheduled_for, sent_at, reminder_sent_at, reminder_scheduled_for, customer_email, customer_name, shopify_order_id, created_at')
    .eq('brand_id', brandId)
    .order('created_at', { ascending: false });

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
    },
  });
}
