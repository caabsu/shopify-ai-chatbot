import { supabase } from '../config/supabase.js';
import type { ContactFormSettings, ContactFormDesign, ContactFormConfig } from '../types/index.js';

const cache = new Map<string, { data: ContactFormSettings; expiresAt: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export const DEFAULT_CONTACT_FORM_DESIGN: ContactFormDesign = {
  // Colors
  primaryColor: '#f5bc70',
  backgroundColor: '#131313',
  inputBackground: 'rgba(19, 19, 19, 0.5)',
  borderColor: 'rgba(245, 188, 112, 0.1)',
  textColor: '#F0EDE8',
  labelColor: 'rgba(240, 237, 232, 0.45)',
  placeholderColor: 'rgba(240, 237, 232, 0.18)',
  accentColor: '#f5bc70',

  // Typography
  headingFontFamily: '"Instrument Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  bodyFontFamily: '"Instrument Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  headingFontSize: '48px',
  labelFontSize: '12px',
  inputFontSize: '15px',

  // Border radius
  cardBorderRadius: '0',
  inputBorderRadius: '0',
  buttonBorderRadius: '0',

  // Labels & Text
  headerTitle: 'Talk to us.',
  description: 'Reply in under 12 hours.',
  chatButtonText: 'Chat now',
  emailButtonText: 'Email us',
  emailAddress: 'support@warmbydesign.com',
  responseTime: 'Reply in under 12 hours',
  headerIcon: 'mail',
  nameLabel: 'Name',
  namePlaceholder: 'Your full name',
  emailLabel: 'Email',
  emailPlaceholder: 'you@example.com',
  subjectLabel: 'Subject',
  subjectPlaceholder: 'Order help, product question, or return',
  messageLabel: 'Message',
  messagePlaceholder: 'Tell us what you need help with...',
  buttonText: 'Send message',
  buttonShowArrow: false,
  successMessage: "Message sent. We'll get back to you soon.",

  // Layout
  showSubjectField: true,
  cardPadding: 'clamp(24px, 4vw, 48px)',
};

export const DEFAULT_CONTACT_FORM_CONFIG: ContactFormConfig = {
  categories: ['general', 'order', 'shipping', 'return', 'other'],
  defaultCategory: 'general',
};

const DEFAULT_CONTACT_FORM_SETTINGS: Omit<ContactFormSettings, 'id' | 'brand_id' | 'created_at' | 'updated_at'> = {
  widget_design: DEFAULT_CONTACT_FORM_DESIGN,
  form_config: DEFAULT_CONTACT_FORM_CONFIG,
};

export async function getContactFormSettings(brandId: string): Promise<ContactFormSettings> {
  const cached = cache.get(brandId);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  const { data, error } = await supabase
    .from('contact_form_settings')
    .select('*')
    .eq('brand_id', brandId)
    .single();

  if (error && (error.code === 'PGRST116' || error.code === '42P01')) {
    if (error.code === '42P01') {
      console.warn('[contact-form-settings] contact_form_settings table does not exist yet — returning defaults');
      return {
        id: 'default',
        brand_id: brandId,
        ...DEFAULT_CONTACT_FORM_SETTINGS,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as ContactFormSettings;
    }

    // Not found — create defaults
    const { data: created, error: createErr } = await supabase
      .from('contact_form_settings')
      .insert({ brand_id: brandId, ...DEFAULT_CONTACT_FORM_SETTINGS })
      .select()
      .single();

    if (createErr) {
      if (createErr.code === '42P01') {
        console.warn('[contact-form-settings] contact_form_settings table does not exist yet — returning defaults');
        return {
          id: 'default',
          brand_id: brandId,
          ...DEFAULT_CONTACT_FORM_SETTINGS,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        } as ContactFormSettings;
      }
      throw new Error(`Failed to create contact form settings: ${createErr.message}`);
    }

    cache.set(brandId, { data: created as ContactFormSettings, expiresAt: Date.now() + CACHE_TTL });
    return created as ContactFormSettings;
  }

  if (error) {
    if (error.code === '42P01') {
      console.warn('[contact-form-settings] contact_form_settings table does not exist yet — returning defaults');
      return {
        id: 'default',
        brand_id: brandId,
        ...DEFAULT_CONTACT_FORM_SETTINGS,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as ContactFormSettings;
    }
    throw new Error(`Failed to load contact form settings: ${error.message}`);
  }

  cache.set(brandId, { data: data as ContactFormSettings, expiresAt: Date.now() + CACHE_TTL });
  return data as ContactFormSettings;
}

export async function updateContactFormSettings(
  brandId: string,
  updates: Partial<Omit<ContactFormSettings, 'id' | 'brand_id' | 'created_at' | 'updated_at'>>,
): Promise<ContactFormSettings> {
  // Ensure settings row exists first
  await getContactFormSettings(brandId);

  const { data, error } = await supabase
    .from('contact_form_settings')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('brand_id', brandId)
    .select()
    .single();

  if (error) throw new Error(`Failed to update contact form settings: ${error.message}`);
  cache.delete(brandId);
  return data as ContactFormSettings;
}

export function invalidateCache(brandId?: string): void {
  if (brandId) {
    cache.delete(brandId);
  } else {
    cache.clear();
  }
}
