import { Router } from 'express';
import { requireAuth } from '../middleware/authMiddleware';
import { getTenantId } from '../context';
import { getTenantModuleConfig } from '../platform/tenantConfig';
import { getConfig } from '../services/configService';

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

/** Full tenant platform config (latency, modules, branding) for admin surfaces. */
router.get('/config', requireAuth, async (_req, res) => {
  try {
    const config = await getConfig();
    res.json(config);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Failed to load tenant config' });
  }
});

export default router;

