import { supabase } from '../config/supabase.js';
import { getBrand } from '../config/brand.js';
import { getBrandSupportEmail } from './brand-email-config.service.js';
import type { ContactFormSettings, ContactFormDesign, ContactFormConfig } from '../types/index.js';

const cache = new Map<string, { data: ContactFormSettings; expiresAt: number }>();
const CACHE_TTL = 5 * 60 * 1000;

export const DEFAULT_CONTACT_FORM_DESIGN: ContactFormDesign = {
  primaryColor: '#f5bc70',
  backgroundColor: '#131313',
  inputBackground: 'rgba(19, 19, 19, 0.5)',
  borderColor: 'rgba(245, 188, 112, 0.1)',
  textColor: '#F0EDE8',
  labelColor: 'rgba(240, 237, 232, 0.45)',
  placeholderColor: 'rgba(240, 237, 232, 0.18)',
  accentColor: '#f5bc70',
  headingFontFamily: '"Instrument Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  bodyFontFamily: '"Instrument Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  headingFontSize: '48px',
  labelFontSize: '12px',
  inputFontSize: '15px',
  cardBorderRadius: '0',
  inputBorderRadius: '0',
  buttonBorderRadius: '0',
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
  showSubjectField: true,
  cardPadding: 'clamp(24px, 4vw, 48px)',
};

const OUTLIGHT_CONTACT_FORM_DESIGN: ContactFormDesign = {
  ...DEFAULT_CONTACT_FORM_DESIGN,
  primaryColor: '#18181b',
  backgroundColor: '#ffffff',
  inputBackground: '#ffffff',
  borderColor: '#d1d5db',
  textColor: '#1a1a1a',
  labelColor: '#374151',
  placeholderColor: '#6b7280',
  accentColor: '#18181b',
  headingFontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  bodyFontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  headerTitle: 'Contact us',
  description: "Have a question or need help? We'll respond as soon as we can.",
  emailAddress: 'support@outlight.us',
  responseTime: 'Replies as soon as possible',
  cardBorderRadius: '12px',
  inputBorderRadius: '8px',
  buttonBorderRadius: '8px',
};

export const DEFAULT_CONTACT_FORM_CONFIG: ContactFormConfig = {
  categories: ['general', 'order', 'shipping', 'return', 'other'],
  defaultCategory: 'general',
};

async function getDefaultContactFormSettings(
  brandId: string,
): Promise<Omit<ContactFormSettings, 'id' | 'brand_id' | 'created_at' | 'updated_at'>> {
  const [brand, supportEmail] = await Promise.all([
    getBrand(brandId).catch(() => null),
    getBrandSupportEmail(brandId).catch(() => null),
  ]);

  const baseDesign = brand?.slug === 'warm-by-design'
    ? DEFAULT_CONTACT_FORM_DESIGN
    : OUTLIGHT_CONTACT_FORM_DESIGN;

  return {
    widget_design: {
      ...baseDesign,
      emailAddress: supportEmail ?? baseDesign.emailAddress,
    },
    form_config: DEFAULT_CONTACT_FORM_CONFIG,
  };
}

async function guardAgainstCrossBrandEmail(settings: ContactFormSettings): Promise<ContactFormSettings> {
  const [brand, supportEmail] = await Promise.all([
    getBrand(settings.brand_id).catch(() => null),
    getBrandSupportEmail(settings.brand_id).catch(() => null),
  ]);

  const design = { ...settings.widget_design };
  const emailAddress = design.emailAddress?.trim().toLowerCase();

  if (supportEmail && (!emailAddress || (brand?.slug !== 'warm-by-design' && emailAddress === 'support@warmbydesign.com'))) {
    design.emailAddress = supportEmail;
    return { ...settings, widget_design: design };
  }

  return settings;
}

function defaultSettingsRow(brandId: string, defaults: Awaited<ReturnType<typeof getDefaultContactFormSettings>>): ContactFormSettings {
  const now = new Date().toISOString();
  return {
    id: 'default',
    brand_id: brandId,
    ...defaults,
    created_at: now,
    updated_at: now,
  } as ContactFormSettings;
}

export async function getContactFormSettings(brandId: string): Promise<ContactFormSettings> {
  const cached = cache.get(brandId);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  const { data, error } = await supabase
    .from('contact_form_settings')
    .select('*')
    .eq('brand_id', brandId)
    .single();

  if (error && (error.code === 'PGRST116' || error.code === '42P01')) {
    const defaults = await getDefaultContactFormSettings(brandId);

    if (error.code === '42P01') {
      console.warn('[contact-form-settings] contact_form_settings table does not exist yet - returning defaults');
      return defaultSettingsRow(brandId, defaults);
    }

    const { data: created, error: createErr } = await supabase
      .from('contact_form_settings')
      .insert({ brand_id: brandId, ...defaults })
      .select()
      .single();

    if (createErr) {
      if (createErr.code === '42P01') {
        console.warn('[contact-form-settings] contact_form_settings table does not exist yet - returning defaults');
        return defaultSettingsRow(brandId, defaults);
      }
      throw new Error(`Failed to create contact form settings: ${createErr.message}`);
    }

    const guardedCreated = await guardAgainstCrossBrandEmail(created as ContactFormSettings);
    cache.set(brandId, { data: guardedCreated, expiresAt: Date.now() + CACHE_TTL });
    return guardedCreated;
  }

  if (error) {
    if (error.code === '42P01') {
      const defaults = await getDefaultContactFormSettings(brandId);
      console.warn('[contact-form-settings] contact_form_settings table does not exist yet - returning defaults');
      return defaultSettingsRow(brandId, defaults);
    }
    throw new Error(`Failed to load contact form settings: ${error.message}`);
  }

  const guarded = await guardAgainstCrossBrandEmail(data as ContactFormSettings);
  cache.set(brandId, { data: guarded, expiresAt: Date.now() + CACHE_TTL });
  return guarded;
}

export async function updateContactFormSettings(
  brandId: string,
  updates: Partial<Omit<ContactFormSettings, 'id' | 'brand_id' | 'created_at' | 'updated_at'>>,
): Promise<ContactFormSettings> {
  await getContactFormSettings(brandId);

  const { data, error } = await supabase
    .from('contact_form_settings')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('brand_id', brandId)
    .select()
    .single();

  if (error) throw new Error(`Failed to update contact form settings: ${error.message}`);
  cache.delete(brandId);
  return guardAgainstCrossBrandEmail(data as ContactFormSettings);
}

export function invalidateCache(brandId?: string): void {
  if (brandId) {
    cache.delete(brandId);
  } else {
    cache.clear();
  }
}
