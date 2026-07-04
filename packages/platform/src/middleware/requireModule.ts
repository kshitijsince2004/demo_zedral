import type { NextFunction, Request, Response } from 'express';
import { isModuleActive, type TenantModuleConfig } from '../tenant/moduleResolver';

export type TenantModuleConfigLoader = (tenantId: string) => Promise<TenantModuleConfig>;

function resolveTenantId(req: Request, res: Response): string | null {
  const header = req.headers['x-tenant-id'];
  if (typeof header === 'string' && header.trim()) return header.trim();
  if (Array.isArray(header) && header[0]?.trim()) return header[0].trim();
  if (typeof res.locals.tenantId === 'string' && res.locals.tenantId.trim()) {
    return res.locals.tenantId.trim();
  }
  return null;
}

export function requireModule(
  moduleCode: string,
  featureFlag: string,
  loadConfig: TenantModuleConfigLoader,
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = resolveTenantId(req, res);
      if (!tenantId) {
        return res.status(400).json({ error: 'Missing or invalid tenant context. Provide a valid X-Tenant-Id header.' });
      }

      const config = await loadConfig(tenantId);
      if (!isModuleActive(moduleCode, featureFlag, config)) {
        return res.status(404).json({ error: 'Module Not Enabled' });
      }

      return next();
    } catch (error) {
      return next(error);
    }
  };
}
