import { config } from '../config/env.js';
import { getToken } from './shopify-auth.service.js';
import { supabase } from '../config/supabase.js';

async function graphql<T = Record<string, unknown>>(
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const token = await getToken();
  const url = `https://${config.shopify.shop}.myshopify.com/admin/api/${config.shopify.apiVersion}/graphql.json`;

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

function normalizePhone(phone: string): string {
  return phone.replace(/[\s\-\(\)\+]/g, '');
}

export interface OrderLookupResult {
  found: boolean;
  message?: string;
  order?: {
    id: string;
    name: string;
    financialStatus: string;
    fulfillmentStatus: string;
    tracking: Array<{ number: string; url: string | null }>;
    estimatedDelivery: string | null;
    lineItems: Array<{
      id: string;
      title: string;
      quantity: number;
      price: string;
      imageUrl: string | null;
    }>;
    shippingCity: string | null;
    shippingCountry: string | null;
    createdAt: string;
  };
}

export async function lookupOrder(
  orderNumber: string,
  email?: string,
  phone?: string
): Promise<OrderLookupResult> {
  if (!email && !phone) {
    return { found: false, message: 'Please provide your email address or phone number to verify your identity.' };
  }

  // Normalize order number — accept with or without #
  const cleanNumber = orderNumber.replace(/^#/, '');

  const query = `
    query OrderLookup($queryStr: String!) {
      orders(first: 1, query: $queryStr) {
        edges {
          node {
            id
            name
            email
            phone
            createdAt
            displayFinancialStatus
            displayFulfillmentStatus
            fulfillments {
              trackingInfo {
                number
                url
              }
              estimatedDeliveryAt
            }
            lineItems(first: 20) {
              edges {
                node {
                  id
                  title
                  quantity
                  originalUnitPriceSet {
                    shopMoney {
                      amount
                    }
                  }
                  image {
                    url
                  }
                }
              }
            }
            shippingAddress {
              city
              country
            }
          }
        }
      }
    }
  `;

  const data = await graphql<{
    orders: {
      edges: Array<{
        node: {
          id: string;
          name: string;
          email: string | null;
          phone: string | null;
          createdAt: string;
          displayFinancialStatus: string;
          displayFulfillmentStatus: string;
          fulfillments: Array<{
            trackingInfo: Array<{ number: string; url: string | null }>;
            estimatedDeliveryAt: string | null;
          }>;
          lineItems: {
            edges: Array<{
              node: {
                id: string;
                title: string;
                quantity: number;
                originalUnitPriceSet: { shopMoney: { amount: string } };
                image: { url: string } | null;
              };
            }>;
          };
          shippingAddress: { city: string; country: string } | null;
        };
      }>;
    };
  }>(query, { queryStr: `name:#${cleanNumber}` });

  const orderEdge = data.orders.edges[0];
  if (!orderEdge) {
    return { found: false, message: 'Order not found. Please double-check your order number.' };
  }

  const order = orderEdge.node;

  // Verify identity
  let verified = false;
  if (email && order.email && email.toLowerCase() === order.email.toLowerCase()) {
    verified = true;
  }
  if (phone && order.phone && normalizePhone(phone) === normalizePhone(order.phone)) {
    verified = true;
  }

  if (!verified) {
    return { found: false, message: 'Could not verify your identity. Please check the email or phone number associated with this order.' };
  }

  // Build tracking info
  const tracking: Array<{ number: string; url: string | null }> = [];
  let estimatedDelivery: string | null = null;
  for (const fulfillment of order.fulfillments) {
    for (const t of fulfillment.trackingInfo) {
      tracking.push({ number: t.number, url: t.url });
    }
    if (fulfillment.estimatedDeliveryAt) {
      estimatedDelivery = fulfillment.estimatedDeliveryAt;
    }
  }

  return {
    found: true,
    order: {
      id: order.id,
      name: order.name,
      financialStatus: order.displayFinancialStatus,
      fulfillmentStatus: order.displayFulfillmentStatus,
      tracking,
      estimatedDelivery,
      lineItems: order.lineItems.edges.map((e) => ({
        id: e.node.id,
        title: e.node.title,
        quantity: e.node.quantity,
        price: e.node.originalUnitPriceSet.shopMoney.amount,
        imageUrl: e.node.image?.url ?? null,
      })),
      shippingCity: order.shippingAddress?.city ?? null,
      shippingCountry: order.shippingAddress?.country ?? null,
      createdAt: order.createdAt,
    },
  };
}

export interface ReturnEligibilityResult {
  items: Array<{
    lineItemId: string;
    title: string;
    eligible: boolean;
    reason: string;
  }>;
}

export async function checkReturnEligibility(orderId: string): Promise<ReturnEligibilityResult> {
  const query = `
    query OrderReturnEligibility($id: ID!) {
      order(id: $id) {
        displayFulfillmentStatus
        createdAt
        fulfillments {
          createdAt
          status
        }
        lineItems(first: 20) {
          edges {
            node {
              id
              title
              quantity
              refundableQuantity
            }
          }
        }
      }
    }
  `;

  const data = await graphql<{
    order: {
      displayFulfillmentStatus: string;
      createdAt: string;
      fulfillments: Array<{ createdAt: string; status: string }>;
      lineItems: {
        edges: Array<{
          node: {
            id: string;
            title: string;
            quantity: number;
            refundableQuantity: number;
          };
        }>;
      };
    } | null;
  }>(query, { id: orderId });

  if (!data.order) {
    return { items: [] };
  }

  const order = data.order;
  const returnWindowDays = 30;
  const now = Date.now();

  // Determine fulfillment date
  const latestFulfillment = order.fulfillments
    .filter((f) => f.status === 'SUCCESS')
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

  const fulfilledAt = latestFulfillment
    ? new Date(latestFulfillment.createdAt).getTime()
    : null;

  const items = order.lineItems.edges.map((e) => {
    const item = e.node;

    if (order.displayFulfillmentStatus === 'UNFULFILLED') {
      return { lineItemId: item.id, title: item.title, eligible: false, reason: 'Item has not been shipped yet' };
    }

    if (item.refundableQuantity <= 0) {
      return { lineItemId: item.id, title: item.title, eligible: false, reason: 'Item has already been returned or refunded' };
    }

    if (fulfilledAt && (now - fulfilledAt) > returnWindowDays * 24 * 60 * 60 * 1000) {
      return { lineItemId: item.id, title: item.title, eligible: false, reason: `Return window of ${returnWindowDays} days has passed` };
    }

    return { lineItemId: item.id, title: item.title, eligible: true, reason: 'Eligible for return' };
  });

  return { items };
}

export interface InitiateReturnResult {
  success: boolean;
  referenceNumber: string;
  message: string;
}

export async function initiateReturn(
  orderId: string,
  lineItemIds: string[],
  reason: string,
  conversationId?: string
): Promise<InitiateReturnResult> {
  const { data: row, error } = await supabase
    .from('return_requests')
    .insert({
      order_id: orderId,
      line_item_ids: lineItemIds,
      reason,
      conversation_id: conversationId,
    })
    .select()
    .single();

  if (error) {
    console.error('[shopify-admin] initiateReturn error:', error.message);
    throw new Error('Failed to submit return request');
  }

  return {
    success: true,
    referenceNumber: (row as { id: string }).id.slice(0, 8).toUpperCase(),
    message: 'Your return request has been submitted and will be reviewed by our team. You will receive an email with further instructions.',
  };
}
