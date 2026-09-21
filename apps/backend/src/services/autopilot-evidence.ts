import { createHash } from 'node:crypto';

export const SHOPIFY_SUPPORT_EVIDENCE_PROJECTION = 'shopify-support-prompt-v2';

export interface ShopifyEvidenceCustomer {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  ordersCount: number;
  totalSpent: string;
  createdAt: string;
  tags: string[];
  note: string | null;
  state: string;
}

interface ShopifyEvidenceTracking {
  number: string;
  url: string | null;
  company: string | null;
}

export interface ShopifyEvidenceOrder {
  id: string;
  name: string;
  totalPrice: string;
  financialStatus: string;
  fulfillmentStatus: string;
  lineItems: Array<{ title: string; quantity: number; variantTitle: string | null }>;
  tracking: ShopifyEvidenceTracking[];
  fulfillments: Array<{
    status: string;
    createdAt: string;
    trackingInfo: ShopifyEvidenceTracking[];
  }>;
  createdAt: string;
  cancelledAt: string | null;
  closedAt: string | null;
}

function compareCanonical(left: unknown, right: unknown): number {
  const leftJson = JSON.stringify(left);
  const rightJson = JSON.stringify(right);
  return leftJson < rightJson ? -1 : leftJson > rightJson ? 1 : 0;
}

function canonicalTracking(tracking: ShopifyEvidenceTracking[]) {
  return [...tracking]
    .map((item) => ({
      number: item.number,
      url: item.url,
      company: item.company,
    }))
    .sort(compareCanonical);
}

/**
 * Keep this projection byte-for-byte equivalent to the admin helper. The two
 * runtimes cannot import one another, but plans are generated in the backend
 * and revalidated in the admin before execution.
 */
export function canonicalShopifySupportEvidence(
  customer: ShopifyEvidenceCustomer | null,
  orders: ShopifyEvidenceOrder[],
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
  customer: ShopifyEvidenceCustomer | null,
  orders: ShopifyEvidenceOrder[],
): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalShopifySupportEvidence(customer, orders)))
    .digest('hex');
}

export function shopifyOrderEvidenceHashes(orders: ShopifyEvidenceOrder[]): Record<string, string> {
  const canonicalOrders = canonicalShopifySupportEvidence(null, orders).orders;
  return Object.fromEntries(canonicalOrders.map((order) => [
    order.id,
    createHash('sha256').update(JSON.stringify({
      projection: SHOPIFY_SUPPORT_EVIDENCE_PROJECTION,
      order,
    })).digest('hex'),
  ]));
}
