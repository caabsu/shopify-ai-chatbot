import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabase
    .from('brands')
    .select('id, name, slug, shopify_shop, settings, created_at')
    .eq('id', session.brandId)
    .single();

  if (error) return NextResponse.json({ error: 'Brand not found' }, { status: 404 });
  return NextResponse.json({ brand: data });
}

export async function PUT(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (body.name) updates.name = body.name;

  if (body.newPassword) {
    updates.password_hash = await bcrypt.hash(body.newPassword, 10);
  }

  const { error } = await supabase
    .from('brands')
    .update(updates)
    .eq('id', session.brandId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
