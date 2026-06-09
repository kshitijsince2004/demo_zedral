import { Request, Response, NextFunction } from 'express';
import { createApiError } from './errorMiddleware';

export type RateLimitStore = Map<string, { count: number; resetTime: number }>;

const defaultStore: RateLimitStore = new Map();

export function createRateLimitMiddleware(
  limit: number = 100,
  windowMs: number = 60000,
  store: RateLimitStore = defaultStore,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    const tenant_id = req.headers['x-tenant-id'] || 'no-tenant';
    const sub = req.user?.id?.toString() || req.ip || 'unknown';
    const key = `${tenant_id}:${sub}`;

    const now = Date.now();
    let record = store.get(key);

    if (!record || record.resetTime < now) {
      record = { count: 1, resetTime: now + windowMs };
    } else {
      record.count += 1;
    }

    store.set(key, record);

    if (record.count > limit) {
      const retryAfter = Math.ceil((record.resetTime - now) / 1000);
      res.setHeader('Retry-After', retryAfter.toString());
      return next(
        createApiError(
          429,
          `Rate limit exceeded. Try again in ${retryAfter} seconds.`,
          'Too Many Requests',
          'https://errors.zedral.io/too-many-requests',
        ),
      );
    }

    next();
  };
}

/** Default rate-limit factory (shared in-memory store for the process). */
export const rateLimitMiddleware = createRateLimitMiddleware;

/** Clear rate-limit counters between tests. */
export function resetRateLimitStoreForTests(store: RateLimitStore = defaultStore): void {
  store.clear();
}
