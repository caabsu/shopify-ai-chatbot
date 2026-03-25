// Red Stag Fulfillment (ShipStream WMS) API client
// Protocol: JSON-RPC 2.0 with session-based auth

let sessionId: string | null = null;
let sessionExpiry = 0;

async function getSession(): Promise<string> {
  if (sessionId && Date.now() < sessionExpiry) return sessionId;

  const endpoint = process.env.REDSTAG_API_ENDPOINT;
  const user = process.env.REDSTAG_API_USER;
  const key = process.env.REDSTAG_API_KEY;

  if (!endpoint || !user || !key) {
    throw new Error('Red Stag API credentials not configured (REDSTAG_API_ENDPOINT, REDSTAG_API_USER, REDSTAG_API_KEY)');
  }

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'login',
      params: [user, key],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Red Stag login HTTP error (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { result?: string; error?: { code: number; message: string } };
  if (data.error) throw new Error(`Red Stag login failed: ${data.error.message}`);
  if (!data.result) throw new Error('Red Stag login returned no session ID');

  sessionId = data.result;
  sessionExpiry = Date.now() + 23 * 60 * 60 * 1000; // 23 hours (session lasts 24h)
  console.log('[redstag] Session established');
  return sessionId;
}

async function rpc(method: string, params: unknown[]): Promise<unknown> {
  const sid = await getSession();
  const endpoint = process.env.REDSTAG_API_ENDPOINT!;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'call',
      params: [sid, method, params],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Red Stag RPC HTTP error (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { result?: unknown; error?: { code: number; message: string } };

  if (data.error) {
    // Session expired — clear and retry once
    const isSessionError =
      data.error.code === -32005 ||
      data.error.message?.toLowerCase().includes('session') ||
      data.error.message?.toLowerCase().includes('login');

    if (isSessionError) {
      console.log('[redstag] Session expired, refreshing and retrying...');
      sessionId = null;
      sessionExpiry = 0;

      const newSid = await getSession();
      const retryRes = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: Date.now(),
          method: 'call',
          params: [newSid, method, params],
        }),
      });

      if (!retryRes.ok) {
        const text = await retryRes.text();
        throw new Error(`Red Stag RPC retry HTTP error (${retryRes.status}): ${text}`);
      }

      const retryData = (await retryRes.json()) as { result?: unknown; error?: { code: number; message: string } };
      if (retryData.error) throw new Error(`Red Stag RPC ${method} failed after retry: ${retryData.error.message}`);
      return retryData.result;
    }

    throw new Error(`Red Stag RPC ${method} failed: ${data.error.message}`);
  }

  return data.result;
}

export interface RMARecord {
  delivery_id: string | number;
  sender_ref_alt: string | null;
  status: string;
  customer_name: string | null;
  updated_at: string | null;
  created_at: string | null;
  [key: string]: unknown;
}

/**
 * Search RMAs in Red Stag.
 * Merges delivery_type=rma filter with any additional filters provided.
 */
export async function searchRMAs(
  filters: Record<string, unknown> = {},
  fields?: string[],
  limit = 100
): Promise<RMARecord[]> {
  const mergedFilters = { delivery_type: { eq: 'rma' }, ...filters };

  const params: unknown[] = [mergedFilters];
  if (fields) params.push(fields);
  else params.push(null);
  params.push(limit);

  const result = await rpc('delivery.search', params) as { results?: RMARecord[] } | RMARecord[];
  if (Array.isArray(result)) return result;
  if (result && typeof result === 'object' && 'results' in result && Array.isArray(result.results)) {
    return result.results;
  }
  return [];
}

/**
 * Get full detail for a single RMA by delivery_id.
 */
export async function getRMADetail(deliveryId: string | number): Promise<RMARecord> {
  const result = await rpc('delivery.info', [{ delivery_id: deliveryId }]);
  return result as RMARecord;
}

/**
 * Get all RMAs with status "processed" or "complete".
 * Optionally filters to records updated after `since`.
 */
export async function getProcessedRMAs(since?: Date): Promise<RMARecord[]> {
  const filters: Record<string, unknown> = {
    status: { in: ['processed', 'complete'] },
  };

  if (since) {
    filters.updated_at = { from: since.toISOString().slice(0, 19).replace('T', ' ') };
  }

  return searchRMAs(filters, [
    'delivery_id', 'status', 'sender_ref_alt', 'sender_name',
    'processed_at', 'completed_at', 'created_at', 'updated_at',
    'merchant_ref', 'merchant_status', 'items',
  ], 200);
}

/**
 * Test the Red Stag connection by performing a login.
 * Returns true on success, false on failure.
 */
export async function testConnection(): Promise<boolean> {
  try {
    // Force a fresh login attempt
    sessionId = null;
    sessionExpiry = 0;
    await getSession();
    return true;
  } catch (err) {
    console.error('[redstag] testConnection failed:', err instanceof Error ? err.message : err);
    return false;
  }
}
