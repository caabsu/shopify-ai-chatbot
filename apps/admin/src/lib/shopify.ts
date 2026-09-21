// Shopify Admin API helper for the admin app
// Uses client credentials grant — token cached in memory

import { supabase } from './supabase';

let cachedToken: { token: string; expiresAt: number; shop: string } | null = null;
const warnedApiVersions = new Set<string>();

// Strip trailing literal \n and whitespace (Vercel env vars can have these)
function cleanEnv(val: string): string {
  return val.replace(/\\n/g, '').replace(/\n/g, '').trim();
}

interface ShopifyConfig {
  shop: string;
  clientId: string;
  clientSecret: string;
  apiVersion: string;
  trackingPageUrl: string;
}

function normalizeShopifyShop(shop: string): string {
  return cleanEnv(shop)
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .replace(/\.myshopify\.com$/i, '')
    .toLowerCase();
}

function normalizeDomain(value: string): string {
  return cleanEnv(value)
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .toLowerCase();
}

function stringSetting(settings: Record<string, unknown>, key: string): string | undefined {
  const value = settings[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

async function getShopifyConfig(brandSlug?: string): Promise<ShopifyConfig> {
  const shop = cleanEnv(process.env.SHOPIFY_SHOP || 'put1rp-iq');
  const clientId = process.env.SHOPIFY_CLIENT_ID ? cleanEnv(process.env.SHOPIFY_CLIENT_ID) : undefined;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET ? cleanEnv(process.env.SHOPIFY_CLIENT_SECRET) : undefined;
  const apiVersion = cleanEnv(process.env.SHOPIFY_API_VERSION || '2026-07');

  if (brandSlug && brandSlug !== 'outlight') {
    const { data: brand, error } = await supabase
      .from('brands')
      .select('shopify_shop, settings')
      .eq('slug', brandSlug)
      .eq('enabled', true)
      .single();

    if (error || !brand) {
      throw new Error(`Shopify brand configuration not found for ${brandSlug}`);
    }

    const settings = (brand.settings ?? {}) as Record<string, unknown>;
    const brandShop = typeof brand.shopify_shop === 'string' ? brand.shopify_shop : '';
    const brandClientId = stringSetting(settings, 'shopify_client_id') || stringSetting(settings, 'shopifyClientId');
    const brandClientSecret = stringSetting(settings, 'shopify_client_secret') || stringSetting(settings, 'shopifyClientSecret');

    if (!brandShop || !brandClientId || !brandClientSecret) {
      throw new Error(`Shopify credentials are not configured for ${brandSlug}`);
    }

    const normalizedShop = normalizeShopifyShop(brandShop);
    const explicitTrackingUrl =
      stringSetting(settings, 'tracking_page_url') ||
      stringSetting(settings, 'trackingPageUrl') ||
      stringSetting(settings, 'tracking_url') ||
      stringSetting(settings, 'trackingUrl');
    const storefrontDomain =
      stringSetting(settings, 'domain') ||
      stringSetting(settings, 'storefront_domain') ||
      stringSetting(settings, 'storefrontDomain');
    const trackingDomain = storefrontDomain ? normalizeDomain(storefrontDomain) : `${normalizedShop}.myshopify.com`;

    return {
      shop: normalizedShop,
      clientId: brandClientId,
      clientSecret: brandClientSecret,
      apiVersion,
      trackingPageUrl: explicitTrackingUrl || `https://${trackingDomain}/pages/tracking-page`,
    };
  }

  if (!clientId || !clientSecret) {
    throw new Error('Missing SHOPIFY_CLIENT_ID or SHOPIFY_CLIENT_SECRET');
  }
  const normalizedShop = normalizeShopifyShop(shop);
  return {
    shop: normalizedShop,
    clientId,
    clientSecret,
    apiVersion,
    trackingPageUrl: `https://${normalizedShop}.myshopify.com/pages/tracking-page`,
  };
}

async function getAccessToken(brandSlug?: string, signal?: AbortSignal): Promise<{ token: string; config: ShopifyConfig }> {
  const config = await getShopifyConfig(brandSlug);
  if (cachedToken && cachedToken.shop === config.shop && Date.now() < cachedToken.expiresAt - 60_000) {
    return { token: cachedToken.token, config };
  }

  const res = await fetch(`https://${config.shop}.myshopify.com/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }),
    signal,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Shopify token error (${res.status}): ${text}`);
  }

  const data = await res.json();
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 86399) * 1000,
    shop: config.shop,
  };
  return { token: cachedToken.token, config };
}

export async function shopifyGraphql<T>(
  query: string,
  variables?: Record<string, unknown>,
  brandSlug?: string,
  signal?: AbortSignal,
): Promise<T> {
  const { token, config } = await getAccessToken(brandSlug, signal);

  const res = await fetch(
    `https://${config.shop}.myshopify.com/admin/api/${config.apiVersion}/graphql.json`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': token,
      },
      body: JSON.stringify({ query, variables }),
      signal,
    }
  );

  const servedVersion = res.headers.get('x-shopify-api-version');
  const versionWarningKey = `${config.shop}:${config.apiVersion}:${servedVersion ?? 'unknown'}`;
  if (servedVersion && servedVersion !== config.apiVersion && !warnedApiVersions.has(versionWarningKey)) {
    warnedApiVersions.add(versionWarningKey);
    console.warn(`[shopify] Requested Admin API ${config.apiVersion}, but Shopify served ${servedVersion}. Update SHOPIFY_API_VERSION after validating the newer schema.`);
  }
  const deprecationReason = res.headers.get('x-shopify-api-deprecated-reason');
  if (deprecationReason && !warnedApiVersions.has(deprecationReason)) {
    warnedApiVersions.add(deprecationReason);
    console.warn(`[shopify] Admin API deprecation warning: ${deprecationReason}`);
  }

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

async function cancelFulfillmentViaRest(
  fulfillmentId: string,
  brandSlug?: string,
  signal?: AbortSignal,
): Promise<{ success: boolean; message: string }> {
  const numericId = fulfillmentId.match(/\/(\d+)$/)?.[1] ?? fulfillmentId.match(/^\d+$/)?.[0];
  if (!numericId) {
    return { success: false, message: `Shopify returned an invalid fulfillment ID: ${fulfillmentId}` };
  }
  const { token, config } = await getAccessToken(brandSlug, signal);
  const response = await fetch(
    `https://${config.shop}.myshopify.com/admin/api/${config.apiVersion}/fulfillments/${numericId}/cancel.json`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': token,
      },
      body: '{}',
      signal,
    },
  );
  const body = await response.text();
  if (!response.ok) {
    return {
      success: false,
      message: `Shopify fulfillment cancellation failed (${response.status}): ${body.slice(0, 300)}`,
    };
  }
  let status = 'CANCELLED';
  if (body.trim()) {
    try {
      const parsed = JSON.parse(body) as { fulfillment?: { status?: string } };
      status = String(parsed.fulfillment?.status ?? status).toUpperCase();
    } catch {
      // A successful endpoint response is still verified by the caller's live
      // order refetch before the irreversible order cancellation proceeds.
    }
  }
  return status === 'CANCELLED'
    ? { success: true, message: `Fulfillment ${fulfillmentId} was cancelled.` }
    : { success: false, message: `Shopify returned fulfillment status ${status} after cancellation.` };
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

export async function getCustomerByEmail(email: string, brandSlug?: string): Promise<CustomerProfile | null> {
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
    { q: `email:${email}` },
    brandSlug
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

export async function getCustomerOrders(email: string, limit = 5, brandSlug?: string): Promise<OrderSummary[]> {
  const config = await getShopifyConfig(brandSlug);
  const data = await shopifyGraphql<{
    orders: {
      edges: Array<{
        node: {
          id: string;
          name: string;
          totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
          displayFinancialStatus: string;
          displayFulfillmentStatus: string;
          lineItems: { edges: Array<{ node: { title: string; quantity: number; variant: { title: string } | null } }> };
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
          lineItems(first: 10) { edges { node { title quantity variant { title } } } }
          fulfillments {
            status createdAt
            trackingInfo { number url company }
          }
          createdAt cancelledAt closedAt
        }}
      }
    }`,
    { q: `email:${email}`, first: limit },
    brandSlug
  );

  return data.orders.edges.map(({ node: o }) => {
    const tracking: OrderSummary['tracking'] = [];
    for (const f of o.fulfillments) {
      for (const t of f.trackingInfo) {
        tracking.push({ number: t.number, url: config.trackingPageUrl, company: t.company });
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
        variantTitle: e.node.variant?.title ?? null,
      })),
      tracking,
      fulfillments: o.fulfillments.map((f) => ({
        status: f.status,
        createdAt: f.createdAt,
        trackingInfo: f.trackingInfo.map((t) => ({ number: t.number, url: config.trackingPageUrl, company: t.company })),
      })),
      createdAt: o.createdAt,
      cancelledAt: o.cancelledAt,
      closedAt: o.closedAt,
    };
  });
}

// ── Order Details (full) ─────────────────────────────────────────────────
export interface ShopifyShippingAddress {
  name: string;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  address1: string;
  address2: string | null;
  city: string;
  province: string | null;
  provinceCode: string | null;
  zip: string | null;
  country: string;
  countryCodeV2: string | null;
  phone: string | null;
}

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
  shippingAddress: ShopifyShippingAddress | null;
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
    id: string;
    status: string;
    createdAt: string;
    trackingInfo: Array<{ number: string; url: string | null; company: string | null }>;
  }>;
}

export async function getOrderDetails(orderId: string, brandSlug?: string, signal?: AbortSignal): Promise<OrderDetail> {
  const config = await getShopifyConfig(brandSlug);
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
            variant: { title: string } | null;
            originalUnitPriceSet: { shopMoney: { amount: string } };
            refundableQuantity: number;
          };
        }>;
      };
      shippingAddress: ShopifyShippingAddress | null;
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
        id: string; status: string; createdAt: string;
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
            id title quantity sku variant { title }
            originalUnitPriceSet { shopMoney { amount } }
            refundableQuantity
          }}
        }
        shippingAddress {
          name firstName lastName company
          address1 address2 city province provinceCode zip
          country countryCodeV2 phone
        }
        transactions(first: 20) { id kind status amountSet { shopMoney { amount } } gateway processedAt }
        refunds(first: 10) {
          id createdAt note
          totalRefundedSet { shopMoney { amount } }
          refundLineItems(first: 20) {
            edges { node { lineItem { title } quantity subtotalSet { shopMoney { amount } } } }
          }
        }
        fulfillments { id status createdAt trackingInfo { number url company } }
      }
    }`,
    { id: orderId },
    brandSlug,
    signal,
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
      variantTitle: li.variant?.title ?? null,
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
      id: f.id,
      status: f.status,
      createdAt: f.createdAt,
      trackingInfo: f.trackingInfo.map((t) => ({ number: t.number, url: config.trackingPageUrl, company: t.company })),
    })),
  };
}

// ── Update Shipping Address ──────────────────────────────────────────────
export interface ShippingAddressInput {
  name?: string;
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
  address1: string;
  address2?: string | null;
  city: string;
  province?: string;
  provinceCode?: string | null;
  zip?: string;
  country: string;
  countryCode?: string | null;
  phone?: string | null;
}

export async function updateOrderShippingAddress(
  orderId: string,
  address: ShippingAddressInput,
  brandSlug?: string,
  signal?: AbortSignal,
): Promise<{ success: boolean; message: string; address?: ShopifyShippingAddress }> {
  const [fallbackFirstName, ...fallbackLastName] = (address.name ?? '').trim().split(/\s+/);
  const data = await shopifyGraphql<{
    orderUpdate: {
      order: { id: string; shippingAddress: ShopifyShippingAddress | null } | null;
      userErrors: Array<{ field: string[]; message: string }>;
    };
  }>(
    `mutation OrderUpdate($input: OrderInput!) {
      orderUpdate(input: $input) {
        order {
          id
          shippingAddress {
            name firstName lastName company
            address1 address2 city province provinceCode zip
            country countryCodeV2 phone
          }
        }
        userErrors { field message }
      }
    }`,
    {
      input: {
        id: orderId,
        shippingAddress: {
          firstName: (address.firstName ?? fallbackFirstName) || undefined,
          lastName: (address.lastName ?? fallbackLastName.join(' ')) || undefined,
          company: address.company ?? undefined,
          address1: address.address1,
          // MailingAddressInput is patch-like. Send null deliberately so an
          // apartment/unit from the old destination cannot survive when the
          // customer supplied a complete new address without address2.
          address2: address.address2 ?? null,
          city: address.city,
          provinceCode: address.provinceCode || undefined,
          province: address.provinceCode ? undefined : address.province || undefined,
          zip: address.zip || undefined,
          countryCode: address.countryCode || undefined,
          country: address.countryCode ? undefined : address.country,
          phone: address.phone ?? undefined,
        },
      },
    },
    brandSlug,
    signal,
  );

  const errors = data.orderUpdate.userErrors;
  if (errors.length > 0) {
    return { success: false, message: errors.map((e) => e.message).join('; ') };
  }
  const updatedAddress = data.orderUpdate.order?.shippingAddress;
  if (!updatedAddress) {
    return {
      success: true,
      message: 'Shopify accepted the update but did not return the updated shipping address',
    };
  }
  return {
    success: true,
    message: 'Shipping address updated',
    address: updatedAddress,
  };
}

// ── Cancel Order ─────────────────────────────────────────────────────────
const CANCEL_JOB_POLL_INTERVAL_MS = 1_000;
const CANCEL_JOB_MAX_WAIT_MS = 45_000;
const accessScopeCache = new Map<string, { handles: Set<string>; expiresAt: number }>();

export interface CancelOrderResult {
  success: boolean;
  message: string;
  /** Shopify's durable asynchronous cancellation job identifier, when present. */
  jobId?: string;
  /** False means Shopify accepted the job but it still needs reconciliation. */
  completed: boolean;
}

export class ShopifyCancellationPollingError extends Error {
  readonly providerReference: string;

  constructor(message: string, jobId: string) {
    super(message);
    this.name = 'ShopifyCancellationPollingError';
    this.providerReference = jobId;
  }
}

function abortReason(signal?: AbortSignal): Error {
  return signal?.reason instanceof Error
    ? signal.reason
    : new Error('Shopify cancellation polling was aborted');
}

async function waitForAbortableDelay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw abortReason(signal);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(abortReason(signal));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function waitForCancellationJob(
  jobId: string,
  brandSlug?: string,
  signal?: AbortSignal,
): Promise<boolean> {
  const deadline = Date.now() + CANCEL_JOB_MAX_WAIT_MS;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw abortReason(signal);
    const data = await shopifyGraphql<{
      job: { id: string; done: boolean } | null;
    }>(
      `query CancellationJob($id: ID!) {
        job(id: $id) { id done }
      }`,
      { id: jobId },
      brandSlug,
      signal,
    );
    if (data.job?.done) return true;

    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await waitForAbortableDelay(Math.min(CANCEL_JOB_POLL_INTERVAL_MS, remaining), signal);
  }
  return false;
}

async function hasShopifyAccessScope(
  handle: string,
  brandSlug?: string,
  signal?: AbortSignal,
): Promise<boolean> {
  const cacheKey = brandSlug || 'default';
  const cached = accessScopeCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.handles.has(handle);
  const data = await shopifyGraphql<{
    currentAppInstallation: { accessScopes: Array<{ handle: string }> } | null;
  }>(
    `query CurrentAppAccessScopes {
      currentAppInstallation { accessScopes { handle } }
    }`,
    undefined,
    brandSlug,
    signal,
  );
  const handles = new Set((data.currentAppInstallation?.accessScopes ?? []).map((scope) => scope.handle));
  accessScopeCache.set(cacheKey, { handles, expiresAt: Date.now() + 5 * 60_000 });
  return handles.has(handle);
}

export async function cancelFulfillment(
  fulfillmentId: string,
  brandSlug?: string,
  signal?: AbortSignal,
): Promise<{ success: boolean; message: string }> {
  const [canWriteFulfillments, canManageMerchantFulfillments, canManageThirdPartyFulfillments] = await Promise.all([
    hasShopifyAccessScope('write_fulfillments', brandSlug, signal),
    hasShopifyAccessScope('write_merchant_managed_fulfillment_orders', brandSlug, signal),
    hasShopifyAccessScope('write_third_party_fulfillment_orders', brandSlug, signal),
  ]);
  if (!canWriteFulfillments && !canManageMerchantFulfillments && !canManageThirdPartyFulfillments) {
    return {
      success: false,
      message:
        'The installed Shopify app is missing a fulfillment write scope required to cancel an outstanding fulfillment.',
    };
  }
  let data: {
    fulfillmentCancel: {
      fulfillment: { id: string; status: string } | null;
      userErrors: Array<{ field: string[]; message: string }>;
    };
  };
  try {
    data = await shopifyGraphql<typeof data>(
      `mutation FulfillmentCancel($id: ID!) {
        fulfillmentCancel(id: $id) {
          fulfillment { id status }
          userErrors { field message }
        }
      }`,
      { id: fulfillmentId },
      brandSlug,
      signal,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/access denied.*fulfillmentCancel|fulfillmentCancel.*access denied/i.test(message)) throw error;
    // Shopify 2026-07 still exposes the equivalent official REST endpoint.
    // An access-denied GraphQL response cannot have executed the mutation, so
    // this compatibility fallback cannot duplicate a side effect.
    return cancelFulfillmentViaRest(fulfillmentId, brandSlug, signal);
  }
  const errors = data.fulfillmentCancel.userErrors;
  if (errors.length > 0) {
    return {
      success: false,
      message: errors.map((error) => error.message).join('; '),
    };
  }
  const fulfillment = data.fulfillmentCancel.fulfillment;
  if (!fulfillment || String(fulfillment.status).toUpperCase() !== 'CANCELLED') {
    return {
      success: false,
      message: 'Shopify did not confirm that the outstanding fulfillment was cancelled.',
    };
  }
  return {
    success: true,
    message: `Fulfillment ${fulfillment.id} was cancelled.`,
  };
}

export async function cancelOrder(
  orderId: string,
  reason: string = 'CUSTOMER',
  refund: boolean = true,
  restock: boolean = true,
  brandSlug?: string,
  signal?: AbortSignal,
): Promise<CancelOrderResult> {
  let canWriteOrders = false;
  try {
    canWriteOrders = await hasShopifyAccessScope('write_orders', brandSlug, signal)
      || await hasShopifyAccessScope('write_marketplace_orders', brandSlug, signal);
  } catch (error) {
    return {
      success: false,
      completed: true,
      message: `Shopify write_orders scope could not be verified before cancellation: ${error instanceof Error ? error.message : 'unknown error'}`,
    };
  }
  if (!canWriteOrders) {
    return {
      success: false,
      completed: true,
      message: 'Shopify app access is missing write_orders (or write_marketplace_orders) scope; grant it in the Dev Dashboard and refresh the app installation token.',
    };
  }
  type CancellationPayload = {
    orderCancel: {
      job: { id: string; done: boolean } | null;
      orderCancelUserErrors: Array<{ field: string[]; message: string }>;
    };
  };
  let data: CancellationPayload;
  try {
    // Shopify Admin API 2026-07 uses refundMethod. Keep the schema-error-only
    // fallback during a rolling deployment so an accidentally stale endpoint
    // cannot turn a compatibility error into a duplicate cancellation.
    data = await shopifyGraphql<CancellationPayload>(
      `mutation OrderCancel($orderId: ID!, $reason: OrderCancelReason!, $refundMethod: OrderCancelRefundMethodInput!, $restock: Boolean!) {
      orderCancel(orderId: $orderId, reason: $reason, refundMethod: $refundMethod, restock: $restock, notifyCustomer: false) {
        job { id done }
        orderCancelUserErrors { field message }
      }
    }`,
      { orderId, reason, refundMethod: { originalPaymentMethodsRefund: refund }, restock },
      brandSlug,
      signal,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const legacySchema = /OrderCancelRefundMethodInput|unknown argument.*(?:refundMethod|notifyCustomer)|argument ['"]refund['"].*required|variable.*refundMethod.*never used/i.test(message);
    if (!legacySchema) throw error;
    // Historical 2025-01/2025-04 schemas use the Boolean form. Retrying is
    // safe only for the explicit schema-validation errors above: no resolver
    // (and therefore no cancellation) ran on the first request.
    data = await shopifyGraphql<CancellationPayload>(
      `mutation OrderCancelLegacy($orderId: ID!, $reason: OrderCancelReason!, $refund: Boolean!, $restock: Boolean!) {
        orderCancel(orderId: $orderId, reason: $reason, refund: $refund, restock: $restock) {
          job { id done }
          orderCancelUserErrors { field message }
        }
      }`,
      { orderId, reason, refund, restock },
      brandSlug,
      signal,
    );
  }

  const errors = data.orderCancel.orderCancelUserErrors;
  if (errors.length > 0) {
    return {
      success: false,
      message: errors.map((error) => error.message).join('; '),
      completed: true,
    };
  }

  const job = data.orderCancel.job;
  if (!job) {
    // Older/fallen-forward schemas can complete synchronously. The caller must
    // still refetch the order and verify `cancelledAt` before declaring success.
    return { success: true, message: 'Cancellation submitted', completed: true };
  }
  let completed = job.done;
  if (!completed) {
    try {
      completed = await waitForCancellationJob(job.id, brandSlug, signal);
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'unknown polling error';
      throw new ShopifyCancellationPollingError(
        `Shopify accepted cancellation job ${job.id}, but its completion could not be confirmed: ${detail}`,
        job.id,
      );
    }
  }
  return {
    success: true,
    message: completed ? 'Cancellation job completed' : 'Cancellation job is still processing',
    jobId: job.id,
    completed,
  };
}

// ── Refund Order ─────────────────────────────────────────────────────────
export async function refundOrder(
  orderId: string,
  amount: number,
  reason: string = 'Customer requested refund',
  notify: boolean = true,
  brandSlug?: string,
  signal?: AbortSignal,
  idempotencyKey?: string,
): Promise<{ success: boolean; message: string; refundId?: string }> {
  // Card-gateway refunds must reference the parent SALE/CAPTURE transaction —
  // Shopify rejects parentless refund transactions on anything but
  // store-credit/cash ("...require a parent_id"). Look the parent up first.
  const txData = await shopifyGraphql<{
    order: {
      transactions: Array<{ id: string; kind: string; status: string; gateway: string; amountSet: { shopMoney: { amount: string } } }>;
    } | null;
  }>(
    `query OrderTransactions($id: ID!) {
      order(id: $id) {
        transactions(first: 20) {
          id kind status gateway
          amountSet { shopMoney { amount } }
        }
      }
    }`,
    { id: orderId },
    brandSlug,
    signal,
  );

  const parents = (txData.order?.transactions ?? []).filter(
    (t) => (t.kind === 'SALE' || t.kind === 'CAPTURE') && t.status === 'SUCCESS'
  );
  // Prefer the largest successful charge as the refund parent.
  parents.sort((a, b) => parseFloat(b.amountSet.shopMoney.amount) - parseFloat(a.amountSet.shopMoney.amount));
  const parent = parents[0];

  const refundTransaction = parent
    ? { parentId: parent.id, amount: amount.toFixed(2), kind: 'REFUND', gateway: parent.gateway, orderId }
    : { amount: amount.toFixed(2), gateway: 'manual', kind: 'REFUND', orderId };

  const data = await shopifyGraphql<{
    refundCreate: {
      refund: { id: string; totalRefundedSet: { shopMoney: { amount: string; currencyCode: string } } } | null;
      userErrors: Array<{ field: string[]; message: string }>;
    };
  }>(
    `mutation RefundCreate($input: RefundInput!, $idempotencyKey: String!) {
      refundCreate(input: $input) @idempotent(key: $idempotencyKey) {
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
        transactions: [refundTransaction],
      },
      idempotencyKey: idempotencyKey || crypto.randomUUID(),
    },
    brandSlug,
    signal,
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
