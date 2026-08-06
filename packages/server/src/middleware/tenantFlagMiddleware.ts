import type { NextFunction, Request, Response } from 'express';
import { getTenantId } from '../context';
import { getTenantModuleConfig } from '../platform/tenantConfig';

/** Fail-closed gate for a boolean tenant flag (e.g. mode.manual_reroll). */
export function requireTenantFlag(flagKey: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    void req;
    try {
      const tenantId = getTenantId();
      if (!tenantId) {
        return res.status(500).json({ error: 'Tenant id missing from context' });
      }
      const cfg = await getTenantModuleConfig(tenantId);
      if (cfg.flags[flagKey] !== true) {
        return res.status(403).json({ error: `Feature disabled: ${flagKey}` });
      }
      next();
    } catch (e: unknown) {
      res.status(500).json({ error: e instanceof Error ? e.message : 'Failed to load tenant flags' });
    }
  };
}
