import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';

// A missing JWT_SECRET in production would make session tokens forgeable with
// a publicly known string — fail closed instead of falling back.
const rawJwtSecret = process.env.JWT_SECRET;
if (!rawJwtSecret && process.env.NODE_ENV === 'production') {
  throw new Error('JWT_SECRET must be configured in production');
}
const JWT_SECRET = new TextEncoder().encode(rawJwtSecret || 'admin-secret-key-change-me');
const COOKIE_NAME = 'admin_token';

export type UserRole = 'admin' | 'agent';

export interface JWTPayload {
  brandId: string;
  brandName: string;
  brandSlug: string;
  userId?: string;
  name?: string;
  email?: string;
  role: UserRole;
}

export async function signToken(payload: JWTPayload): Promise<string> {
  return new SignJWT(payload as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('24h')
    .setIssuedAt()
    .sign(JWT_SECRET);
}

export async function verifyToken(token: string): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return payload as unknown as JWTPayload;
  } catch {
    return null;
  }
}

export async function getSession(): Promise<JWTPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifyToken(token);
}

/** Get the raw JWT token string for forwarding to the backend */
export async function getToken(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(COOKIE_NAME)?.value ?? null;
}

export { COOKIE_NAME };
