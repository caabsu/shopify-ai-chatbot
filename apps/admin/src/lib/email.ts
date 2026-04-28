import { Resend } from 'resend';
import { supabase } from './supabase';

// ── Per-Brand Resend Client Resolution ───────────────────────────────────────
// Each brand can have its own Resend API key and FROM address via env vars
// or brands.settings. Env suffixes normalize slugs, e.g. warm-by-design -> WARM_BY_DESIGN.

const resendClients = new Map<string, Resend>();

function getResendClient(apiKey: string): Resend {
  let client = resendClients.get(apiKey);
  if (!client) {
    client = new Resend(apiKey);
    resendClients.set(apiKey, client);
  }
  return client;
}

interface BrandEmailConfig {
  resend: Resend;
  fromAddress: string;
}

function normalizeEnvSuffix(slug: string): string {
  return slug.toUpperCase().replace(/[^A-Z0-9]/g, '_');
}

function stringSetting(settings: Record<string, unknown> | null | undefined, key: string): string | undefined {
  const value = settings?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

async function getBrandEmailConfig(brandSlug?: string): Promise<BrandEmailConfig | null> {
  let apiKey = process.env.RESEND_API_KEY || '';
  let fromAddress = process.env.EMAIL_FROM_ADDRESS || 'Support <onboarding@resend.dev>';

  if (brandSlug) {
    const { data: brand } = await supabase
      .from('brands')
      .select('name, settings')
      .eq('slug', brandSlug)
      .single();

    const settings = (brand?.settings ?? null) as Record<string, unknown> | null;
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
    if (settingsFrom) fromAddress = settingsFrom;
    else if (supportEmail) fromAddress = `${brand?.name || 'Support'} <${supportEmail}>`;

    const normalized = normalizeEnvSuffix(brandSlug);
    const legacy = brandSlug.toUpperCase();
    const brandKey = process.env[`RESEND_API_KEY_${normalized}`] || process.env[`RESEND_API_KEY_${legacy}`];
    const brandFrom = process.env[`EMAIL_FROM_ADDRESS_${normalized}`] || process.env[`EMAIL_FROM_ADDRESS_${legacy}`];
    if (brandKey) apiKey = brandKey;
    if (brandFrom) fromAddress = brandFrom;
  }

  if (!apiKey) return null;
  return { resend: getResendClient(apiKey), fromAddress };
}

export async function sendTicketReplyEmail(opts: {
  to: string;
  customerName?: string;
  ticketNumber: number;
  subject: string;
  replyContent: string;
  agentName?: string;
  brandName?: string;
  brandSlug?: string;
  inReplyToMessageId?: string;
  originalMessage?: string;
}): Promise<{ messageId?: string; error?: string }> {
  const config = await getBrandEmailConfig(opts.brandSlug);
  if (!config) {
    console.warn('[email] No Resend API key configured — skipping email');
    return { error: 'Email not configured' };
  }

  const { to, ticketNumber, subject, replyContent, agentName, brandName, inReplyToMessageId, originalMessage } = opts;
  const brand = brandName || 'Support';
  const signature = agentName ? `${agentName}\n${brand} Team` : `${brand} Team`;

  const emailSubject = `Re: [Ticket #${ticketNumber}] ${subject}`;

  // Build quoted original message if available
  const quotedOriginal = originalMessage
    ? `\n\n--- Original Message ---\n${originalMessage}`
    : '';
  const quotedOriginalHtml = originalMessage
    ? `<div style="margin-top: 24px; padding: 12px 16px; border-left: 3px solid #e5e5e5; color: #888; font-size: 13px; white-space: pre-wrap;">--- Original Message ---\n${escapeHtml(originalMessage)}</div>`
    : '';

  // Strip markdown links for plain text: [text](url) → text (url)
  const plainContent = replyContent.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$1 ($2)');
  const textBody = `${plainContent}

---
${signature}

Ticket #${ticketNumber} — Please reply to this email to continue the conversation.${quotedOriginal}`;

  const htmlBody = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; color: #1a1a1a;">
  <div style="white-space: pre-wrap; line-height: 1.6;">${markdownToHtml(replyContent)}</div>
  <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 24px 0;" />
  <p style="color: #888; font-size: 13px;">
    ${escapeHtml(signature).replace(/\n/g, '<br>')}<br><br>
    <span style="color: #aaa;">Ticket #${ticketNumber} — Reply to this email to continue the conversation.</span>
  </p>
  ${quotedOriginalHtml}
</div>`;

  // Build email threading headers
  const headers: Record<string, string> = {
    'X-Ticket-Number': String(ticketNumber),
  };
  if (inReplyToMessageId) {
    headers['In-Reply-To'] = inReplyToMessageId;
    headers['References'] = inReplyToMessageId;
  }

  try {
    const { data, error } = await config.resend.emails.send({
      from: config.fromAddress,
      to: [to],
      subject: emailSubject,
      text: textBody,
      html: htmlBody,
      headers,
    });

    if (error) {
      console.error('[email] Resend error:', error);
      return { error: error.message };
    }

    console.log(`[email] Sent reply for ticket #${ticketNumber} to ${to} (from: ${config.fromAddress})`);
    return { messageId: data?.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[email] Failed to send:', msg);
    return { error: msg };
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Escape HTML then convert markdown-style links [text](url) to <a> tags */
function markdownToHtml(text: string): string {
  const escaped = escapeHtml(text);
  return escaped.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
    '<a href="$2" style="color: #C5A059; text-decoration: underline;">$1</a>'
  );
}
