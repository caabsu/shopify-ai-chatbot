import { Router } from 'express';
import { resolveBrandId } from '../config/brand.js';
import { syncRMAs, getRecentSyncLog } from '../services/rma-sync.service.js';
import { testConnection, getInventory, getWarehouses, getInboundShipments } from '../services/redstag.service.js';
import { supabase } from '../config/supabase.js';

export const rmaRouter = Router();

/**
 * GET /api/rma/sync-status
 * Returns recent rma_sync_log entries for the admin dashboard.
 */
rmaRouter.get('/sync-status', async (req, res) => {
  try {
    const brandId = await resolveBrandId(req);
    const limit = Math.min(parseInt((req.query.limit as string) || '500', 10), 500);
    const entries = await getRecentSyncLog(brandId, limit);
    res.json({ entries, count: entries.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[rma] GET /sync-status error:', message);
    res.status(500).json({ error: 'Failed to load sync log' });
  }
});

/**
 * POST /api/rma/sync-now
 * Manually trigger an RMA sync (for admin use).
 */
rmaRouter.post('/sync-now', async (req, res) => {
  try {
    const brandId = await resolveBrandId(req);
    console.log(`[rma] Manual sync triggered for brand ${brandId}`);
    const summary = await syncRMAs(brandId);
    res.json({ success: true, summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[rma] POST /sync-now error:', message);
    res.status(500).json({ error: 'Sync failed', details: message });
  }
});

/**
 * GET /api/rma/test-connection
 * Test the Red Stag API connection.
 */
rmaRouter.get('/test-connection', async (_req, res) => {
  try {
    const connected = await testConnection();
    res.json({
      connected,
      message: connected
        ? 'Successfully connected to Red Stag API'
        : 'Failed to connect to Red Stag API — check REDSTAG_API_ENDPOINT, REDSTAG_API_USER, REDSTAG_API_KEY',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[rma] GET /test-connection error:', message);
    res.status(500).json({ connected: false, error: message });
  }
});

/**
 * GET /api/rma/inventory
 * Live inventory levels from Red Stag.
 */
rmaRouter.get('/inventory', async (_req, res) => {
  try {
    const inventory = await getInventory();
    res.json({ inventory, count: inventory.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[rma] GET /inventory error:', message);
    res.status(500).json({ error: 'Failed to fetch inventory' });
  }
});

/**
 * GET /api/rma/warehouses
 * Warehouse list with addresses.
 */
rmaRouter.get('/warehouses', async (_req, res) => {
  try {
    const warehouses = await getWarehouses();
    res.json({ warehouses });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[rma] GET /warehouses error:', message);
    res.status(500).json({ error: 'Failed to fetch warehouses' });
  }
});

/**
 * GET /api/rma/inbound
 * Inbound ASN shipments from Red Stag.
 */
rmaRouter.get('/inbound', async (_req, res) => {
  try {
    const shipments = await getInboundShipments();
    res.json({ shipments, count: shipments.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[rma] GET /inbound error:', message);
    res.status(500).json({ error: 'Failed to fetch inbound shipments' });
  }
});

/**
 * GET /api/rma/analytics
 * Comprehensive returns + warehouse analytics.
 */
rmaRouter.get('/analytics', async (req, res) => {
  try {
    const brandId = await resolveBrandId(req);

    // Fetch all data in parallel
    const [
      { data: rmaLog },
      { data: returnRequests },
      { data: returnItems },
      inventory,
    ] = await Promise.all([
      supabase.from('rma_sync_log').select('*').eq('brand_id', brandId).order('rma_created_at', { ascending: false }),
      supabase.from('return_requests').select('*').eq('brand_id', brandId).order('created_at', { ascending: false }),
      supabase.from('return_items').select('*'),
      getInventory().catch(() => []),
    ]);

    const rmas = rmaLog ?? [];
    const returns = returnRequests ?? [];
    const items = returnItems ?? [];

    // ── Return Request Analytics ──
    const now = Date.now();
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

    const totalReturns = returns.length;
    const returnsThisMonth = returns.filter((r: { created_at: string }) => new Date(r.created_at).getTime() > thirtyDaysAgo).length;

    const statusCounts: Record<string, number> = {};
    returns.forEach((r: { status: string }) => {
      statusCounts[r.status] = (statusCounts[r.status] || 0) + 1;
    });

    const approvedCount = (statusCounts.approved || 0) + (statusCounts.partially_approved || 0) +
      (statusCounts.shipped || 0) + (statusCounts.received || 0) + (statusCounts.refunded || 0);
    const deniedCount = statusCounts.denied || 0;
    const decidedCount = approvedCount + deniedCount;
    const approvalRate = decidedCount > 0 ? Math.round((approvedCount / decidedCount) * 100) : 0;

    // Reason breakdown from return items
    const reasonCounts: Record<string, number> = {};
    items.forEach((i: { reason: string }) => {
      if (i.reason) reasonCounts[i.reason] = (reasonCounts[i.reason] || 0) + 1;
    });

    // Average refund
    const refundedReturns = returns.filter((r: { refund_amount: number | null }) => r.refund_amount != null && r.refund_amount > 0);
    const avgRefund = refundedReturns.length > 0
      ? refundedReturns.reduce((sum: number, r: { refund_amount: number }) => sum + r.refund_amount, 0) / refundedReturns.length
      : 0;
    const totalRefunded = refundedReturns.reduce((sum: number, r: { refund_amount: number }) => sum + r.refund_amount, 0);

    // Processing time (created_at → decided_at)
    const processingTimes = returns
      .filter((r: { decided_at: string | null }) => r.decided_at)
      .map((r: { created_at: string; decided_at: string }) => (new Date(r.decided_at).getTime() - new Date(r.created_at).getTime()) / (1000 * 60 * 60));
    const avgProcessingHours = processingTimes.length > 0
      ? processingTimes.reduce((a: number, b: number) => a + b, 0) / processingTimes.length
      : 0;

    // Daily returns (last 30 days)
    const dailyReturns: Record<string, number> = {};
    for (let d = 29; d >= 0; d--) {
      const date = new Date(now - d * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      dailyReturns[date] = 0;
    }
    returns.forEach((r: { created_at: string }) => {
      const date = r.created_at.slice(0, 10);
      if (date in dailyReturns) dailyReturns[date]++;
    });

    // ── RMA / Warehouse Analytics ──
    const rmaStatusCounts: Record<string, number> = {};
    rmas.forEach((r: { status: string }) => {
      rmaStatusCounts[r.status] = (rmaStatusCounts[r.status] || 0) + 1;
    });

    const matchMethodCounts: Record<string, number> = {};
    rmas.forEach((r: { match_method: string | null }) => {
      const m = r.match_method || 'none';
      matchMethodCounts[m] = (matchMethodCounts[m] || 0) + 1;
    });

    const rmaRefunded = rmas.filter((r: { refund_processed: boolean }) => r.refund_processed).length;
    const rmaPending = rmas.filter((r: { refund_processed: boolean; error: string | null }) => !r.refund_processed && !r.error).length;
    const rmaErrors = rmas.filter((r: { error: string | null }) => !!r.error).length;

    // RMA processing times (rma_created_at → rma_completed_at)
    const rmaProcessingDays = rmas
      .filter((r: { rma_created_at: string | null; rma_completed_at: string | null }) => r.rma_created_at && r.rma_completed_at)
      .map((r: { rma_created_at: string; rma_completed_at: string }) =>
        (new Date(r.rma_completed_at).getTime() - new Date(r.rma_created_at).getTime()) / (1000 * 60 * 60 * 24)
      );
    const avgRmaProcessingDays = rmaProcessingDays.length > 0
      ? rmaProcessingDays.reduce((a: number, b: number) => a + b, 0) / rmaProcessingDays.length
      : 0;

    // SKU-level return frequency from RMA data
    const skuReturnCounts: Record<string, number> = {};
    rmas.forEach((r: { sku_details: Array<{ sku: string; qty: number }> | null }) => {
      (r.sku_details ?? []).forEach((s) => {
        if (s.sku && !s.sku.endsWith('-Damaged')) {
          skuReturnCounts[s.sku] = (skuReturnCounts[s.sku] || 0) + 1;
        }
      });
    });

    // Exception summary
    const exceptionCounts: Record<string, number> = {};
    rmas.forEach((r: { exceptions: Array<{ reason: string }> | null }) => {
      (r.exceptions ?? []).forEach((e) => {
        exceptionCounts[e.reason] = (exceptionCounts[e.reason] || 0) + 1;
      });
    });

    // ── Inventory Summary ──
    const totalSkus = inventory.length;
    const totalOnHand = inventory.reduce((s, i) => s + i.qty_on_hand, 0);
    const totalAvailable = inventory.reduce((s, i) => s + i.qty_available, 0);
    const totalAllocated = inventory.reduce((s, i) => s + i.qty_allocated, 0);
    const lowStockSkus = inventory.filter((i) => i.qty_available > 0 && i.qty_available <= 10);
    const outOfStockSkus = inventory.filter((i) => i.qty_available === 0 && i.qty_on_hand === 0);

    res.json({
      returns: {
        total: totalReturns,
        thisMonth: returnsThisMonth,
        approvalRate,
        avgRefund: Math.round(avgRefund * 100) / 100,
        totalRefunded: Math.round(totalRefunded * 100) / 100,
        avgProcessingHours: Math.round(avgProcessingHours * 10) / 10,
        byStatus: statusCounts,
        byReason: reasonCounts,
        dailyReturns,
      },
      rma: {
        total: rmas.length,
        refunded: rmaRefunded,
        pending: rmaPending,
        errors: rmaErrors,
        avgProcessingDays: Math.round(avgRmaProcessingDays * 10) / 10,
        byStatus: rmaStatusCounts,
        byMatchMethod: matchMethodCounts,
        skuReturnFrequency: Object.entries(skuReturnCounts).sort((a, b) => b[1] - a[1]).slice(0, 20),
        exceptionSummary: exceptionCounts,
      },
      inventory: {
        totalSkus,
        totalOnHand: Math.round(totalOnHand),
        totalAvailable: Math.round(totalAvailable),
        totalAllocated: Math.round(totalAllocated),
        lowStock: lowStockSkus.map((i) => ({ sku: i.sku, available: i.qty_available, onHand: i.qty_on_hand })),
        outOfStock: outOfStockSkus.map((i) => ({ sku: i.sku })),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[rma] GET /analytics error:', message);
    res.status(500).json({ error: 'Failed to compute analytics' });
  }
});
