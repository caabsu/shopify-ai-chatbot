import { Resend } from 'resend';
import { supabase } from '../config/supabase.js';
import { getBrandSlug, getBrandName } from '../config/brand.js';
import { getReviewSettings } from './review-settings.service.js';
import type { ReviewEmailTemplate, ReviewRequestLineItem } from '../types/index.js';
import { v4 as uuidv4 } from 'uuid';
import { logEvent } from './activity-log.service.js';

// ── Per-Brand Resend Client ───────────────────────────────────────────────

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
const defaultFromAddress = process.env.EMAIL_FROM_ADDRESS || 'Reviews <onboarding@resend.dev>';

interface BrandEmailConfig {
  resend: Resend;
  fromAddress: string;
}

async function getBrandEmailConfig(brandId: string): Promise<BrandEmailConfig | null> {
  let apiKey = defaultApiKey;
  let fromAddress = defaultFromAddress;

  const slug = await getBrandSlug(brandId);
  if (slug) {
    const upper = slug.toUpperCase();
    const brandKey = process.env[`RESEND_API_KEY_${upper}`];
    const brandFrom = process.env[`EMAIL_FROM_ADDRESS_${upper}`];
    if (brandKey) apiKey = brandKey;
    if (brandFrom) fromAddress = brandFrom;
  }

  if (!apiKey) return null;
  return { resend: getResendClient(apiKey), fromAddress };
}

// ── Default Email Templates ───────────────────────────────────────────────

const DEFAULT_TEMPLATES: Record<string, { subject: string; body_html: string }> = {
  request: {
    subject: 'How did you like your purchase? Leave a review!',
    body_html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #333;">Hi {{customer_name}},</h2>
        <p>We hope you're enjoying your recent purchase of <strong>{{product_title}}</strong>!</p>
        <p>We'd love to hear what you think. Your feedback helps other shoppers and helps us improve.</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="{{review_link}}" style="background-color: #C4A265; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-size: 16px;">Write a Review</a>
        </div>
        <p style="color: #666; font-size: 14px;">Thank you for shopping with {{brand_name}}!</p>
      </div>
    `,
  },
  reminder: {
    subject: 'Quick reminder: We\'d love your feedback!',
    body_html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #333;">Hi {{customer_name}},</h2>
        <p>Just a friendly reminder — we'd really appreciate your thoughts on <strong>{{product_title}}</strong>.</p>
        <p>It only takes a minute and helps us a lot!</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="{{review_link}}" style="background-color: #C4A265; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-size: 16px;">Write a Review</a>
        </div>
        <p style="color: #666; font-size: 14px;">Thanks again, {{brand_name}}</p>
      </div>
    `,
  },
  thank_you: {
    subject: 'Thank you for your review!',
    body_html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #333;">Thank you, {{customer_name}}!</h2>
        <p>We really appreciate you taking the time to review <strong>{{product_title}}</strong>.</p>
        <p>Your feedback means the world to us and helps fellow shoppers make informed decisions.</p>
        <p style="color: #666; font-size: 14px;">With gratitude, {{brand_name}}</p>
      </div>
    `,
  },
};

// ── Template Variable Replacement ─────────────────────────────────────────

function replaceTemplateVars(
  text: string,
  vars: { customer_name?: string; product_title?: string; review_link?: string; brand_name?: string },
): string {
  let result = text;
  result = result.replace(/\{\{customer_name\}\}/g, vars.customer_name ?? 'Customer');
  result = result.replace(/\{\{product_title\}\}/g, vars.product_title ?? 'your purchase');
  result = result.replace(/\{\{review_link\}\}/g, vars.review_link ?? '#');
  result = result.replace(/\{\{brand_name\}\}/g, vars.brand_name ?? 'Our Store');
  return result;
}

// ── Schedule Review Request ───────────────────────────────────────────────

interface OrderInfo {
  shopify_order_id: string;
  shopify_customer_id?: string | null;
  customer_email: string;
  customer_name?: string | null;
  product_ids: string[];
  line_items?: ReviewRequestLineItem[];
  /** The order's fulfillment date — used as the base for scheduling instead of now() */
  fulfilled_at?: string | null;
}

export async function scheduleReviewRequest(
  order: OrderInfo,
  brandId: string,
): Promise<void> {
  try {
    const settings = await getReviewSettings(brandId);

    if (!settings.request_enabled) {
      console.log('[review-email] Review requests are disabled for brand', brandId);
      return;
    }

    // Check for existing request for this order
    const { data: existing } = await supabase
      .from('review_requests')
      .select('id')
      .eq('shopify_order_id', order.shopify_order_id)
      .eq('brand_id', brandId)
      .single();

    if (existing) {
      console.log(`[review-email] Review request already exists for order ${order.shopify_order_id}`);
      return;
    }

    // Use fulfillment date as base (for backfills), fall back to now for webhook-triggered
    const baseDate = order.fulfilled_at ? new Date(order.fulfilled_at) : new Date();
    const scheduledFor = new Date(baseDate);
    scheduledFor.setDate(scheduledFor.getDate() + settings.request_delay_days);

    // If scheduled_for ended up in the past (old backfilled order), schedule for 1 hour from now
    const now = new Date();
    if (scheduledFor < now) {
      scheduledFor.setTime(now.getTime() + 60 * 60 * 1000);
    }

    const reminderScheduledFor = settings.reminder_enabled
      ? new Date(scheduledFor.getTime() + settings.reminder_delay_days * 24 * 60 * 60 * 1000)
      : null;

    const token = uuidv4();

    const { error } = await supabase
      .from('review_requests')
      .insert({
        shopify_order_id: order.shopify_order_id,
        shopify_customer_id: order.shopify_customer_id ?? null,
        customer_email: order.customer_email,
        customer_name: order.customer_name ?? null,
        product_ids: order.product_ids,
        line_items: order.line_items ?? null,
        status: 'scheduled',
        scheduled_for: scheduledFor.toISOString(),
        reminder_scheduled_for: reminderScheduledFor?.toISOString() ?? null,
        token,
        brand_id: brandId,
      });

    if (error) {
      console.error('[review-email] Failed to schedule review request:', error.message);
      throw new Error(`Failed to schedule review request: ${error.message}`);
    }

    console.log(`[review-email] Scheduled review request for order ${order.shopify_order_id}, send at ${scheduledFor.toISOString()}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[review-email] scheduleReviewRequest failed:', message);
    throw new Error(`Failed to schedule review request: ${message}`);
  }
}

// ── Process Scheduled Emails ──────────────────────────────────────────────

export async function processScheduledEmails(): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;

  try {
    const now = new Date().toISOString();

    const { data: requests, error } = await supabase
      .from('review_requests')
      .select('*')
      .eq('status', 'scheduled')
      .lte('scheduled_for', now)
      .limit(50);

    if (error) {
      console.error('[review-email] Failed to fetch scheduled requests:', error.message);
      return { sent: 0, failed: 0 };
    }

    if (!requests || requests.length === 0) return { sent: 0, failed: 0 };

    for (const request of requests) {
      try {
        const req = request as Record<string, unknown>;
        const brandId = req.brand_id as string;
        const emailConfig = await getBrandEmailConfig(brandId);

        if (!emailConfig) {
          console.error(`[review-email] No email config for brand ${brandId}`);
          failed++;
          continue;
        }

        const brandName = await getBrandName(brandId) ?? 'Our Store';
        const template = await getEffectiveTemplate(brandId, 'request');

        // Build product title from line_items (preferred) or fall back to product_ids lookup
        const reqLineItems = req.line_items as ReviewRequestLineItem[] | null;
        const productIds = req.product_ids as string[];
        let productTitle = 'your purchase';

        if (reqLineItems && reqLineItems.length > 0) {
          productTitle = reqLineItems.slice(0, 3).map((li) => {
            if (li.variant_title && li.variant_title !== 'Default Title') {
              return `${li.product_title} - ${li.variant_title}`;
            }
            return li.product_title;
          }).join(', ');
        } else if (productIds.length > 0) {
          const { data: products } = await supabase
            .from('products')
            .select('title')
            .in('id', productIds)
            .limit(3);

          if (products && products.length > 0) {
            productTitle = (products as Array<{ title: string }>).map((p) => p.title).join(', ');
          }
        }

        const reviewLink = `https://${process.env.REVIEW_FORM_BASE_URL || 'shopify-ai-chatbot-production-9ab4.up.railway.app'}/review?token=${req.token as string}`;

        const subject = replaceTemplateVars(template.subject, {
          customer_name: req.customer_name as string | undefined,
          product_title: productTitle,
          review_link: reviewLink,
          brand_name: brandName,
        });

        const bodyHtml = replaceTemplateVars(template.body_html, {
          customer_name: req.customer_name as string | undefined,
          product_title: productTitle,
          review_link: reviewLink,
          brand_name: brandName,
        });

        const settings = await getReviewSettings(brandId);

        await emailConfig.resend.emails.send({
          from: settings.sender_email
            ? `${settings.sender_name || brandName} <${settings.sender_email}>`
            : emailConfig.fromAddress,
          to: req.customer_email as string,
          subject,
          html: bodyHtml,
        });

        await supabase
          .from('review_requests')
          .update({ status: 'sent', sent_at: new Date().toISOString() })
          .eq('id', req.id);

        sent++;
        logEvent('email.sent', 'success', `Review request email sent to ${req.customer_email} (order ${req.shopify_order_id})`, {
          email: req.customer_email, orderId: req.shopify_order_id, type: 'request',
        });
        console.log(`[review-email] Sent review request email to ${req.customer_email} for order ${req.shopify_order_id}`);
      } catch (err) {
        failed++;
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[review-email] Failed to send email for request ${(request as Record<string, unknown>).id}:`, message);

        logEvent('email.failed', 'error', `Failed to send request email to ${(request as Record<string, unknown>).customer_email}: ${message}`, {
          email: (request as Record<string, unknown>).customer_email, type: 'request',
        });

        await supabase
          .from('review_requests')
          .update({ status: 'bounced' })
          .eq('id', (request as Record<string, unknown>).id);
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[review-email] processScheduledEmails failed:', message);
  }

  return { sent, failed };
}

// ── Process Scheduled Reminders ───────────────────────────────────────────

export async function processScheduledReminders(): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;

  try {
    const now = new Date().toISOString();

    const { data: requests, error } = await supabase
      .from('review_requests')
      .select('*')
      .eq('status', 'sent')
      .not('reminder_scheduled_for', 'is', null)
      .lte('reminder_scheduled_for', now)
      .limit(50);

    if (error) {
      console.error('[review-email] Failed to fetch reminder requests:', error.message);
      return { sent: 0, failed: 0 };
    }

    if (!requests || requests.length === 0) return { sent: 0, failed: 0 };

    for (const request of requests) {
      try {
        const req = request as Record<string, unknown>;
        const brandId = req.brand_id as string;
        const emailConfig = await getBrandEmailConfig(brandId);

        if (!emailConfig) {
          failed++;
          continue;
        }

        const brandName = await getBrandName(brandId) ?? 'Our Store';
        const template = await getEffectiveTemplate(brandId, 'reminder');

        // Build product title from line_items (preferred) or fall back to product_ids lookup
        const reqLineItems = req.line_items as ReviewRequestLineItem[] | null;
        const productIds = req.product_ids as string[];
        let productTitle = 'your purchase';

        if (reqLineItems && reqLineItems.length > 0) {
          productTitle = reqLineItems.slice(0, 3).map((li) => {
            if (li.variant_title && li.variant_title !== 'Default Title') {
              return `${li.product_title} - ${li.variant_title}`;
            }
            return li.product_title;
          }).join(', ');
        } else if (productIds.length > 0) {
          const { data: products } = await supabase
            .from('products')
            .select('title')
            .in('id', productIds)
            .limit(3);

          if (products && products.length > 0) {
            productTitle = (products as Array<{ title: string }>).map((p) => p.title).join(', ');
          }
        }

        const reviewLink = `https://${process.env.REVIEW_FORM_BASE_URL || 'shopify-ai-chatbot-production-9ab4.up.railway.app'}/review?token=${req.token as string}`;

        const subject = replaceTemplateVars(template.subject, {
          customer_name: req.customer_name as string | undefined,
          product_title: productTitle,
          review_link: reviewLink,
          brand_name: brandName,
        });

        const bodyHtml = replaceTemplateVars(template.body_html, {
          customer_name: req.customer_name as string | undefined,
          product_title: productTitle,
          review_link: reviewLink,
          brand_name: brandName,
        });

        const settings = await getReviewSettings(brandId);

        await emailConfig.resend.emails.send({
          from: settings.sender_email
            ? `${settings.sender_name || brandName} <${settings.sender_email}>`
            : emailConfig.fromAddress,
          to: req.customer_email as string,
          subject,
          html: bodyHtml,
        });

        await supabase
          .from('review_requests')
          .update({ status: 'reminded', reminder_sent_at: new Date().toISOString() })
          .eq('id', req.id);

        sent++;
        logEvent('email.sent', 'success', `Reminder email sent to ${req.customer_email}`, {
          email: req.customer_email, type: 'reminder',
        });
        console.log(`[review-email] Sent reminder email to ${req.customer_email}`);
      } catch (err) {
        failed++;
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[review-email] Failed to send reminder for request ${(request as Record<string, unknown>).id}:`, message);
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[review-email] processScheduledReminders failed:', message);
  }

  return { sent, failed };
}

// ── Expire Old Requests ───────────────────────────────────────────────────

export async function expireOldRequests(): Promise<{ expired: number }> {
  try {
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() - 30);

    const { error, count } = await supabase
      .from('review_requests')
      .update({ status: 'expired' })
      .in('status', ['scheduled', 'sent', 'reminded'])
      .lt('created_at', expiryDate.toISOString());

    if (error) {
      console.error('[review-email] Failed to expire old requests:', error.message);
      return { expired: 0 };
    }

    const expired = count ?? 0;
    if (expired > 0) {
      console.log(`[review-email] Expired ${expired} old review requests`);
    }
    return { expired };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[review-email] expireOldRequests failed:', message);
    return { expired: 0 };
  }
}

// ── Email Template Management ─────────────────────────────────────────────

async function getEffectiveTemplate(
  brandId: string,
  templateType: 'request' | 'reminder' | 'thank_you',
): Promise<{ subject: string; body_html: string }> {
  const { data, error } = await supabase
    .from('review_email_templates')
    .select('*')
    .eq('brand_id', brandId)
    .eq('template_type', templateType)
    .eq('enabled', true)
    .single();

  if (!error && data) {
    return { subject: (data as ReviewEmailTemplate).subject, body_html: (data as ReviewEmailTemplate).body_html };
  }

  // Fallback to default
  const defaultTpl = DEFAULT_TEMPLATES[templateType];
  if (defaultTpl) return defaultTpl;

  return { subject: 'Review your purchase', body_html: '<p>Please leave a review!</p>' };
}

export async function getEmailTemplates(brandId: string): Promise<ReviewEmailTemplate[]> {
  try {
    const { data, error } = await supabase
      .from('review_email_templates')
      .select('*')
      .eq('brand_id', brandId)
      .order('template_type');

    if (error) throw new Error(`Failed to fetch email templates: ${error.message}`);

    const templates = (data ?? []) as ReviewEmailTemplate[];

    // Ensure all template types exist (fill with defaults if missing)
    const types: Array<'request' | 'reminder' | 'thank_you'> = ['request', 'reminder', 'thank_you'];
    const result: ReviewEmailTemplate[] = [];

    for (const type of types) {
      const existing = templates.find((t) => t.template_type === type);
      if (existing) {
        result.push(existing);
      } else {
        const defaults = DEFAULT_TEMPLATES[type];
        result.push({
          id: '',
          brand_id: brandId,
          template_type: type,
          subject: defaults.subject,
          body_html: defaults.body_html,
          enabled: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }
    }

    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[review-email] getEmailTemplates failed:', message);
    throw new Error(`Failed to get email templates: ${message}`);
  }
}

export async function updateEmailTemplate(
  brandId: string,
  templateType: 'request' | 'reminder' | 'thank_you',
  updates: Partial<Pick<ReviewEmailTemplate, 'subject' | 'body_html' | 'enabled'>>,
): Promise<ReviewEmailTemplate> {
  try {
    const { data, error } = await supabase
      .from('review_email_templates')
      .upsert(
        {
          brand_id: brandId,
          template_type: templateType,
          subject: updates.subject ?? DEFAULT_TEMPLATES[templateType]?.subject ?? '',
          body_html: updates.body_html ?? DEFAULT_TEMPLATES[templateType]?.body_html ?? '',
          enabled: updates.enabled ?? true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'brand_id,template_type' },
      )
      .select()
      .single();

    if (error) throw new Error(`Failed to update email template: ${error.message}`);
    return data as ReviewEmailTemplate;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[review-email] updateEmailTemplate failed:', message);
    throw new Error(`Failed to update email template: ${message}`);
  }
}
