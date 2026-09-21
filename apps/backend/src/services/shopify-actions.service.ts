import { randomUUID } from 'node:crypto';
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
const CANCEL_JOB_POLL_INTERVAL_MS = 1_000;
const CANCEL_JOB_MAX_WAIT_MS = 45_000;
const CANCEL_EVIDENCE_MAX_WAIT_MS = 15_000;

interface CancellationEvidence {
  id: string;
  name: string;
  cancelledAt: string | null;
  displayFinancialStatus: string;
  displayFulfillmentStatus: string;
  totalPriceSet: { shopMoney: { amount: string } };
  totalRefundedSet: { shopMoney: { amount: string } };
  transactions: Array<{
    kind: string;
    status: string;
    amountSet: { shopMoney: { amount: string } };
  }>;
  fulfillments: Array<{ trackingInfo: Array<{ number: string | null }> }>;
}

export interface CancelOrderResult {
  success: boolean;
  message: string;
  completed: boolean;
  jobId?: string;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function getCancellationEvidence(orderId: string, brandId?: string): Promise<CancellationEvidence | null> {
  const data = await shopifyGraphql<{ order: CancellationEvidence | null }>(
    `query OrderCancellationEvidence($id: ID!) {
      order(id: $id) {
        id name cancelledAt displayFinancialStatus displayFulfillmentStatus
        totalPriceSet { shopMoney { amount } }
        totalRefundedSet { shopMoney { amount } }
        transactions(first: 100) {
          kind status
          amountSet { shopMoney { amount } }
        }
        fulfillments { trackingInfo { number } }
      }
    }`,
    { id: orderId },
    brandId,
  );
  return data.order;
}

function expectedOutstandingRefund(order: CancellationEvidence): number | null {
  const alreadyRefunded = Number.parseFloat(order.totalRefundedSet.shopMoney.amount || '0');
  if (!Number.isFinite(alreadyRefunded)) return null;
  const captured = order.transactions
    .filter((transaction) => (
      (transaction.kind === 'SALE' || transaction.kind === 'CAPTURE')
      && transaction.status === 'SUCCESS'
    ))
    .reduce((sum, transaction) => sum + Number.parseFloat(transaction.amountSet.shopMoney.amount || '0'), 0);
  if (Number.isFinite(captured) && captured > 0) return Math.max(0, captured - alreadyRefunded);
  const total = Number.parseFloat(order.totalPriceSet.shopMoney.amount);
  return Number.isFinite(total) ? Math.max(0, total - alreadyRefunded) : null;
}

function refundEvidenceIsComplete(
  order: CancellationEvidence,
  refundedBefore: number,
  expectedOutstanding: number | null,
): boolean {
  if (order.displayFinancialStatus === 'REFUNDED') return true;
  const refundedAfter = Number.parseFloat(order.totalRefundedSet.shopMoney.amount || '0');
  if (!Number.isFinite(refundedBefore)
      || !Number.isFinite(refundedAfter)
      || expectedOutstanding === null) return false;
  return Math.max(0, refundedAfter - refundedBefore) + 0.01 >= expectedOutstanding;
}

async function waitForCancellationJob(jobId: string, brandId?: string): Promise<boolean> {
  const deadline = Date.now() + CANCEL_JOB_MAX_WAIT_MS;
  while (Date.now() < deadline) {
    const data = await shopifyGraphql<{ job: { id: string; done: boolean } | null }>(
      `query CancellationJob($id: ID!) { job(id: $id) { id done } }`,
      { id: jobId },
      brandId,
    );
    if (data.job?.done) return true;
    await delay(Math.min(CANCEL_JOB_POLL_INTERVAL_MS, Math.max(0, deadline - Date.now())));
  }
  return false;
}

async function waitForCancellationEvidence(
  orderId: string,
  refundExpected: boolean,
  refundedBefore: number,
  expectedOutstanding: number | null,
  brandId?: string,
): Promise<CancellationEvidence | null> {
  const deadline = Date.now() + CANCEL_EVIDENCE_MAX_WAIT_MS;
  do {
    const evidence = await getCancellationEvidence(orderId, brandId);
    if (evidence?.cancelledAt
        && (!refundExpected || refundEvidenceIsComplete(evidence, refundedBefore, expectedOutstanding))) {
      return evidence;
    }
    if (Date.now() >= deadline) return null;
    await delay(Math.min(CANCEL_JOB_POLL_INTERVAL_MS, Math.max(0, deadline - Date.now())));
  } while (Date.now() <= deadline);
  return null;
}

export async function cancelOrder(
  orderId: string,
  reason?: string,
  brandId?: string
): Promise<CancelOrderResult> {
  try {
    const scopeData = await shopifyGraphql<{
      currentAppInstallation: { accessScopes: Array<{ handle: string }> } | null;
    }>(`query CurrentAppAccessScopes {
      currentAppInstallation { accessScopes { handle } }
    }`, undefined, brandId);
    const scopes = new Set((scopeData.currentAppInstallation?.accessScopes ?? []).map((scope) => scope.handle));
    if (!scopes.has('write_orders') && !scopes.has('write_marketplace_orders')) {
      return { success: false, completed: true, message: 'Shopify access is missing write_orders.' };
    }

    const before = await getCancellationEvidence(orderId, brandId);
    if (!before) return { success: false, completed: true, message: 'Order was not found.' };
    const refundExpected = ['PAID', 'PARTIALLY_PAID', 'PARTIALLY_REFUNDED']
      .includes(before.displayFinancialStatus.toUpperCase());
    const refundedBefore = Number.parseFloat(before.totalRefundedSet.shopMoney.amount || '0');
    const expectedRefund = expectedOutstandingRefund(before);
    if (before.cancelledAt) {
      return !refundExpected
        ? { success: true, completed: true, message: `Order ${before.name} was already cancelled and its financial state is confirmed.` }
        : { success: false, completed: false, message: `Order ${before.name} is cancelled, but its refund is not yet confirmed.` };
    }
    const hasTracking = before.fulfillments.some((fulfillment) => fulfillment.trackingInfo.length > 0);
    const restock = before.displayFulfillmentStatus.toUpperCase() === 'UNFULFILLED' && !hasTracking;

    const data = await shopifyGraphql<{
      orderCancel: {
        job: { id: string; done: boolean } | null;
        orderCancelUserErrors: Array<{ field: string[]; message: string; code: string | null }>;
      };
    }>(`mutation OrderCancel(
      $orderId: ID!
      $reason: OrderCancelReason!
      $refundMethod: OrderCancelRefundMethodInput!
      $restock: Boolean!
    ) {
      orderCancel(
        orderId: $orderId
        reason: $reason
        refundMethod: $refundMethod
        restock: $restock
        notifyCustomer: false
      ) {
        job { id done }
        orderCancelUserErrors { field message code }
      }
    }`, {
      orderId,
      reason: reason ?? 'CUSTOMER',
      refundMethod: { originalPaymentMethodsRefund: true },
      restock,
    }, brandId);

    const errors = data.orderCancel.orderCancelUserErrors;
    if (errors.length > 0) {
      const messages = errors.map((e) => e.message).join('; ');
      console.error(`[shopify-actions.service] cancelOrder errors:`, messages);
      return { success: false, completed: true, message: `Could not cancel order: ${messages}` };
    }

    const job = data.orderCancel.job;
    if (job && !job.done && !(await waitForCancellationJob(job.id, brandId))) {
      return {
        success: false,
        completed: false,
        jobId: job.id,
        message: `Shopify accepted cancellation for ${before.name}, but it is still processing.`,
      };
    }
    const confirmed = await waitForCancellationEvidence(
      orderId,
      refundExpected,
      refundedBefore,
      expectedRefund,
      brandId,
    );
    if (!confirmed) {
      return {
        success: false,
        completed: false,
        jobId: job?.id,
        message: `Shopify accepted cancellation for ${before.name}, but cancellation/refund evidence is still pending.`,
      };
    }

    console.log(`[shopify-actions.service] Order ${orderId} cancellation and financial state confirmed`);
    return {
      success: true,
      completed: true,
      jobId: job?.id,
      message: `Order ${confirmed.name} has been cancelled${refundExpected ? ' and its refund is confirmed' : ''}.`,
    };
  } catch (err) {
    console.error('[shopify-actions.service] cancelOrder error:', err instanceof Error ? err.message : err);
    return {
      success: false,
      completed: false,
      message: `Cancellation could not be confirmed: ${err instanceof Error ? err.message : 'unknown Shopify error'}`,
    };
  }
}

// ── Refund Order ───────────────────────────────────────────────────────────
export async function refundOrder(
  orderId: string,
  amount: number,
  reason?: string,
  notify = true,
  brandId?: string,
  idempotencyKey = randomUUID(),
): Promise<{ success: boolean; message: string; refundId?: string }> {
  const mutation = `
    mutation RefundCreate($input: RefundInput!, $idempotencyKey: String!) {
      refundCreate(input: $input) @idempotent(key: $idempotencyKey) {
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
    idempotencyKey,
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
