import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

const DEFAULT_BRAND_ID = '00000000-0000-0000-0000-000000000000';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Try brand-specific templates first
  const { data: brandTemplates, error } = await supabase
    .from('review_email_templates')
    .select('*')
    .eq('brand_id', session.brandId)
    .order('template_type');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (brandTemplates && brandTemplates.length > 0) {
    return NextResponse.json({ templates: brandTemplates });
  }

  // Fall back to default templates
  const { data: defaults, error: defaultError } = await supabase
    .from('review_email_templates')
    .select('*')
    .eq('brand_id', DEFAULT_BRAND_ID)
    .order('template_type');

  if (defaultError) return NextResponse.json({ error: defaultError.message }, { status: 500 });

  return NextResponse.json({ templates: defaults ?? [] });
}
