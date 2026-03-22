import { supabase } from '../config/supabase.js';
import type { ReviewSettings, ReviewWidgetDesign } from '../types/index.js';

const cache = new Map<string, { data: ReviewSettings; expiresAt: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export const DEFAULT_WIDGET_DESIGN: ReviewWidgetDesign = {
  starColor: '#C4A265',
  starStyle: 'filled',
  backgroundColor: '#ffffff',
  textColor: '#333333',
  headingColor: '#111111',
  headingFontFamily: 'inherit',
  bodyFontFamily: 'inherit',
  fontSize: 'medium',
  borderRadius: 'rounded',
  cardStyle: 'bordered',
  buttonStyle: 'filled',
  buttonText: 'Write a Review',
  headerText: 'Customer Reviews',
  reviewsPerPage: 10,
  defaultSort: 'newest',
  showVerifiedBadge: true,
  showVariant: true,
  showDate: true,
  showPhotos: true,
  layout: 'list',
};

export const DEFAULT_REVIEW_SETTINGS: Omit<ReviewSettings, 'id' | 'brand_id' | 'created_at' | 'updated_at'> = {
  auto_publish: false,
  auto_publish_min_rating: 4,
  auto_publish_verified_only: true,
  profanity_filter: true,
  request_enabled: true,
  request_delay_days: 14,
  reminder_enabled: true,
  reminder_delay_days: 7,
  incentive_enabled: false,
  incentive_type: null,
  incentive_value: null,
  sender_name: null,
  sender_email: null,
  review_form_fields: {},
  widget_design: DEFAULT_WIDGET_DESIGN,
  reviews_per_page: 10,
  default_sort: 'newest',
  show_verified_badge: true,
  show_incentivized_disclosure: true,
  incentivized_disclosure_text: 'This reviewer received a discount for leaving a review.',
};

export async function getReviewSettings(brandId: string): Promise<ReviewSettings> {
  const cached = cache.get(brandId);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  const { data, error } = await supabase
    .from('review_settings')
    .select('*')
    .eq('brand_id', brandId)
    .single();

  if (error && error.code === 'PGRST116') {
    // Not found — create defaults
    const { data: created, error: createErr } = await supabase
      .from('review_settings')
      .insert({ brand_id: brandId, ...DEFAULT_REVIEW_SETTINGS })
      .select()
      .single();

    if (createErr) throw new Error(`Failed to create review settings: ${createErr.message}`);
    cache.set(brandId, { data: created as ReviewSettings, expiresAt: Date.now() + CACHE_TTL });
    return created as ReviewSettings;
  }

  if (error) throw new Error(`Failed to load review settings: ${error.message}`);
  cache.set(brandId, { data: data as ReviewSettings, expiresAt: Date.now() + CACHE_TTL });
  return data as ReviewSettings;
}

export async function updateReviewSettings(
  brandId: string,
  updates: Partial<Omit<ReviewSettings, 'id' | 'brand_id' | 'created_at' | 'updated_at'>>,
): Promise<ReviewSettings> {
  // Ensure settings row exists first
  await getReviewSettings(brandId);

  const { data, error } = await supabase
    .from('review_settings')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('brand_id', brandId)
    .select()
    .single();

  if (error) throw new Error(`Failed to update review settings: ${error.message}`);
  cache.delete(brandId);
  return data as ReviewSettings;
}

export function invalidateSettingsCache(brandId?: string): void {
  if (brandId) {
    cache.delete(brandId);
  } else {
    cache.clear();
  }
}
