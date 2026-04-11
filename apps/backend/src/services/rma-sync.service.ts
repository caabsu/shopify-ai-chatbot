// RMA Sync Agent — fetches ALL RMAs from Red Stag, intelligently matches to Shopify orders,
// captures rich warehouse data (exceptions, status history, containers), and issues refunds.
//
// Matching strategy (in order of priority):
// 1. Order number from sender_ref_alt (e.g. "#3372" or "3372")
// 2. Customer name → Shopify order search → SKU cross-reference
// 3. SKU search → customer name cross-reference
// 4. Tracking number match against existing return_requests
//
// If no match found, the RMA is still logged with all Red Stag data for manual review.

import { supabase } from '../config/supabase.js';
import * as redstagService from './redstag.service.js';
import type { RMARecord } from './redstag.service.js';
import { processRefund } from './refund.service.js';
import { getReturnSettings } from './return-settings.service.js';
import { sendReturnRefunded } from './email.service.js';
import { getBrandName } from '../config/brand.js';
import { lookupOrder, searchOrdersByCustomerName, searchOrdersBySku } from './shopify-admin.service.js';

const DRY_RUN = process.env.RMA_SYNC_DRY_RUN === 'true';

export interface RmaSyncLogEntry {
  id: string;
  delivery_id: string;
  increment_id: string | null;
  order_number: string | null;
  customer_name: string | null;
  customer_email: string | null;
  order_total: number | null;
  line_items_summary: string | null;
  fulfillment_status: string | null;
  shopify_order_id: string | null;
  status: string;
  rma_state: string | null;
  processed_at: string | null;
  refund_amount: number | null;
  refund_processed: boolean;
  refund_processed_at: string | null;
  return_request_id: string | null;
  shopify_refund_id: string | null;
  sku_details: Array<{ sku: string; qty: number; qty_expected?: number; qty_received?: number; qty_processed?: number; qty_shortage?: number; qty_overage?: number }> | null;
  tracking_numbers: string[] | null;
  carrier_name: string | null;
  shopify_refund_status: string | null;
  rma_created_at: string | null;
  rma_delivered_at: string | null;
  rma_completed_at: string | null;
  warehouse_id: string | null;
  exceptions: Array<{ reason: string; comment: string | null; status: string; qty: string; sku?: string }> | null;
  status_history: Array<{ status: string; comment: string | null; created_at: string }> | null;
  containers: Array<{ weight: string; weight_unit: string; damage_type: string; notes: string | null }> | null;
  sender_ref_alt: string | null;
  match_method: string | null;
  weight_info: { total_weight: string; weight_unit: string } | null;
  error: string | null;
  brand_id: string;
  created_at: string;
  updated_at: string;
}

export interface SyncSummary {
  synced: number;
  matched: number;
  refunded: number;
  skipped: number;
  errors: number;
  unmatched: number;
  dryRun: boolean;
}

// ─── Order Number Parsing ────────────────────────────────────────────────

/** Parse order number from sender_ref_alt field. Returns null for "NO ORDER", empty, or non-numeric values. */
function parseOrderNumber(senderRefAlt: string | null): string | null {
  if (!senderRefAlt) return null;
  const cleaned = senderRefAlt.trim().replace(/^#/, '').trim();
  if (!cleaned || cleaned.toUpperCase() === 'NO ORDER') return null;
  // Must contain at least one digit to be a valid order number
  if (!/\d/.test(cleaned)) return null;
  return cleaned;
}

// ─── Database Operations ─────────────────────────────────────────────────

async function upsertSyncLog(
  deliveryId: string,
  brandId: string,
  fields: Partial<Omit<RmaSyncLogEntry, 'id' | 'created_at'>>
): Promise<RmaSyncLogEntry | null> {
  const now = new Date().toISOString();

  // Check if row exists first
  const { data: existing } = await supabase
    .from('rma_sync_log')
    .select('id')
    .eq('delivery_id', deliveryId)
    .eq('brand_id', brandId)
    .single();

  if (existing) {
    // Update existing row
    const { data, error } = await supabase
      .from('rma_sync_log')
      .update({ updated_at: now, ...fields })
      .eq('delivery_id', deliveryId)
      .eq('brand_id', brandId)
      .select()
      .single();

    if (error) {
      console.error(`[rma-sync] Failed to update sync log for delivery ${deliveryId}:`, error.message);
      return null;
    }
    return data as RmaSyncLogEntry;
  } else {
    // Insert new row — must include required fields
    const { data, error } = await supabase
      .from('rma_sync_log')
      .insert({
        delivery_id: deliveryId,
        brand_id: brandId,
        updated_at: now,
        status: fields.status ?? 'unknown',
        refund_processed: fields.refund_processed ?? false,
        ...fields,
      })
      .select()
      .single();

    if (error) {
      console.error(`[rma-sync] Failed to insert sync log for delivery ${deliveryId}:`, error.message);
      return null;
    }
    return data as RmaSyncLogEntry;
  }
}

async function isAlreadyRefunded(deliveryId: string, brandId: string): Promise<boolean> {
  const { data } = await supabase
    .from('rma_sync_log')
    .select('refund_processed')
    .eq('delivery_id', deliveryId)
    .eq('brand_id', brandId)
    .single();

  return (data as { refund_processed?: boolean } | null)?.refund_processed === true;
}

async function findReturnRequest(
  orderNumber: string,
  brandId: string
): Promise<{
  id: string;
  customer_email: string;
  customer_name: string | null;
  items?: Array<{ reason: string }>;
} | null> {
  const { data } = await supabase
    .from('return_requests')
    .select('id, customer_email, customer_name')
    .eq('brand_id', brandId)
    .eq('order_number', orderNumber)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (!data) return null;

  const { data: items } = await supabase
    .from('return_items')
    .select('reason')
    .eq('return_request_id', (data as { id: string }).id);

  return {
    ...(data as { id: string; customer_email: string; customer_name: string | null }),
    items: (items ?? []) as Array<{ reason: string }>,
  };
}

// ─── Smart Order Matching ────────────────────────────────────────────────

interface MatchResult {
  orderNumber: string;
  shopifyOrderId: string;
  customerEmail: string | null;
  customerName: string | null;
  method: string; // 'order_number' | 'name_sku_match' | 'sku_name_match' | 'name_only'
}

/**
 * Attempts to match an RMA to a Shopify order using multiple strategies.
 * Returns the match result or null if no match found.
 */
async function matchRmaToOrder(rma: RMARecord, brandId: string): Promise<MatchResult | null> {
  const senderName = (rma.sender_name ?? '').trim();
  const skus = (rma.items ?? [])
    .map((i) => i.sku)
    .filter((s) => s && !s.endsWith('-Damaged'));

  // Strategy 1: Direct order number lookup
  const orderNumber = parseOrderNumber(rma.sender_ref_alt);
  if (orderNumber) {
    try {
      const result = await lookupOrder(orderNumber, undefined, undefined, brandId, true);
      if (result.found && result.order) {
        return {
          orderNumber,
          shopifyOrderId: result.order.id,
          customerEmail: result.customerEmail ?? null,
          customerName: result.customerName ?? null,
          method: 'order_number',
        };
      }
    } catch (err) {
      console.warn(`[rma-sync] Order lookup failed for #${orderNumber}:`, err instanceof Error ? err.message : err);
    }
  }

  // Strategy 2: Search by customer name, then cross-reference SKUs
  if (senderName && senderName.toUpperCase() !== 'NA') {
    try {
      const nameResults = await searchOrdersByCustomerName(senderName, brandId, 10);

      if (nameResults.length > 0 && skus.length > 0) {
        // Find orders where at least one SKU matches
        for (const order of nameResults) {
          const orderSkus = order.lineItems.map((li) => li.sku).filter(Boolean);
          const hasSkuMatch = skus.some((sku) => orderSkus.includes(sku));
          if (hasSkuMatch) {
            const orderNum = order.name.replace(/^#/, '');
            return {
              orderNumber: orderNum,
              shopifyOrderId: order.id,
              customerEmail: order.email,
              customerName: order.customerName,
              method: 'name_sku_match',
            };
          }
        }

        // No SKU match but name matched — use first result if name is close
        const firstOrder = nameResults[0];
        if (firstOrder.customerName && namesMatch(senderName, firstOrder.customerName)) {
          const orderNum = firstOrder.name.replace(/^#/, '');
          return {
            orderNumber: orderNum,
            shopifyOrderId: firstOrder.id,
            customerEmail: firstOrder.email,
            customerName: firstOrder.customerName,
            method: 'name_only',
          };
        }
      } else if (nameResults.length > 0) {
        // No SKUs to cross-reference, rely on name match quality
        const firstOrder = nameResults[0];
        if (firstOrder.customerName && namesMatch(senderName, firstOrder.customerName)) {
          const orderNum = firstOrder.name.replace(/^#/, '');
          return {
            orderNumber: orderNum,
            shopifyOrderId: firstOrder.id,
            customerEmail: firstOrder.email,
            customerName: firstOrder.customerName,
            method: 'name_only',
          };
        }
      }
    } catch (err) {
      console.warn(`[rma-sync] Name search failed for "${senderName}":`, err instanceof Error ? err.message : err);
    }
  }

  // Strategy 3: Search by SKU, then cross-reference customer name
  if (skus.length > 0 && senderName && senderName.toUpperCase() !== 'NA') {
    for (const sku of skus) {
      try {
        const skuResults = await searchOrdersBySku(sku, brandId, 10);
        for (const order of skuResults) {
          if (order.customerName && namesMatch(senderName, order.customerName)) {
            const orderNum = order.name.replace(/^#/, '');
            return {
              orderNumber: orderNum,
              shopifyOrderId: order.id,
              customerEmail: order.email,
              customerName: order.customerName,
              method: 'sku_name_match',
            };
          }
        }
      } catch (err) {
        console.warn(`[rma-sync] SKU search failed for "${sku}":`, err instanceof Error ? err.message : err);
      }
    }
  }

  return null;
}

/** Fuzzy name comparison — checks if both names have overlapping words. */
function namesMatch(name1: string, name2: string): boolean {
  const normalize = (n: string) => n.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(Boolean);
  const words1 = normalize(name1);
  const words2 = normalize(name2);
  if (words1.length === 0 || words2.length === 0) return false;
  const matching = words1.filter((w) => words2.some((w2) => w === w2 || w.includes(w2) || w2.includes(w)));
  // At least one word must match, and it must be a significant portion
  return matching.length >= Math.min(words1.length, words2.length);
}

// ─── Data Extraction ─────────────────────────────────────────────────────

function extractRichFields(rma: RMARecord): Partial<Omit<RmaSyncLogEntry, 'id' | 'created_at'>> {
  // SKU details with full warehouse quantities
  const skuDetails = (rma.items ?? []).map((item) => ({
    sku: item.sku ?? '',
    qty: parseFloat(item.qty ?? '0'),
    qty_expected: parseFloat(item.qty_expected ?? '0'),
    qty_received: parseFloat(item.qty_received ?? '0'),
    qty_processed: parseFloat(item.qty_processed ?? '0'),
    qty_shortage: parseFloat(item.qty_shortage ?? '0'),
    qty_overage: parseFloat(item.qty_overage ?? '0'),
  }));

  // Exceptions (damage reports, shortages, etc.)
  const exceptions = (rma.exceptions ?? []).map((exc) => {
    // Try to find the SKU for this exception via delivery_item_id
    const matchingItem = (rma.items ?? []).find((i) => i.delivery_item_id === exc.delivery_item_id);
    return {
      reason: exc.reason,
      comment: exc.comment,
      status: exc.status,
      qty: exc.qty,
      sku: matchingItem?.sku ?? undefined,
    };
  });

  // Status history (full timeline)
  const statusHistory = (rma.status_history ?? []).map((h) => ({
    status: h.status,
    comment: h.comment,
    created_at: h.created_at,
  }));

  // Container info
  const containers = (rma.containers ?? []).map((c) => ({
    weight: c.weight,
    weight_unit: c.weight_unit ?? 'lb',
    damage_type: c.damage_type,
    notes: c.notes,
  }));

  // Total weight from containers
  const totalWeight = (rma.containers ?? []).reduce((sum, c) => sum + parseFloat(c.weight ?? '0'), 0);
  const weightUnit = rma.containers?.[0]?.weight_unit ?? 'lb';

  const trackingNumbers = Array.isArray(rma.tracking_numbers)
    ? rma.tracking_numbers as string[]
    : typeof rma.tracking_numbers === 'string' ? [rma.tracking_numbers] : null;

  return {
    increment_id: rma.increment_id ?? null,
    customer_name: rma.sender_name ?? null,
    status: rma.status,
    rma_state: rma.state ?? null,
    processed_at: rma.processed_at ?? null,
    carrier_name: typeof rma.carrier_name === 'string' ? rma.carrier_name : null,
    warehouse_id: rma.warehouse_id ?? null,
    tracking_numbers: trackingNumbers,
    sender_ref_alt: rma.sender_ref_alt ?? null,
    rma_created_at: rma.created_at ?? null,
    rma_delivered_at: rma.delivered_at ?? null,
    rma_completed_at: rma.completed_at ?? null,
    sku_details: skuDetails.length > 0 ? skuDetails : null,
    exceptions: exceptions.length > 0 ? exceptions : null,
    status_history: statusHistory.length > 0 ? statusHistory : null,
    containers: containers.length > 0 ? containers : null,
    weight_info: totalWeight > 0 ? { total_weight: totalWeight.toFixed(2), weight_unit: weightUnit } : null,
  };
}

// ─── Main Sync ───────────────────────────────────────────────────────────

/**
 * Main sync function — fetches ALL RMAs from Red Stag, intelligently matches
 * them to Shopify orders, captures rich data, and issues refunds for completed ones.
 */
export async function syncRMAs(brandId: string): Promise<SyncSummary> {
  console.log(`[rma-sync] Starting sync for brand ${brandId} (dry_run=${DRY_RUN})`);

  const summary: SyncSummary = {
    synced: 0,
    matched: 0,
    refunded: 0,
    skipped: 0,
    errors: 0,
    unmatched: 0,
    dryRun: DRY_RUN,
  };

  // Load return settings for restocking fee config
  let returnSettings: { restocking_fee_percent: number; restocking_fee_exempt_reasons: string[] };
  try {
    const settings = await getReturnSettings(brandId);
    returnSettings = {
      restocking_fee_percent: settings.restocking_fee_percent ?? 20,
      restocking_fee_exempt_reasons: settings.restocking_fee_exempt_reasons ?? ['defective', 'wrong_item', 'not_as_described'],
    };
  } catch (err) {
    console.warn('[rma-sync] Failed to load return settings, using defaults:', err instanceof Error ? err.message : err);
    returnSettings = { restocking_fee_percent: 20, restocking_fee_exempt_reasons: ['defective', 'wrong_item', 'not_as_described'] };
  }

  // Fetch ALL RMAs from Red Stag (all statuses)
  let rmas: RMARecord[];
  try {
    rmas = await redstagService.getAllRMAs();
    console.log(`[rma-sync] Found ${rmas.length} total RMAs across all statuses`);
  } catch (err) {
    console.error('[rma-sync] Failed to fetch RMAs from Red Stag:', err instanceof Error ? err.message : err);
    summary.errors++;
    return summary;
  }

  for (const rma of rmas) {
    const deliveryId = String(rma.delivery_id);
    summary.synced++;

    try {
      // Extract rich data from Red Stag
      const richFields = extractRichFields(rma);

      // Check if already refunded (skip refund processing but still update data)
      const alreadyDone = await isAlreadyRefunded(deliveryId, brandId);

      // Try to match to a Shopify order
      const match = await matchRmaToOrder(rma, brandId);

      const baseFields: Partial<Omit<RmaSyncLogEntry, 'id' | 'created_at'>> = {
        ...richFields,
        refund_processed: false,
        error: null,
      };

      if (match) {
        summary.matched++;
        baseFields.order_number = match.orderNumber;
        baseFields.shopify_order_id = match.shopifyOrderId;
        baseFields.customer_email = match.customerEmail;
        if (match.customerName) baseFields.customer_name = match.customerName;
        baseFields.match_method = match.method;

        console.log(`[rma-sync] Matched delivery ${deliveryId} → order #${match.orderNumber} (method: ${match.method})`);

        // Enrich with full Shopify order data
        try {
          const orderResult = await lookupOrder(match.orderNumber, undefined, undefined, brandId, true);
          if (orderResult.found && orderResult.order) {
            const order = orderResult.order;
            baseFields.fulfillment_status = order.fulfillmentStatus ?? null;
            baseFields.order_total = order.lineItems.reduce(
              (sum, li) => sum + parseFloat(li.price) * li.quantity, 0
            );
            baseFields.line_items_summary = order.lineItems
              .map((li) => `${li.title} (x${li.quantity})`)
              .join(', ');

            const financialStatus = order.financialStatus?.toUpperCase() || '';
            baseFields.shopify_refund_status = financialStatus;

            if (order.totalRefunded > 0) {
              baseFields.refund_amount = order.totalRefunded;
              baseFields.refund_processed = true;
              baseFields.refund_processed_at = baseFields.rma_completed_at || new Date().toISOString();
            } else if (financialStatus === 'REFUNDED' || financialStatus === 'PARTIALLY_REFUNDED') {
              baseFields.refund_processed = true;
              baseFields.refund_processed_at = baseFields.rma_completed_at || new Date().toISOString();
            }
          }
        } catch (err) {
          console.warn(`[rma-sync] Failed to enrich order data for #${match.orderNumber}:`, err instanceof Error ? err.message : err);
        }
      } else {
        summary.unmatched++;
        baseFields.match_method = 'none';
        baseFields.order_number = parseOrderNumber(rma.sender_ref_alt);
        console.log(`[rma-sync] No match for delivery ${deliveryId} (sender: "${rma.sender_name}", ref: "${rma.sender_ref_alt}")`);
      }

      // Always upsert the sync log with the latest data
      await upsertSyncLog(deliveryId, brandId, baseFields);

      // Skip refund processing if already done or not in refund-eligible status
      if (alreadyDone) {
        summary.skipped++;
        continue;
      }

      // Only process refunds for completed/processed RMAs that we matched
      const isRefundEligible = ['processed', 'complete', 'put_away'].includes(rma.status);
      if (!isRefundEligible || !match) {
        continue;
      }

      // Look up return request for reason-based fee exemption
      const returnRequest = match.orderNumber
        ? await findReturnRequest(match.orderNumber, brandId)
        : null;
      const returnReason = returnRequest?.items?.[0]?.reason ?? undefined;

      // Process the refund
      const refundResult = await processRefund({
        orderNumber: match.orderNumber,
        brandId,
        restockingFeePercent: returnSettings.restocking_fee_percent,
        exemptReasons: returnSettings.restocking_fee_exempt_reasons,
        returnReason,
        dryRun: DRY_RUN,
      });

      if (refundResult.success) {
        await upsertSyncLog(deliveryId, brandId, {
          refund_processed: !DRY_RUN,
          refund_processed_at: DRY_RUN ? null : new Date().toISOString(),
          refund_amount: refundResult.amount ?? null,
          shopify_refund_id: refundResult.refundId !== 'dry-run' ? refundResult.refundId : null,
          return_request_id: returnRequest?.id ?? null,
          error: null,
        });

        if (!DRY_RUN) {
          summary.refunded++;
          console.log(
            `[rma-sync] Refund processed: order=#${match.orderNumber}, delivery=${deliveryId}, ` +
            `amount=$${refundResult.amount?.toFixed(2)}, refundId=${refundResult.refundId}`
          );

          if (returnRequest) {
            await supabase
              .from('return_requests')
              .update({ status: 'refunded', updated_at: new Date().toISOString() })
              .eq('id', returnRequest.id);
          }

          // Send customer email (fire-and-forget)
          const customerEmail = match.customerEmail ?? returnRequest?.customer_email;
          if (customerEmail) {
            const brandName = await getBrandName(brandId).catch(() => 'Support');
            sendReturnRefunded({
              to: customerEmail,
              customerName: match.customerName ?? returnRequest?.customer_name ?? undefined,
              returnRequestId: returnRequest?.id ?? deliveryId,
              orderNumber: match.orderNumber,
              items: 'Your returned items',
              refundAmount: refundResult.amount,
              brandName: brandName ?? undefined,
              brandId,
            }).catch((err: unknown) => {
              console.error(`[rma-sync] Failed to send refund email:`, err instanceof Error ? err.message : err);
            });
          }
        } else {
          summary.skipped++;
          console.log(
            `[rma-sync] DRY RUN — would refund order=#${match.orderNumber}, amount=$${refundResult.amount?.toFixed(2)}`
          );
        }
      } else {
        await upsertSyncLog(deliveryId, brandId, {
          error: refundResult.error ?? 'Refund failed',
        });
        summary.errors++;
        console.error(`[rma-sync] Refund failed for order #${match.orderNumber}: ${refundResult.error}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[rma-sync] Error processing delivery ${deliveryId}:`, message);
      await upsertSyncLog(deliveryId, brandId, { error: message }).catch(() => {});
      summary.errors++;
    }
  }

  console.log(
    `[rma-sync] Sync complete: synced=${summary.synced}, matched=${summary.matched}, ` +
    `unmatched=${summary.unmatched}, refunded=${summary.refunded}, ` +
    `skipped=${summary.skipped}, errors=${summary.errors}, dry_run=${DRY_RUN}`
  );

  return summary;
}

/**
 * Get recent rma_sync_log entries for the admin dashboard.
 */
export async function getRecentSyncLog(
  brandId: string,
  limit = 50
): Promise<RmaSyncLogEntry[]> {
  const { data, error } = await supabase
    .from('rma_sync_log')
    .select('*')
    .eq('brand_id', brandId)
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('[rma-sync] Failed to load sync log:', error.message);
    return [];
  }

  return (data ?? []) as RmaSyncLogEntry[];
}
