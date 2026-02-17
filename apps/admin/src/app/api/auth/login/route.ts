import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { supabase } from '@/lib/supabase';
import { signToken, COOKIE_NAME } from '@/lib/auth';

export async function POST(request: Request) {
  const { brandSlug, password } = await request.json();

  if (!brandSlug || !password) {
    return NextResponse.json({ error: 'Brand and password are required' }, { status: 400 });
  }

  const { data: brand, error } = await supabase
    .from('brands')
    .select('*')
    .eq('slug', brandSlug)
    .eq('enabled', true)
    .single();

  if (error || !brand) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  const valid = await bcrypt.compare(password, brand.password_hash);
  if (!valid) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  const token = await signToken({
    brandId: brand.id,
    brandName: brand.name,
    brandSlug: brand.slug,
  });

  const response = NextResponse.json({ success: true, brandName: brand.name });
  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24, // 24 hours
    path: '/',
  });

  return response;
}
