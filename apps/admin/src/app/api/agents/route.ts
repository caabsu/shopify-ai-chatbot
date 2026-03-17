import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

export async function GET() {
  const session = await getSession();
  if (!session || session.role === 'agent') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { data: agents, error } = await supabase
    .from('agent_users')
    .select('id, brand_id, name, email, role, is_active, avatar_url, created_at')
    .eq('brand_id', session.brandId)
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: 'Failed to load agents' }, { status: 500 });
  }

  return NextResponse.json({ agents });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session || session.role === 'agent') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { name, email, password, role } = await request.json();

  if (!name || !email || !password) {
    return NextResponse.json({ error: 'Name, email, and password are required' }, { status: 400 });
  }

  if (role && !['admin', 'agent'].includes(role)) {
    return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const { data: agent, error } = await supabase
    .from('agent_users')
    .insert({
      brand_id: session.brandId,
      name,
      email: email.toLowerCase().trim(),
      password_hash: passwordHash,
      role: role || 'agent',
      is_active: true,
    })
    .select('id, brand_id, name, email, role, is_active, avatar_url, created_at')
    .single();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'An agent with this email already exists' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Failed to create agent' }, { status: 500 });
  }

  return NextResponse.json({ agent }, { status: 201 });
}

export async function PUT(request: Request) {
  const session = await getSession();
  if (!session || session.role === 'agent') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { id, is_active, role, name, password } = await request.json();

  if (!id) {
    return NextResponse.json({ error: 'Agent ID is required' }, { status: 400 });
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof is_active === 'boolean') updates.is_active = is_active;
  if (role && ['admin', 'agent'].includes(role)) updates.role = role;
  if (name) updates.name = name;
  if (password) updates.password_hash = await bcrypt.hash(password, 10);

  const { error } = await supabase
    .from('agent_users')
    .update(updates)
    .eq('id', id)
    .eq('brand_id', session.brandId);

  if (error) {
    return NextResponse.json({ error: 'Failed to update agent' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
