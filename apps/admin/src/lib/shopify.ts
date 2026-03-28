// Shopify Admin API helper for the admin app
// Uses client credentials grant — token cached in memory

let cachedToken: { token: string; expiresAt: number } | null = null;

function getShopifyConfig() {
  const shop = process.env.SHOPIFY_SHOP || 'put1rp-iq';
  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
  const apiVersion = process.env.SHOPIFY_API_VERSION || '2025-01';
  if (!clientId || !clientSecret) {
    throw new Error('Missing SHOPIFY_CLIENT_ID or SHOPIFY_CLIENT_SECRET');
  }
  return { shop, clientId, clientSecret, apiVersion };
}

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.token;
  }

  const { shop, clientId, clientSecret } = getShopifyConfig();
  const res = await fetch(`https://${shop}.myshopify.com/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Shopify token error (${res.status}): ${text}`);
  }

  const data = await res.json();
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 86399) * 1000,
  };
  return cachedToken.token;
}

export async function shopifyGraphql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const { shop, apiVersion } = getShopifyConfig();
  const token = await getAccessToken();

  const res = await fetch(
    `https://${shop}.myshopify.com/admin/api/${apiVersion}/graphql.json`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': token,
      },
      body: JSON.stringify({ query, variables }),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Shopify API error (${res.status}): ${text}`);
  }

  const json = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (json.errors?.length) {
    throw new Error(`Shopify GraphQL: ${json.errors.map((e) => e.message).join('; ')}`);
  }
  if (!json.data) throw new Error('Shopify returned no data');
  return json.data;
}

// ── Customer Profile ──────────────────────────────────────────────────────
export interface CustomerProfile {
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

export async function getCustomerByEmail(email: string): Promise<CustomerProfile | null> {
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
  }>(
    `query ($q: String!) {
      customers(first: 1, query: $q) {
        edges { node {
          id firstName lastName email phone ordersCount
          totalSpentV2 { amount currencyCode }
          createdAt tags note state
        }}
      }
    }`,
    { q: `email:${email}` }
  );

  const node = data.customers.edges[0]?.node;
  if (!node) return null;

  return {
    id: node.id,
    firstName: node.firstName,
    lastName: node.lastName,
    email: node.email,
    phone: node.phone,
    ordersCount: node.ordersCount,
    totalSpent: `${node.totalSpentV2.amount} ${node.totalSpentV2.currencyCode}`,
    createdAt: node.createdAt,
    tags: node.tags,
    note: node.note,
    state: node.state,
  };
}

// ── Customer Orders (with full fulfillment + tracking) ────────────────────
export interface OrderSummary {
  id: string;
  name: string;
  totalPrice: string;
  financialStatus: string;
  fulfillmentStatus: string;
  lineItems: Array<{ title: string; quantity: number; variantTitle: string | null }>;
  tracking: Array<{ number: string; url: string | null; company: string | null }>;
  fulfillments: Array<{
    status: string;
    createdAt: string;
    trackingInfo: Array<{ number: string; url: string | null; company: string | null }>;
  }>;
  createdAt: string;
  cancelledAt: string | null;
  closedAt: string | null;
}

export async function getCustomerOrders(email: string, limit = 5): Promise<OrderSummary[]> {
  const data = await shopifyGraphql<{
    orders: {
      edges: Array<{
        node: {
          id: string;
          name: string;
          totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
          displayFinancialStatus: string;
          displayFulfillmentStatus: string;
          lineItems: { edges: Array<{ node: { title: string; quantity: number; variantTitle: string | null } }> };
          fulfillments: Array<{
            status: string;
            createdAt: string;
            trackingInfo: Array<{ number: string; url: string | null; company: string | null }>;
          }>;
          createdAt: string;
          cancelledAt: string | null;
          closedAt: string | null;
        };
      }>;
    };
  }>(
    `query ($q: String!, $first: Int!) {
      orders(first: $first, query: $q, sortKey: CREATED_AT, reverse: true) {
        edges { node {
          id name
          totalPriceSet { shopMoney { amount currencyCode } }
          displayFinancialStatus displayFulfillmentStatus
          lineItems(first: 10) { edges { node { title quantity variantTitle } } }
          fulfillments {
            status createdAt
            trackingInfo { number url company }
          }
          createdAt cancelledAt closedAt
        }}
      }
    }`,
    { q: `email:${email}`, first: limit }
  );

  return data.orders.edges.map(({ node: o }) => {
    const tracking: OrderSummary['tracking'] = [];
    for (const f of o.fulfillments) {
      for (const t of f.trackingInfo) {
        tracking.push({ number: t.number, url: t.url, company: t.company });
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
      fulfillments: o.fulfillments.map((f) => ({
        status: f.status,
        createdAt: f.createdAt,
        trackingInfo: f.trackingInfo.map((t) => ({ number: t.number, url: t.url, company: t.company })),
      })),
      createdAt: o.createdAt,
      cancelledAt: o.cancelledAt,
      closedAt: o.closedAt,
    };
  });
}
