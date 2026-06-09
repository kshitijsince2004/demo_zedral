import { Request, Response, NextFunction } from 'express';
import { requestContext } from '../context';
import { v4 as uuidv4 } from 'uuid';

export const contextMiddleware = (req: Request, res: Response, next: NextFunction) => {
  // Extract tenant from headers (Gateway extracts from JWT and forwards as X-Tenant-Id)
  // For now, if not present, default to the seeded tenant for backwards compatibility during transition
  const tenant_id = (req.headers['x-tenant-id'] as string) || '00000000-0000-0000-0000-000000000001';
  
  // Extract or mint correlation id
  const correlation_id = (req.headers['x-correlation-id'] as string) || uuidv4();

  // Make correlation_id available on response headers
  res.setHeader('X-Correlation-Id', correlation_id);

  requestContext.run({ tenant_id, correlation_id }, () => {
    next();
  });
};
