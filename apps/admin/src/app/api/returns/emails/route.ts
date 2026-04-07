import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { DEFAULT_RETURN_EMAIL_TEMPLATES, ALL_RETURN_TEMPLATE_TYPES } from '@/lib/return-email-defaults';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabase
    .from('return_email_templates')
    .select('*')
    .eq('brand_id', session.brandId)
    .order('template_type');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Auto-seed any missing template types
  const existing = new Set((data ?? []).map((t: { template_type: string }) => t.template_type));
  const missingTypes = ALL_RETURN_TEMPLATE_TYPES.filter((t) => !existing.has(t));

  if (missingTypes.length > 0) {
    const toInsert = missingTypes.map((type) => ({
      brand_id: session.brandId,
      template_type: type,
      subject: DEFAULT_RETURN_EMAIL_TEMPLATES[type].subject,
      body_html: DEFAULT_RETURN_EMAIL_TEMPLATES[type].body_html,
      body_text: DEFAULT_RETURN_EMAIL_TEMPLATES[type].body_text,
    }));

    const { data: inserted, error: insertErr } = await supabase
      .from('return_email_templates')
      .insert(toInsert)
      .select();

    if (!insertErr && inserted) {
      return NextResponse.json({ templates: [...(data ?? []), ...inserted] });
    }
  }

  return NextResponse.json({ templates: data ?? [] });
}
