import { Router } from 'express';
import { resolveBrandId } from '../config/brand.js';
import { syncRMAs, getRecentSyncLog } from '../services/rma-sync.service.js';
import { testConnection } from '../services/redstag.service.js';

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
