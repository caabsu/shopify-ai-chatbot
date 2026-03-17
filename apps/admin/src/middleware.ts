import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'admin-secret-key-change-me');

// Pages agents ARE allowed to access
const AGENT_ALLOWED = ['/agent', '/api/tickets', '/api/auth', '/api/settings/canned-responses'];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow login page and auth API routes
  if (pathname.startsWith('/login') || pathname.startsWith('/api/auth')) {
    return NextResponse.next();
  }

  const token = request.cookies.get('admin_token')?.value;

  if (!token) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    const role = (payload as Record<string, unknown>).role as string | undefined;

    // Agents trying to access admin pages → redirect to agent workspace
    if (role === 'agent') {
      const isAgentRoute = AGENT_ALLOWED.some((p) => pathname.startsWith(p));
      if (!isAgentRoute) {
        return NextResponse.redirect(new URL('/agent/tickets', request.url));
      }
    }

    // Admins accessing /agent routes → let them through (admins can see everything)

    return NextResponse.next();
  } catch {
    const response = NextResponse.redirect(new URL('/login', request.url));
    response.cookies.delete('admin_token');
    return response;
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
