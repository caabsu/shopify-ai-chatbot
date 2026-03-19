import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';

const SECRET = new TextEncoder().encode(process.env.SESSION_SECRET || 'change-me');

export interface PortalSession {
  member_id: string;
  customer_id: string;
  email: string;
  company_name: string;
  brand_id: string;
}

export async function createSession(data: PortalSession): Promise<string> {
  return new SignJWT(data as any)
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('24h')
    .sign(SECRET);
}

export async function getSession(): Promise<PortalSession | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get('portal_session')?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, SECRET);
    return payload as unknown as PortalSession;
  } catch {
    return null;
  }
}
