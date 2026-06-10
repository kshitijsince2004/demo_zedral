import type { Request } from 'express';
import { getConfiguredTenantId, isProductionRuntime, isValidTenantUuid } from './envValidation';

const DEV_DEFAULT_TENANT = '00000000-0000-0000-0000-000000000001';

/**
 * Resolve tenant for the current request.
 * Production: TENANT_ID env is authoritative; optional X-Tenant-Id must match.
 * Development: falls back to seeded default tenant when unset.
 */
export function resolveRequestTenantId(req: Request): string | null {
  const header = (req.headers['x-tenant-id'] as string | undefined)?.trim();
  const configured = getConfiguredTenantId();

  if (header) {
    if (!isValidTenantUuid(header)) return null;
    if (isProductionRuntime() && configured && header !== configured) return null;
    return header;
  }

  if (configured) return configured;

  if (isProductionRuntime()) return null;

  return DEV_DEFAULT_TENANT;
}
