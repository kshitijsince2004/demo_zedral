import { Router } from 'express';
import { UserRole } from '@m1/shared-validation';
import { requireAuth, requireRole } from '../middleware/authMiddleware';
import { MachineRegistryService } from '../services/MachineRegistryService';
import { MachineMasterService } from '../services/MachineMasterService';
import { MachineSpecService } from '../services/MachineSpecService';
import { isEligible } from '../utils/machineEligibility';

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

router.get('/specs', requireRole([UserRole.ADMIN, UserRole.MACHINE_HEAD, UserRole.PLANT_HEAD]), async (req, res) => {
  try {
    const machineCode = req.query.machineCode ? String(req.query.machineCode) : undefined;
    res.json({ specs: await MachineSpecService.list(machineCode) });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Failed to load specs' });
  }
});

router.get('/specs/:machineCode/active', requireAuth, async (req, res) => {
  try {
    const spec = await MachineSpecService.getActive(req.params.machineCode);
    res.json({ spec });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Failed to load active spec' });
  }
});

router.post('/specs', requireRole([UserRole.ADMIN, UserRole.MACHINE_HEAD]), async (req, res) => {
  try {
    const spec = await MachineSpecService.createDraft(req.body, req.user!.id);
    res.status(201).json(spec);
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'Create draft failed' });
  }
});

router.post('/specs/:specId/activate', requireRole([UserRole.ADMIN, UserRole.MACHINE_HEAD]), async (req, res) => {
  try {
    const spec = await MachineSpecService.activate(req.params.specId);
    res.json(spec);
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'Activate failed' });
  }
});

router.post('/eligibility', requireAuth, async (req, res) => {
  try {
    const machineCode = String(req.body?.machineCode ?? '').toUpperCase();
    const spec = await MachineSpecService.getActive(machineCode);
    const result = isEligible({
      requiredMandrelIdMm: req.body?.requiredMandrelIdMm,
      widthMm: req.body?.widthMm,
      thicknessMm: req.body?.thicknessMm,
      coilWeightMt: req.body?.coilWeightMt,
      exitOdMm: req.body?.exitOdMm,
      suggestedMachine: req.body?.suggestedMachine ?? null,
    }, spec);
    res.json({ ...result, spec });
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'Eligibility check failed' });
  }
});

export default router;
