import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: responses, error } = await supabase
    .from('canned_responses')
    .select('*')
    .eq('brand_id', session.brandId)
    .order('usage_count', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ responses: responses ?? [] });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { name, category, content, variables } = body;

  if (!name || !content) {
    return NextResponse.json({ error: 'name and content are required' }, { status: 400 });
  }

  const { data: response, error } = await supabase
    .from('canned_responses')
    .insert({
      brand_id: session.brandId,
      name,
      category: category || 'general',
      content,
      variables: variables || [],
      created_by: session.userId,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ response }, { status: 201 });
}
