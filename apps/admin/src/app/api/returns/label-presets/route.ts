import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabase
    .from('label_presets')
    .select('*')
    .eq('brand_id', session.brandId)
    .order('sku', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ presets: data ?? [] });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { sku, product_title, length, width, height, weight, weight_unit, dimension_unit } = body;

  if (!sku || length == null || width == null || height == null || weight == null) {
    return NextResponse.json(
      { error: 'sku, length, width, height, and weight are required' },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from('label_presets')
    .upsert(
      {
        brand_id: session.brandId,
        sku,
        product_title: product_title ?? null,
        length,
        width,
        height,
        weight,
        weight_unit: weight_unit ?? 'lb',
        dimension_unit: dimension_unit ?? 'in',
      },
      { onConflict: 'brand_id,sku' }
    )
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ preset: data }, { status: 201 });
}
