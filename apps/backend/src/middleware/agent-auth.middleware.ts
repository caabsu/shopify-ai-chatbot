import { Request, Response, NextFunction } from 'express';
import * as jose from 'jose';

const JWT_SECRET = process.env.JWT_SECRET || 'admin-secret-key-change-me';
const secret = new TextEncoder().encode(JWT_SECRET);

export interface AgentPayload {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'agent';
  brandId: string;
}

// Extend Express Request
declare global {
  namespace Express {
    interface Request {
      agent?: AgentPayload;
    }
  }
}

// ── Sign JWT ───────────────────────────────────────────────────────────────
export async function signAgentToken(payload: AgentPayload): Promise<string> {
  const token = await new jose.SignJWT({
    id: payload.id,
    email: payload.email,
    name: payload.name,
    role: payload.role,
    brandId: payload.brandId,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('24h')
    .setIssuedAt()
    .sign(secret);

  return token;
}

// ── Auth Middleware ─────────────────────────────────────────────────────────
export async function agentAuthMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    let token: string | undefined;

    // Check Authorization header first
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7);
    }

    // Fallback to cookie
    if (!token) {
      const cookieHeader = req.headers.cookie;
      if (cookieHeader) {
        const cookies = cookieHeader.split(';').reduce<Record<string, string>>((acc, c) => {
          const [key, val] = c.trim().split('=');
          if (key && val) acc[key] = decodeURIComponent(val);
          return acc;
        }, {});
        token = cookies['agent_token'];
      }
    }

    if (!token) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const { payload } = await jose.jwtVerify(token, secret);

    req.agent = {
      id: payload.id as string,
      email: payload.email as string,
      name: payload.name as string,
      role: payload.role as 'admin' | 'agent',
      brandId: payload.brandId as string,
    };

    next();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[agent-auth] Token verification failed:', message);
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ── Require Admin Middleware ────────────────────────────────────────────────
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.agent) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  if (req.agent.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }

  next();
}
