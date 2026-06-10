import { Router } from 'express';
import { UserRole } from '@m1/shared-validation';
import { requireAuth, requireRole } from '../middleware/authMiddleware';
import { MachineRegistryService } from '../services/MachineRegistryService';
import { MachineMasterService } from '../services/MachineMasterService';

const router = Router();
router.use(requireAuth);

router.get('/registry', async (_req, res) => {
  try {
    const machines = await MachineRegistryService.getAll(false);
    res.json({ machines });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Failed to load machine registry' });
  }
});

router.get(
  '/master',
  requireRole([UserRole.ADMIN]),
  async (req, res) => {
    try {
      const includeOffline = req.query.includeOffline !== 'false';
      const machines = await MachineMasterService.list(includeOffline);
      res.json(machines);
    } catch (e: unknown) {
      res.status(500).json({ error: e instanceof Error ? e.message : 'Failed to load machines' });
    }
  },
);

router.post(
  '/master',
  requireRole([UserRole.ADMIN]),
  async (req, res) => {
    try {
      await MachineMasterService.create(req.body, req.user!.id);
      res.status(201).json({ ok: true });
    } catch (e: unknown) {
      res.status(400).json({ error: e instanceof Error ? e.message : 'Create failed' });
    }
  },
);

router.put(
  '/master/:machineCode',
  requireRole([UserRole.ADMIN]),
  async (req, res) => {
    try {
      await MachineMasterService.update(req.params.machineCode, req.body);
      res.json({ ok: true });
    } catch (e: unknown) {
      res.status(400).json({ error: e instanceof Error ? e.message : 'Update failed' });
    }
  },
);

router.patch(
  '/master/:machineCode/status',
  requireRole([UserRole.ADMIN]),
  async (req, res) => {
    try {
      const status = String(req.body?.machineStatus ?? '').toUpperCase();
      if (!['OPERATIONAL', 'MAINTENANCE', 'OFFLINE'].includes(status)) {
        return res.status(400).json({ error: 'Invalid machineStatus' });
      }
      await MachineMasterService.setStatus(
        req.params.machineCode,
        status as 'OPERATIONAL' | 'MAINTENANCE' | 'OFFLINE',
      );
      res.json({ ok: true });
    } catch (e: unknown) {
      res.status(400).json({ error: e instanceof Error ? e.message : 'Status update failed' });
    }
  },
);

export default router;
