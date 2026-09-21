import { createHash } from 'node:crypto';
import type { CustomerProfile, OrderDetail, OrderSummary } from '@/lib/shopify';

/**
 * Version every material change to the canonical projection. Evidence created
 * under an older projection must be regenerated instead of being compared as
 * though it covered the same prompt inputs.
 */
export const SHOPIFY_SUPPORT_EVIDENCE_PROJECTION = 'shopify-support-prompt-v2';

function compareCanonical(left: unknown, right: unknown): number {
  const leftJson = JSON.stringify(left);
  const rightJson = JSON.stringify(right);
  return leftJson < rightJson ? -1 : leftJson > rightJson ? 1 : 0;
}

function canonicalTracking(
  tracking: Array<{ number: string; url: string | null; company: string | null }>,
) {
  return [...tracking]
    .map((item) => ({
      number: item.number,
      url: item.url,
      company: item.company,
    }))
    .sort(compareCanonical);
}

/**
 * Canonical Shopify snapshot used by draft/plan generation and send/approval
 * revalidation. It intentionally includes every mutable Shopify value exposed
 * to either support model, plus closely related order state. Sorting removes
 * GraphQL edge-order noise while preserving duplicate rows.
 */
export function canonicalShopifySupportEvidence(
  customer: CustomerProfile | null,
  orders: OrderSummary[],
) {
  return {
    projection: SHOPIFY_SUPPORT_EVIDENCE_PROJECTION,
    customer: customer ? {
      id: customer.id,
      firstName: customer.firstName,
      lastName: customer.lastName,
      email: customer.email,
      phone: customer.phone,
      ordersCount: customer.ordersCount,
      totalSpent: customer.totalSpent,
      createdAt: customer.createdAt,
      tags: [...customer.tags].sort(),
      note: customer.note,
      state: customer.state,
    } : null,
    orders: [...orders]
      .map((order) => ({
        id: order.id,
        name: order.name,
        financialStatus: order.financialStatus,
        fulfillmentStatus: order.fulfillmentStatus,
        totalPrice: order.totalPrice,
        lineItems: [...order.lineItems]
          .map((item) => ({ title: item.title, quantity: item.quantity, variantTitle: item.variantTitle }))
          .sort(compareCanonical),
        tracking: canonicalTracking(order.tracking),
        fulfillments: [...order.fulfillments]
          .map((fulfillment) => ({
            status: fulfillment.status,
            createdAt: fulfillment.createdAt,
            trackingInfo: canonicalTracking(fulfillment.trackingInfo),
          }))
          .sort(compareCanonical),
        createdAt: order.createdAt,
        cancelledAt: order.cancelledAt,
        closedAt: order.closedAt,
      }))
      .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
  };
}

export function shopifySupportEvidenceHash(
  customer: CustomerProfile | null,
  orders: OrderSummary[],
): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalShopifySupportEvidence(customer, orders)))
    .digest('hex');
}

export function shopifyOrderEvidenceHashes(orders: OrderSummary[]): Record<string, string> {
  const canonicalOrders = canonicalShopifySupportEvidence(null, orders).orders;
  return Object.fromEntries(canonicalOrders.map((order) => [
    order.id,
    createHash('sha256').update(JSON.stringify({
      projection: SHOPIFY_SUPPORT_EVIDENCE_PROJECTION,
      order,
    })).digest('hex'),
  ]));
}

/**
 * Project an exact Shopify order lookup into the same evidence shape used by
 * the planner's customer-order search. Approval must re-read the order IDs
 * recorded in the plan instead of assuming that the ticket email is also the
 * checkout email.
 */
export function orderDetailToEvidenceSummary(order: OrderDetail): OrderSummary {
  const tracking = order.fulfillments.flatMap((fulfillment) => (
    fulfillment.trackingInfo.map((item) => ({
      number: item.number,
      url: item.url,
      company: item.company,
    }))
  ));
  return {
    id: order.id,
    name: order.name,
    totalPrice: `${order.totalPrice} ${order.currency}`,
    financialStatus: order.financialStatus,
    fulfillmentStatus: order.fulfillmentStatus,
    lineItems: order.lineItems.map((item) => ({
      title: item.title,
      quantity: item.quantity,
      variantTitle: item.variantTitle,
    })),
    tracking,
    fulfillments: order.fulfillments.map((fulfillment) => ({
      status: fulfillment.status,
      createdAt: fulfillment.createdAt,
      trackingInfo: fulfillment.trackingInfo.map((item) => ({
        number: item.number,
        url: item.url,
        company: item.company,
      })),
    })),
    createdAt: order.createdAt,
    cancelledAt: order.cancelledAt,
    closedAt: order.closedAt,
  };
}
