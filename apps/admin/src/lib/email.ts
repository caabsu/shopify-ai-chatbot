import { Resend } from 'resend';

// ── Per-Brand Resend Client Resolution ───────────────────────────────────────
// Each brand can have its own Resend API key and FROM address via env vars:
//   RESEND_API_KEY_<SLUG_UPPER>   (e.g. RESEND_API_KEY_OUTLIGHT)
//   EMAIL_FROM_ADDRESS_<SLUG_UPPER> (e.g. EMAIL_FROM_ADDRESS_OUTLIGHT)
// Falls back to the base RESEND_API_KEY / EMAIL_FROM_ADDRESS.

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

const defaultApiKey = process.env.RESEND_API_KEY || '';
const defaultFromAddress = process.env.EMAIL_FROM_ADDRESS || 'Support <onboarding@resend.dev>';

function getBrandEmailConfig(brandSlug?: string): BrandEmailConfig | null {
  let apiKey = defaultApiKey;
  let fromAddress = defaultFromAddress;

  if (brandSlug) {
    const upper = brandSlug.toUpperCase();
    const brandKey = process.env[`RESEND_API_KEY_${upper}`];
    const brandFrom = process.env[`EMAIL_FROM_ADDRESS_${upper}`];
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
  const config = getBrandEmailConfig(opts.brandSlug);
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
