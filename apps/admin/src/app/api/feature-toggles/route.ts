import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabase
    .from('feature_toggles')
    .select('*')
    .eq('brand_id', session.brandId)
    .order('feature_key');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ toggles: data });
}

export async function PUT(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { feature_key, enabled } = await request.json();

  if (!feature_key || typeof enabled !== 'boolean') {
    return NextResponse.json({ error: 'feature_key and enabled are required' }, { status: 400 });
  }

  const { error } = await supabase
    .from('feature_toggles')
    .update({ enabled, updated_at: new Date().toISOString() })
    .eq('brand_id', session.brandId)
    .eq('feature_key', feature_key);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
