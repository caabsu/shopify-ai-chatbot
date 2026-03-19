import { Resend } from 'resend';
import { getBrandSlug } from '../config/brand.js';

// ── Per-Brand Resend Client Resolution ───────────────────────────────────────
// Mirrors the pattern in email.service.ts: cache Resend clients by API key to
// avoid creating new instances on every call.

const resendClients = new Map<string, Resend>();

function getResendClient(apiKey: string): Resend {
  let client = resendClients.get(apiKey);
  if (!client) {
    client = new Resend(apiKey);
    resendClients.set(apiKey, client);
  }
  return client;
}

const defaultApiKey = process.env.RESEND_API_KEY || '';
const defaultFromAddress =
  process.env.EMAIL_FROM_ADDRESS || 'noreply@outlight.com';

interface BrandEmailConfig {
  client: Resend;
  from: string;
}

async function getTradeEmailConfig(
  brandId?: string,
): Promise<BrandEmailConfig | null> {
  let apiKey = defaultApiKey;
  let from = defaultFromAddress;

  if (brandId) {
    const slug = await getBrandSlug(brandId);
    if (slug) {
      const upper = slug.toUpperCase();
      const brandKey = process.env[`RESEND_API_KEY_${upper}`];
      const brandFrom = process.env[`EMAIL_FROM_ADDRESS_${upper}`];
      if (brandKey) apiKey = brandKey;
      if (brandFrom) from = brandFrom;
    }
  }

  if (!apiKey) return null;
  return { client: getResendClient(apiKey), from };
}

// ── Trade Application Received ───────────────────────────────────────────────

export async function sendTradeApplicationReceivedEmail(opts: {
  to: string;
  full_name: string;
  company_name: string;
  brandId?: string;
}): Promise<{ messageId?: string; error?: string }> {
  try {
    const config = await getTradeEmailConfig(opts.brandId);
    if (!config) return { error: 'Email not configured' };

    const firstName = opts.full_name.split(' ')[0];

    const { data, error } = await config.client.emails.send({
      from: config.from,
      to: opts.to,
      subject: 'We received your trade program application',
      html: `
        <p>Hi ${firstName},</p>
        <p>Thank you for applying to the Outlight Trade Program on behalf of <strong>${opts.company_name}</strong>.</p>
        <p>We're reviewing your application and will get back to you within 1-2 business days.</p>
        <p>Best,<br>The Outlight Team</p>
      `,
    });

    if (error) {
      console.error('[trade-email] Resend error (application received):', error);
      return { error: error.message };
    }

    console.log(`[trade-email] Sent application received to ${opts.to} (from: ${config.from})`);
    return { messageId: data?.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[trade-email] sendApplicationReceived error:', message);
    return { error: message };
  }
}

// ── Trade Welcome (Approval) ─────────────────────────────────────────────────

export async function sendTradeWelcomeEmail(opts: {
  to: string;
  full_name: string;
  company_name: string;
  discount_code: string;
  payment_terms: string;
  concierge_email: string | null;
  is_new_customer: boolean;
  brandId?: string;
}): Promise<{ messageId?: string; error?: string }> {
  try {
    const config = await getTradeEmailConfig(opts.brandId);
    if (!config) return { error: 'Email not configured' };

    const firstName = opts.full_name.split(' ')[0];
    const termsLabel =
      opts.payment_terms === 'NET_30'
        ? 'Net 30'
        : opts.payment_terms === 'NET_60'
          ? 'Net 60'
          : 'Due on fulfillment';

    const { data, error } = await config.client.emails.send({
      from: config.from,
      to: opts.to,
      subject: 'Welcome to the Outlight Trade Program',
      html: `
        <p>Hi ${firstName},</p>
        <p>Welcome to the Outlight Trade Program. Your application for <strong>${opts.company_name}</strong> has been approved.</p>
        <h3>Your trade benefits</h3>
        <ul>
          <li><strong>30% trade discount</strong> — automatically applied when you're logged in</li>
          <li><strong>Backup code:</strong> ${opts.discount_code} — use when not logged in</li>
          <li><strong>Payment terms:</strong> ${termsLabel}</li>
          <li><strong>Priority concierge support</strong>${opts.concierge_email ? ` — reach us at ${opts.concierge_email}` : ''}</li>
        </ul>
        ${
          opts.is_new_customer
            ? '<p>You should receive a separate email to activate your account. Please set your password to start shopping with trade pricing.</p>'
            : '<p>Log into your existing account to see trade pricing applied automatically.</p>'
        }
        <p>Best,<br>The Outlight Team</p>
      `,
    });

    if (error) {
      console.error('[trade-email] Resend error (welcome):', error);
      return { error: error.message };
    }

    console.log(`[trade-email] Sent welcome email to ${opts.to} (from: ${config.from})`);
    return { messageId: data?.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[trade-email] sendWelcome error:', message);
    return { error: message };
  }
}

// ── Trade Rejection ──────────────────────────────────────────────────────────

export async function sendTradeRejectionEmail(opts: {
  to: string;
  full_name: string;
  company_name: string;
  reason: string;
  brandId?: string;
}): Promise<{ messageId?: string; error?: string }> {
  try {
    const config = await getTradeEmailConfig(opts.brandId);
    if (!config) return { error: 'Email not configured' };

    const firstName = opts.full_name.split(' ')[0];

    const { data, error } = await config.client.emails.send({
      from: config.from,
      to: opts.to,
      subject: 'Update on your Outlight trade program application',
      html: `
        <p>Hi ${firstName},</p>
        <p>Thank you for your interest in the Outlight Trade Program.</p>
        <p>After reviewing your application for <strong>${opts.company_name}</strong>, we're unable to approve it at this time.</p>
        ${opts.reason ? `<p><strong>Reason:</strong> ${opts.reason}</p>` : ''}
        <p>If you believe this was in error or your circumstances have changed, we encourage you to reapply.</p>
        <p>Best,<br>The Outlight Team</p>
      `,
    });

    if (error) {
      console.error('[trade-email] Resend error (rejection):', error);
      return { error: error.message };
    }

    console.log(`[trade-email] Sent rejection email to ${opts.to} (from: ${config.from})`);
    return { messageId: data?.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[trade-email] sendRejection error:', message);
    return { error: message };
  }
}
