import { Resend } from 'resend';
import { getTemplate, renderTemplate } from './return-email-template.service.js';
import { getBrandSlug, getBrandName } from '../config/brand.js';

// ── Per-Brand Resend Client Resolution ───────────────────────────────────────
// Each brand can have its own Resend API key and FROM address via env vars:
//   RESEND_API_KEY_<SLUG_UPPER>   (e.g. RESEND_API_KEY_OUTLIGHT)
//   EMAIL_FROM_ADDRESS_<SLUG_UPPER> (e.g. EMAIL_FROM_ADDRESS_OUTLIGHT)
// Falls back to the base RESEND_API_KEY / EMAIL_FROM_ADDRESS for brands
// without dedicated env vars (e.g. Misu uses the defaults).

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

async function getBrandEmailConfig(brandId?: string): Promise<BrandEmailConfig | null> {
  let apiKey = defaultApiKey;
  let fromAddress = defaultFromAddress;

  if (brandId) {
    const slug = await getBrandSlug(brandId);
    if (slug) {
      const upper = slug.toUpperCase();
      const brandKey = process.env[`RESEND_API_KEY_${upper}`];
      const brandFrom = process.env[`EMAIL_FROM_ADDRESS_${upper}`];
      if (brandKey) apiKey = brandKey;
      if (brandFrom) fromAddress = brandFrom;
    }
  }

  if (!apiKey) return null;
  return { resend: getResendClient(apiKey), fromAddress };
}

export function isEmailConfigured(): boolean {
  return !!defaultApiKey;
}

// ── Ticket Confirmation Email ────────────────────────────────────────────────

export async function sendTicketConfirmation(opts: {
  to: string;
  customerName?: string;
  ticketNumber: number;
  subject: string;
  brandName?: string;
  brandId?: string;
}): Promise<{ messageId?: string; error?: string }> {
  const config = await getBrandEmailConfig(opts.brandId);
  if (!config) return { error: 'Email not configured' };

  const { to, customerName, ticketNumber, subject } = opts;
  const brand = opts.brandName || (opts.brandId ? await getBrandName(opts.brandId) : null) || 'Support';
  const firstName = customerName ? customerName.split(' ')[0] : '';
  const greeting = firstName ? `Hi ${firstName},` : 'Hi,';

  const emailSubject = `[Ticket #${ticketNumber}] ${subject}`;

  const textBody = `${greeting}

Thank you for reaching out. We've received your message and created ticket #${ticketNumber} for you.

Our team will review your request and get back to you as soon as possible. You can reply to this email to add more information.

---
${brand} Team`;

  const htmlBody = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; color: #1a1a1a;">
  <p>${greeting}</p>
  <p>Thank you for reaching out. We've received your message and created <strong>ticket #${ticketNumber}</strong> for you.</p>
  <p>Our team will review your request and get back to you as soon as possible. You can reply to this email to add more information.</p>
  <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 24px 0;" />
  <p style="color: #aaa; font-size: 13px;">${escapeHtml(brand)} Team</p>
</div>`;

  try {
    const { data, error } = await config.resend.emails.send({
      from: config.fromAddress,
      to: [to],
      subject: emailSubject,
      text: textBody,
      html: htmlBody,
      headers: {
        'X-Ticket-Number': String(ticketNumber),
      },
    });

    if (error) {
      console.error('[email] Resend error:', error);
      return { error: error.message };
    }

    console.log(`[email] Sent confirmation for ticket #${ticketNumber} to ${to} (from: ${config.fromAddress})`);
    return { messageId: data?.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[email] Failed to send confirmation:', msg);
    return { error: msg };
  }
}

// ── Return Portal Emails ──────────────────────────────────────────────────

interface ReturnEmailOpts {
  to: string;
  customerName?: string;
  returnRequestId: string;
  orderNumber: string;
  items: string;
  brandName?: string;
  brandId?: string;
}

export async function sendReturnConfirmation(opts: ReturnEmailOpts): Promise<{ messageId?: string; error?: string; skipped?: boolean }> {
  const config = await getBrandEmailConfig(opts.brandId);
  if (!config) return { error: 'Email not configured' };

  const { to, customerName, returnRequestId, orderNumber, items, brandId } = opts;
  const brand = opts.brandName || (brandId ? await getBrandName(brandId) : null) || 'Support';
  const firstName = customerName ? customerName.split(' ')[0] : '';
  const greeting = firstName ? `Hi ${firstName},` : 'Hi,';
  const refId = returnRequestId.slice(0, 8).toUpperCase();

  let emailSubject = `We've received your return request — #${refId}`;

  let textBody = `${greeting}

We've received your return request #${refId} for order ${orderNumber}.

Items: ${items}

Our team will review your request and get back to you shortly.

---
${brand} Team`;

  let htmlBody = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; color: #1a1a1a;">
  <p>${greeting}</p>
  <p>We've received your return request <strong>#${escapeHtml(refId)}</strong> for order <strong>${escapeHtml(orderNumber)}</strong>.</p>
  <p><strong>Items:</strong> ${escapeHtml(items)}</p>
  <p>Our team will review your request and get back to you shortly.</p>
  <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 24px 0;" />
  <p style="color: #aaa; font-size: 13px;">${escapeHtml(brand)} Team</p>
</div>`;

  // Try DB template
  if (brandId) {
    try {
      const tpl = await getTemplate(brandId, 'confirmation');
      if (tpl) {
        if (!tpl.enabled) return { skipped: true };
        const vars: Record<string, string> = {
          greeting: firstName ? `Hi ${firstName},` : 'Hi,',
          ref_id: refId,
          order_number: orderNumber,
          items,
          brand_name: brand,
        };
        emailSubject = renderTemplate(tpl.subject, vars);
        htmlBody = renderTemplate(tpl.body_html, vars);
        textBody = renderTemplate(tpl.body_text, vars);
      }
    } catch (err) {
      console.error('[email] Failed to load template, using defaults:', err instanceof Error ? err.message : err);
    }
  }

  try {
    const { data, error } = await config.resend.emails.send({
      from: config.fromAddress,
      to: [to],
      subject: emailSubject,
      text: textBody,
      html: htmlBody,
    });

    if (error) {
      console.error('[email] Resend error:', error);
      return { error: error.message };
    }

    console.log(`[email] Sent return confirmation #${refId} to ${to} (from: ${config.fromAddress})`);
    return { messageId: data?.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[email] Failed to send return confirmation:', msg);
    return { error: msg };
  }
}

export async function sendReturnApproved(opts: ReturnEmailOpts): Promise<{ messageId?: string; error?: string; skipped?: boolean }> {
  const config = await getBrandEmailConfig(opts.brandId);
  if (!config) return { error: 'Email not configured' };

  const { to, customerName, returnRequestId, orderNumber, items, brandId } = opts;
  const brand = opts.brandName || (brandId ? await getBrandName(brandId) : null) || 'Support';
  const firstName = customerName ? customerName.split(' ')[0] : '';
  const greeting = firstName ? `Hi ${firstName},` : 'Hi,';
  const refId = returnRequestId.slice(0, 8).toUpperCase();

  let emailSubject = `Your return has been approved — #${refId}`;

  let textBody = `${greeting}

Great news! Your return request #${refId} for order ${orderNumber} has been approved.

Items: ${items}

Here's what to do next:
1. Pack the item(s) securely in their original packaging if possible.
2. Include your return reference number #${refId} inside the package.
3. Ship the package to the return address provided in your account.

Once we receive your return, we'll process your refund within 5-10 business days.

---
${brand} Team`;

  let htmlBody = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; color: #1a1a1a;">
  <p>${greeting}</p>
  <p>Great news! Your return request <strong>#${escapeHtml(refId)}</strong> for order <strong>${escapeHtml(orderNumber)}</strong> has been approved.</p>
  <p><strong>Items:</strong> ${escapeHtml(items)}</p>
  <p><strong>Here's what to do next:</strong></p>
  <ol>
    <li>Pack the item(s) securely in their original packaging if possible.</li>
    <li>Include your return reference number <strong>#${escapeHtml(refId)}</strong> inside the package.</li>
    <li>Ship the package to the return address provided in your account.</li>
  </ol>
  <p>Once we receive your return, we'll process your refund within 5-10 business days.</p>
  <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 24px 0;" />
  <p style="color: #aaa; font-size: 13px;">${escapeHtml(brand)} Team</p>
</div>`;

  // Try DB template
  if (brandId) {
    try {
      const tpl = await getTemplate(brandId, 'approved');
      if (tpl) {
        if (!tpl.enabled) return { skipped: true };
        const vars: Record<string, string> = {
          greeting: firstName ? `Hi ${firstName},` : 'Hi,',
          ref_id: refId,
          order_number: orderNumber,
          items,
          brand_name: brand,
        };
        emailSubject = renderTemplate(tpl.subject, vars);
        htmlBody = renderTemplate(tpl.body_html, vars);
        textBody = renderTemplate(tpl.body_text, vars);
      }
    } catch (err) {
      console.error('[email] Failed to load template, using defaults:', err instanceof Error ? err.message : err);
    }
  }

  try {
    const { data, error } = await config.resend.emails.send({
      from: config.fromAddress,
      to: [to],
      subject: emailSubject,
      text: textBody,
      html: htmlBody,
    });

    if (error) {
      console.error('[email] Resend error:', error);
      return { error: error.message };
    }

    console.log(`[email] Sent return approved #${refId} to ${to} (from: ${config.fromAddress})`);
    return { messageId: data?.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[email] Failed to send return approved:', msg);
    return { error: msg };
  }
}

export async function sendReturnDenied(opts: ReturnEmailOpts & { reason?: string }): Promise<{ messageId?: string; error?: string; skipped?: boolean }> {
  const config = await getBrandEmailConfig(opts.brandId);
  if (!config) return { error: 'Email not configured' };

  const { to, customerName, returnRequestId, orderNumber, items, reason, brandId } = opts;
  const brand = opts.brandName || (brandId ? await getBrandName(brandId) : null) || 'Support';
  const firstName = customerName ? customerName.split(' ')[0] : '';
  const greeting = firstName ? `Hi ${firstName},` : 'Hi,';
  const refId = returnRequestId.slice(0, 8).toUpperCase();
  const denialReason = reason || 'Your return request does not meet our return policy requirements.';

  let emailSubject = `Update on your return request — #${refId}`;

  let textBody = `${greeting}

Thank you for your return request #${refId} for order ${orderNumber}.

Items: ${items}

Unfortunately, your return request was not approved. Reason: ${denialReason}

If you have any questions or believe this was made in error, please don't hesitate to contact our support team.

---
${brand} Team`;

  let htmlBody = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; color: #1a1a1a;">
  <p>${greeting}</p>
  <p>Thank you for your return request <strong>#${escapeHtml(refId)}</strong> for order <strong>${escapeHtml(orderNumber)}</strong>.</p>
  <p><strong>Items:</strong> ${escapeHtml(items)}</p>
  <p>Unfortunately, your return request was not approved.</p>
  <p><strong>Reason:</strong> ${escapeHtml(denialReason)}</p>
  <p>If you have any questions or believe this was made in error, please don't hesitate to contact our support team.</p>
  <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 24px 0;" />
  <p style="color: #aaa; font-size: 13px;">${escapeHtml(brand)} Team</p>
</div>`;

  // Try DB template
  if (brandId) {
    try {
      const tpl = await getTemplate(brandId, 'denied');
      if (tpl) {
        if (!tpl.enabled) return { skipped: true };
        const vars: Record<string, string> = {
          greeting: firstName ? `Hi ${firstName},` : 'Hi,',
          ref_id: refId,
          order_number: orderNumber,
          items,
          brand_name: brand,
          denial_reason: denialReason,
        };
        emailSubject = renderTemplate(tpl.subject, vars);
        htmlBody = renderTemplate(tpl.body_html, vars);
        textBody = renderTemplate(tpl.body_text, vars);
      }
    } catch (err) {
      console.error('[email] Failed to load template, using defaults:', err instanceof Error ? err.message : err);
    }
  }

  try {
    const { data, error } = await config.resend.emails.send({
      from: config.fromAddress,
      to: [to],
      subject: emailSubject,
      text: textBody,
      html: htmlBody,
    });

    if (error) {
      console.error('[email] Resend error:', error);
      return { error: error.message };
    }

    console.log(`[email] Sent return denied #${refId} to ${to} (from: ${config.fromAddress})`);
    return { messageId: data?.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[email] Failed to send return denied:', msg);
    return { error: msg };
  }
}

export async function sendReturnApprovedNoReturn(opts: ReturnEmailOpts & { refundAmount?: number; noReturnReason?: string }): Promise<{ messageId?: string; error?: string; skipped?: boolean }> {
  const config = await getBrandEmailConfig(opts.brandId);
  if (!config) return { error: 'Email not configured' };

  const { to, customerName, returnRequestId, orderNumber, items, refundAmount, brandId } = opts;
  const brand = opts.brandName || (brandId ? await getBrandName(brandId) : null) || 'Support';
  const firstName = customerName ? customerName.split(' ')[0] : '';
  const greeting = firstName ? `Hi ${firstName},` : 'Hi,';
  const refId = returnRequestId.slice(0, 8).toUpperCase();
  const amountStr = refundAmount !== undefined ? `$${refundAmount.toFixed(2)}` : 'your refund';

  let emailSubject = `Your refund is being processed — #${refId}`;

  let textBody = `${greeting}

We've reviewed your return request #${refId} for order ${orderNumber} and are processing your refund.

Items being refunded: ${items}
Refund amount: ${amountStr}

No need to return the items.
Based on the nature of your request, we're processing a refund without requiring a return.

Your refund will appear in your original payment method within 5-10 business days, depending on your bank or payment provider.

---
${brand} Team`;

  let htmlBody = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; color: #1a1a1a;">
  <p>${greeting}</p>
  <p>We've reviewed your return request <strong>#${escapeHtml(refId)}</strong> for order <strong>${escapeHtml(orderNumber)}</strong> and are processing your refund.</p>
  <p><strong>Items:</strong> ${escapeHtml(items)}</p>
  <p><strong>Refund amount:</strong> ${escapeHtml(amountStr)}</p>
  <p><strong>No need to return the items.</strong> Based on the nature of your request, we're processing a refund without requiring a return.</p>
  <p>Your refund will appear in your original payment method within 5-10 business days, depending on your bank or payment provider.</p>
  <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 24px 0;" />
  <p style="color: #aaa; font-size: 13px;">${escapeHtml(brand)} Team</p>
</div>`;

  // Try DB template
  if (brandId) {
    try {
      const tpl = await getTemplate(brandId, 'approved_no_return');
      if (tpl) {
        if (!tpl.enabled) return { skipped: true };
        const vars: Record<string, string> = {
          greeting: firstName ? `Hi ${firstName},` : 'Hi,',
          ref_id: refId,
          order_number: orderNumber,
          items,
          brand_name: brand,
          refund_amount: amountStr,
        };
        emailSubject = renderTemplate(tpl.subject, vars);
        htmlBody = renderTemplate(tpl.body_html, vars);
        textBody = renderTemplate(tpl.body_text, vars);
      }
    } catch (err) {
      console.error('[email] Failed to load template, using defaults:', err instanceof Error ? err.message : err);
    }
  }

  try {
    const { data, error } = await config.resend.emails.send({
      from: config.fromAddress,
      to: [to],
      subject: emailSubject,
      text: textBody,
      html: htmlBody,
    });

    if (error) {
      console.error('[email] Resend error:', error);
      return { error: error.message };
    }

    console.log(`[email] Sent return approved (no return) #${refId} to ${to} (from: ${config.fromAddress})`);
    return { messageId: data?.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[email] Failed to send return approved (no return):', msg);
    return { error: msg };
  }
}

export async function sendReturnRefunded(opts: ReturnEmailOpts & { refundAmount?: number }): Promise<{ messageId?: string; error?: string; skipped?: boolean }> {
  const config = await getBrandEmailConfig(opts.brandId);
  if (!config) return { error: 'Email not configured' };

  const { to, customerName, returnRequestId, orderNumber, items, refundAmount, brandId } = opts;
  const brand = opts.brandName || (brandId ? await getBrandName(brandId) : null) || 'Support';
  const firstName = customerName ? customerName.split(' ')[0] : '';
  const greeting = firstName ? `Hi ${firstName},` : 'Hi,';
  const refId = returnRequestId.slice(0, 8).toUpperCase();
  const amountStr = refundAmount !== undefined ? `$${refundAmount.toFixed(2)}` : 'your refund';

  let emailSubject = `Your refund has been processed — #${refId}`;

  let textBody = `${greeting}

Your refund of ${amountStr} for return request #${refId} (order ${orderNumber}) has been processed.

Items: ${items}

The refund should appear in your original payment method within 5-10 business days, depending on your bank or payment provider.

Thank you for your patience!

---
${brand} Team`;

  let htmlBody = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; color: #1a1a1a;">
  <p>${greeting}</p>
  <p>Your refund of <strong>${escapeHtml(amountStr)}</strong> for return request <strong>#${escapeHtml(refId)}</strong> (order <strong>${escapeHtml(orderNumber)}</strong>) has been processed.</p>
  <p><strong>Items:</strong> ${escapeHtml(items)}</p>
  <p>The refund should appear in your original payment method within 5-10 business days, depending on your bank or payment provider.</p>
  <p>Thank you for your patience!</p>
  <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 24px 0;" />
  <p style="color: #aaa; font-size: 13px;">${escapeHtml(brand)} Team</p>
</div>`;

  // Try DB template
  if (brandId) {
    try {
      const tpl = await getTemplate(brandId, 'refunded');
      if (tpl) {
        if (!tpl.enabled) return { skipped: true };
        const vars: Record<string, string> = {
          greeting: firstName ? `Hi ${firstName},` : 'Hi,',
          ref_id: refId,
          order_number: orderNumber,
          items,
          brand_name: brand,
          refund_amount: amountStr,
        };
        emailSubject = renderTemplate(tpl.subject, vars);
        htmlBody = renderTemplate(tpl.body_html, vars);
        textBody = renderTemplate(tpl.body_text, vars);
      }
    } catch (err) {
      console.error('[email] Failed to load template, using defaults:', err instanceof Error ? err.message : err);
    }
  }

  try {
    const { data, error } = await config.resend.emails.send({
      from: config.fromAddress,
      to: [to],
      subject: emailSubject,
      text: textBody,
      html: htmlBody,
    });

    if (error) {
      console.error('[email] Resend error:', error);
      return { error: error.message };
    }

    console.log(`[email] Sent return refunded #${refId} to ${to} (from: ${config.fromAddress})`);
    return { messageId: data?.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[email] Failed to send return refunded:', msg);
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
