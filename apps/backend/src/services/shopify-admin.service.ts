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
  customerEmail?: string;
  customerPhone?: string;
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

  // Normalize order number — strip #, leading zeros, whitespace
  const cleanNumber = orderNumber.replace(/^[#\s]+/, '').replace(/^0+/, '') || orderNumber;

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
    console.warn(`[shopify-admin] Order not found for query "name:#${cleanNumber}". If orders exist but aren't returned, the app may be missing the read_all_orders scope.`);
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
    return {
      found: false,
      message: 'ORDER_EXISTS_BUT_VERIFICATION_FAILED: The order was found but the provided email or phone does not match. Ask the customer to double-check the email address they used when placing this order.',
    };
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
    customerEmail: order.email ?? undefined,
    customerPhone: order.phone ?? undefined,
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

export interface ShopPolicy {
  type: string;
  title: string;
  body: string;
}

export async function fetchLegalPolicies(): Promise<ShopPolicy[]> {
  const query = `
    query {
      shop {
        shopPolicies {
          type
          body
        }
      }
    }
  `;

  const data = await graphql<{
    shop: {
      shopPolicies: Array<{
        type: string;
        body: string;
      }>;
    };
  }>(query);

  return data.shop.shopPolicies
    .filter((p) => p.body && p.body.trim().length > 0)
    .map((p) => ({
      type: p.type,
      title: p.type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      body: p.body,
    }));
}

export async function getProductMetafields(productId: string): Promise<Record<string, string | number | null>> {
  const query = `
    query ProductMetafields($id: ID!) {
      product(id: $id) {
        metafields(first: 30) {
          edges {
            node {
              namespace
              key
              value
              type
            }
          }
        }
      }
    }
  `;

  const data = await graphql<{
    product: {
      metafields: {
        edges: Array<{
          node: { namespace: string; key: string; value: string; type: string };
        }>;
      };
    } | null;
  }>(query, { id: productId });

  if (!data.product) return {};

  const result: Record<string, string | number | null> = {};

  // Skip these namespaces/keys — not useful for customer-facing responses
  const skipKeys = new Set([
    'loox.reviews', // huge HTML blob
    'mm-google-shopping.google_product_category',
    'mc-facebook.google_product_category',
    'umbrella.extended_warranty_id',
    'shopify.color-pattern',
  ]);

  for (const edge of data.product.metafields.edges) {
    const { namespace, key, value, type } = edge.node;
    const fullKey = `${namespace}.${key}`;

    if (skipKeys.has(fullKey)) continue;
    if (type === 'file_reference' || type === 'list.metaobject_reference') continue;

    // Convert to a human-readable label
    const label = humanizeKey(key);

    if (type === 'rich_text_field') {
      result[label] = extractPlainText(value);
    } else if (type === 'number_integer') {
      result[label] = parseInt(value, 10);
    } else if (type === 'number_decimal') {
      result[label] = parseFloat(value);
    } else if (type === 'rating') {
      try {
        const parsed = JSON.parse(value);
        result[label] = parseFloat(parsed.value);
      } catch {
        result[label] = value;
      }
    } else {
      result[label] = value;
    }
  }

  return result;
}

function humanizeKey(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Extract plain text from Shopify rich_text_field JSON */
function extractPlainText(richTextJson: string): string {
  try {
    const parsed = JSON.parse(richTextJson);
    const texts: string[] = [];
    function walk(node: { type?: string; value?: string; children?: unknown[] }) {
      if (node.value) texts.push(node.value);
      if (node.children) {
        for (const child of node.children) {
          walk(child as { type?: string; value?: string; children?: unknown[] });
        }
      }
    }
    walk(parsed);
    return texts.join(' ').replace(/\s+/g, ' ').trim();
  } catch {
    return richTextJson;
  }
}

export interface CancelOrderResult {
  success: boolean;
  message: string;
}

export async function cancelOrder(orderId: string, orderName: string): Promise<CancelOrderResult> {
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

  const data = await graphql<{
    orderCancel: {
      orderCancelUserErrors: Array<{ field: string[]; message: string }>;
    };
  }>(mutation, {
    orderId,
    reason: 'CUSTOMER',
    refund: true,
    restock: true,
  });

  const errors = data.orderCancel.orderCancelUserErrors;
  if (errors.length > 0) {
    const messages = errors.map((e) => e.message).join('; ');
    console.error(`[shopify-admin] cancelOrder errors for ${orderName}:`, messages);
    return {
      success: false,
      message: `Could not cancel order ${orderName}: ${messages}`,
    };
  }

  return {
    success: true,
    message: `Order ${orderName} has been cancelled. A refund will be issued to the original payment method within 5-10 business days.`,
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
