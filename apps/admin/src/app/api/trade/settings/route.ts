import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

export async function GET(_req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: settings, error } = await supabase
    .from('trade_settings')
    .select('*')
    .eq('brand_id', session.brandId)
    .single();

  if (error && error.code !== 'PGRST116') {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Return default settings if none exist yet
  return NextResponse.json({
    settings: settings ?? {
      brand_id: session.brandId,
      discount_percentage: 20,
      auto_approve: false,
      require_business_license: false,
      welcome_email_enabled: true,
      portal_enabled: true,
    },
  });
}

export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  const { data: settings, error } = await supabase
    .from('trade_settings')
    .upsert(
      { ...body, brand_id: session.brandId },
      { onConflict: 'brand_id' }
    )
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ settings });
}
