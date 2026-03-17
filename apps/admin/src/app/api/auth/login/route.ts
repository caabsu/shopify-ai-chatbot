import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { supabase } from '@/lib/supabase';
import { signToken, COOKIE_NAME } from '@/lib/auth';
import type { UserRole } from '@/lib/auth';

export async function POST(request: Request) {
  const { brandSlug, password, email } = await request.json();

  if (!brandSlug || !password) {
    return NextResponse.json({ error: 'Brand and password are required' }, { status: 400 });
  }

  // Look up the brand
  const { data: brand, error: brandError } = await supabase
    .from('brands')
    .select('*')
    .eq('slug', brandSlug)
    .eq('enabled', true)
    .single();

  if (brandError || !brand) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  // Path 1: Email + password → agent_users lookup (individual user login)
  if (email) {
    const { data: user, error: userError } = await supabase
      .from('agent_users')
      .select('*')
      .eq('brand_id', brand.id)
      .eq('email', email.toLowerCase().trim())
      .eq('is_active', true)
      .single();

    if (userError || !user || !user.password_hash) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    const token = await signToken({
      brandId: brand.id,
      brandName: brand.name,
      brandSlug: brand.slug,
      userId: user.id,
      name: user.name,
      email: user.email,
      role: user.role as UserRole,
    });

    const response = NextResponse.json({
      success: true,
      brandName: brand.name,
      role: user.role,
      name: user.name,
    });
    response.cookies.set(COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24,
      path: '/',
    });

    return response;
  }

  // Path 2: Brand password only → admin access (backward compatible)
  const valid = await bcrypt.compare(password, brand.password_hash);
  if (!valid) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  const token = await signToken({
    brandId: brand.id,
    brandName: brand.name,
    brandSlug: brand.slug,
    role: 'admin',
  });

  const response = NextResponse.json({ success: true, brandName: brand.name, role: 'admin' });
  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24,
    path: '/',
  });

  return response;
}
