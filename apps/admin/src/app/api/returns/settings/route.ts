import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabase
    .from('return_settings')
    .select('*')
    .eq('brand_id', session.brandId)
    .single();

  if (error && error.code === 'PGRST116') {
    // Not found — return defaults (backend will auto-create on first access)
    return NextResponse.json({
      brand_id: session.brandId,
      return_window_days: 30,
      require_photos: false,
      ai_confidence_threshold: 0.85,
      available_reasons: ['defective', 'wrong_item', 'not_as_described', 'changed_mind', 'too_small', 'too_large', 'arrived_late', 'other'],
      reason_labels: {
        defective: 'Defective / Damaged',
        wrong_item: 'Wrong Item Received',
        not_as_described: 'Not as Described',
        changed_mind: 'Changed My Mind',
        too_small: 'Too Small',
        too_large: 'Too Large',
        arrived_late: 'Arrived Late',
        other: 'Other',
      },
      available_resolutions: ['refund', 'store_credit', 'exchange'],
      auto_close_days: 30,
      portal_title: 'Returns & Exchanges',
      portal_description: 'Start a return or exchange in just a few steps.',
    });
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();

  const allowedKeys = [
    'return_window_days', 'require_photos', 'require_photos_for_reasons',
    'ai_confidence_threshold', 'available_reasons', 'reason_labels',
    'available_resolutions', 'auto_close_days', 'portal_title', 'portal_description',
  ];

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const key of allowedKeys) {
    if (body[key] !== undefined) updates[key] = body[key];
  }

  const { data, error } = await supabase
    .from('return_settings')
    .upsert(
      { brand_id: session.brandId, ...updates },
      { onConflict: 'brand_id' },
    )
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
