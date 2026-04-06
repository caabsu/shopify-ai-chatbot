import { supabase } from '../config/supabase.js';
import type { ContactFormSettings, ContactFormDesign, ContactFormConfig } from '../types/index.js';

const cache = new Map<string, { data: ContactFormSettings; expiresAt: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export const DEFAULT_CONTACT_FORM_DESIGN: ContactFormDesign = {
  // Colors
  primaryColor: '#3C2415',
  backgroundColor: '#FDFAF6',
  inputBackground: '#FAF7F2',
  borderColor: '#E8E0D5',
  textColor: '#2C1810',
  labelColor: '#2C1810',
  placeholderColor: '#B5A898',
  accentColor: '#C5A059',

  // Typography
  headingFontFamily: 'Georgia, serif',
  bodyFontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  headingFontSize: '22px',
  labelFontSize: '14px',
  inputFontSize: '15px',

  // Border radius
  cardBorderRadius: '16px',
  inputBorderRadius: '12px',
  buttonBorderRadius: '12px',

  // Labels & Text
  headerTitle: 'Send a Message',
  headerIcon: 'mail',
  nameLabel: 'Name',
  namePlaceholder: 'Your full name',
  emailLabel: 'Email',
  emailPlaceholder: 'you@example.com',
  subjectLabel: 'Subject',
  subjectPlaceholder: 'e.g., Subscription help',
  messageLabel: 'Message',
  messagePlaceholder: 'Describe your question or concern...',
  buttonText: 'Send Message',
  buttonShowArrow: true,
  successMessage: "Message sent! We'll get back to you soon.",

  // Layout
  showSubjectField: true,
  cardPadding: '36px 32px',
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
