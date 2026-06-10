import { Request, Response, NextFunction } from 'express';
import { requestContext } from '../context';
import { resolveRequestTenantId } from '../config/tenantConfig';
import { v4 as uuidv4 } from 'uuid';

export const contextMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const tenant_id = resolveRequestTenantId(req);
  if (!tenant_id) {
    return res.status(400).json({
      error: 'Missing or invalid tenant context. Provide a valid X-Tenant-Id header.',
    });
  }

  const correlation_id = (req.headers['x-correlation-id'] as string) || uuidv4();
  res.setHeader('X-Correlation-Id', correlation_id);

  requestContext.run({ tenant_id, correlation_id }, () => {
    next();
  });
};
