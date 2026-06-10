import { Router } from 'express';
import type { Request } from 'express';
import { requireAuth } from '../middleware/authMiddleware';
import {
  assertMachineAccess,
  isMachineAccessForbidden,
} from '../auth/machineAccessPolicy';
import { MachineHandoverService } from '../services/MachineHandoverService';

const router = Router();
router.use(requireAuth);

function handoverRouteStatus(error: unknown): number {
  if (isMachineAccessForbidden(error)) return 403;
  const message = error instanceof Error ? error.message : '';
  if (/not found/i.test(message)) return 404;
  return 400;
}

function handoverRouteMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Handover request failed';
}

async function assertHandoverMachineAccess(
  user: Request['user'],
  handoverId: string,
): Promise<void> {
  const handover = await MachineHandoverService.getHandoverForAccess(handoverId);
  if (!handover) {
    throw new Error('Handover not found');
  }
  assertMachineAccess(user!, handover.machine_code);
}

router.get('/overview', async (req, res) => {
  try {
    const roles = req.user?.roles ?? [];
    const allMachines = roles.includes('PLANT_HEAD') || roles.includes('ADMIN');
    const machineFilter = allMachines ? null : (req.user?.machineAccess ?? []);
    const overview = await MachineHandoverService.getHandoverOverview(machineFilter);
    res.json(overview);
  } catch (error: unknown) {
    res.status(handoverRouteStatus(error)).json({ error: handoverRouteMessage(error) });
  }
});

router.get('/pending', async (req, res) => {
  try {
    const machines = req.user?.machineAccess ?? [];
    const pending = await MachineHandoverService.listPendingForMachines(machines);
    res.json({ pending });
  } catch (error: unknown) {
    res.status(handoverRouteStatus(error)).json({ error: handoverRouteMessage(error) });
  }
});

router.get('/:machineCode/preview', async (req, res) => {
  try {
    const machineCode = String(req.params.machineCode).toUpperCase();
    assertMachineAccess(req.user!, machineCode);
    const preview = await MachineHandoverService.buildOutgoingPreview(
      machineCode,
      req.user!.id,
    );
    res.json(preview);
  } catch (error: unknown) {
    res.status(handoverRouteStatus(error)).json({ error: handoverRouteMessage(error) });
  }
});

router.get('/:machineCode/pending', async (req, res) => {
  try {
    const machineCode = String(req.params.machineCode).toUpperCase();
    assertMachineAccess(req.user!, machineCode);
    const pending = await MachineHandoverService.getPendingForMachine(machineCode);
    res.json({ pending: pending ?? null });
  } catch (error: unknown) {
    res.status(handoverRouteStatus(error)).json({ error: handoverRouteMessage(error) });
  }
});

router.get('/:machineCode/draft', async (req, res) => {
  try {
    const machineCode = String(req.params.machineCode).toUpperCase();
    assertMachineAccess(req.user!, machineCode);
    const draft = await MachineHandoverService.getDraftForMachine(machineCode, req.user!.id);
    res.json({ draft: draft ?? null });
  } catch (error: unknown) {
    res.status(handoverRouteStatus(error)).json({ error: handoverRouteMessage(error) });
  }
});

router.post('/:machineCode/session', async (req, res) => {
  try {
    const machineCode = String(req.params.machineCode).toUpperCase();
    assertMachineAccess(req.user!, machineCode);
    const result = await MachineHandoverService.ensureActiveSession(machineCode, req.user!.id);
    res.json(result);
  } catch (error: unknown) {
    res.status(handoverRouteStatus(error)).json({ error: handoverRouteMessage(error) });
  }
});

/** Save a draft handover (persists to DB, can be updated repeatedly) */
router.post('/:machineCode/draft', async (req, res) => {
  try {
    const machineCode = String(req.params.machineCode).toUpperCase();
    assertMachineAccess(req.user!, machineCode);
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
    res.status(handoverRouteStatus(error)).json({ error: handoverRouteMessage(error) });
  }
});

/** Submit a final handover (promotes DRAFT → PENDING, closes session) */
router.post('/:machineCode/outgoing', async (req, res) => {
  try {
    const machineCode = String(req.params.machineCode).toUpperCase();
    assertMachineAccess(req.user!, machineCode);
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
    res.status(handoverRouteStatus(error)).json({ error: handoverRouteMessage(error) });
  }
});

router.post('/accept/:handoverId', async (req, res) => {
  try {
    const handoverId = String(req.params.handoverId);
    await assertHandoverMachineAccess(req.user, handoverId);
    const handover = await MachineHandoverService.acceptHandover(
      handoverId,
      req.user!.id,
    );
    res.json(handover);
  } catch (error: unknown) {
    res.status(handoverRouteStatus(error)).json({ error: handoverRouteMessage(error) });
  }
});

router.post('/clarification/:handoverId', async (req, res) => {
  try {
    const handoverId = String(req.params.handoverId);
    await assertHandoverMachineAccess(req.user, handoverId);
    const { notes } = req.body ?? {};
    const handover = await MachineHandoverService.requestClarification(
      handoverId,
      req.user!.id,
      String(notes ?? ''),
    );
    res.json(handover);
  } catch (error: unknown) {
    res.status(handoverRouteStatus(error)).json({ error: handoverRouteMessage(error) });
  }
});

export default router;
