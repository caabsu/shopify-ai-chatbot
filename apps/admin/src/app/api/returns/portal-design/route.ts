import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabase
    .from('ai_config')
    .select('value')
    .eq('brand_id', session.brandId)
    .eq('key', 'return_portal_design')
    .single();

  if (error && error.code !== 'PGRST116') {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let design = null;
  if (data?.value) {
    try { design = JSON.parse(data.value); } catch { /* ignore */ }
  }

  return NextResponse.json({ design });
}

export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();

  const { error } = await supabase
    .from('ai_config')
    .upsert(
      {
        brand_id: session.brandId,
        key: 'return_portal_design',
        value: JSON.stringify(body),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'brand_id,key' },
    );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
