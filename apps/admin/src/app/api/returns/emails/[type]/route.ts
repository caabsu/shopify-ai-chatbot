import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { DEFAULT_RETURN_EMAIL_TEMPLATES, ALL_RETURN_TEMPLATE_TYPES, type ReturnTemplateType } from '@/lib/return-email-defaults';

const VALID_TYPES = ALL_RETURN_TEMPLATE_TYPES as readonly string[];

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ type: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { type } = await params;
  if (!VALID_TYPES.includes(type)) {
    return NextResponse.json({ error: 'Invalid template type' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('return_email_templates')
    .select('*')
    .eq('brand_id', session.brandId)
    .eq('template_type', type)
    .single();

  if (error && error.code === 'PGRST116') {
    // Auto-seed this template from defaults
    const defaults = DEFAULT_RETURN_EMAIL_TEMPLATES[type as ReturnTemplateType];
    if (defaults) {
      const { data: created, error: createErr } = await supabase
        .from('return_email_templates')
        .insert({
          brand_id: session.brandId,
          template_type: type,
          subject: defaults.subject,
          body_html: defaults.body_html,
          body_text: defaults.body_text,
        })
        .select()
        .single();

      if (!createErr && created) return NextResponse.json(created);
    }
    return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function PUT(
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
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.enabled !== undefined) updates.enabled = body.enabled;
  if (body.subject !== undefined) updates.subject = body.subject;
  if (body.body_html !== undefined) updates.body_html = body.body_html;
  if (body.body_text !== undefined) updates.body_text = body.body_text;

  const { data, error } = await supabase
    .from('return_email_templates')
    .update(updates)
    .eq('brand_id', session.brandId)
    .eq('template_type', type)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
