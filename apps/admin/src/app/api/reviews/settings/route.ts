import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

const DEFAULTS = {
  auto_publish: true,
  auto_publish_min_rating: 1,
  auto_publish_verified_only: false,
  profanity_filter: true,
  request_enabled: true,
  request_delay_days: 14,
  reminder_enabled: true,
  reminder_delay_days: 7,
  incentive_enabled: false,
  reviews_per_page: 10,
  default_sort: 'newest',
  show_verified_badge: true,
  show_incentivized_disclosure: true,
  incentivized_disclosure_text: 'This reviewer received an incentive for their honest review.',
};

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabase
    .from('review_settings')
    .select('*')
    .eq('brand_id', session.brandId)
    .single();

  if (error && error.code === 'PGRST116') {
    return NextResponse.json({ brand_id: session.brandId, ...DEFAULTS });
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();

  const allowedKeys = [
    'auto_publish', 'auto_publish_min_rating', 'auto_publish_verified_only',
    'profanity_filter', 'request_enabled', 'request_delay_days',
    'reminder_enabled', 'reminder_delay_days', 'incentive_enabled',
    'incentive_type', 'incentive_value', 'sender_name', 'sender_email',
    'review_form_fields', 'reviews_per_page', 'default_sort',
    'show_verified_badge', 'show_incentivized_disclosure', 'incentivized_disclosure_text',
  ];

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const key of allowedKeys) {
    if (body[key] !== undefined) updates[key] = body[key];
  }

  const { data, error } = await supabase
    .from('review_settings')
    .upsert(
      { brand_id: session.brandId, ...updates },
      { onConflict: 'brand_id' }
    )
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
