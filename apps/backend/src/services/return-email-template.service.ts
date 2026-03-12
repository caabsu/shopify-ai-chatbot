import { supabase } from '../config/supabase.js';
import type { ReturnEmailTemplate } from '../types/index.js';

type TemplateType = ReturnEmailTemplate['template_type'];

const DEFAULT_TEMPLATES: Record<TemplateType, { subject: string; body_html: string; body_text: string }> = {
  confirmation: {
    subject: "We've received your return request — #{{ref_id}}",
    body_html: `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; color: #1a1a1a;">
  <p>{{greeting}}</p>
  <p>We've received your return request <strong>#{{ref_id}}</strong> for order <strong>{{order_number}}</strong>.</p>
  <p><strong>Items:</strong> {{items}}</p>
  <p>Our team will review your request and get back to you shortly.</p>
  <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 24px 0;" />
  <p style="color: #aaa; font-size: 13px;">{{brand_name}} Team</p>
</div>`,
    body_text: `{{greeting}}\n\nWe've received your return request #{{ref_id}} for order {{order_number}}.\n\nItems: {{items}}\n\nOur team will review your request and get back to you shortly.\n\n---\n{{brand_name}} Team`,
  },
  approved: {
    subject: 'Your return has been approved — #{{ref_id}}',
    body_html: `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; color: #1a1a1a;">
  <p>{{greeting}}</p>
  <p>Great news! Your return request <strong>#{{ref_id}}</strong> for order <strong>{{order_number}}</strong> has been approved.</p>
  <p><strong>Items:</strong> {{items}}</p>
  <p><strong>Here's what to do next:</strong></p>
  <ol>
    <li>Pack the item(s) securely in their original packaging if possible.</li>
    <li>Include your return reference number <strong>#{{ref_id}}</strong> inside the package.</li>
    <li>Ship the package to the return address provided in your account.</li>
  </ol>
  <p>Once we receive your return, we'll process your refund within 5-10 business days.</p>
  <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 24px 0;" />
  <p style="color: #aaa; font-size: 13px;">{{brand_name}} Team</p>
</div>`,
    body_text: `{{greeting}}\n\nGreat news! Your return request #{{ref_id}} for order {{order_number}} has been approved.\n\nItems: {{items}}\n\nHere's what to do next:\n1. Pack the item(s) securely in their original packaging if possible.\n2. Include your return reference number #{{ref_id}} inside the package.\n3. Ship the package to the return address provided in your account.\n\nOnce we receive your return, we'll process your refund within 5-10 business days.\n\n---\n{{brand_name}} Team`,
  },
  denied: {
    subject: 'Update on your return request — #{{ref_id}}',
    body_html: `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; color: #1a1a1a;">
  <p>{{greeting}}</p>
  <p>Thank you for your return request <strong>#{{ref_id}}</strong> for order <strong>{{order_number}}</strong>.</p>
  <p><strong>Items:</strong> {{items}}</p>
  <p>Unfortunately, your return request was not approved.</p>
  <p><strong>Reason:</strong> {{denial_reason}}</p>
  <p>If you have any questions or believe this was made in error, please don't hesitate to contact our support team.</p>
  <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 24px 0;" />
  <p style="color: #aaa; font-size: 13px;">{{brand_name}} Team</p>
</div>`,
    body_text: `{{greeting}}\n\nThank you for your return request #{{ref_id}} for order {{order_number}}.\n\nItems: {{items}}\n\nUnfortunately, your return request was not approved. Reason: {{denial_reason}}\n\nIf you have any questions or believe this was made in error, please don't hesitate to contact our support team.\n\n---\n{{brand_name}} Team`,
  },
  refunded: {
    subject: 'Your refund has been processed — #{{ref_id}}',
    body_html: `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; color: #1a1a1a;">
  <p>{{greeting}}</p>
  <p>Your refund of <strong>{{refund_amount}}</strong> for return request <strong>#{{ref_id}}</strong> (order <strong>{{order_number}}</strong>) has been processed.</p>
  <p><strong>Items:</strong> {{items}}</p>
  <p>The refund should appear in your original payment method within 5-10 business days, depending on your bank or payment provider.</p>
  <p>Thank you for your patience!</p>
  <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 24px 0;" />
  <p style="color: #aaa; font-size: 13px;">{{brand_name}} Team</p>
</div>`,
    body_text: `{{greeting}}\n\nYour refund of {{refund_amount}} for return request #{{ref_id}} (order {{order_number}}) has been processed.\n\nItems: {{items}}\n\nThe refund should appear in your original payment method within 5-10 business days, depending on your bank or payment provider.\n\nThank you for your patience!\n\n---\n{{brand_name}} Team`,
  },
};

export async function getTemplates(brandId: string): Promise<ReturnEmailTemplate[]> {
  const { data, error } = await supabase
    .from('return_email_templates')
    .select('*')
    .eq('brand_id', brandId)
    .order('template_type');

  if (error) throw new Error(`Failed to load email templates: ${error.message}`);

  // Seed any missing templates
  const existing = new Set((data ?? []).map((t: ReturnEmailTemplate) => t.template_type));
  const missingTypes = (['confirmation', 'approved', 'denied', 'refunded'] as TemplateType[]).filter(
    (t) => !existing.has(t),
  );

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
