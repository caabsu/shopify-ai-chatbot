import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const status = searchParams.get('status');
  const search = searchParams.get('search');
  const page = parseInt(searchParams.get('page') || '1');
  const perPage = parseInt(searchParams.get('per_page') || '20');

  let query = supabase
    .from('return_requests')
    .select('*', { count: 'exact' })
    .eq('brand_id', session.brandId);

  if (status) query = query.eq('status', status);
  if (search) {
    query = query.or(`order_number.ilike.%${search}%,customer_email.ilike.%${search}%,customer_name.ilike.%${search}%`);
  }

  query = query.order('created_at', { ascending: false });

  const from = (page - 1) * perPage;
  const to = from + perPage - 1;
  query = query.range(from, to);

  const { data: returns, error, count } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Fetch items for each return
  const returnIds = (returns ?? []).map((r) => r.id);
  let items: Record<string, unknown[]> = {};
  if (returnIds.length > 0) {
    const { data: allItems } = await supabase
      .from('return_items')
      .select('*')
      .in('return_request_id', returnIds);

    if (allItems) {
      items = allItems.reduce((acc: Record<string, unknown[]>, item) => {
        if (!acc[item.return_request_id]) acc[item.return_request_id] = [];
        acc[item.return_request_id].push(item);
        return acc;
      }, {});
    }
  }

  const returnsWithItems = await Promise.all((returns ?? []).map(async (r) => {
    const returnItems = items[r.id] ?? [];

    try {
      const params = new URLSearchParams({
        order_number: r.order_number,
        email: r.customer_email,
      });
      const lookupRes = await fetch(`${BACKEND_URL}/api/returns/lookup?${params.toString()}`, {
        headers: { 'x-brand': session.brandId },
        cache: 'no-store',
      });
      if (lookupRes.ok) {
        const lookup = await lookupRes.json() as {
          items?: Array<{
            id: string;
            price?: string;
            originalUnitPrice?: string;
            originalTotal?: string;
            discountedTotal?: string;
          }>;
        };
        const paidByLineItemId = new Map((lookup.items ?? []).map((item) => [item.id, item]));
        for (const item of returnItems as Array<Record<string, unknown>>) {
          const paid = paidByLineItemId.get(String(item.line_item_id));
          if (!paid) continue;
          const unitPaid = parseFloat(String(paid.price ?? '0').replace(/[^0-9.-]/g, ''));
          if (!Number.isNaN(unitPaid)) item.price = unitPaid;
          item.original_unit_price = paid.originalUnitPrice ? parseFloat(paid.originalUnitPrice) : null;
          item.original_total = paid.originalTotal ? parseFloat(paid.originalTotal) : null;
          item.discounted_total = paid.discountedTotal ? parseFloat(paid.discountedTotal) : null;
        }
      }
    } catch {
      // Non-fatal. Fall back to the stored return item amount.
    }

    return {
      ...r,
      items: returnItems,
    };
  }));

  return NextResponse.json({
    returns: returnsWithItems,
    total: count ?? 0,
    page,
    perPage,
    totalPages: Math.ceil((count ?? 0) / perPage),
  });
}
