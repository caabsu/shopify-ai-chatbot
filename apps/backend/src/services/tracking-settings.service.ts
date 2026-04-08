import { supabase } from '../config/supabase.js';
import type { TrackingSettings, TrackingWidgetDesign } from '../types/index.js';

const cache = new Map<string, { data: TrackingSettings; expiresAt: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export const DEFAULT_WIDGET_DESIGN: TrackingWidgetDesign = {
  // V03 Warm Split
  accentColor: '#a36b33',
  backgroundColor: '#f5f0e6',
  textColor: '#352013',
  headingColor: '#a36b33',
  headingFontFamily: "'DM Serif Display', serif",
  bodyFontFamily: "'Bricolage Grotesque', system-ui, sans-serif",
  statusFontFamily: "'DM Serif Display', serif",
  buttonColor: '#a36b33',
  buttonTextColor: '#f8f5ef',
  headerText: 'Track Your Order',
  headerSubtext: 'Enter your details below to view real-time shipping updates.',
  buttonText: 'Track Order',
  tabOrderLabel: 'Order # + Email',
  tabTrackingLabel: 'Tracking Number',
  timelineSectionLabel: 'TRACKING TIMELINE',
  orderDetailsSectionLabel: 'ORDER DETAILS',
  deliveredIcon: 'checkmark',
  inTransitIcon: 'truck',
  exceptionIcon: 'alert',
};

export const DEFAULT_STATUS_MESSAGES: Record<string, string> = {
  delivered: 'Your order has arrived.',
  in_transit: 'Your order is on its way.',
  out_for_delivery: 'Out for delivery today.',
  info_received: 'Shipping label created.',
  exception: 'Delivery exception — contact support.',
  expired: 'Tracking information expired.',
  not_found: 'Tracking information not available yet.',
};

export const DEFAULT_CARRIER_NAMES: Record<string, string> = {
  usps: 'USPS',
  ups: 'UPS',
  fedex: 'FedEx',
  dhl: 'DHL',
  yanwen: 'Yanwen',
  'china-post': 'China Post',
  'china-ems': 'China EMS',
};

const DEFAULT_TRACKING_SETTINGS: Omit<TrackingSettings, 'id' | 'brand_id' | 'created_at' | 'updated_at'> = {
  widget_design: DEFAULT_WIDGET_DESIGN,
  custom_status_messages: DEFAULT_STATUS_MESSAGES,
  carrier_display_names: DEFAULT_CARRIER_NAMES,
  cache_ttl_minutes: 30,
  seventeen_track_api_key: null,
};

export async function getTrackingSettings(brandId: string): Promise<TrackingSettings> {
  const cached = cache.get(brandId);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  const { data, error } = await supabase
    .from('tracking_settings')
    .select('*')
    .eq('brand_id', brandId)
    .single();

  if (error && (error.code === 'PGRST116' || error.code === '42P01')) {
    if (error.code === '42P01') {
      console.warn('[tracking-settings] tracking_settings table does not exist yet — returning defaults');
      return {
        id: 'default',
        brand_id: brandId,
        ...DEFAULT_TRACKING_SETTINGS,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as TrackingSettings;
    }

    // Not found — create defaults
    const { data: created, error: createErr } = await supabase
      .from('tracking_settings')
      .insert({ brand_id: brandId, ...DEFAULT_TRACKING_SETTINGS })
      .select()
      .single();

    if (createErr) {
      if (createErr.code === '42P01') {
        console.warn('[tracking-settings] tracking_settings table does not exist yet — returning defaults');
        return {
          id: 'default',
          brand_id: brandId,
          ...DEFAULT_TRACKING_SETTINGS,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        } as TrackingSettings;
      }
      throw new Error(`Failed to create tracking settings: ${createErr.message}`);
    }

    cache.set(brandId, { data: created as TrackingSettings, expiresAt: Date.now() + CACHE_TTL });
    return created as TrackingSettings;
  }

  if (error) {
    if (error.code === '42P01') {
      console.warn('[tracking-settings] tracking_settings table does not exist yet — returning defaults');
      return {
        id: 'default',
        brand_id: brandId,
        ...DEFAULT_TRACKING_SETTINGS,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as TrackingSettings;
    }
    throw new Error(`Failed to load tracking settings: ${error.message}`);
  }

  cache.set(brandId, { data: data as TrackingSettings, expiresAt: Date.now() + CACHE_TTL });
  return data as TrackingSettings;
}

export async function updateTrackingSettings(
  brandId: string,
  updates: Partial<Omit<TrackingSettings, 'id' | 'brand_id' | 'created_at' | 'updated_at'>>,
): Promise<TrackingSettings> {
  // Ensure settings row exists first
  await getTrackingSettings(brandId);

  const { data, error } = await supabase
    .from('tracking_settings')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('brand_id', brandId)
    .select()
    .single();

  if (error) throw new Error(`Failed to update tracking settings: ${error.message}`);
  cache.delete(brandId);
  return data as TrackingSettings;
}

export function invalidateCache(brandId?: string): void {
  if (brandId) {
    cache.delete(brandId);
  } else {
    cache.clear();
  }
}
