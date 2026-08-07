import { Router } from 'express';
import { resolveServiceTokenTenant } from '@zedral/platform';
import {
  createDowntimeEvent,
  createProductionCount,
  parseDowntimeEventRequest,
  parseProductionCountRequest,
} from '../platform/canonApiService';

const router = Router();

function requireTenantHeader(value: string | string[] | undefined): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (Array.isArray(value) && value[0]?.trim()) return value[0].trim();
  return null;
}

router.use((req, res, next) => {
  const tenantId = requireTenantHeader(req.headers['x-tenant-id']);
  if (!tenantId) {
    return res.status(400).json({ error: 'x-tenant-id header is required' });
  }

  const boundTenant = resolveServiceTokenTenant(req.headers.authorization, tenantId);
  if (!boundTenant) {
    return res.status(401).json({ error: 'Invalid service token or tenant scope' });
  }

  res.locals.tenantId = boundTenant;
  return next();
});

router.post('/production-counts', async (req, res) => {
  try {
    const tenantId = res.locals.tenantId as string;
    const payload = parseProductionCountRequest(req.body);
    const created = await createProductionCount(tenantId, payload);
    res.status(201).json(created);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid production count' });
  }
});

router.post('/events/downtime', async (req, res) => {
  try {
    const tenantId = res.locals.tenantId as string;
    const payload = parseDowntimeEventRequest(req.body);
    const created = await createDowntimeEvent(tenantId, payload);
    res.status(201).json(created);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid downtime event' });
  }
});

export default router;
