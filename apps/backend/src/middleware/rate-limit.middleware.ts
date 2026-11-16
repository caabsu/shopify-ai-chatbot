import type { Request, Response, NextFunction } from 'express';

interface Bucket {
  count: number;
  resetAt: number;
}

interface RateLimitOptions {
  windowMs: number;
  max: number;
  /** Label for log lines. */
  name?: string;
}

/**
 * The keyed counter behind `rateLimit`, for callers that are not Express
 * middleware (the storefront chat tools). Each call counts one hit for `key`.
 */
export function createRateLimiter(opts: RateLimitOptions) {
  const buckets = new Map<string, Bucket>();

  // Drop expired buckets so the map can't grow without bound.
  const sweeper = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }, Math.max(opts.windowMs, 60_000));
  sweeper.unref?.();

  return (key: string): { allowed: boolean; retryAfter: number } => {
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + opts.windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;

    if (bucket.count > opts.max) {
      if (bucket.count === opts.max + 1) {
        console.warn(`[rate-limit] ${opts.name ?? 'endpoint'}: blocked ${key} (${opts.max}/${opts.windowMs}ms exceeded)`);
      }
      return { allowed: false, retryAfter: Math.ceil((bucket.resetAt - now) / 1000) };
    }
    return { allowed: true, retryAfter: 0 };
  };
}

/**
 * Minimal in-memory rate limiter for public endpoints (inbound email webhook,
 * contact form, login). Per-process — good enough for a single Railway
 * instance; swap for Redis if the backend ever scales horizontally.
 */
export function rateLimit(opts: RateLimitOptions & {
  /** Bucket key — defaults to client IP. */
  keyFn?: (req: Request) => string;
}) {
  const hit = createRateLimiter(opts);

  return (req: Request, res: Response, next: NextFunction): void => {
    const { allowed, retryAfter } = hit(opts.keyFn ? opts.keyFn(req) : clientIp(req));

    if (!allowed) {
      res.setHeader('Retry-After', String(retryAfter));
      res.status(429).json({ error: 'Too many requests. Try again later.' });
      return;
    }
    next();
  };
}

export function clientIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown';
}
