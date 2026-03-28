// Shopify Admin API helper for the admin app
// Uses client credentials grant — token cached in memory

let cachedToken: { token: string; expiresAt: number } | null = null;

// Strip trailing literal \n and whitespace (Vercel env vars can have these)
function cleanEnv(val: string): string {
  return val.replace(/\\n/g, '').replace(/\n/g, '').trim();
}

function getShopifyConfig() {
  const shop = cleanEnv(process.env.SHOPIFY_SHOP || 'put1rp-iq');
  const clientId = process.env.SHOPIFY_CLIENT_ID ? cleanEnv(process.env.SHOPIFY_CLIENT_ID) : undefined;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET ? cleanEnv(process.env.SHOPIFY_CLIENT_SECRET) : undefined;
  const apiVersion = cleanEnv(process.env.SHOPIFY_API_VERSION || '2025-01');
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
  // Shopify 2025-01 API: ordersCount → numberOfOrders, totalSpentV2 → amountSpent
  const data = await shopifyGraphql<{
    customers: {
      edges: Array<{
        node: {
          id: string;
          firstName: string | null;
          lastName: string | null;
          email: string | null;
          phone: string | null;
          numberOfOrders: string;
          amountSpent: { amount: string; currencyCode: string };
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
          id firstName lastName email phone numberOfOrders
          amountSpent { amount currencyCode }
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
    ordersCount: parseInt(node.numberOfOrders, 10) || 0,
    totalSpent: `${node.amountSpent.amount} ${node.amountSpent.currencyCode}`,
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
        // Always use the correct Outlight tracking page instead of Shopify's 17track proxy URLs
        tracking.push({ number: t.number, url: 'https://outlight.us/pages/tracking-page', company: t.company });
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
        trackingInfo: f.trackingInfo.map((t) => ({ number: t.number, url: 'https://outlight.us/pages/tracking-page', company: t.company })),
      })),
      createdAt: o.createdAt,
      cancelledAt: o.cancelledAt,
      closedAt: o.closedAt,
    };
  });
}

// ── Order Details (full) ─────────────────────────────────────────────────
export interface OrderDetail {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  note: string | null;
  createdAt: string;
  cancelledAt: string | null;
  cancelReason: string | null;
  closedAt: string | null;
  financialStatus: string;
  fulfillmentStatus: string;
  subtotal: string;
  tax: string;
  shipping: string;
  totalPrice: string;
  currentTotalPrice: string;
  totalRefunded: string;
  currency: string;
  lineItems: Array<{
    id: string;
    title: string;
    quantity: number;
    sku: string | null;
    variantTitle: string | null;
    unitPrice: string;
    refundableQuantity: number;
  }>;
  shippingAddress: {
    name: string; address1: string; address2: string | null;
    city: string; province: string | null; zip: string | null;
    country: string; phone: string | null;
  } | null;
  transactions: Array<{
    id: string;
    kind: string;
    status: string;
    amount: string;
    gateway: string;
    processedAt: string;
  }>;
  refunds: Array<{
    id: string;
    createdAt: string;
    note: string | null;
    amount: string;
    lineItems: Array<{ title: string; quantity: number; subtotal: string }>;
  }>;
  fulfillments: Array<{
    status: string;
    createdAt: string;
    trackingInfo: Array<{ number: string; url: string | null; company: string | null }>;
  }>;
}

export async function getOrderDetails(orderId: string): Promise<OrderDetail> {
  const data = await shopifyGraphql<{
    order: {
      id: string;
      name: string;
      email: string | null;
      phone: string | null;
      note: string | null;
      createdAt: string;
      cancelledAt: string | null;
      cancelReason: string | null;
      closedAt: string | null;
      displayFinancialStatus: string;
      displayFulfillmentStatus: string;
      currentSubtotalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
      currentTotalTaxSet: { shopMoney: { amount: string; currencyCode: string } };
      totalShippingPriceSet: { shopMoney: { amount: string; currencyCode: string } };
      totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
      currentTotalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
      totalRefundedSet: { shopMoney: { amount: string; currencyCode: string } };
      lineItems: {
        edges: Array<{
          node: {
            id: string; title: string; quantity: number; sku: string | null;
            variantTitle: string | null;
            originalUnitPriceSet: { shopMoney: { amount: string } };
            refundableQuantity: number;
          };
        }>;
      };
      shippingAddress: {
        name: string; address1: string; address2: string | null;
        city: string; province: string | null; zip: string | null;
        country: string; phone: string | null;
      } | null;
      transactions: Array<{
        id: string; kind: string; status: string;
        amountSet: { shopMoney: { amount: string } };
        gateway: string; processedAt: string;
      }>;
      refunds: Array<{
        id: string; createdAt: string; note: string | null;
        totalRefundedSet: { shopMoney: { amount: string } };
        refundLineItems: {
          edges: Array<{
            node: {
              lineItem: { title: string };
              quantity: number;
              subtotalSet: { shopMoney: { amount: string } };
            };
          }>;
        };
      }>;
      fulfillments: Array<{
        status: string; createdAt: string;
        trackingInfo: Array<{ number: string; url: string | null; company: string | null }>;
      }>;
    };
  }>(
    `query ($id: ID!) {
      order(id: $id) {
        id name email phone note
        createdAt cancelledAt cancelReason closedAt
        displayFinancialStatus displayFulfillmentStatus
        currentSubtotalPriceSet { shopMoney { amount currencyCode } }
        currentTotalTaxSet { shopMoney { amount currencyCode } }
        totalShippingPriceSet { shopMoney { amount currencyCode } }
        totalPriceSet { shopMoney { amount currencyCode } }
        currentTotalPriceSet { shopMoney { amount currencyCode } }
        totalRefundedSet { shopMoney { amount currencyCode } }
        lineItems(first: 50) {
          edges { node {
            id title quantity sku variantTitle
            originalUnitPriceSet { shopMoney { amount } }
            refundableQuantity
          }}
        }
        shippingAddress { name address1 address2 city province zip country phone }
        transactions(first: 20) { id kind status amountSet { shopMoney { amount } } gateway processedAt }
        refunds(first: 10) {
          id createdAt note
          totalRefundedSet { shopMoney { amount } }
          refundLineItems(first: 20) {
            edges { node { lineItem { title } quantity subtotalSet { shopMoney { amount } } } }
          }
        }
        fulfillments { status createdAt trackingInfo { number url company } }
      }
    }`,
    { id: orderId }
  );

  const o = data.order;
  const currency = o.totalPriceSet.shopMoney.currencyCode;

  return {
    id: o.id,
    name: o.name,
    email: o.email,
    phone: o.phone,
    note: o.note,
    createdAt: o.createdAt,
    cancelledAt: o.cancelledAt,
    cancelReason: o.cancelReason,
    closedAt: o.closedAt,
    financialStatus: o.displayFinancialStatus,
    fulfillmentStatus: o.displayFulfillmentStatus,
    subtotal: o.currentSubtotalPriceSet.shopMoney.amount,
    tax: o.currentTotalTaxSet.shopMoney.amount,
    shipping: o.totalShippingPriceSet.shopMoney.amount,
    totalPrice: o.totalPriceSet.shopMoney.amount,
    currentTotalPrice: o.currentTotalPriceSet.shopMoney.amount,
    totalRefunded: o.totalRefundedSet.shopMoney.amount,
    currency,
    lineItems: o.lineItems.edges.map(({ node: li }) => ({
      id: li.id,
      title: li.title,
      quantity: li.quantity,
      sku: li.sku,
      variantTitle: li.variantTitle,
      unitPrice: li.originalUnitPriceSet.shopMoney.amount,
      refundableQuantity: li.refundableQuantity,
    })),
    shippingAddress: o.shippingAddress,
    transactions: o.transactions.map((t) => ({
      id: t.id,
      kind: t.kind,
      status: t.status,
      amount: t.amountSet.shopMoney.amount,
      gateway: t.gateway,
      processedAt: t.processedAt,
    })),
    refunds: o.refunds.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      note: r.note,
      amount: r.totalRefundedSet.shopMoney.amount,
      lineItems: r.refundLineItems.edges.map(({ node: rli }) => ({
        title: rli.lineItem.title,
        quantity: rli.quantity,
        subtotal: rli.subtotalSet.shopMoney.amount,
      })),
    })),
    fulfillments: o.fulfillments.map((f) => ({
      status: f.status,
      createdAt: f.createdAt,
      trackingInfo: f.trackingInfo.map((t) => ({ number: t.number, url: 'https://outlight.us/pages/tracking-page', company: t.company })),
    })),
  };
}

// ── Cancel Order ─────────────────────────────────────────────────────────
export async function cancelOrder(
  orderId: string,
  reason: string = 'CUSTOMER',
  refund: boolean = true,
  restock: boolean = true
): Promise<{ success: boolean; message: string }> {
  const data = await shopifyGraphql<{
    orderCancel: {
      orderCancelUserErrors: Array<{ field: string[]; message: string }>;
    };
  }>(
    `mutation OrderCancel($orderId: ID!, $reason: OrderCancelReason!, $refund: Boolean!, $restock: Boolean!) {
      orderCancel(orderId: $orderId, reason: $reason, refund: $refund, restock: $restock) {
        orderCancelUserErrors { field message }
      }
    }`,
    { orderId, reason, refund, restock }
  );

  const errors = data.orderCancel.orderCancelUserErrors;
  if (errors.length > 0) {
    return { success: false, message: errors.map((e) => e.message).join('; ') };
  }
  return { success: true, message: 'Order cancelled successfully' };
}

// ── Refund Order ─────────────────────────────────────────────────────────
export async function refundOrder(
  orderId: string,
  amount: number,
  reason: string = 'Customer requested refund',
  notify: boolean = true
): Promise<{ success: boolean; message: string; refundId?: string }> {
  const data = await shopifyGraphql<{
    refundCreate: {
      refund: { id: string; totalRefundedSet: { shopMoney: { amount: string; currencyCode: string } } } | null;
      userErrors: Array<{ field: string[]; message: string }>;
    };
  }>(
    `mutation RefundCreate($input: RefundInput!) {
      refundCreate(input: $input) {
        refund {
          id
          totalRefundedSet { shopMoney { amount currencyCode } }
        }
        userErrors { field message }
      }
    }`,
    {
      input: {
        orderId,
        note: reason,
        notify,
        transactions: [{
          amount: amount.toFixed(2),
          gateway: 'manual',
          kind: 'REFUND',
          orderId,
        }],
      },
    }
  );

  const errors = data.refundCreate.userErrors;
  if (errors.length > 0) {
    return { success: false, message: errors.map((e) => e.message).join('; ') };
  }

  const refund = data.refundCreate.refund;
  return {
    success: true,
    message: `Refunded $${refund?.totalRefundedSet.shopMoney.amount ?? amount.toFixed(2)} successfully`,
    refundId: refund?.id,
  };
}
