import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET() {
  const { data: brands, error } = await supabase
    .from('brands')
    .select('id, name, slug')
    .eq('enabled', true)
    .order('name');

  if (error) {
    return NextResponse.json({ error: 'Failed to load brands' }, { status: 500 });
  }

  return NextResponse.json({ brands });
}
