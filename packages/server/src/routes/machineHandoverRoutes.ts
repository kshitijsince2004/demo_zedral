import { Router } from 'express';
import { requireAuth } from '../middleware/authMiddleware';
import { MachineHandoverService } from '../services/MachineHandoverService';

const router = Router();
router.use(requireAuth);

router.get('/overview', async (req, res) => {
  try {
    const roles = req.user?.roles ?? [];
    const allMachines = roles.includes('PLANT_HEAD') || roles.includes('ADMIN');
    const machineFilter = allMachines ? null : (req.user?.machineAccess ?? []);
    const overview = await MachineHandoverService.getHandoverOverview(machineFilter);
    res.json(overview);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to load handover overview';
    res.status(500).json({ error: message });
  }
});

router.get('/pending', async (req, res) => {
  try {
    const machines = req.user?.machineAccess ?? [];
    const pending = await MachineHandoverService.listPendingForMachines(machines);
    res.json({ pending });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to list pending handovers';
    res.status(500).json({ error: message });
  }
});

router.get('/:machineCode/preview', async (req, res) => {
  try {
    const machineCode = String(req.params.machineCode).toUpperCase();
    const preview = await MachineHandoverService.buildOutgoingPreview(
      machineCode,
      req.user!.id,
    );
    res.json(preview);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to build handover preview';
    res.status(400).json({ error: message });
  }
});

router.get('/:machineCode/pending', async (req, res) => {
  try {
    const machineCode = String(req.params.machineCode).toUpperCase();
    const pending = await MachineHandoverService.getPendingForMachine(machineCode);
    res.json({ pending: pending ?? null });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to load pending handover';
    res.status(400).json({ error: message });
  }
});

router.get('/:machineCode/draft', async (req, res) => {
  try {
    const machineCode = String(req.params.machineCode).toUpperCase();
    const draft = await MachineHandoverService.getDraftForMachine(machineCode, req.user!.id);
    res.json({ draft: draft ?? null });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to load draft handover';
    res.status(400).json({ error: message });
  }
});

router.post('/:machineCode/session', async (req, res) => {
  try {
    const machineCode = String(req.params.machineCode).toUpperCase();
    const result = await MachineHandoverService.ensureActiveSession(machineCode, req.user!.id);
    res.json(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to start machine session';
    res.status(400).json({ error: message });
  }
});

/** Save a draft handover (persists to DB, can be updated repeatedly) */
router.post('/:machineCode/draft', async (req, res) => {
  try {
    const machineCode = String(req.params.machineCode).toUpperCase();
    const {
      machineStatus,
      machineCondition,
      machineConditionRemarks,
      remarks,
      handoverPriority,
      breakdownCode,
      breakdownDescription,
      downtimeMinutes,
      maintenanceStatus,
      scrapKg,
      coolantTempDegC,
      coolantPressKgCm2,
      shiftRemarks,
      orderSnapshot,
      crewNotes,
    } = req.body ?? {};

    const draft = await MachineHandoverService.saveDraftHandover(
      machineCode,
      req.user!.id,
      {
        machineStatus,
        machineCondition,
        machineConditionRemarks,
        remarks,
        handoverPriority,
        breakdownCode,
        breakdownDescription,
        downtimeMinutes,
        maintenanceStatus,
        scrapKg,
        coolantTempDegC,
        coolantPressKgCm2,
        shiftRemarks,
        orderSnapshot,
        crewNotes,
      },
    );
    res.status(201).json(draft);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to save draft';
    res.status(400).json({ error: message });
  }
});

/** Submit a final handover (promotes DRAFT → PENDING, closes session) */
router.post('/:machineCode/outgoing', async (req, res) => {
  try {
    const machineCode = String(req.params.machineCode).toUpperCase();
    const {
      machineStatus,
      machineCondition,
      machineConditionRemarks,
      remarks,
      handoverPriority,
      breakdownCode,
      breakdownDescription,
      downtimeMinutes,
      maintenanceStatus,
      scrapKg,
      coolantTempDegC,
      coolantPressKgCm2,
      shiftRemarks,
      orderSnapshot,
      crewNotes,
    } = req.body ?? {};

    const handover = await MachineHandoverService.createOutgoingHandover(
      machineCode,
      req.user!.id,
      {
        machineStatus,
        machineCondition,
        machineConditionRemarks,
        remarks,
        handoverPriority,
        breakdownCode,
        breakdownDescription,
        downtimeMinutes,
        maintenanceStatus,
        scrapKg,
        coolantTempDegC,
        coolantPressKgCm2,
        shiftRemarks,
        orderSnapshot,
        crewNotes,
      },
    );
    res.status(201).json(handover);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to create handover';
    res.status(400).json({ error: message });
  }
});

router.post('/accept/:handoverId', async (req, res) => {
  try {
    const handover = await MachineHandoverService.acceptHandover(
      String(req.params.handoverId),
      req.user!.id,
    );
    res.json(handover);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to accept handover';
    res.status(400).json({ error: message });
  }
});

router.post('/clarification/:handoverId', async (req, res) => {
  try {
    const { notes } = req.body ?? {};
    const handover = await MachineHandoverService.requestClarification(
      String(req.params.handoverId),
      req.user!.id,
      String(notes ?? ''),
    );
    res.json(handover);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to request clarification';
    res.status(400).json({ error: message });
  }
});

export default router;
