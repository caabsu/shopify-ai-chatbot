import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { Resend } from 'resend';

const VALID_TYPES = ['request', 'reminder', 'thank_you'];
const DEFAULT_BRAND_ID = '00000000-0000-0000-0000-000000000000';

const SAMPLE_VARS: Record<string, string> = {
  customer_name: 'Jane',
  product_title: 'Classic Outdoor Tee',
  review_link: 'https://example.com/review/abc123',
  brand_name: 'Outlight',
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

  // Load template (brand-specific first, then default)
  let template = null;
  const { data: brandTemplate } = await supabase
    .from('review_email_templates')
    .select('*')
    .eq('brand_id', session.brandId)
    .eq('template_type', type)
    .single();

  if (brandTemplate) {
    template = brandTemplate;
  } else {
    const { data: defaultTemplate } = await supabase
      .from('review_email_templates')
      .select('*')
      .eq('brand_id', DEFAULT_BRAND_ID)
      .eq('template_type', type)
      .single();
    template = defaultTemplate;
  }

  if (!template) {
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
