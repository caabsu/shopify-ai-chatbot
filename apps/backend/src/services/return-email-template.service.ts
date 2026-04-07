import { supabase } from '../config/supabase.js';
import type { ReturnEmailTemplate } from '../types/index.js';

type TemplateType = ReturnEmailTemplate['template_type'];

const ALL_TEMPLATE_TYPES: TemplateType[] = ['confirmation', 'approved', 'approved_no_label', 'approved_no_return', 'denied', 'refunded'];

// ── Outlight Brand Email Wrapper ─────────────────────────────────────────
function emailWrapper(content: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#F9F9FB;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F9F9FB;">
    <tr><td align="center" style="padding:40px 16px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:8px;overflow:hidden;">
        <!-- Header -->
        <tr><td style="padding:32px 40px 24px;text-align:center;border-bottom:1px solid #f0ece6;">
          <span style="font-size:22px;font-weight:700;letter-spacing:2px;color:#131314;">OUTLIGHT</span>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:32px 40px;color:#131314;font-size:15px;line-height:1.7;">
          ${content}
        </td></tr>
        <!-- Footer -->
        <tr><td style="padding:24px 40px 32px;background-color:#f4f0eb;text-align:center;">
          <p style="margin:0 0 4px;font-size:13px;color:#131314;font-weight:600;">Outlight Team</p>
          <p style="margin:0;font-size:12px;color:#888;">Questions? Reply to this email or contact support.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ── Default Templates ────────────────────────────────────────────────────
const DEFAULT_TEMPLATES: Record<TemplateType, { subject: string; body_html: string; body_text: string }> = {
  confirmation: {
    subject: "We've received your return request \u2014 Order #{{order_number}}",
    body_html: emailWrapper(`
          <p style="margin:0 0 16px;">{{greeting}}</p>
          <p style="margin:0 0 16px;">We've received your return request <strong style="color:#C5A059;">#{{ref_id}}</strong> for order <strong>{{order_number}}</strong>.</p>
          <div style="background-color:#f4f0eb;border-radius:6px;padding:16px 20px;margin:0 0 20px;">
            <p style="margin:0 0 4px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:#888;">Items</p>
            <p style="margin:0;font-size:14px;color:#131314;">{{items}}</p>
          </div>
          <p style="margin:0 0 16px;">Our team is reviewing your request. We'll get back to you shortly with an update.</p>
          <p style="margin:0 0 8px;font-size:13px;color:#888;"><strong>What happens next?</strong></p>
          <p style="margin:0;font-size:13px;color:#888;">You'll receive an email once your return has been reviewed with instructions on next steps.</p>
    `),
    body_text: `{{greeting}}\n\nWe've received your return request #{{ref_id}} for order {{order_number}}.\n\nItems: {{items}}\n\nOur team is reviewing your request. We'll get back to you shortly with an update.\n\nWhat happens next?\nYou'll receive an email once your return has been reviewed with instructions on next steps.\n\n---\nOutlight Team`,
  },

  approved: {
    subject: 'Your return has been approved \u2014 Order #{{order_number}}',
    body_html: emailWrapper(`
          <p style="margin:0 0 16px;">{{greeting}}</p>
          <p style="margin:0 0 16px;">Great news! Your return request <strong style="color:#C5A059;">#{{ref_id}}</strong> for order <strong>{{order_number}}</strong> has been approved.</p>
          <div style="background-color:#f4f0eb;padding:16px 20px;margin:0 0 20px;">
            <p style="margin:0 0 4px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:#888;">Items approved for return</p>
            <p style="margin:0;font-size:14px;color:#131314;">{{items}}</p>
          </div>
          {{label_section}}
          <p style="margin:0 0 12px;font-weight:600;color:#131314;">Next steps:</p>
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
            <tr><td style="padding:4px 12px 4px 0;vertical-align:top;color:#C5A059;font-weight:700;font-size:14px;">1.</td><td style="padding:4px 0;font-size:14px;color:#131314;">Pack item(s) securely in their original packaging if possible.</td></tr>
            <tr><td style="padding:4px 12px 4px 0;vertical-align:top;color:#C5A059;font-weight:700;font-size:14px;">2.</td><td style="padding:4px 0;font-size:14px;color:#131314;">Write your order number <strong>#{{order_number}}</strong> on a piece of paper and include it inside the package.</td></tr>
            <tr><td style="padding:4px 12px 4px 0;vertical-align:top;color:#C5A059;font-weight:700;font-size:14px;">3.</td><td style="padding:4px 0;font-size:14px;color:#131314;">Attach the prepaid label and drop off at any carrier location.</td></tr>
          </table>
          <p style="margin:0;font-size:13px;color:#888;">Your refund will be processed within 5-7 business days of receiving your return.</p>
    `),
    body_text: `{{greeting}}\n\nGreat news! Your return for order #{{order_number}} has been approved.\n\nItems approved for return: {{items}}\n\n{{label_section}}\n\nNext steps:\n1. Pack item(s) securely in their original packaging if possible.\n2. Write your order number #{{order_number}} on a piece of paper and include it inside the package.\n3. Attach the prepaid label and drop off at any carrier location, or ship to the address above.\n\nYour refund will be processed within 5-7 business days of receiving your return.\n\n---\nOutlight Team`,
  },

  approved_no_label: {
    subject: 'Your return has been approved \u2014 Order #{{order_number}}',
    body_html: emailWrapper(`
          <p style="margin:0 0 16px;">{{greeting}}</p>
          <p style="margin:0 0 16px;">Great news! Your return request <strong style="color:#C5A059;">#{{ref_id}}</strong> for order <strong>{{order_number}}</strong> has been approved.</p>
          <div style="background-color:#f4f0eb;padding:16px 20px;margin:0 0 20px;">
            <p style="margin:0 0 4px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:#888;">Items approved for return</p>
            <p style="margin:0;font-size:14px;color:#131314;">{{items}}</p>
          </div>
          <div style="background-color:#f4f0eb;padding:16px 20px;margin:0 0 20px;border-radius:6px;">
            <p style="margin:0 0 8px;font-weight:600;font-size:13px;text-transform:uppercase;letter-spacing:0.5px;color:#888;">Ship your return to:</p>
            <p style="margin:0;font-size:14px;color:#131314;line-height:1.6;">{{warehouse_address}}</p>
          </div>
          <p style="margin:0 0 12px;font-weight:600;color:#131314;">Next steps:</p>
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
            <tr><td style="padding:4px 12px 4px 0;vertical-align:top;color:#C5A059;font-weight:700;font-size:14px;">1.</td><td style="padding:4px 0;font-size:14px;color:#131314;">Pack item(s) securely in their original packaging if possible.</td></tr>
            <tr><td style="padding:4px 12px 4px 0;vertical-align:top;color:#C5A059;font-weight:700;font-size:14px;">2.</td><td style="padding:4px 0;font-size:14px;color:#131314;">Write your order number <strong>#{{order_number}}</strong> on a piece of paper and include it inside the package.</td></tr>
            <tr><td style="padding:4px 12px 4px 0;vertical-align:top;color:#C5A059;font-weight:700;font-size:14px;">3.</td><td style="padding:4px 0;font-size:14px;color:#131314;">Ship the package to the address above using any carrier of your choice.</td></tr>
          </table>
          <p style="margin:0;font-size:13px;color:#888;">Your refund will be processed within 5-7 business days of receiving your return.</p>
    `),
    body_text: `{{greeting}}\n\nGreat news! Your return for order #{{order_number}} has been approved.\n\nItems approved for return: {{items}}\n\nShip your return to:\n{{warehouse_address}}\n\nNext steps:\n1. Pack item(s) securely in their original packaging if possible.\n2. Write your order number #{{order_number}} on a piece of paper and include it inside the package.\n3. Ship the package to the address above using any carrier of your choice.\n\nYour refund will be processed within 5-7 business days of receiving your return.\n\n---\nOutlight Team`,
  },

  approved_no_return: {
    subject: 'Your refund is being processed \u2014 Order #{{order_number}}',
    body_html: emailWrapper(`
          <p style="margin:0 0 16px;">{{greeting}}</p>
          <p style="margin:0 0 16px;">We've reviewed your return request <strong style="color:#C5A059;">#{{ref_id}}</strong> for order <strong>{{order_number}}</strong> and are processing your refund.</p>
          <div style="background-color:#f4f0eb;border-radius:6px;padding:16px 20px;margin:0 0 20px;">
            <p style="margin:0 0 4px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:#888;">Items being refunded</p>
            <p style="margin:0 0 12px;font-size:14px;color:#131314;">{{items}}</p>
            <p style="margin:0 0 4px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:#888;">Refund amount</p>
            <p style="margin:0;font-size:18px;font-weight:700;color:#131314;">{{refund_amount}}</p>
          </div>
          <div style="background-color:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;padding:14px 20px;margin:0 0 20px;">
            <p style="margin:0;font-size:14px;color:#166534;font-weight:600;">No need to return the items.</p>
            <p style="margin:6px 0 0;font-size:13px;color:#166534;">Based on the nature of your request, we're processing a refund without requiring a return.</p>
          </div>
          <p style="margin:0;font-size:13px;color:#888;">Your refund will appear in your original payment method within 5-10 business days, depending on your bank or payment provider.</p>
    `),
    body_text: `{{greeting}}\n\nWe've reviewed your return request #{{ref_id}} for order {{order_number}} and are processing your refund.\n\nItems being refunded: {{items}}\nRefund amount: {{refund_amount}}\n\nNo need to return the items.\nBased on the nature of your request, we're processing a refund without requiring a return.\n\nYour refund will appear in your original payment method within 5-10 business days, depending on your bank or payment provider.\n\n---\nOutlight Team`,
  },

  denied: {
    subject: 'Update on your return request \u2014 Order #{{order_number}}',
    body_html: emailWrapper(`
          <p style="margin:0 0 16px;">{{greeting}}</p>
          <p style="margin:0 0 16px;">Thank you for reaching out about your return request <strong style="color:#C5A059;">#{{ref_id}}</strong> for order <strong>{{order_number}}</strong>.</p>
          <div style="background-color:#f4f0eb;border-radius:6px;padding:16px 20px;margin:0 0 20px;">
            <p style="margin:0 0 4px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:#888;">Items</p>
            <p style="margin:0;font-size:14px;color:#131314;">{{items}}</p>
          </div>
          <p style="margin:0 0 12px;">After reviewing your request, we're unable to process this return at this time.</p>
          <div style="border-left:3px solid #C5A059;padding:12px 16px;margin:0 0 20px;background-color:#fefce8;">
            <p style="margin:0;font-size:14px;color:#131314;">{{denial_reason}}</p>
          </div>
          <p style="margin:0 0 8px;">We understand this may not be the outcome you were hoping for.</p>
          <p style="margin:0;font-size:13px;color:#888;">If you have questions or believe this was made in error, please reply to this email and we'll be happy to take another look.</p>
    `),
    body_text: `{{greeting}}\n\nThank you for reaching out about your return request #{{ref_id}} for order {{order_number}}.\n\nItems: {{items}}\n\nAfter reviewing your request, we're unable to process this return at this time.\n\n{{denial_reason}}\n\nWe understand this may not be the outcome you were hoping for. If you have questions or believe this was made in error, please reply to this email and we'll be happy to take another look.\n\n---\nOutlight Team`,
  },

  refunded: {
    subject: 'Your refund has been processed \u2014 Order #{{order_number}}',
    body_html: emailWrapper(`
          <p style="margin:0 0 16px;">{{greeting}}</p>
          <p style="margin:0 0 16px;">Your refund for return request <strong style="color:#C5A059;">#{{ref_id}}</strong> (order <strong>{{order_number}}</strong>) has been processed.</p>
          <div style="background-color:#f4f0eb;border-radius:6px;padding:16px 20px;margin:0 0 20px;">
            <p style="margin:0 0 4px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:#888;">Items refunded</p>
            <p style="margin:0 0 12px;font-size:14px;color:#131314;">{{items}}</p>
            <p style="margin:0 0 4px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:#888;">Refund amount</p>
            <p style="margin:0;font-size:18px;font-weight:700;color:#131314;">{{refund_amount}}</p>
          </div>
          <div style="background-color:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;padding:14px 20px;margin:0 0 20px;">
            <p style="margin:0;font-size:14px;color:#166534;font-weight:600;">Refund issued to your original payment method.</p>
          </div>
          <p style="margin:0 0 8px;font-size:13px;color:#888;">Please allow 5-10 business days for the refund to appear on your statement, depending on your bank or payment provider.</p>
          <p style="margin:0;font-size:14px;color:#131314;">Thank you for your patience!</p>
    `),
    body_text: `{{greeting}}\n\nYour refund for return request #{{ref_id}} (order {{order_number}}) has been processed.\n\nItems refunded: {{items}}\nRefund amount: {{refund_amount}}\n\nRefund issued to your original payment method.\nPlease allow 5-10 business days for the refund to appear on your statement, depending on your bank or payment provider.\n\nThank you for your patience!\n\n---\nOutlight Team`,
  },
};

// ── CRUD ─────────────────────────────────────────────────────────────────

export async function getTemplates(brandId: string): Promise<ReturnEmailTemplate[]> {
  const { data, error } = await supabase
    .from('return_email_templates')
    .select('*')
    .eq('brand_id', brandId)
    .order('template_type');

  if (error) throw new Error(`Failed to load email templates: ${error.message}`);

  // Seed any missing templates
  const existing = new Set((data ?? []).map((t: ReturnEmailTemplate) => t.template_type));
  const missingTypes = ALL_TEMPLATE_TYPES.filter((t) => !existing.has(t));

  if (missingTypes.length > 0) {
    const toInsert = missingTypes.map((type) => ({
      brand_id: brandId,
      template_type: type,
      subject: DEFAULT_TEMPLATES[type].subject,
      body_html: DEFAULT_TEMPLATES[type].body_html,
      body_text: DEFAULT_TEMPLATES[type].body_text,
    }));

    const { data: inserted, error: insertErr } = await supabase
      .from('return_email_templates')
      .insert(toInsert)
      .select();

    if (insertErr) {
      console.error('[return-email-template] Failed to seed defaults:', insertErr.message);
    } else {
      return [...(data ?? []), ...(inserted ?? [])] as ReturnEmailTemplate[];
    }
  }

  return (data ?? []) as ReturnEmailTemplate[];
}

export async function getTemplate(brandId: string, type: TemplateType): Promise<ReturnEmailTemplate | null> {
  const { data, error } = await supabase
    .from('return_email_templates')
    .select('*')
    .eq('brand_id', brandId)
    .eq('template_type', type)
    .single();

  if (error && error.code === 'PGRST116') {
    // Seed this one template
    const defaults = DEFAULT_TEMPLATES[type];
    if (!defaults) return null;

    const { data: created, error: createErr } = await supabase
      .from('return_email_templates')
      .insert({
        brand_id: brandId,
        template_type: type,
        subject: defaults.subject,
        body_html: defaults.body_html,
        body_text: defaults.body_text,
      })
      .select()
      .single();

    if (createErr) return null;
    return created as ReturnEmailTemplate;
  }

  if (error) throw new Error(`Failed to load email template: ${error.message}`);
  return data as ReturnEmailTemplate;
}

export async function updateTemplate(
  brandId: string,
  type: TemplateType,
  updates: Partial<Pick<ReturnEmailTemplate, 'enabled' | 'subject' | 'body_html' | 'body_text'>>,
): Promise<ReturnEmailTemplate> {
  const { data, error } = await supabase
    .from('return_email_templates')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('brand_id', brandId)
    .eq('template_type', type)
    .select()
    .single();

  if (error) throw new Error(`Failed to update email template: ${error.message}`);
  return data as ReturnEmailTemplate;
}

export function renderTemplate(template: string, variables: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
  }
  return result;
}
