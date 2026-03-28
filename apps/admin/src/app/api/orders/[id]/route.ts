import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getOrderDetails, cancelOrder, refundOrder } from '@/lib/shopify';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const orderId = `gid://shopify/Order/${id}`;

  try {
    const order = await getOrderDetails(orderId);
    return NextResponse.json({ order });
  } catch (err) {
    console.error(`[orders/${id}] getOrderDetails failed:`, err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch order details' },
      { status: 500 }
    );
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const orderId = `gid://shopify/Order/${id}`;
  const body = await req.json();
  const action = body.action as string;

  if (action === 'cancel') {
    try {
      const result = await cancelOrder(
        orderId,
        body.reason || 'CUSTOMER',
        body.refund !== false,
        body.restock !== false
      );
      return NextResponse.json(result);
    } catch (err) {
      console.error(`[orders/${id}] cancel failed:`, err instanceof Error ? err.message : err);
      return NextResponse.json(
        { success: false, message: err instanceof Error ? err.message : 'Cancel failed' },
        { status: 500 }
      );
    }
  }

  if (action === 'refund') {
    const amount = parseFloat(body.amount);
    if (!amount || amount <= 0) {
      return NextResponse.json({ success: false, message: 'Invalid refund amount' }, { status: 400 });
    }
    try {
      const result = await refundOrder(
        orderId,
        amount,
        body.reason || 'Customer requested refund',
        body.notify !== false
      );
      return NextResponse.json(result);
    } catch (err) {
      console.error(`[orders/${id}] refund failed:`, err instanceof Error ? err.message : err);
      return NextResponse.json(
        { success: false, message: err instanceof Error ? err.message : 'Refund failed' },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
