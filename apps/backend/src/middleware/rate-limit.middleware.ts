import type { Request, Response, NextFunction } from 'express';

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Minimal in-memory rate limiter for public endpoints (inbound email webhook,
 * contact form, login). Per-process — good enough for a single Railway
 * instance; swap for Redis if the backend ever scales horizontally.
 */
export function rateLimit(opts: {
  windowMs: number;
  max: number;
  /** Bucket key — defaults to client IP. */
  keyFn?: (req: Request) => string;
  /** Label for log lines. */
  name?: string;
}) {
  const buckets = new Map<string, Bucket>();

  // Drop expired buckets so the map can't grow without bound.
  const sweeper = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }, Math.max(opts.windowMs, 60_000));
  sweeper.unref?.();

  return (req: Request, res: Response, next: NextFunction): void => {
    const key = opts.keyFn ? opts.keyFn(req) : clientIp(req);
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + opts.windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;

    if (bucket.count > opts.max) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      if (bucket.count === opts.max + 1) {
        console.warn(`[rate-limit] ${opts.name ?? 'endpoint'}: blocked ${key} (${opts.max}/${opts.windowMs}ms exceeded)`);
      }
      res.status(429).json({ error: 'Too many requests. Try again later.' });
      return;
    }
    next();
  };
}

export function clientIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown';
}
