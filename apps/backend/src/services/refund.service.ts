// Shopify refund processing via REST API
// Uses the Shopify Admin REST API (not GraphQL) for simplicity —
// the REST refund endpoint handles transaction lookups automatically.

import { getTokenForBrand } from './shopify-auth.service.js';
import { getBrandShopifyConfig } from '../config/brand-shopify.js';
import { config } from '../config/env.js';
import { graphql } from './shopify-admin.service.js';

export interface RefundLineItem {
  lineItemId: string; // Shopify line item GID
  quantity: number;
  price: number;
  reason?: string;
}

export interface ProcessRefundResult {
  success: boolean;
  refundId?: string;
  amount?: number;
  error?: string;
}

/**
 * Look up an order by name to get its numeric REST ID.
 * Returns the numeric Shopify order ID (e.g. 6123456789012).
 */
async function getOrderNumericId(
  orderNumber: string,
  brandId?: string
): Promise<{ numericId: string; lineItems: Array<{ id: string; title: string; quantity: number; price: string }> } | null> {
  const cleanNumber = orderNumber.replace(/^[#\s]+/, '').replace(/^0+/, '') || orderNumber;

  const query = `
    query OrderForRefund($queryStr: String!) {
      orders(first: 1, query: $queryStr) {
        edges {
          node {
            id
            legacyResourceId
            lineItems(first: 50) {
              edges {
                node {
                  id
                  title
                  quantity
                  refundableQuantity
                  originalUnitPriceSet {
                    shopMoney {
                      amount
                    }
                  }
                }
              }
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
          legacyResourceId: string;
          lineItems: {
            edges: Array<{
              node: {
                id: string;
                title: string;
                quantity: number;
                refundableQuantity: number;
                originalUnitPriceSet: { shopMoney: { amount: string } };
              };
            }>;
          };
        };
      }>;
    };
  }>(query, { queryStr: `name:#${cleanNumber}` }, brandId);

  const edge = data.orders.edges[0];
  if (!edge) return null;

  return {
    numericId: edge.node.legacyResourceId,
    lineItems: edge.node.lineItems.edges
      .filter((e) => e.node.refundableQuantity > 0)
      .map((e) => ({
        id: e.node.id,
        title: e.node.title,
        quantity: e.node.refundableQuantity,
        price: e.node.originalUnitPriceSet.shopMoney.amount,
      })),
  };
}

/**
 * Process a refund for an order via Shopify Admin REST API.
 *
 * @param orderNumber  Shopify order number (e.g. "#3372" or "3372")
 * @param brandId      Brand ID for multi-brand support
 * @param restockingFeePercent  Percentage fee to deduct (0-100)
 * @param exemptReasons        Return reasons that are exempt from the restocking fee
 * @param returnReason         The reason for the return (to check fee exemption)
 * @param dryRun               If true, calculates but does not submit the refund
 */
export async function processRefund(params: {
  orderNumber: string;
  brandId?: string;
  restockingFeePercent?: number;
  exemptReasons?: string[];
  returnReason?: string;
  dryRun?: boolean;
}): Promise<ProcessRefundResult> {
  const {
    orderNumber,
    brandId,
    restockingFeePercent = 20,
    exemptReasons = ['defective', 'wrong_item', 'not_as_described'],
    returnReason,
    dryRun = false,
  } = params;

  try {
    // 1. Look up order to get numeric ID and line items
    const orderData = await getOrderNumericId(orderNumber, brandId);
    if (!orderData) {
      return { success: false, error: `Order ${orderNumber} not found in Shopify` };
    }

    const { numericId, lineItems } = orderData;

    if (lineItems.length === 0) {
      return { success: false, error: `No refundable line items found for order ${orderNumber}` };
    }

    // 2. Calculate refund amount with restocking fee
    const totalItemValue = lineItems.reduce((sum, item) => {
      return sum + parseFloat(item.price) * item.quantity;
    }, 0);

    const isExempt = returnReason
      ? exemptReasons.some((r) => r.toLowerCase() === returnReason.toLowerCase())
      : false;

    const feeMultiplier = isExempt ? 0 : restockingFeePercent / 100;
    const restockingFeeAmount = totalItemValue * feeMultiplier;
    const refundAmount = Math.max(0, totalItemValue - restockingFeeAmount);

    console.log(
      `[refund] Order ${orderNumber}: total=$${totalItemValue.toFixed(2)}, ` +
      `restocking fee=${isExempt ? 'exempt' : `${restockingFeePercent}%`} ($${restockingFeeAmount.toFixed(2)}), ` +
      `refund=$${refundAmount.toFixed(2)}, dry_run=${dryRun}`
    );

    if (dryRun) {
      return { success: true, amount: refundAmount, refundId: 'dry-run' };
    }

    // 3. Build REST refund payload
    const brandConfig = await getBrandShopifyConfig(brandId);
    const token = await getTokenForBrand(brandId);
    const apiVersion = config.shopify.apiVersion;
    const url = `https://${brandConfig.shop}.myshopify.com/admin/api/${apiVersion}/orders/${numericId}/refunds.json`;

    // Fetch primary inventory location for restocking
    const locUrl = `https://${brandConfig.shop}.myshopify.com/admin/api/${apiVersion}/locations.json`;
    const locRes = await fetch(locUrl, {
      headers: { 'X-Shopify-Access-Token': token },
    });
    let locationId: string | undefined;
    if (locRes.ok) {
      const locData = (await locRes.json()) as { locations?: Array<{ id: number; active: boolean; legacy: boolean }> };
      const primary = locData.locations?.find(l => l.active && !l.legacy) ?? locData.locations?.[0];
      if (primary) locationId = String(primary.id);
    }
    if (!locationId) {
      console.warn(`[refund] Could not find location for ${brandConfig.shop}, restocking without location`);
    }

    const refundLineItems = lineItems.map((item) => {
      // Convert GID to numeric ID for REST API: gid://shopify/LineItem/123 -> 123
      const numericLineItemId = item.id.split('/').pop() ?? item.id;
      return {
        line_item_id: numericLineItemId,
        quantity: item.quantity,
        restock_type: 'return',
        ...(locationId ? { location_id: locationId } : {}),
      };
    });

    const refundPayload = {
      refund: {
        notify: true,
        note: `Automated refund via Red Stag RMA sync${returnReason ? ` (reason: ${returnReason})` : ''}${isExempt ? '' : ` — ${restockingFeePercent}% restocking fee applied`}`,
        shipping: {
          full_refund: false,
          amount: '0.00',
        },
        refund_line_items: refundLineItems,
        transactions: [
          {
            kind: 'suggested_refund',
            amount: refundAmount.toFixed(2),
            gateway: 'shopify_payments',
          },
        ],
      },
    };

    // First, calculate the refund to get the suggested transaction
    const calcUrl = `https://${brandConfig.shop}.myshopify.com/admin/api/${apiVersion}/orders/${numericId}/refunds/calculate.json`;
    const calcRes = await fetch(calcUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': token,
      },
      body: JSON.stringify({
        refund: {
          refund_line_items: refundLineItems,
          shipping: { full_refund: false },
        },
      }),
    });

    let suggestedTransactions: Array<{ parent_id: string; amount: string; kind: string; gateway: string }> = [];

    if (calcRes.ok) {
      const calcData = (await calcRes.json()) as {
        refund?: {
          transactions?: Array<{ parent_id: string; amount: string; kind: string; gateway: string }>;
        };
      };
      suggestedTransactions = calcData.refund?.transactions ?? [];
    } else {
      console.warn(`[refund] Refund calculate returned ${calcRes.status} for order ${orderNumber}, proceeding without suggestions`);
    }

    // Build final transactions — use suggested if available, otherwise manual
    let transactions: Array<Record<string, unknown>>;
    if (suggestedTransactions.length > 0) {
      // Apply restocking fee to suggested amount if not exempt
      transactions = suggestedTransactions.map((t) => ({
        parent_id: t.parent_id,
        amount: refundAmount.toFixed(2),
        kind: 'refund',
        gateway: t.gateway,
      }));
    } else {
      // Fallback: use refund_line_items only and let Shopify calculate
      transactions = [];
    }

    // Override with our calculated amount
    const finalPayload = {
      refund: {
        ...refundPayload.refund,
        transactions: transactions.length > 0 ? transactions : undefined,
      },
    };

    // 4. Submit the refund
    const refundRes = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': token,
      },
      body: JSON.stringify(finalPayload),
    });

    const refundText = await refundRes.text();

    if (!refundRes.ok) {
      console.error(`[refund] Shopify refund API error ${refundRes.status} for order ${orderNumber}:`, refundText);
      return {
        success: false,
        error: `Shopify refund failed (${refundRes.status}): ${refundText.slice(0, 200)}`,
      };
    }

    let refundData: { refund?: { id: string | number; transactions?: Array<{ amount: string }> } };
    try {
      refundData = JSON.parse(refundText) as typeof refundData;
    } catch {
      return { success: false, error: `Invalid JSON response from Shopify refund API: ${refundText.slice(0, 100)}` };
    }

    const refundId = String(refundData.refund?.id ?? '');
    const actualAmount = parseFloat(
      refundData.refund?.transactions?.[0]?.amount ?? String(refundAmount)
    );

    console.log(`[refund] Refund ${refundId} created for order ${orderNumber}: $${actualAmount.toFixed(2)}`);

    return {
      success: true,
      refundId,
      amount: actualAmount,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[refund] processRefund error for order ${orderNumber}:`, message);
    return { success: false, error: message };
  }
}
