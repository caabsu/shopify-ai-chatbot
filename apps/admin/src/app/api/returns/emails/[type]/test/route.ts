import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { Resend } from 'resend';

const VALID_TYPES = ['confirmation', 'approved', 'approved_no_label', 'approved_no_return', 'denied', 'refunded'];

const SAMPLE_VARS: Record<string, string> = {
  greeting: 'Hi Jane,',
  ref_id: 'TEST-001',
  order_number: '#1042',
  items: '<li>Classic Tee (Size M) &mdash; $49.99</li><li>Slim Joggers (Size L) &mdash; $59.99</li>',
  brand_name: 'Outlight',
  label_section:
    '<div style="background:#f4f0eb;padding:16px 20px;margin:16px 0;"><p style="margin:0 0 8px;font-weight:500;color:#131314;">Prepaid Return Label</p><a href="https://example.com/label" style="display:inline-block;padding:10px 24px;background:#C5A059;color:#131314;text-decoration:none;font-size:13px;font-weight:500;letter-spacing:0.05em;text-transform:uppercase;">Download Label</a><p style="margin:12px 0 0;font-size:12px;color:#71757a;">Tracking: TEST123456789</p></div>',
  label_url: 'https://example.com/label',
  tracking_number: 'TEST123456789',
  warehouse_address: 'Outlight - SWT1<br>Red Stag Fulfillment<br>500 Red Stag Way<br>Sweetwater, TN 37874',
  denial_reason: 'The item is outside the 30-day return window.',
  refund_amount: '$109.98',
};

function renderTemplate(html: string, vars: Record<string, string>): string {
  let rendered = html;
  for (const [key, value] of Object.entries(vars)) {
    rendered = rendered.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
  }
  return rendered;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ type: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { type } = await params;
  if (!VALID_TYPES.includes(type)) {
    return NextResponse.json({ error: 'Invalid template type' }, { status: 400 });
  }

  const body = await req.json();
  const { to } = body;
  if (!to || typeof to !== 'string' || !to.includes('@')) {
    return NextResponse.json({ error: 'Valid email address required' }, { status: 400 });
  }

  // Load template
  const { data: template, error } = await supabase
    .from('return_email_templates')
    .select('*')
    .eq('brand_id', session.brandId)
    .eq('template_type', type)
    .single();

  if (error || !template) {
    return NextResponse.json({ error: 'Template not found — save the template first' }, { status: 404 });
  }

  const vars = { ...SAMPLE_VARS, brand_name: session.brandName };
  const renderedSubject = renderTemplate(template.subject, vars);
  const renderedHtml = renderTemplate(template.body_html, vars);

  const apiKey =
    process.env[`RESEND_API_KEY_${session.brandSlug.toUpperCase()}`] ||
    process.env.RESEND_API_KEY;
  const fromAddress =
    process.env[`EMAIL_FROM_ADDRESS_${session.brandSlug.toUpperCase()}`] ||
    process.env.EMAIL_FROM_ADDRESS ||
    'Support <onboarding@resend.dev>';

  if (!apiKey) {
    return NextResponse.json({ error: 'Email not configured (missing RESEND_API_KEY)' }, { status: 500 });
  }

  try {
    const resend = new Resend(apiKey);
    const { error: sendError } = await resend.emails.send({
      from: fromAddress,
      to: [to],
      subject: `[TEST] ${renderedSubject}`,
      html: renderedHtml,
    });

    if (sendError) {
      return NextResponse.json({ error: sendError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Send failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
