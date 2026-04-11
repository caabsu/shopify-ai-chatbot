import { Resend } from 'resend';
import { getTemplate, renderTemplate } from './return-email-template.service.js';
import { getBrandSlug, getBrandName } from '../config/brand.js';
import { RETURN_ADDRESSES } from './shippo.service.js';

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
  labelUrl?: string;
  trackingNumber?: string;
  items: string;
  brandName?: string;
  brandId?: string;
  /** Which warehouse to direct the return to (e.g. "Tennessee" or "Utah"). Used when no prepaid label. */
  warehouseHint?: string;
}

// US states grouped by which Red Stag warehouse is closer
const UTAH_CLOSER_STATES = new Set([
  'wa', 'or', 'ca', 'nv', 'id', 'mt', 'wy', 'ut', 'co', 'az', 'nm',
  'ak', 'hi', 'nd', 'sd', 'ne', 'ks', 'mn', 'ia',
]);

/** Pick the closest warehouse based on hint text or customer state */
function getWarehouseAddress(hint?: string): typeof RETURN_ADDRESSES[0] {
  if (hint) {
    const lower = hint.toLowerCase();
    const match = RETURN_ADDRESSES.find((w) => w.label.toLowerCase().includes(lower) || w.state.toLowerCase().includes(lower) || w.city.toLowerCase().includes(lower));
    if (match) return match;
    // If hint is a US state abbreviation, pick based on geography
    if (lower.length === 2 && UTAH_CLOSER_STATES.has(lower)) {
      return RETURN_ADDRESSES.find((w) => w.state === 'UT') ?? RETURN_ADDRESSES[0];
    }
  }
  // Default to Tennessee (primary warehouse)
  return RETURN_ADDRESSES[0];
}

function formatWarehouseAddress(w: typeof RETURN_ADDRESSES[0]): { text: string; html: string } {
  const lines = [w.name, w.company, w.street1, w.street2, `${w.city}, ${w.state} ${w.zip}`].filter(Boolean);
  return {
    text: lines.join('\n'),
    html: lines.map((l) => escapeHtml(l as string)).join('<br>'),
  };
}

export async function sendReturnConfirmation(opts: ReturnEmailOpts): Promise<{ messageId?: string; error?: string; skipped?: boolean }> {
  const config = await getBrandEmailConfig(opts.brandId);
  if (!config) return { error: 'Email not configured' };

  const { to, customerName, returnRequestId, orderNumber, items, brandId } = opts;
  const brand = opts.brandName || (brandId ? await getBrandName(brandId) : null) || 'Support';
  const firstName = customerName ? customerName.split(' ')[0] : '';
  const greeting = firstName ? `Hi ${firstName},` : 'Hi,';
  const refId = returnRequestId.slice(0, 8).toUpperCase();

  let emailSubject = `We've received your return request — Order #${escapeHtml(orderNumber)}`;

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

  const { to, customerName, returnRequestId, orderNumber, items, brandId, labelUrl, trackingNumber, warehouseHint } = opts;
  const brand = opts.brandName || (brandId ? await getBrandName(brandId) : null) || 'Support';
  const firstName = customerName ? customerName.split(' ')[0] : '';
  const greeting = firstName ? `Hi ${firstName},` : 'Hi,';
  const refId = returnRequestId.slice(0, 8).toUpperCase();

  const hasLabel = !!labelUrl;

  let emailSubject = `Your return has been approved — Order #${escapeHtml(orderNumber)}`;

  // Build label or warehouse address section
  let labelTextSection = '';
  let labelHtmlSection = '';

  if (hasLabel) {
    labelTextSection = `A prepaid return shipping label is attached to this email. You can also download it here: ${labelUrl}\n${trackingNumber ? `Return tracking number: ${trackingNumber}\n` : ''}`;
    labelHtmlSection = `<div style="background:#f4f0eb;padding:16px 20px;margin:16px 0;">
        <p style="margin:0 0 8px;font-weight:500;color:#131314;">Prepaid Return Label</p>
        <p style="margin:0 0 8px;font-size:14px;color:#2d3338;">A prepaid shipping label has been created for your return.</p>
        <a href="${escapeHtml(labelUrl || '')}" style="display:inline-block;padding:10px 24px;background:#C5A059;color:#131314;text-decoration:none;font-size:13px;font-weight:500;letter-spacing:0.05em;text-transform:uppercase;">Download Label</a>
        ${trackingNumber ? `<p style="margin:12px 0 0;font-size:12px;color:#71757a;">Tracking: ${escapeHtml(trackingNumber)}</p>` : ''}
      </div>`;
  } else {
    // No prepaid label — show the warehouse address
    const warehouse = getWarehouseAddress(warehouseHint);
    const addr = formatWarehouseAddress(warehouse);
    labelTextSection = `Please ship your return to:\n${addr.text}\n`;
    labelHtmlSection = `<div style="background:#f4f0eb;padding:16px 20px;margin:16px 0;border-radius:6px;">
        <p style="margin:0 0 8px;font-weight:600;font-size:13px;text-transform:uppercase;letter-spacing:0.5px;color:#888;">Ship your return to:</p>
        <p style="margin:0;font-size:14px;color:#131314;line-height:1.6;">${addr.html}</p>
      </div>`;
  }

  let textBody = `${greeting}

Great news! Your return for order #${orderNumber} has been approved.

Items: ${items}
${labelTextSection}
Here's what to do next:
1. Pack the item(s) securely in their original packaging if possible.
2. Write your order number #${orderNumber} on a piece of paper and include it inside the package.
${hasLabel ? '3. Attach the prepaid return label to the outside of the package.\n4. Drop off the package at any carrier location.' : '3. Ship the package to the address above using any carrier of your choice.'}

Once we receive your return, we'll process your refund within 5-10 business days.

---
${brand} Team`;

  let htmlBody = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; color: #1a1a1a;">
  <p>${greeting}</p>
  <p>Great news! Your return for order <strong>#${escapeHtml(orderNumber)}</strong> has been approved.</p>
  <p><strong>Items:</strong> ${escapeHtml(items)}</p>
  ${labelHtmlSection}
  <p><strong>Here's what to do next:</strong></p>
  <ol>
    <li>Pack the item(s) securely in their original packaging if possible.</li>
    <li>Write your order number <strong>#${escapeHtml(orderNumber)}</strong> on a piece of paper and include it inside the package.</li>
    ${hasLabel ? '<li>Attach the prepaid return label to the outside of the package.</li><li>Drop off the package at any carrier location.</li>' : '<li>Ship the package to the address above using any carrier of your choice.</li>'}
  </ol>
  <p>Once we receive your return, we'll process your refund within 5-10 business days.</p>
  <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 24px 0;" />
  <p style="color: #aaa; font-size: 13px;">${escapeHtml(brand)} Team</p>
</div>`;

  // Try DB template — use different template based on whether we have a prepaid label
  if (brandId) {
    try {
      const templateType = hasLabel ? 'approved' : 'approved_no_label';
      const tpl = await getTemplate(brandId, templateType);
      if (tpl) {
        if (!tpl.enabled) return { skipped: true };
        const vars: Record<string, string> = {
          greeting: firstName ? `Hi ${firstName},` : 'Hi,',
          ref_id: refId,
          order_number: orderNumber,
          items,
          brand_name: brand,
          label_url: labelUrl || '',
          tracking_number: trackingNumber || '',
        };
        if (hasLabel) {
          // For with-label template: build {{label_section}} variable
          vars.label_section = `<div style="background:#f4f0eb;padding:16px 20px;margin:16px 0;"><p style="margin:0 0 8px;font-weight:500;color:#131314;">Prepaid Return Label</p><p style="margin:0 0 8px;font-size:14px;color:#2d3338;">A prepaid shipping label has been created for your return.</p><a href="${escapeHtml(labelUrl || '')}" style="display:inline-block;padding:10px 24px;background:#C5A059;color:#131314;text-decoration:none;font-size:13px;font-weight:500;letter-spacing:0.05em;text-transform:uppercase;">Download Label</a>${trackingNumber ? `<p style="margin:12px 0 0;font-size:12px;color:#71757a;">Tracking: ${escapeHtml(trackingNumber)}</p>` : ''}</div>`;
        } else {
          // For no-label template: build {{warehouse_address}} variable
          const warehouse = getWarehouseAddress(warehouseHint);
          const addr = formatWarehouseAddress(warehouse);
          vars.warehouse_address = addr.html;
        }
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

  let emailSubject = `Update on your return request — Order #${escapeHtml(orderNumber)}`;

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

  let emailSubject = `Your refund is being processed — Order #${escapeHtml(orderNumber)}`;

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

  let emailSubject = `Your refund has been processed — Order #${escapeHtml(orderNumber)}`;

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
