import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

const DESIGN_DEFAULTS = {
  starColor: '#C4A265',
  starStyle: 'filled',
  backgroundColor: '#ffffff',
  textColor: '#333333',
  headingColor: '#C4A265',
  headingFontFamily: '',
  bodyFontFamily: '',
  fontSize: 'medium',
  borderRadius: 'rounded',
  cardStyle: 'bordered',
  buttonStyle: 'outlined',
  buttonText: 'WRITE A REVIEW',
  headerText: 'CUSTOMER REVIEWS',
  reviewsPerPage: 10,
  defaultSort: 'newest',
  showVerifiedBadge: true,
  showVariant: true,
  showDate: true,
  showPhotos: true,
  layout: 'grid',
};

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabase
    .from('review_settings')
    .select('widget_design')
    .eq('brand_id', session.brandId)
    .single();

  if (error && error.code === 'PGRST116') {
    return NextResponse.json({ design: { ...DESIGN_DEFAULTS } });
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const design = { ...DESIGN_DEFAULTS, ...(data?.widget_design || {}) };
  return NextResponse.json({ design });
}

export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();

  // Merge incoming design with defaults
  const design = { ...DESIGN_DEFAULTS, ...(body.design || body) };

  const { data, error } = await supabase
    .from('review_settings')
    .upsert(
      {
        brand_id: session.brandId,
        widget_design: design,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'brand_id' }
    )
    .select('widget_design')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ design: { ...DESIGN_DEFAULTS, ...(data?.widget_design || {}) } });
}
