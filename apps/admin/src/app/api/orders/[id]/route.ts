import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getOrderDetails, cancelOrder, refundOrder } from '@/lib/shopify';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const orderId = `gid://shopify/Order/${id}`;

  try {
    const order = await getOrderDetails(orderId, session.brandSlug);
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
      const before = await getOrderDetails(orderId, session.brandSlug);
      if (before.cancelledAt) {
        return NextResponse.json({
          success: false,
          completed: true,
          message: `Order ${before.name} is already cancelled`,
        }, { status: 409 });
      }
      const hasTracking = before.fulfillments.some((fulfillment) => fulfillment.trackingInfo.length > 0);
      const safeToRestock = before.fulfillmentStatus === 'UNFULFILLED' && !hasTracking;
      const result = await cancelOrder(
        orderId,
        body.reason || 'CUSTOMER',
        body.refund !== false,
        body.restock !== false && safeToRestock,
        session.brandSlug
      );
      if (!result.success) {
        return NextResponse.json(result, { status: 409 });
      }
      if (!result.completed) {
        return NextResponse.json(
          { ...result, pending: true },
          { status: 202, headers: { 'Retry-After': '3' } },
        );
      }

      // A completed Shopify job is not yet a customer-facing success until
      // the order projection exposes cancelledAt. This also covers older
      // schemas that return no asynchronous Job object.
      try {
        const confirmed = await getOrderDetails(orderId, session.brandSlug);
        if (!confirmed.cancelledAt) {
          return NextResponse.json(
            {
              ...result,
              completed: false,
              pending: true,
              message: 'Shopify accepted the cancellation, but the cancelled order state is not visible yet.',
            },
            { status: 202, headers: { 'Retry-After': '3' } },
          );
        }
        return NextResponse.json({
          ...result,
          completed: true,
          cancelledAt: confirmed.cancelledAt,
          order: confirmed,
        });
      } catch (confirmationError) {
        console.warn(
          `[orders/${id}] cancellation accepted but confirmation is pending:`,
          confirmationError instanceof Error ? confirmationError.message : confirmationError,
        );
        return NextResponse.json(
          {
            ...result,
            completed: false,
            pending: true,
            message: 'Shopify accepted the cancellation, but live confirmation is temporarily unavailable.',
          },
          { status: 202, headers: { 'Retry-After': '3' } },
        );
      }
    } catch (err) {
      const providerReference = err && typeof err === 'object' && 'providerReference' in err
        ? (err as { providerReference?: unknown }).providerReference
        : undefined;
      if (typeof providerReference === 'string' && providerReference) {
        console.warn(`[orders/${id}] cancellation job requires reconciliation:`, err instanceof Error ? err.message : err);
        return NextResponse.json(
          {
            success: true,
            completed: false,
            pending: true,
            jobId: providerReference,
            message: err instanceof Error ? err.message : 'Shopify accepted the cancellation; confirmation is pending.',
          },
          { status: 202, headers: { 'Retry-After': '3' } },
        );
      }
      // Once the mutation request is dispatched, a transport failure cannot
      // prove that Shopify did not accept it. Keep the UI in reconciliation
      // mode and poll cancelledAt instead of inviting a duplicate mutation.
      console.warn(`[orders/${id}] cancellation outcome is unknown:`, err instanceof Error ? err.message : err);
      return NextResponse.json(
        {
          success: true,
          completed: false,
          pending: true,
          message: `Cancellation outcome could not be confirmed${err instanceof Error ? `: ${err.message}` : ''}. Checking live order state before another attempt.`,
        },
        { status: 202, headers: { 'Retry-After': '3' } },
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
        body.notify !== false,
        session.brandSlug
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
