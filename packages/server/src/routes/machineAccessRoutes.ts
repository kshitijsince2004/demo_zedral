import { Router } from 'express';
import { UserRole } from '@m1/shared-validation';
import { requireAuth, requireRole } from '../middleware/authMiddleware';
import { MachineAccessService } from '../services/MachineAccessService';

const router = Router();
router.use(requireAuth);

router.get('/', requireRole([UserRole.PLANT_HEAD, UserRole.ADMIN]), async (_req, res) => {
  try {
    const entries = await MachineAccessService.list();
    res.json(entries);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to list assignments';
    res.status(500).json({ error: msg });
  }
});

router.get('/me', requireRole([UserRole.MACHINE_HEAD, UserRole.SUPERVISOR, UserRole.PLANT_HEAD, UserRole.ADMIN]), async (req, res) => {
  try {
    const machines = await MachineAccessService.getForUser(req.user!.id);
    res.json({ machines });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to load machine access';
    res.status(500).json({ error: msg });
  }
});

router.put('/:userId', requireRole([UserRole.PLANT_HEAD, UserRole.ADMIN]), async (req, res) => {
  try {
    const machineCodes: string[] = req.body.machine_codes ?? req.body.machineCodes ?? [];
    await MachineAccessService.setForUser(Number(req.params.userId), machineCodes, req.user!.id);
    res.json({ ok: true });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to update assignment';
    res.status(400).json({ error: msg });
  }
});

export default router;
