import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';

// A missing JWT_SECRET in production would make session tokens forgeable with
// a publicly known string — fail closed instead of falling back.
const COOKIE_NAME = 'admin_token';

let jwtSecret: Uint8Array | null = null;

function getJwtSecret(): Uint8Array {
  if (jwtSecret) return jwtSecret;
  const raw = process.env.JWT_SECRET;
  if (!raw && process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET must be configured in production');
  }
  jwtSecret = new TextEncoder().encode(raw || 'admin-secret-key-change-me');
  return jwtSecret;
}

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
    .sign(getJwtSecret());
}

export async function verifyToken(token: string): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret());
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
