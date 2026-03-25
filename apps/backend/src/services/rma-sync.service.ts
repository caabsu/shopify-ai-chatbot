// RMA sync orchestrator — polls Red Stag for processed RMAs and issues Shopify refunds
import { supabase } from '../config/supabase.js';
import * as redstagService from './redstag.service.js';
import { processRefund } from './refund.service.js';
import { getReturnSettings } from './return-settings.service.js';
import { sendReturnRefunded } from './email.service.js';
import { getBrandName } from '../config/brand.js';
import { lookupOrder } from './shopify-admin.service.js';

const DRY_RUN = process.env.RMA_SYNC_DRY_RUN === 'true';

export interface RmaSyncLogEntry {
  id: string;
  delivery_id: string;
  order_number: string | null;
  customer_name: string | null;
  customer_email: string | null;
  order_total: number | null;
  line_items_summary: string | null;
  fulfillment_status: string | null;
  shopify_order_id: string | null;
  status: string;
  processed_at: string | null;
  refund_amount: number | null;
  refund_processed: boolean;
  refund_processed_at: string | null;
  return_request_id: string | null;
  shopify_refund_id: string | null;
  sku_details: Array<{ sku: string; qty: number; qty_received?: number; qty_processed?: number }> | null;
  tracking_numbers: string[] | null;
  carrier_name: string | null;
  shopify_refund_status: string | null;
  error: string | null;
  brand_id: string;
  created_at: string;
  updated_at: string;
}

export interface SyncSummary {
  synced: number;
  refunded: number;
  skipped: number;
  errors: number;
  dryRun: boolean;
}

/** Parse order number from sender_ref_alt field (strips "#" and whitespace) */
function parseOrderNumber(senderRefAlt: string | null): string | null {
  if (!senderRefAlt) return null;
  const cleaned = senderRefAlt.trim().replace(/^#/, '').trim();
  return cleaned || null;
}

/** Upsert an rma_sync_log entry by delivery_id + brand_id */
async function upsertSyncLog(
  deliveryId: string,
  brandId: string,
  fields: Partial<Omit<RmaSyncLogEntry, 'id' | 'created_at'>>
): Promise<RmaSyncLogEntry | null> {
  const { data, error } = await supabase
    .from('rma_sync_log')
    .upsert(
      {
        delivery_id: deliveryId,
        brand_id: brandId,
        updated_at: new Date().toISOString(),
        ...fields,
      },
      { onConflict: 'delivery_id' }
    )
    .select()
    .single();

  if (error) {
    console.error(`[rma-sync] Failed to upsert sync log for delivery ${deliveryId}:`, error.message);
    return null;
  }

  return data as RmaSyncLogEntry;
}

/** Check whether a delivery_id has already been refunded */
async function isAlreadyRefunded(deliveryId: string, brandId: string): Promise<boolean> {
  const { data } = await supabase
    .from('rma_sync_log')
    .select('refund_processed')
    .eq('delivery_id', deliveryId)
    .eq('brand_id', brandId)
    .single();

  return (data as { refund_processed?: boolean } | null)?.refund_processed === true;
}

/** Look up a return_request by order_number for a given brand */
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

  // Load return items to check reasons
  const { data: items } = await supabase
    .from('return_items')
    .select('reason')
    .eq('return_request_id', (data as { id: string }).id);

  return {
    ...(data as { id: string; customer_email: string; customer_name: string | null }),
    items: (items ?? []) as Array<{ reason: string }>,
  };
}

/**
 * Main sync function — polls Red Stag for processed/complete RMAs and issues Shopify refunds.
 */
export async function syncRMAs(brandId: string): Promise<SyncSummary> {
  console.log(`[rma-sync] Starting sync for brand ${brandId} (dry_run=${DRY_RUN})`);

  const summary: SyncSummary = {
    synced: 0,
    refunded: 0,
    skipped: 0,
    errors: 0,
    dryRun: DRY_RUN,
  };

  // Fetch brand's return settings for restocking fee config
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

  // Fetch processed/complete RMAs from Red Stag
  let rmas: redstagService.RMARecord[];
  try {
    rmas = await redstagService.getProcessedRMAs();
    console.log(`[rma-sync] Found ${rmas.length} processed/complete RMAs`);
  } catch (err) {
    console.error('[rma-sync] Failed to fetch RMAs from Red Stag:', err instanceof Error ? err.message : err);
    summary.errors++;
    return summary;
  }

  for (const rma of rmas) {
    const deliveryId = String(rma.delivery_id);
    summary.synced++;

    try {
      // Check if already refunded
      const alreadyDone = await isAlreadyRefunded(deliveryId, brandId);
      if (alreadyDone) {
        summary.skipped++;
        continue;
      }

      const orderNumber = parseOrderNumber(rma.sender_ref_alt);

      // Upsert log entry (without refund yet)
      // Extract SKU details from RMA items array
      let skuDetails: Array<{ sku: string; qty: number; qty_received?: number; qty_processed?: number }> | null = null;
      if (rma.items && Array.isArray(rma.items)) {
        skuDetails = (rma.items as Array<Record<string, unknown>>).map((item) => ({
          sku: String(item.sku ?? ''),
          qty: Number(item.qty ?? item.quantity ?? 0),
          qty_received: item.qty_received != null ? Number(item.qty_received) : undefined,
          qty_processed: item.qty_processed != null ? Number(item.qty_processed) : undefined,
        }));
      }

      // Extract tracking numbers and carrier from RMA
      const trackingNumbers = rma.tracking_numbers && Array.isArray(rma.tracking_numbers)
        ? rma.tracking_numbers as string[]
        : typeof rma.tracking_numbers === 'string' ? [rma.tracking_numbers] : null;
      const carrierName = typeof rma.carrier_name === 'string' ? rma.carrier_name : null;

      const baseFields: Partial<Omit<RmaSyncLogEntry, 'id' | 'created_at'>> = {
        order_number: orderNumber,
        customer_name: (rma.sender_name as string) ?? rma.customer_name ?? null,
        status: rma.status,
        processed_at: rma.updated_at ?? new Date().toISOString(),
        refund_processed: false,
        error: null,
        sku_details: skuDetails,
        tracking_numbers: trackingNumbers,
        carrier_name: carrierName,
      };

      // Enrich with Shopify order data if we have an order number
      if (orderNumber) {
        try {
          // lookupOrder requires email for verification — try with return request email first
          const returnReq = await findReturnRequest(orderNumber, brandId);
          const email = returnReq?.customer_email;
          if (email) {
            const orderResult = await lookupOrder(orderNumber, email, undefined, brandId);
            if (orderResult.found && orderResult.order) {
              const order = orderResult.order;
              baseFields.customer_email = orderResult.customerEmail ?? email;
              baseFields.customer_name = baseFields.customer_name || orderResult.order.lineItems?.[0]?.title ? (rma.sender_name as string) : null;
              baseFields.shopify_order_id = order.id;
              baseFields.fulfillment_status = order.fulfillmentStatus ?? null;
              baseFields.order_total = order.lineItems.reduce(
                (sum, li) => sum + parseFloat(li.price) * li.quantity, 0
              );
              baseFields.line_items_summary = order.lineItems
                .map((li) => `${li.title} (x${li.quantity})`)
                .join(', ');

              // Check if Shopify already shows this order as refunded
              const financialStatus = order.financialStatus?.toUpperCase() || '';
              if (financialStatus.includes('REFUND') || financialStatus.includes('PARTIALLY_REFUNDED')) {
                baseFields.shopify_refund_status = financialStatus;
                baseFields.refund_processed = true;
                baseFields.refund_processed_at = new Date().toISOString();
              }
            }
          }
        } catch (err) {
          console.warn(`[rma-sync] Failed to enrich order data for ${orderNumber}:`, err instanceof Error ? err.message : err);
        }
      }

      await upsertSyncLog(deliveryId, brandId, baseFields);

      if (!orderNumber) {
        await upsertSyncLog(deliveryId, brandId, {
          error: 'No order number in sender_ref_alt',
        });
        summary.errors++;
        console.warn(`[rma-sync] Delivery ${deliveryId} has no order number in sender_ref_alt: "${rma.sender_ref_alt}"`);
        continue;
      }

      // Look up matching return request in our DB
      const returnRequest = await findReturnRequest(orderNumber, brandId);

      // Determine return reason from return items
      const returnReason = returnRequest?.items?.[0]?.reason ?? undefined;

      // Process the refund
      const refundResult = await processRefund({
        orderNumber,
        brandId,
        restockingFeePercent: returnSettings.restocking_fee_percent,
        exemptReasons: returnSettings.restocking_fee_exempt_reasons,
        returnReason,
        dryRun: DRY_RUN,
      });

      if (refundResult.success) {
        await upsertSyncLog(deliveryId, brandId, {
          order_number: orderNumber,
          customer_name: rma.customer_name ?? returnRequest?.customer_name ?? null,
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
            `[rma-sync] Refund processed: order=${orderNumber}, delivery=${deliveryId}, ` +
            `amount=$${refundResult.amount?.toFixed(2)}, refundId=${refundResult.refundId}`
          );

          // Update the return_request status to 'refunded' if we have one
          if (returnRequest) {
            await supabase
              .from('return_requests')
              .update({ status: 'refunded', updated_at: new Date().toISOString() })
              .eq('id', returnRequest.id);
          }

          // Send customer email notification (fire-and-forget)
          const customerEmail = returnRequest?.customer_email;
          if (customerEmail) {
            const brandName = await getBrandName(brandId).catch(() => 'Support');
            sendReturnRefunded({
              to: customerEmail,
              customerName: returnRequest?.customer_name ?? undefined,
              returnRequestId: returnRequest?.id ?? deliveryId,
              orderNumber,
              items: 'Your returned items',
              refundAmount: refundResult.amount,
              brandName: brandName ?? undefined,
              brandId,
            }).catch((err: unknown) => {
              console.error(`[rma-sync] Failed to send refund email for order ${orderNumber}:`, err instanceof Error ? err.message : err);
            });
          }
        } else {
          summary.skipped++;
          console.log(
            `[rma-sync] DRY RUN — would refund order=${orderNumber}, delivery=${deliveryId}, ` +
            `amount=$${refundResult.amount?.toFixed(2)}`
          );
        }
      } else {
        await upsertSyncLog(deliveryId, brandId, {
          error: refundResult.error ?? 'Refund failed',
        });
        summary.errors++;
        console.error(
          `[rma-sync] Refund failed for order ${orderNumber} (delivery ${deliveryId}): ${refundResult.error}`
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[rma-sync] Error processing delivery ${deliveryId}:`, message);
      await upsertSyncLog(deliveryId, brandId, { error: message }).catch(() => {});
      summary.errors++;
    }
  }

  console.log(
    `[rma-sync] Sync complete: synced=${summary.synced}, refunded=${summary.refunded}, ` +
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
