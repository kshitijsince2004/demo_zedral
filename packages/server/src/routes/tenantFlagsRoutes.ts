import { Router } from 'express';
import { requireAuth } from '../middleware/authMiddleware';
import { getTenantId } from '../context';
import { getTenantModuleConfig } from '../platform/tenantConfig';

const router = Router();

router.get('/', requireAuth, async (req, res) => {
  try {
    void req;
    const tenantId = getTenantId();
    if (!tenantId) return res.status(500).json({ error: 'Tenant id missing from context' });

    const cfg = await getTenantModuleConfig(tenantId);
    res.json({ flags: cfg.flags, enabledModules: cfg.enabledModules });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Failed to load tenant flags' });
  }
});

export default router;
