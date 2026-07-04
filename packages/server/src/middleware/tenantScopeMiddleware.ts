import type { NextFunction, Request, Response } from 'express';
import { getTenantId } from '../context';

export function tenantScopeMiddleware(_req: Request, res: Response, next: NextFunction) {
  const tenantId = getTenantId();
  if (!tenantId) {
    return res.status(400).json({
      error: 'Missing or invalid tenant context. Provide a valid X-Tenant-Id header.',
    });
  }

  res.locals.tenantId = tenantId;
  return next();
}
