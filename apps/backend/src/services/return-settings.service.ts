import { supabase } from '../config/supabase.js';
import type { ReturnSettings } from '../types/index.js';

const cache = new Map<string, { data: ReturnSettings; expiresAt: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

const DEFAULT_SETTINGS: Omit<ReturnSettings, 'id' | 'brand_id' | 'created_at' | 'updated_at'> = {
  return_window_days: 30,
  require_photos: false,
  require_photos_for_reasons: ['defective', 'wrong_item', 'not_as_described'],
  ai_confidence_threshold: 0.85,
  available_reasons: ['defective', 'wrong_item', 'not_as_described', 'changed_mind', 'too_small', 'too_large', 'arrived_late', 'other'],
  reason_labels: {
    defective: 'Defective / Damaged',
    wrong_item: 'Wrong Item Received',
    not_as_described: 'Not as Described',
    changed_mind: 'Changed My Mind',
    too_small: 'Too Small',
    too_large: 'Too Large',
    arrived_late: 'Arrived Late',
    other: 'Other',
  },
  available_resolutions: ['refund', 'store_credit', 'exchange'],
  auto_close_days: 30,
  portal_title: 'Returns & Exchanges',
  portal_description: 'Start a return or exchange in just a few steps.',
  restocking_fee_percent: 20,
  restocking_fee_exempt_reasons: ['defective', 'wrong_item', 'not_as_described'],
  collect_dimensions_for_reasons: ['defective', 'wrong_item', 'not_as_described'],
  provide_prepaid_label_for_reasons: ['defective', 'wrong_item', 'not_as_described'],
  dimension_collection_enabled: true,
};

export async function getReturnSettings(brandId: string): Promise<ReturnSettings> {
  const cached = cache.get(brandId);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  const { data, error } = await supabase
    .from('return_settings')
    .select('*')
    .eq('brand_id', brandId)
    .single();

  if (error && error.code === 'PGRST116') {
    // Not found — create defaults
    const { data: created, error: createErr } = await supabase
      .from('return_settings')
      .insert({ brand_id: brandId, ...DEFAULT_SETTINGS })
      .select()
      .single();

    if (createErr) throw new Error(`Failed to create return settings: ${createErr.message}`);
    cache.set(brandId, { data: created as ReturnSettings, expiresAt: Date.now() + CACHE_TTL });
    return created as ReturnSettings;
  }

  if (error) throw new Error(`Failed to load return settings: ${error.message}`);
  cache.set(brandId, { data: data as ReturnSettings, expiresAt: Date.now() + CACHE_TTL });
  return data as ReturnSettings;
}

export async function updateReturnSettings(
  brandId: string,
  updates: Partial<Omit<ReturnSettings, 'id' | 'brand_id' | 'created_at' | 'updated_at'>>,
): Promise<ReturnSettings> {
  const { data, error } = await supabase
    .from('return_settings')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('brand_id', brandId)
    .select()
    .single();

  if (error) throw new Error(`Failed to update return settings: ${error.message}`);
  cache.delete(brandId);
  return data as ReturnSettings;
}
