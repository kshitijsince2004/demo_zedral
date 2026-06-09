import { Request, Response, NextFunction } from 'express';
import { throwApiError } from './errorMiddleware';

const requests = new Map<string, { count: number, resetTime: number }>();

export const rateLimitMiddleware = (limit: number = 100, windowMs: number = 60000) => {
  return (req: Request, res: Response, next: NextFunction) => {
    // Determine key: tenant_id + sub (or ip as fallback)
    const tenant_id = req.headers['x-tenant-id'] || 'no-tenant';
    const sub = req.user?.id?.toString() || req.ip || 'unknown';
    const key = `${tenant_id}:${sub}`;
    
    const now = Date.now();
    let record = requests.get(key);

    if (!record || record.resetTime < now) {
      record = { count: 1, resetTime: now + windowMs };
    } else {
      record.count += 1;
    }

    requests.set(key, record);

    if (record.count > limit) {
      const retryAfter = Math.ceil((record.resetTime - now) / 1000);
      res.setHeader('Retry-After', retryAfter.toString());
      return next(throwApiError(
        429, 
        `Rate limit exceeded. Try again in ${retryAfter} seconds.`, 
        'Too Many Requests', 
        'https://errors.zedral.io/too-many-requests'
      ));
    }

    next();
  };
};
