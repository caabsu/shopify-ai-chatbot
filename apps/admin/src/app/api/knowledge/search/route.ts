import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const q = req.nextUrl.searchParams.get('q')?.trim();
  if (!q) {
    return NextResponse.json({ documents: [] });
  }

  // Full-text search across title and content
  const { data, error } = await supabase
    .from('knowledge_documents')
    .select('id, title, content, category')
    .eq('brand_id', session.brandId)
    .eq('enabled', true)
    .or(`title.ilike.%${q}%,content.ilike.%${q}%`)
    .order('priority', { ascending: false })
    .limit(8);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ documents: data });
}
