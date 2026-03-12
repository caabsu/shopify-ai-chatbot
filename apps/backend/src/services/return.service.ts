import { supabase } from '../config/supabase.js';
import type { ReturnRequest, ReturnItem } from '../types/index.js';

// ── Create Return Request ─────────────────────────────────────────────────
export async function createReturnRequest(data: {
  brand_id: string;
  order_id: string;
  order_number: string;
  customer_email: string;
  customer_name?: string;
  items: Array<{
    line_item_id: string;
    fulfillment_line_item_id: string;
    product_title: string;
    variant_title?: string;
    product_image_url?: string;
    quantity: number;
    price: number;
    reason: ReturnItem['reason'];
    reason_details?: string;
    photo_urls?: string[];
  }>;
}): Promise<ReturnRequest> {
  // Insert the return request
  const { data: row, error } = await supabase
    .from('return_requests')
    .insert({
      brand_id: data.brand_id,
      order_id: data.order_id,
      order_number: data.order_number,
      customer_email: data.customer_email,
      customer_name: data.customer_name ?? null,
      status: 'pending_review',
    })
    .select()
    .single();

  if (error) {
    console.error('[return.service] createReturnRequest error:', error.message);
    throw new Error('Failed to create return request');
  }

  const returnRequest = row as ReturnRequest;

  // Insert return items
  const itemInserts = data.items.map((item) => ({
    return_request_id: returnRequest.id,
    line_item_id: item.line_item_id,
    fulfillment_line_item_id: item.fulfillment_line_item_id,
    product_title: item.product_title,
    variant_title: item.variant_title ?? null,
    product_image_url: item.product_image_url ?? null,
    quantity: item.quantity,
    price: item.price,
    reason: item.reason,
    reason_details: item.reason_details ?? null,
    photo_urls: item.photo_urls ?? null,
    item_status: 'pending',
  }));

  const { data: itemRows, error: itemsError } = await supabase
    .from('return_items')
    .insert(itemInserts)
    .select();

  if (itemsError) {
    console.error('[return.service] createReturnRequest items error:', itemsError.message);
    throw new Error('Failed to create return items');
  }

  returnRequest.items = (itemRows ?? []) as ReturnItem[];

  console.log(`[return.service] Created return request ${returnRequest.id} for order ${data.order_number} with ${data.items.length} items`);
  return returnRequest;
}

// ── Get Single Return Request ─────────────────────────────────────────────
export async function getReturnRequest(id: string): Promise<ReturnRequest | null> {
  const { data: row, error } = await supabase
    .from('return_requests')
    .select()
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    console.error('[return.service] getReturnRequest error:', error.message);
    throw new Error('Failed to get return request');
  }

  const returnRequest = row as ReturnRequest;

  // Load items
  const { data: itemRows, error: itemsError } = await supabase
    .from('return_items')
    .select()
    .eq('return_request_id', id)
    .order('created_at', { ascending: true });

  if (itemsError) {
    console.error('[return.service] getReturnRequest items error:', itemsError.message);
    throw new Error('Failed to get return items');
  }

  returnRequest.items = (itemRows ?? []) as ReturnItem[];

  return returnRequest;
}

// ── List Return Requests with Filters ─────────────────────────────────────
export async function getReturnRequests(
  brandId: string,
  filters?: {
    status?: string;
    customer_email?: string;
    page?: number;
    perPage?: number;
  }
): Promise<{ requests: ReturnRequest[]; total: number; totalPages: number }> {
  const page = filters?.page ?? 1;
  const perPage = filters?.perPage ?? 20;
  const offset = (page - 1) * perPage;

  let query = supabase
    .from('return_requests')
    .select('*', { count: 'exact' })
    .eq('brand_id', brandId);

  if (filters?.status) {
    query = query.eq('status', filters.status);
  }
  if (filters?.customer_email) {
    query = query.eq('customer_email', filters.customer_email);
  }

  const { data: rows, error, count } = await query
    .order('created_at', { ascending: false })
    .range(offset, offset + perPage - 1);

  if (error) {
    console.error('[return.service] getReturnRequests error:', error.message);
    throw new Error('Failed to list return requests');
  }

  const total = count ?? 0;

  // Load items for each return request
  const requests = (rows ?? []) as ReturnRequest[];
  if (requests.length > 0) {
    const requestIds = requests.map((r) => r.id);
    const { data: allItems, error: itemsError } = await supabase
      .from('return_items')
      .select()
      .in('return_request_id', requestIds)
      .order('created_at', { ascending: true });

    if (itemsError) {
      console.error('[return.service] getReturnRequests items error:', itemsError.message);
    } else {
      const itemsByRequest = new Map<string, ReturnItem[]>();
      for (const item of (allItems ?? []) as ReturnItem[]) {
        const existing = itemsByRequest.get(item.return_request_id) ?? [];
        existing.push(item);
        itemsByRequest.set(item.return_request_id, existing);
      }
      for (const request of requests) {
        request.items = itemsByRequest.get(request.id) ?? [];
      }
    }
  }

  return {
    requests,
    total,
    totalPages: Math.ceil(total / perPage),
  };
}

// ── Update Return Request ─────────────────────────────────────────────────
export async function updateReturnRequest(
  id: string,
  updates: Partial<Pick<
    ReturnRequest,
    'status' | 'resolution_type' | 'refund_amount' | 'admin_notes' | 'decided_by' | 'decided_at' | 'shopify_return_id' | 'ai_recommendation'
  >>
): Promise<ReturnRequest> {
  const updatePayload: Record<string, unknown> = {
    ...updates,
    updated_at: new Date().toISOString(),
  };

  const { data: row, error } = await supabase
    .from('return_requests')
    .update(updatePayload)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('[return.service] updateReturnRequest error:', error.message);
    throw new Error('Failed to update return request');
  }

  const returnRequest = row as ReturnRequest;

  // Re-load items
  const { data: itemRows, error: itemsError } = await supabase
    .from('return_items')
    .select()
    .eq('return_request_id', id)
    .order('created_at', { ascending: true });

  if (!itemsError) {
    returnRequest.items = (itemRows ?? []) as ReturnItem[];
  }

  console.log(`[return.service] Updated return request ${id}: ${JSON.stringify(Object.keys(updates))}`);
  return returnRequest;
}

// ── Update Individual Return Item Status ──────────────────────────────────
export async function updateReturnItemStatus(
  itemId: string,
  status: ReturnItem['item_status'],
  denialReason?: string
): Promise<ReturnItem> {
  const updatePayload: Record<string, unknown> = {
    item_status: status,
  };

  if (denialReason !== undefined) {
    updatePayload.denial_reason = denialReason;
  }

  const { data: row, error } = await supabase
    .from('return_items')
    .update(updatePayload)
    .eq('id', itemId)
    .select()
    .single();

  if (error) {
    console.error('[return.service] updateReturnItemStatus error:', error.message);
    throw new Error('Failed to update return item status');
  }

  console.log(`[return.service] Updated return item ${itemId} status to ${status}`);
  return row as ReturnItem;
}

// ── Get Return Stats ──────────────────────────────────────────────────────
export async function getReturnStats(
  brandId: string
): Promise<Record<string, number>> {
  const statuses = [
    'pending_review',
    'approved',
    'partially_approved',
    'denied',
    'shipped',
    'received',
    'refunded',
    'closed',
    'cancelled',
  ] as const;

  const stats: Record<string, number> = {};

  for (const status of statuses) {
    const { count, error } = await supabase
      .from('return_requests')
      .select('*', { count: 'exact', head: true })
      .eq('brand_id', brandId)
      .eq('status', status);

    if (error) {
      console.error(`[return.service] getReturnStats error for ${status}:`, error.message);
      stats[status] = 0;
    } else {
      stats[status] = count ?? 0;
    }
  }

  return stats;
}

// ── Get Returns by Customer Email ─────────────────────────────────────────
export async function getReturnsByEmail(
  email: string,
  brandId: string
): Promise<ReturnRequest[]> {
  const { data: rows, error } = await supabase
    .from('return_requests')
    .select()
    .eq('brand_id', brandId)
    .eq('customer_email', email)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[return.service] getReturnsByEmail error:', error.message);
    throw new Error('Failed to get returns by email');
  }

  const requests = (rows ?? []) as ReturnRequest[];

  // Load items for each return request
  if (requests.length > 0) {
    const requestIds = requests.map((r) => r.id);
    const { data: allItems, error: itemsError } = await supabase
      .from('return_items')
      .select()
      .in('return_request_id', requestIds)
      .order('created_at', { ascending: true });

    if (itemsError) {
      console.error('[return.service] getReturnsByEmail items error:', itemsError.message);
    } else {
      const itemsByRequest = new Map<string, ReturnItem[]>();
      for (const item of (allItems ?? []) as ReturnItem[]) {
        const existing = itemsByRequest.get(item.return_request_id) ?? [];
        existing.push(item);
        itemsByRequest.set(item.return_request_id, existing);
      }
      for (const request of requests) {
        request.items = itemsByRequest.get(request.id) ?? [];
      }
    }
  }

  return requests;
}
