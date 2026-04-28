import { Resend } from 'resend';
import { supabase } from '../config/supabase.js';
import { getBrand, getBrandSlug } from '../config/brand.js';

export interface BrandEmailConfig {
  resend: Resend;
  fromAddress: string;
}

const resendClients = new Map<string, Resend>();

function getResendClient(apiKey: string): Resend {
  let client = resendClients.get(apiKey);
  if (!client) {
    client = new Resend(apiKey);
    resendClients.set(apiKey, client);
  }
  return client;
}

function normalizeEnvSuffix(slug: string): string {
  return slug.toUpperCase().replace(/[^A-Z0-9]/g, '_');
}

function stringSetting(settings: Record<string, unknown> | null | undefined, key: string): string | undefined {
  const value = settings?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function extractEmailAddress(value: string): string | null {
  const match = value.match(/<([^>]+)>/);
  const address = (match?.[1] || value).trim().toLowerCase();
  return address.includes('@') ? address : null;
}

export function isDefaultEmailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY;
}

export async function getBrandEmailConfig(
  brandId?: string,
  opts: { defaultFromAddress?: string } = {},
): Promise<BrandEmailConfig | null> {
  let apiKey = process.env.RESEND_API_KEY || '';
  let fromAddress = opts.defaultFromAddress || process.env.EMAIL_FROM_ADDRESS || 'Support <onboarding@resend.dev>';

  if (brandId) {
    const [brand, slug] = await Promise.all([getBrand(brandId), getBrandSlug(brandId)]);
    const settings = brand?.settings ?? null;

    const settingsApiKey = stringSetting(settings, 'resend_api_key') || stringSetting(settings, 'resendApiKey');
    const settingsFrom =
      stringSetting(settings, 'email_from_address') ||
      stringSetting(settings, 'emailFromAddress') ||
      stringSetting(settings, 'support_from_address') ||
      stringSetting(settings, 'supportFromAddress');
    const supportEmail =
      stringSetting(settings, 'support_email') ||
      stringSetting(settings, 'supportEmail') ||
      stringSetting(settings, 'inbound_email') ||
      stringSetting(settings, 'inboundEmail');

    if (settingsApiKey) apiKey = settingsApiKey;
    if (settingsFrom) {
      fromAddress = settingsFrom;
    } else if (supportEmail) {
      fromAddress = `${brand?.name || 'Support'} <${supportEmail}>`;
    }

    if (slug) {
      const normalized = normalizeEnvSuffix(slug);
      const legacy = slug.toUpperCase();
      const brandApiKey = process.env[`RESEND_API_KEY_${normalized}`] || process.env[`RESEND_API_KEY_${legacy}`];
      const brandFrom = process.env[`EMAIL_FROM_ADDRESS_${normalized}`] || process.env[`EMAIL_FROM_ADDRESS_${legacy}`];
      if (brandApiKey) apiKey = brandApiKey;
      if (brandFrom) fromAddress = brandFrom;
    }
  }

  if (!apiKey) return null;
  return { resend: getResendClient(apiKey), fromAddress };
}

export async function getConfiguredSenderAddresses(): Promise<Set<string>> {
  const addresses = new Set<string>();

  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('EMAIL_FROM_ADDRESS') && value) {
      const address = extractEmailAddress(value);
      if (address) addresses.add(address);
    }
  }

  const { data, error } = await supabase
    .from('brands')
    .select('settings')
    .eq('enabled', true);

  if (error) {
    console.warn('[email-config] Failed to load brand sender addresses:', error.message);
    return addresses;
  }

  for (const row of data ?? []) {
    const settings = (row.settings ?? {}) as Record<string, unknown>;
    const values = [
      stringSetting(settings, 'email_from_address'),
      stringSetting(settings, 'emailFromAddress'),
      stringSetting(settings, 'support_from_address'),
      stringSetting(settings, 'supportFromAddress'),
      stringSetting(settings, 'support_email'),
      stringSetting(settings, 'supportEmail'),
      stringSetting(settings, 'inbound_email'),
      stringSetting(settings, 'inboundEmail'),
    ];

    for (const value of values) {
      if (!value) continue;
      const address = extractEmailAddress(value);
      if (address) addresses.add(address);
    }
  }

  return addresses;
}
