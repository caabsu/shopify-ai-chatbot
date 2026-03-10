import { config } from '../config/env.js';
import { getTokenForBrand } from './shopify-auth.service.js';
import { getBrandShopifyConfig } from '../config/brand-shopify.js';

async function shopifyGraphql<T>(query: string, variables?: Record<string, unknown>, brandId?: string): Promise<T> {
  const token = await getTokenForBrand(brandId);
  const brandConfig = await getBrandShopifyConfig(brandId);
  const url = `https://${brandConfig.shop}.myshopify.com/admin/api/${config.shopify.apiVersion}/graphql.json`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Shopify Admin API error (${res.status}): ${text}`);
  }

  const json = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };

  if (json.errors && json.errors.length > 0) {
    const messages = json.errors.map((e) => e.message).join('; ');
    throw new Error(`Shopify GraphQL error: ${messages}`);
  }

  if (!json.data) {
    throw new Error('Shopify GraphQL returned no data');
  }

  return json.data;
}

// ── Cancel Order ───────────────────────────────────────────────────────────
export async function cancelOrder(
  orderId: string,
  reason?: string,
  brandId?: string
): Promise<{ success: boolean; message: string }> {
  const mutation = `
    mutation OrderCancel($orderId: ID!, $reason: OrderCancelReason!, $refund: Boolean!, $restock: Boolean!) {
      orderCancel(orderId: $orderId, reason: $reason, refund: $refund, restock: $restock) {
        orderCancelUserErrors {
          field
          message
        }
      }
    }
  `;

  try {
    const data = await shopifyGraphql<{
      orderCancel: {
        orderCancelUserErrors: Array<{ field: string[]; message: string }>;
      };
    }>(mutation, {
      orderId,
      reason: reason ?? 'CUSTOMER',
      refund: true,
      restock: true,
    }, brandId);

    const errors = data.orderCancel.orderCancelUserErrors;
    if (errors.length > 0) {
      const messages = errors.map((e) => e.message).join('; ');
      console.error(`[shopify-actions.service] cancelOrder errors:`, messages);
      return { success: false, message: `Could not cancel order: ${messages}` };
    }

    console.log(`[shopify-actions.service] Order ${orderId} cancelled successfully`);
    return { success: true, message: 'Order has been cancelled. A refund will be issued to the original payment method.' };
  } catch (err) {
    console.error('[shopify-actions.service] cancelOrder error:', err instanceof Error ? err.message : err);
    throw new Error('Failed to cancel order');
  }
}

// ── Refund Order ───────────────────────────────────────────────────────────
export async function refundOrder(
  orderId: string,
  amount: number,
  reason?: string,
  notify = true,
  brandId?: string
): Promise<{ success: boolean; message: string; refundId?: string }> {
  const mutation = `
    mutation RefundCreate($input: RefundInput!) {
      refundCreate(input: $input) {
        refund {
          id
          totalRefundedSet {
            shopMoney {
              amount
              currencyCode
            }
          }
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  try {
    const data = await shopifyGraphql<{
      refundCreate: {
        refund: {
          id: string;
          totalRefundedSet: { shopMoney: { amount: string; currencyCode: string } };
        } | null;
        userErrors: Array<{ field: string[]; message: string }>;
      };
    }>(mutation, {
      input: {
        orderId,
        note: reason ?? 'Customer requested refund',
        notify,
        transactions: [
          {
            amount: amount.toFixed(2),
            gateway: 'manual',
            kind: 'REFUND',
            orderId,
          },
        ],
      },
    }, brandId);

    const errors = data.refundCreate.userErrors;
    if (errors.length > 0) {
      const messages = errors.map((e) => e.message).join('; ');
      console.error(`[shopify-actions.service] refundOrder errors:`, messages);
      return { success: false, message: `Could not process refund: ${messages}` };
    }

    const refund = data.refundCreate.refund;
    const refundedAmount = refund?.totalRefundedSet?.shopMoney;
    console.log(`[shopify-actions.service] Refund created for order ${orderId}: ${refundedAmount?.amount} ${refundedAmount?.currencyCode}`);

    return {
      success: true,
      message: `Refund of ${refundedAmount?.amount ?? amount} ${refundedAmount?.currencyCode ?? 'USD'} has been processed.`,
      refundId: refund?.id,
    };
  } catch (err) {
    console.error('[shopify-actions.service] refundOrder error:', err instanceof Error ? err.message : err);
    throw new Error('Failed to process refund');
  }
}

// ── Create Discount Code ───────────────────────────────────────────────────
export async function createDiscountCode(
  code: string,
  percentage: number,
  expiryDays?: number,
  brandId?: string
): Promise<{ success: boolean; message: string; code?: string }> {
  const startsAt = new Date().toISOString();
  const endsAt = expiryDays
    ? new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000).toISOString()
    : null;

  const mutation = `
    mutation DiscountCodeBasicCreate($basicCodeDiscount: DiscountCodeBasicInput!) {
      discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
        codeDiscountNode {
          id
          codeDiscount {
            ... on DiscountCodeBasic {
              title
              codes(first: 1) {
                edges {
                  node {
                    code
                  }
                }
              }
            }
          }
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  try {
    const input: Record<string, unknown> = {
      title: `${code} - ${percentage}% off`,
      code,
      startsAt,
      customerGets: {
        value: {
          percentage: percentage / 100,
        },
        items: {
          all: true,
        },
      },
      customerSelection: {
        all: true,
      },
      appliesOncePerCustomer: true,
    };

    if (endsAt) {
      input.endsAt = endsAt;
    }

    const data = await shopifyGraphql<{
      discountCodeBasicCreate: {
        codeDiscountNode: {
          id: string;
          codeDiscount: {
            title: string;
            codes: { edges: Array<{ node: { code: string } }> };
          };
        } | null;
        userErrors: Array<{ field: string[]; message: string }>;
      };
    }>(mutation, { basicCodeDiscount: input }, brandId);

    const errors = data.discountCodeBasicCreate.userErrors;
    if (errors.length > 0) {
      const messages = errors.map((e) => e.message).join('; ');
      console.error(`[shopify-actions.service] createDiscountCode errors:`, messages);
      return { success: false, message: `Could not create discount code: ${messages}` };
    }

    const createdCode = data.discountCodeBasicCreate.codeDiscountNode?.codeDiscount?.codes?.edges?.[0]?.node?.code ?? code;
    const expiryText = expiryDays ? ` (expires in ${expiryDays} days)` : '';
    console.log(`[shopify-actions.service] Created discount code ${createdCode} for ${percentage}%${expiryText}`);

    return {
      success: true,
      message: `Discount code "${createdCode}" created for ${percentage}% off${expiryText}.`,
      code: createdCode,
    };
  } catch (err) {
    console.error('[shopify-actions.service] createDiscountCode error:', err instanceof Error ? err.message : err);
    throw new Error('Failed to create discount code');
  }
}
