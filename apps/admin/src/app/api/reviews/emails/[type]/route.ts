import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

const VALID_TYPES = ['request', 'reminder', 'thank_you'];
const DEFAULT_BRAND_ID = '00000000-0000-0000-0000-000000000000';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ type: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { type } = await params;
  if (!VALID_TYPES.includes(type)) {
    return NextResponse.json({ error: 'Invalid template type' }, { status: 400 });
  }

  // Try brand-specific template
  const { data, error } = await supabase
    .from('review_email_templates')
    .select('*')
    .eq('brand_id', session.brandId)
    .eq('template_type', type)
    .single();

  if (!error && data) {
    return NextResponse.json(data);
  }

  // Fall back to default template
  if (error && error.code === 'PGRST116') {
    const { data: defaultTpl, error: defaultError } = await supabase
      .from('review_email_templates')
      .select('*')
      .eq('brand_id', DEFAULT_BRAND_ID)
      .eq('template_type', type)
      .single();

    if (defaultError && defaultError.code === 'PGRST116') {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    }
    if (defaultError) return NextResponse.json({ error: defaultError.message }, { status: 500 });
    return NextResponse.json(defaultTpl);
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ type: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { type } = await params;
  if (!VALID_TYPES.includes(type)) {
    return NextResponse.json({ error: 'Invalid template type' }, { status: 400 });
  }

  const body = await req.json();

  const record: Record<string, unknown> = {
    brand_id: session.brandId,
    template_type: type,
    updated_at: new Date().toISOString(),
  };

  if (body.subject !== undefined) record.subject = body.subject;
  if (body.body_html !== undefined) record.body_html = body.body_html;
  if (body.enabled !== undefined) record.enabled = body.enabled;

  const { data, error } = await supabase
    .from('review_email_templates')
    .upsert(record, { onConflict: 'brand_id,template_type' })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
