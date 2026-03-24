import { supabase } from '../config/supabase.js';
import * as shopifyAdmin from './shopify-admin.service.js';
import { getTrackingSettings, DEFAULT_STATUS_MESSAGES, DEFAULT_CARRIER_NAMES } from './tracking-settings.service.js';
import type { TrackingResult, TrackingEvent, TrackingOrderInfo } from '../types/index.js';

// ── Shopify fulfillment status → our status mapping ─────────────────────────

function mapShopifyStatus(
  displayStatus: string | null,
  events: Array<{ status: string }>,
): TrackingResult['status'] {
  // Check displayStatus first
  const ds = (displayStatus || '').toUpperCase();
  if (ds === 'DELIVERED') return 'delivered';
  if (ds === 'OUT_FOR_DELIVERY') return 'out_for_delivery';
  if (ds === 'IN_TRANSIT') return 'in_transit';
  if (ds === 'LABEL_PRINTED' || ds === 'LABEL_PURCHASED' || ds === 'CONFIRMED') return 'info_received';
  if (ds === 'ATTEMPTED_DELIVERY' || ds === 'FAILURE') return 'exception';

  // Fallback: check latest event status
  if (events.length > 0) {
    const latest = events[events.length - 1].status.toUpperCase();
    if (latest === 'DELIVERED') return 'delivered';
    if (latest === 'OUT_FOR_DELIVERY') return 'out_for_delivery';
    if (latest === 'IN_TRANSIT') return 'in_transit';
    if (latest === 'CONFIRMED' || latest === 'LABEL_PRINTED') return 'info_received';
    if (latest === 'ATTEMPTED_DELIVERY' || latest === 'FAILURE') return 'exception';
  }

  return 'in_transit';
}

function mapShopifyEventDescription(status: string, message: string | null): string {
  if (message) return message;
  // Friendly names for Shopify status codes
  const map: Record<string, string> = {
    CONFIRMED: 'Order Confirmed',
    LABEL_PRINTED: 'Shipping Label Created',
    LABEL_PURCHASED: 'Shipping Label Purchased',
    IN_TRANSIT: 'In Transit',
    OUT_FOR_DELIVERY: 'Out for Delivery',
    ATTEMPTED_DELIVERY: 'Delivery Attempted',
    DELIVERED: 'Delivered',
    FAILURE: 'Delivery Exception',
    READY_FOR_PICKUP: 'Ready for Pickup',
    PICKED_UP: 'Picked Up',
  };
  return map[status.toUpperCase()] || status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ── Carrier display name resolution ──────────────────────────────────────────

function resolveCarrierDisplay(carrier: string, carrierNames: Record<string, string>): string {
  const key = carrier.toLowerCase();
  return carrierNames[key] ?? DEFAULT_CARRIER_NAMES[key] ?? carrier;
}

// ── lookupByOrder — PRIMARY: uses Shopify fulfillment events (free) ──────────

export async function lookupByOrder(
  orderNumber: string,
  email: string,
  brandId: string,
): Promise<TrackingResult> {
  const settings = await getTrackingSettings(brandId);
  const statusMessages = { ...DEFAULT_STATUS_MESSAGES, ...settings.custom_status_messages };
  const carrierNames = { ...DEFAULT_CARRIER_NAMES, ...settings.carrier_display_names };

  const lookupResult = await shopifyAdmin.lookupOrder(orderNumber, email, undefined, brandId);

  if (!lookupResult.found || !lookupResult.order) {
    const notFoundResult: TrackingResult = {
      trackingNumber: '',
      carrier: 'unknown',
      carrierDisplay: 'Unknown',
      status: 'not_found',
      statusMessage: lookupResult.message?.includes('VERIFICATION_FAILED')
        ? 'Email does not match.'
        : (statusMessages.not_found ?? DEFAULT_STATUS_MESSAGES.not_found),
      statusDetail: lookupResult.message?.includes('VERIFICATION_FAILED')
        ? 'The email address you entered does not match this order. Please double-check and try again.'
        : 'We couldn\'t find that order. Please check your order number and try again.',
      estimatedDelivery: null,
      signedBy: null,
      deliveredAt: null,
      events: [],
      order: null,
    };
    // Fire-and-forget lookup log
    supabase.from('tracking_lookups').insert({
      brand_id: brandId,
      order_number: orderNumber,
      email: email,
      tracking_number: null,
      lookup_type: 'order',
      status: notFoundResult.status,
      carrier: null,
    }).then(null, () => {});
    return notFoundResult;
  }

  const order = lookupResult.order;

  // Build order info
  const orderInfo: TrackingOrderInfo = {
    orderNumber: order.name,
    lineItems: order.lineItems.map((item) => ({
      title: item.title,
      variant: null,
      quantity: item.quantity,
      price: item.price,
      imageUrl: item.imageUrl,
    })),
    destination:
      order.shippingCity && order.shippingCountry
        ? `${order.shippingCity}, ${order.shippingCountry}`
        : order.shippingCity ?? order.shippingCountry ?? null,
    transitDays: null,
    total: null,
  };

  // Calculate total from line items
  const totalAmount = order.lineItems.reduce((sum, item) => sum + parseFloat(item.price) * item.quantity, 0);
  if (totalAmount > 0) {
    orderInfo.total = `$${totalAmount.toFixed(2)}`;
  }

  // If no tracking numbers, return info_received
  if (!order.tracking || order.tracking.length === 0) {
    const infoResult: TrackingResult = {
      trackingNumber: '',
      carrier: 'unknown',
      carrierDisplay: 'Unknown',
      status: 'info_received',
      statusMessage: statusMessages.info_received ?? DEFAULT_STATUS_MESSAGES.info_received,
      statusDetail: 'Your order has been confirmed. Tracking information will be available once your order ships.',
      estimatedDelivery: order.estimatedDelivery ?? null,
      signedBy: null,
      deliveredAt: null,
      events: [],
      order: orderInfo,
    };
    // Fire-and-forget lookup log
    supabase.from('tracking_lookups').insert({
      brand_id: brandId,
      order_number: orderNumber,
      email: email,
      tracking_number: null,
      lookup_type: 'order',
      status: infoResult.status,
      carrier: null,
    }).then(null, () => {});
    return infoResult;
  }

  // Use Shopify fulfillment events (free, native)
  const firstTracking = order.tracking[0];
  const trackingNumber = firstTracking.number;
  const carrier = firstTracking.company || 'unknown';
  const carrierDisplay = resolveCarrierDisplay(carrier, carrierNames);

  // Map Shopify fulfillment events into our TrackingEvent format
  const events: TrackingEvent[] = (order.fulfillmentEvents || [])
    .sort((a, b) => new Date(b.happenedAt).getTime() - new Date(a.happenedAt).getTime())
    .map((evt) => {
      const location = [evt.city, evt.province, evt.country].filter(Boolean).join(', ');
      return {
        status: evt.status,
        description: mapShopifyEventDescription(evt.status, evt.message),
        location,
        timestamp: evt.happenedAt,
      };
    });

  // Determine overall status from Shopify displayStatus + events
  const status = mapShopifyStatus(order.fulfillmentDisplayStatus, events);

  // Determine delivered info
  let signedBy: string | null = null;
  let deliveredAt: string | null = null;
  if (status === 'delivered') {
    const deliveryEvent = events.find(e => e.status.toUpperCase() === 'DELIVERED');
    if (deliveryEvent) {
      deliveredAt = deliveryEvent.timestamp;
      const signedMatch = deliveryEvent.description.match(/signed\s+by\s+(.+)/i);
      if (signedMatch) signedBy = signedMatch[1].trim();
    }
  }

  // Calculate transit days
  if (order.createdAt) {
    const start = new Date(order.createdAt);
    const end = deliveredAt ? new Date(deliveredAt) : new Date();
    const days = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    if (days > 0) orderInfo.transitDays = days;
  }

  const result: TrackingResult = {
    trackingNumber,
    carrier,
    carrierDisplay,
    status,
    statusMessage: statusMessages[status] ?? DEFAULT_STATUS_MESSAGES[status] ?? status,
    statusDetail: events.length > 0 ? events[0].description : '',
    estimatedDelivery: order.estimatedDelivery ?? null,
    signedBy,
    deliveredAt,
    events,
    order: orderInfo,
  };
  // Fire-and-forget lookup log
  supabase.from('tracking_lookups').insert({
    brand_id: brandId,
    order_number: orderNumber,
    email: email,
    tracking_number: trackingNumber || null,
    lookup_type: 'order',
    status: result.status,
    carrier: carrier !== 'unknown' ? carrier : null,
  }).then(null, () => {});
  return result;
}

// ── lookupByTracking — FALLBACK: uses 17track API (paid) ─────────────────────

export async function lookupByTracking(
  trackingNumber: string,
  brandId: string,
): Promise<TrackingResult> {
  const settings = await getTrackingSettings(brandId);
  const statusMessages = { ...DEFAULT_STATUS_MESSAGES, ...settings.custom_status_messages };
  const carrierNames = { ...DEFAULT_CARRIER_NAMES, ...settings.carrier_display_names };

  const trackData = await fetchFromSeventeenTrack(trackingNumber, brandId);
  const carrierDisplay = resolveCarrierDisplay(trackData.carrier, carrierNames);

  const trackResult: TrackingResult = {
    trackingNumber,
    carrier: trackData.carrier,
    carrierDisplay,
    status: trackData.status,
    statusMessage: statusMessages[trackData.status] ?? DEFAULT_STATUS_MESSAGES[trackData.status] ?? trackData.status,
    statusDetail: trackData.statusDetail,
    estimatedDelivery: null,
    signedBy: trackData.signedBy,
    deliveredAt: trackData.deliveredAt,
    events: trackData.events,
    order: null,
  };
  // Fire-and-forget lookup log
  supabase.from('tracking_lookups').insert({
    brand_id: brandId,
    order_number: null,
    email: null,
    tracking_number: trackingNumber,
    lookup_type: 'tracking',
    status: trackResult.status,
    carrier: trackData.carrier !== 'unknown' ? trackData.carrier : null,
  }).then(null, () => {});
  return trackResult;
}

// ── 17track API (only used for tracking-number-only lookups) ─────────────────

function map17trackStatus(code: number): TrackingResult['status'] {
  if (code === 0) return 'not_found';
  if (code === 10) return 'info_received';
  if (code === 20) return 'in_transit';
  if (code === 30 || code === 35) return 'expired';
  if (code === 40) return 'delivered';
  if (code === 50) return 'exception';
  return 'in_transit';
}

async function fetchFromSeventeenTrack(
  trackingNumber: string,
  brandId: string,
): Promise<{
  status: TrackingResult['status'];
  statusDetail: string;
  events: TrackingEvent[];
  carrier: string;
  signedBy: string | null;
  deliveredAt: string | null;
}> {
  const settings = await getTrackingSettings(brandId);

  // Check cache first
  try {
    const cacheTtlMs = (settings.cache_ttl_minutes ?? 120) * 60 * 1000;
    const { data: cacheRow } = await supabase
      .from('tracking_cache')
      .select('*')
      .eq('tracking_number', trackingNumber)
      .single();

    if (cacheRow) {
      const age = Date.now() - new Date(cacheRow.cachedAt).getTime();
      if (age < cacheTtlMs) {
        return {
          status: cacheRow.status,
          statusDetail: cacheRow.statusDetail || '',
          events: cacheRow.events || [],
          carrier: cacheRow.carrier || 'unknown',
          signedBy: cacheRow.signedBy || null,
          deliveredAt: cacheRow.deliveredAt || null,
        };
      }
    }
  } catch { /* cache miss */ }

  const apiKey = settings.seventeen_track_api_key || process.env.SEVENTEEN_TRACK_API_KEY;
  if (!apiKey) {
    return {
      status: 'not_found',
      statusDetail: 'Tracking by number requires 17track API key. Try looking up by order number instead.',
      events: [],
      carrier: 'unknown',
      signedBy: null,
      deliveredAt: null,
    };
  }

  try {
    // Register
    await fetch('https://api.17track.net/track/v2.2/register', {
      method: 'POST',
      headers: { '17token': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify([{ number: trackingNumber }]),
    });

    // Get track info
    const infoRes = await fetch('https://api.17track.net/track/v2.2/gettrackinfo', {
      method: 'POST',
      headers: { '17token': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify([{ number: trackingNumber }]),
    });

    if (!infoRes.ok) {
      console.error(`[tracking] 17track failed: ${infoRes.status}`);
      return { status: 'not_found', statusDetail: 'Unable to retrieve tracking information', events: [], carrier: 'unknown', signedBy: null, deliveredAt: null };
    }

    const infoJson = await infoRes.json() as {
      data?: { accepted?: Array<{ track?: { e: number; w?: string; z0?: { z?: Array<{ a: string; z: string; c: string }> } } }> };
    };

    const trackData = infoJson.data?.accepted?.[0]?.track;
    if (!trackData) {
      return { status: 'not_found', statusDetail: 'No tracking data available yet', events: [], carrier: 'unknown', signedBy: null, deliveredAt: null };
    }

    const status = map17trackStatus(trackData.e);
    const carrier = trackData.w ?? 'unknown';
    const events: TrackingEvent[] = (trackData.z0?.z ?? []).map((ev) => ({
      status,
      description: ev.z ?? '',
      location: ev.c ?? '',
      timestamp: ev.a ?? '',
    }));

    let signedBy: string | null = null;
    let deliveredAt: string | null = null;
    if (status === 'delivered' && events.length > 0) {
      deliveredAt = events[0].timestamp;
      const m = events[0].description.match(/signed\s+by\s+(.+)/i);
      if (m) signedBy = m[1].trim();
    }

    // Cache
    try {
      await supabase.from('tracking_cache').upsert({
        tracking_number: trackingNumber,
        brand_id: brandId,
        status,
        statusDetail: events[0]?.description ?? '',
        events,
        carrier,
        signedBy,
        deliveredAt,
        cachedAt: new Date().toISOString(),
      }, { onConflict: 'tracking_number' });
    } catch { /* non-fatal */ }

    return { status, statusDetail: events[0]?.description ?? '', events, carrier, signedBy, deliveredAt };
  } catch (err) {
    console.error('[tracking] 17track error:', err instanceof Error ? err.message : String(err));
    return { status: 'not_found', statusDetail: 'Unable to retrieve tracking information', events: [], carrier: 'unknown', signedBy: null, deliveredAt: null };
  }
}
