import { config } from '../config/env.js';
import { getToken } from './shopify-auth.service.js';

interface ShopifyCustomerProfile {
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

interface ShopifyOrderSummary {
  id: string;
  name: string;
  totalPrice: string;
  financialStatus: string;
  fulfillmentStatus: string;
  lineItems: Array<{
    title: string;
    quantity: number;
    variantTitle: string | null;
  }>;
  tracking: Array<{ number: string; url: string | null }>;
  createdAt: string;
}

async function shopifyGraphql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
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

// ── Get Customer by Email ──────────────────────────────────────────────────
export async function getCustomerByEmail(email: string): Promise<ShopifyCustomerProfile | null> {
  const query = `
    query CustomerByEmail($queryStr: String!) {
      customers(first: 1, query: $queryStr) {
        edges {
          node {
            id
            firstName
            lastName
            email
            phone
            ordersCount
            totalSpentV2 {
              amount
              currencyCode
            }
            createdAt
            tags
            note
            state
          }
        }
      }
    }
  `;

  try {
    const data = await shopifyGraphql<{
      customers: {
        edges: Array<{
          node: {
            id: string;
            firstName: string | null;
            lastName: string | null;
            email: string | null;
            phone: string | null;
            ordersCount: number;
            totalSpentV2: { amount: string; currencyCode: string };
            createdAt: string;
            tags: string[];
            note: string | null;
            state: string;
          };
        }>;
      };
    }>(query, { queryStr: `email:${email}` });

    const edge = data.customers.edges[0];
    if (!edge) {
      console.log(`[customer-profile.service] No customer found for email: ${email}`);
      return null;
    }

    const c = edge.node;
    return {
      id: c.id,
      firstName: c.firstName,
      lastName: c.lastName,
      email: c.email,
      phone: c.phone,
      ordersCount: c.ordersCount,
      totalSpent: `${c.totalSpentV2.amount} ${c.totalSpentV2.currencyCode}`,
      createdAt: c.createdAt,
      tags: c.tags,
      note: c.note,
      state: c.state,
    };
  } catch (err) {
    console.error('[customer-profile.service] getCustomerByEmail error:', err instanceof Error ? err.message : err);
    throw new Error('Failed to fetch customer profile from Shopify');
  }
}

// ── Get Customer Orders ────────────────────────────────────────────────────
export async function getCustomerOrders(email: string, limit = 10): Promise<ShopifyOrderSummary[]> {
  const query = `
    query CustomerOrders($queryStr: String!, $first: Int!) {
      orders(first: $first, query: $queryStr, sortKey: CREATED_AT, reverse: true) {
        edges {
          node {
            id
            name
            totalPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }
            displayFinancialStatus
            displayFulfillmentStatus
            lineItems(first: 10) {
              edges {
                node {
                  title
                  quantity
                  variantTitle
                }
              }
            }
            fulfillments {
              trackingInfo {
                number
                url
              }
            }
            createdAt
          }
        }
      }
    }
  `;

  try {
    const data = await shopifyGraphql<{
      orders: {
        edges: Array<{
          node: {
            id: string;
            name: string;
            totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
            displayFinancialStatus: string;
            displayFulfillmentStatus: string;
            lineItems: {
              edges: Array<{
                node: { title: string; quantity: number; variantTitle: string | null };
              }>;
            };
            fulfillments: Array<{
              trackingInfo: Array<{ number: string; url: string | null }>;
            }>;
            createdAt: string;
          };
        }>;
      };
    }>(query, { queryStr: `email:${email}`, first: limit });

    return data.orders.edges.map((edge) => {
      const o = edge.node;
      const tracking: Array<{ number: string; url: string | null }> = [];
      for (const f of o.fulfillments) {
        for (const t of f.trackingInfo) {
          tracking.push({ number: t.number, url: t.url });
        }
      }

      return {
        id: o.id,
        name: o.name,
        totalPrice: `${o.totalPriceSet.shopMoney.amount} ${o.totalPriceSet.shopMoney.currencyCode}`,
        financialStatus: o.displayFinancialStatus,
        fulfillmentStatus: o.displayFulfillmentStatus,
        lineItems: o.lineItems.edges.map((e) => ({
          title: e.node.title,
          quantity: e.node.quantity,
          variantTitle: e.node.variantTitle,
        })),
        tracking,
        createdAt: o.createdAt,
      };
    });
  } catch (err) {
    console.error('[customer-profile.service] getCustomerOrders error:', err instanceof Error ? err.message : err);
    throw new Error('Failed to fetch customer orders from Shopify');
  }
}
