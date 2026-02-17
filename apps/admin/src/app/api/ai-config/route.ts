import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabase
    .from('ai_config')
    .select('*')
    .eq('brand_id', session.brandId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const configMap: Record<string, string> = {};
  for (const row of data ?? []) {
    configMap[row.key] = row.value;
  }

  return NextResponse.json({ config: configMap });
}

export async function PUT(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { key, value } = body;

  if (!key || value === undefined) {
    return NextResponse.json({ error: 'Key and value are required' }, { status: 400 });
  }

  // Upsert
  const { error } = await supabase
    .from('ai_config')
    .upsert(
      { brand_id: session.brandId, key, value, updated_at: new Date().toISOString() },
      { onConflict: 'brand_id,key' }
    );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
