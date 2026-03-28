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
      // Confirmation sent on every submission
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
    .select('status, scheduled_for, sent_at, reminder_sent_at')
    .eq('brand_id', brandId);

  const reviewCounts = { total: 0, scheduled: 0, sent: 0, reminded: 0, bounced: 0, expired: 0 };
  const queuedEmails: Array<{ scheduled_for: string; status: string }> = [];

  if (reviewRows) {
    reviewCounts.total = reviewRows.length;
    for (const row of reviewRows) {
      const s = row.status as string;
      if (s === 'scheduled') {
        reviewCounts.scheduled++;
        queuedEmails.push({ scheduled_for: row.scheduled_for, status: s });
      }
      if (s === 'sent') reviewCounts.sent++;
      if (s === 'reminded') reviewCounts.reminded++;
      if (s === 'bounced') reviewCounts.bounced++;
      if (s === 'expired') reviewCounts.expired++;
    }
  }
  const reviewEmailsSent = reviewCounts.sent + reviewCounts.reminded;

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
      queuedEmails: queuedEmails.slice(0, 20),
    },
  });
}
