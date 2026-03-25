import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ sku: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { sku } = await params;

  const { error } = await supabase
    .from('label_presets')
    .delete()
    .eq('brand_id', session.brandId)
    .eq('sku', sku);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
