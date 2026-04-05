import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { Resend } from 'resend';
import { randomUUID } from 'crypto';

const VALID_TYPES = ['request', 'reminder', 'thank_you'];

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  process.env.BACKEND_URL ||
  'https://shopify-ai-chatbot-production-9ab4.up.railway.app';

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
    subject: "Quick reminder: We'd love your feedback!",
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
  const { to, product_title, customer_name } = body;
  if (!to || typeof to !== 'string' || !to.includes('@')) {
    return NextResponse.json({ error: 'Valid email address required' }, { status: 400 });
  }

  // Load template (brand-specific first, then fall back to defaults)
  let template: { subject: string; body_html: string } | null = null;
  const { data: brandTemplate } = await supabase
    .from('review_email_templates')
    .select('*')
    .eq('brand_id', session.brandId)
    .eq('template_type', type)
    .single();

  if (brandTemplate) {
    template = brandTemplate as { subject: string; body_html: string };
  } else {
    template = DEFAULT_TEMPLATES[type] || null;
  }

  if (!template) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  }

  // Look up product by title to get its ID for the review_request
  let productIds: string[] = [];
  const resolvedProductTitle = product_title || 'your purchase';
  if (product_title) {
    const { data: product } = await supabase
      .from('products')
      .select('id')
      .eq('brand_id', session.brandId)
      .eq('title', product_title)
      .limit(1)
      .maybeSingle();
    if (product) {
      productIds = [product.id];
    }
  }

  // Create a real review_request in DB so the link actually works
  const testToken = randomUUID();
  const { error: insertError } = await supabase.from('review_requests').insert({
    brand_id: session.brandId,
    shopify_order_id: `test-${Date.now()}`,
    customer_email: to,
    customer_name: customer_name || session.name || 'Test User',
    product_ids: productIds,
    token: testToken,
    status: 'sent',
    scheduled_for: new Date().toISOString(),
    sent_at: new Date().toISOString(),
  });

  if (insertError) {
    console.error('Failed to create test review_request:', insertError.message);
  }

  const reviewLink = `${BACKEND_URL}/review?token=${testToken}`;

  const vars: Record<string, string> = {
    customer_name: customer_name || session.name || 'Jane',
    product_title: resolvedProductTitle,
    review_link: reviewLink,
    brand_name: session.brandName,
  };

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

    return NextResponse.json({ success: true, type });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Send failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
