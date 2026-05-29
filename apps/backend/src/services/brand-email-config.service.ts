import { Resend } from 'resend';
import { supabase } from '../config/supabase.js';
import { getBrand, getBrandSlug } from '../config/brand.js';

export interface BrandEmailConfig {
  resend: Resend;
  fromAddress: string;
  supportEmail: string | null;
}

const resendClients = new Map<string, Resend>();
const DEFAULT_SUPPORT_EMAIL_BY_SLUG: Record<string, string> = {
  outlight: 'support@outlight.us',
  'warm-by-design': 'support@warmbydesign.com',
};

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

function defaultSupportEmailForSlug(slug?: string | null): string | null {
  return slug ? DEFAULT_SUPPORT_EMAIL_BY_SLUG[slug] ?? null : null;
}

function supportEmailFromSettings(settings: Record<string, unknown> | null | undefined): string | undefined {
  return (
    stringSetting(settings, 'support_email') ||
    stringSetting(settings, 'supportEmail') ||
    stringSetting(settings, 'inbound_email') ||
    stringSetting(settings, 'inboundEmail') ||
    stringSetting(settings, 'contact_email') ||
    stringSetting(settings, 'contactEmail')
  );
}

export function extractEmailAddress(value: string): string | null {
  const match = value.match(/<([^>]+)>/);
  const address = (match?.[1] || value).trim().toLowerCase();
  return address.includes('@') ? address : null;
}

function extractEmailAddresses(value: unknown): string[] {
  if (!value) return [];

  if (Array.isArray(value)) {
    return value.flatMap((item) => extractEmailAddresses(item));
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return [
      ...extractEmailAddresses(record.email),
      ...extractEmailAddresses(record.address),
      ...extractEmailAddresses(record.to),
      ...extractEmailAddresses(record.recipient),
    ];
  }

  if (typeof value !== 'string') return [];

  return value
    .split(',')
    .map((part) => extractEmailAddress(part))
    .filter((address): address is string => !!address);
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
  let supportEmail = extractEmailAddress(fromAddress);

  if (brandId) {
    const [brand, slug] = await Promise.all([getBrand(brandId), getBrandSlug(brandId)]);
    const settings = brand?.settings ?? null;

    const settingsApiKey = stringSetting(settings, 'resend_api_key') || stringSetting(settings, 'resendApiKey');
    const settingsFrom =
      stringSetting(settings, 'email_from_address') ||
      stringSetting(settings, 'emailFromAddress') ||
      stringSetting(settings, 'support_from_address') ||
      stringSetting(settings, 'supportFromAddress');
    const settingsSupportEmail = supportEmailFromSettings(settings);

    if (settingsApiKey) apiKey = settingsApiKey;
    if (settingsFrom) {
      fromAddress = settingsFrom;
    } else if (settingsSupportEmail) {
      fromAddress = `${brand?.name || 'Support'} <${settingsSupportEmail}>`;
    }
    supportEmail = settingsSupportEmail ? extractEmailAddress(settingsSupportEmail) : defaultSupportEmailForSlug(slug);

    if (slug) {
      const normalized = normalizeEnvSuffix(slug);
      const legacy = slug.toUpperCase();
      const brandApiKey = process.env[`RESEND_API_KEY_${normalized}`] || process.env[`RESEND_API_KEY_${legacy}`];
      const brandFrom = process.env[`EMAIL_FROM_ADDRESS_${normalized}`] || process.env[`EMAIL_FROM_ADDRESS_${legacy}`];
      if (brandApiKey) apiKey = brandApiKey;
      if (brandFrom) {
        fromAddress = brandFrom;
        supportEmail = extractEmailAddress(brandFrom) ?? supportEmail;
      }
    }

    supportEmail = supportEmail ?? extractEmailAddress(fromAddress) ?? null;
  }

  if (!apiKey) return null;
  return { resend: getResendClient(apiKey), fromAddress, supportEmail };
}

export async function getBrandSupportEmail(brandId: string): Promise<string | null> {
  const [brand, slug] = await Promise.all([getBrand(brandId), getBrandSlug(brandId)]);
  const settings = brand?.settings ?? null;
  const configured = supportEmailFromSettings(settings);
  if (configured) return extractEmailAddress(configured);

  if (slug) {
    const normalized = normalizeEnvSuffix(slug);
    const legacy = slug.toUpperCase();
    const envFrom = process.env[`EMAIL_FROM_ADDRESS_${normalized}`] || process.env[`EMAIL_FROM_ADDRESS_${legacy}`];
    const envEmail = envFrom ? extractEmailAddress(envFrom) : null;
    if (envEmail) return envEmail;
    const fallback = defaultSupportEmailForSlug(slug);
    if (fallback) return fallback;
  }

  return process.env.EMAIL_FROM_ADDRESS ? extractEmailAddress(process.env.EMAIL_FROM_ADDRESS) : null;
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
      supportEmailFromSettings(settings),
    ];

    for (const value of values) {
      if (!value) continue;
      const address = extractEmailAddress(value);
      if (address) addresses.add(address);
    }
  }

  return addresses;
}

export async function resolveBrandIdByEmailRecipient(...recipients: unknown[]): Promise<string | null> {
  const recipientAddresses = new Set(
    recipients
      .flatMap((recipient) => extractEmailAddresses(recipient))
      .map((address) => address.toLowerCase())
  );

  if (recipientAddresses.size === 0) return null;

  const { data, error } = await supabase
    .from('brands')
    .select('id, slug, name, settings')
    .eq('enabled', true);

  if (error) {
    console.warn('[email-config] Failed to load brands for recipient resolution:', error.message);
    return null;
  }

  for (const brand of data ?? []) {
    const settings = (brand.settings ?? {}) as Record<string, unknown>;
    const candidates = new Set<string>();
    const addCandidate = (value?: string) => {
      if (!value) return;
      const address = extractEmailAddress(value);
      if (address) candidates.add(address);
    };

    addCandidate(stringSetting(settings, 'email_from_address'));
    addCandidate(stringSetting(settings, 'emailFromAddress'));
    addCandidate(stringSetting(settings, 'support_from_address'));
    addCandidate(stringSetting(settings, 'supportFromAddress'));
    addCandidate(supportEmailFromSettings(settings));

    const slug = brand.slug as string | undefined;
    if (slug) {
      const normalized = normalizeEnvSuffix(slug);
      const legacy = slug.toUpperCase();
      addCandidate(process.env[`EMAIL_FROM_ADDRESS_${normalized}`]);
      addCandidate(process.env[`EMAIL_FROM_ADDRESS_${legacy}`]);
      addCandidate(defaultSupportEmailForSlug(slug) ?? undefined);
    }

    for (const address of recipientAddresses) {
      if (candidates.has(address)) {
        return brand.id as string;
      }
    }
  }

  return null;
}
