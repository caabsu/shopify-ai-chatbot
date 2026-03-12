import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: rules, error } = await supabase
    .from('return_rules')
    .select('*')
    .eq('brand_id', session.brandId)
    .order('priority', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ rules: rules ?? [] });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();

  const { data: rule, error } = await supabase
    .from('return_rules')
    .insert({
      brand_id: session.brandId,
      name: body.name,
      enabled: body.enabled ?? true,
      priority: body.priority ?? 0,
      conditions: body.conditions ?? {},
      action: body.action,
      resolution_type: body.resolution_type || null,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ rule }, { status: 201 });
}
