import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function POST() {
  const cookieStore = await cookies();
  cookieStore.delete('portal_session');
  return NextResponse.redirect(new URL('/login', process.env.NEXT_PUBLIC_STORE_URL || '/'));
}
