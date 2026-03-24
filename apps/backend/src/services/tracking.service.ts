import { supabase } from '../config/supabase.js';
import * as shopifyAdmin from './shopify-admin.service.js';
import { getTrackingSettings, DEFAULT_STATUS_MESSAGES, DEFAULT_CARRIER_NAMES } from './tracking-settings.service.js';
import type { TrackingResult, TrackingEvent, TrackingOrderInfo } from '../types/index.js';

// ── Tracking cache ─────────────────────────────────────────────────────────────

interface CachedTrackingData {
  status: TrackingResult['status'];
  statusDetail: string;
  events: TrackingEvent[];
  carrier: string;
  signedBy: string | null;
  deliveredAt: string | null;
  cachedAt: string;
}

// ── 17track status code mapping ───────────────────────────────────────────────

function map17trackStatus(code: number): TrackingResult['status'] {
  if (code === 0) return 'not_found';
  if (code === 10) return 'info_received';
  if (code === 20) return 'in_transit';
  if (code === 30 || code === 35) return 'expired';
  if (code === 40) return 'delivered';
  if (code === 50) return 'exception';
  return 'in_transit';
}

// ── Carrier display name resolution ──────────────────────────────────────────

function resolveCarrierDisplay(carrier: string, carrierNames: Record<string, string>): string {
  const key = carrier.toLowerCase();
  return carrierNames[key] ?? DEFAULT_CARRIER_NAMES[key] ?? carrier;
}

// ── fetchTracking — hit 17track API or return cached ─────────────────────────

export async function fetchTracking(
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
  const cacheTtlMs = (settings.cache_ttl_minutes ?? 30) * 60 * 1000;

  // Check DB cache first
  try {
    const { data: cacheRow } = await supabase
      .from('tracking_cache')
      .select('*')
      .eq('tracking_number', trackingNumber)
      .single();

    if (cacheRow) {
      const row = cacheRow as unknown as CachedTrackingData & { id: string; brand_id: string };
      const age = Date.now() - new Date(row.cachedAt).getTime();
      if (age < cacheTtlMs) {
        return {
          status: row.status,
          statusDetail: row.statusDetail,
          events: row.events,
          carrier: row.carrier,
          signedBy: row.signedBy,
          deliveredAt: row.deliveredAt,
        };
      }
    }
  } catch {
    // Cache table may not exist — proceed to live lookup
  }

  const apiKey = settings.seventeen_track_api_key || process.env.SEVENTEEN_TRACK_API_KEY;
  if (!apiKey) {
    return {
      status: 'not_found',
      statusDetail: 'Tracking not configured',
      events: [],
      carrier: 'unknown',
      signedBy: null,
      deliveredAt: null,
    };
  }

  try {
    // Step 1: Register the tracking number
    await fetch('https://api.17track.net/track/v2.2/register', {
      method: 'POST',
      headers: {
        '17token': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([{ number: trackingNumber }]),
    });

    // Step 2: Get tracking info
    const infoRes = await fetch('https://api.17track.net/track/v2.2/gettrackinfo', {
      method: 'POST',
      headers: {
        '17token': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([{ number: trackingNumber }]),
    });

    if (!infoRes.ok) {
      console.error(`[tracking] 17track gettrackinfo failed: ${infoRes.status}`);
      return {
        status: 'not_found',
        statusDetail: 'Unable to retrieve tracking information',
        events: [],
        carrier: 'unknown',
        signedBy: null,
        deliveredAt: null,
      };
    }

    const infoJson = (await infoRes.json()) as {
      data?: {
        accepted?: Array<{
          number: string;
          track?: {
            e: number;
            w?: string;
            z0?: {
              z?: Array<{
                a: string;
                z: string;
                c: string;
              }>;
            };
          };
        }>;
      };
    };

    const accepted = infoJson.data?.accepted;
    if (!accepted || accepted.length === 0) {
      return {
        status: 'not_found',
        statusDetail: 'No tracking data found',
        events: [],
        carrier: 'unknown',
        signedBy: null,
        deliveredAt: null,
      };
    }

    const trackData = accepted[0].track;
    if (!trackData) {
      return {
        status: 'not_found',
        statusDetail: 'No tracking data available',
        events: [],
        carrier: 'unknown',
        signedBy: null,
        deliveredAt: null,
      };
    }

    const status = map17trackStatus(trackData.e);
    const carrier = trackData.w ?? 'unknown';

    const rawEvents = trackData.z0?.z ?? [];
    const events: TrackingEvent[] = rawEvents.map((ev) => ({
      status: status,
      description: ev.z ?? '',
      location: ev.c ?? '',
      timestamp: ev.a ?? '',
    }));

    // Determine signed-by and delivered-at from events
    let signedBy: string | null = null;
    let deliveredAt: string | null = null;

    if (status === 'delivered' && events.length > 0) {
      const latestEvent = events[0];
      deliveredAt = latestEvent.timestamp;

      // Parse signed by from description (e.g. "Delivered, signed by JOHN")
      const signedMatch = latestEvent.description.match(/signed\s+by\s+(.+)/i);
      if (signedMatch) {
        signedBy = signedMatch[1].trim();
      }
    }

    const result = {
      status,
      statusDetail: events[0]?.description ?? '',
      events,
      carrier,
      signedBy,
      deliveredAt,
    };

    // Cache the result
    try {
      await supabase
        .from('tracking_cache')
        .upsert({
          tracking_number: trackingNumber,
          brand_id: brandId,
          status,
          statusDetail: result.statusDetail,
          events,
          carrier,
          signedBy,
          deliveredAt,
          cachedAt: new Date().toISOString(),
        }, { onConflict: 'tracking_number' });
    } catch {
      // Cache write failure is non-fatal
    }

    return result;
  } catch (err) {
    console.error('[tracking] 17track API error:', err instanceof Error ? err.message : String(err));
    return {
      status: 'not_found',
      statusDetail: 'Unable to retrieve tracking information at this time',
      events: [],
      carrier: 'unknown',
      signedBy: null,
      deliveredAt: null,
    };
  }
}

// ── lookupByOrder ─────────────────────────────────────────────────────────────

export async function lookupByOrder(
  orderNumber: string,
  email: string,
  brandId: string,
): Promise<TrackingResult> {
  const settings = await getTrackingSettings(brandId);
  const statusMessages = { ...DEFAULT_STATUS_MESSAGES, ...settings.custom_status_messages };
  const carrierNames = { ...DEFAULT_CARRIER_NAMES, ...settings.carrier_display_names };

  // Use existing shopify-admin lookupOrder with email verification
  const lookupResult = await shopifyAdmin.lookupOrder(orderNumber, email, undefined, brandId);

  if (!lookupResult.found || !lookupResult.order) {
    return {
      trackingNumber: '',
      carrier: 'unknown',
      carrierDisplay: 'Unknown',
      status: 'not_found',
      statusMessage: statusMessages.not_found ?? DEFAULT_STATUS_MESSAGES.not_found,
      statusDetail: lookupResult.message ?? 'Order not found or email does not match.',
      estimatedDelivery: null,
      signedBy: null,
      deliveredAt: null,
      events: [],
      order: null,
    };
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

  // If no tracking numbers, return info_received
  if (!order.tracking || order.tracking.length === 0) {
    const status: TrackingResult['status'] = 'info_received';
    return {
      trackingNumber: '',
      carrier: 'unknown',
      carrierDisplay: 'Unknown',
      status,
      statusMessage: statusMessages[status] ?? DEFAULT_STATUS_MESSAGES[status],
      statusDetail: 'Your order has been confirmed. Tracking information will be available once your order ships.',
      estimatedDelivery: order.estimatedDelivery ?? null,
      signedBy: null,
      deliveredAt: null,
      events: [],
      order: orderInfo,
    };
  }

  // Use first tracking number
  const firstTracking = order.tracking[0];
  const trackingNumber = firstTracking.number;

  const trackData = await fetchTracking(trackingNumber, brandId);
  const carrierDisplay = resolveCarrierDisplay(trackData.carrier, carrierNames);

  return {
    trackingNumber,
    carrier: trackData.carrier,
    carrierDisplay,
    status: trackData.status,
    statusMessage: statusMessages[trackData.status] ?? DEFAULT_STATUS_MESSAGES[trackData.status] ?? trackData.status,
    statusDetail: trackData.statusDetail,
    estimatedDelivery: order.estimatedDelivery ?? null,
    signedBy: trackData.signedBy,
    deliveredAt: trackData.deliveredAt,
    events: trackData.events,
    order: orderInfo,
  };
}

// ── lookupByTracking ──────────────────────────────────────────────────────────

export async function lookupByTracking(
  trackingNumber: string,
  brandId: string,
): Promise<TrackingResult> {
  const settings = await getTrackingSettings(brandId);
  const statusMessages = { ...DEFAULT_STATUS_MESSAGES, ...settings.custom_status_messages };
  const carrierNames = { ...DEFAULT_CARRIER_NAMES, ...settings.carrier_display_names };

  const trackData = await fetchTracking(trackingNumber, brandId);
  const carrierDisplay = resolveCarrierDisplay(trackData.carrier, carrierNames);

  return {
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
}
