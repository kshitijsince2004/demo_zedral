import { Router } from 'express';
import { UserRole } from '@m1/shared-validation';
import { requireAuth, requireRole } from '../middleware/authMiddleware';
import { MachineCrewService } from '../services/MachineCrewService';
import { LiveDashboardService } from '../services/live';

const router = Router();
router.use(requireAuth);
router.use(requireRole([UserRole.MACHINE_HEAD, UserRole.ADMIN, UserRole.PLANT_HEAD]));

function isMissingTableError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return msg.includes('machine_crew_roster') && msg.includes('does not exist');
}

function routeErrorStatus(error: unknown, fallback: number): number {
  const message = error instanceof Error ? error.message : '';
  if (message.includes('scope')) return 403;
  if (isMissingTableError(error)) return 503;
  return fallback;
}

function routeErrorMessage(error: unknown, fallback: string): string {
  if (isMissingTableError(error)) {
    return 'Crew roster table is not initialized. Run database migrations (npm run migrate in packages/server).';
  }
  return error instanceof Error ? error.message : fallback;
}

async function assertMachineScope(userId: number, roles: string[], machineCode: string) {
  const scope = await LiveDashboardService.getMachineScope(userId, roles);
  if (scope !== null && !scope.includes(machineCode)) {
    throw new Error('Machine not in your scope');
  }
}

router.get('/', async (req, res) => {
  try {
    const machineCode = typeof req.query.machineCode === 'string' ? req.query.machineCode.trim() : '';
    if (!machineCode) return res.status(400).json({ error: 'machineCode is required' });
    await assertMachineScope(req.user!.id, req.user!.roles ?? [], machineCode);
    const crew = await MachineCrewService.list(machineCode);
    res.json({ crew });
  } catch (error: unknown) {
    const status = routeErrorStatus(error, 500);
    res.status(status).json({ error: routeErrorMessage(error, 'Failed to load crew roster') });
  }
});

router.post('/', async (req, res) => {
  try {
    const machineCode = String(req.body?.machineCode ?? '').trim();
    const memberName = String(req.body?.memberName ?? '').trim();
    const roleLabel = String(req.body?.roleLabel ?? '').trim();
    if (!machineCode || !memberName || !roleLabel) {
      return res.status(400).json({ error: 'machineCode, memberName, and roleLabel are required' });
    }
    await assertMachineScope(req.user!.id, req.user!.roles ?? [], machineCode);
    const id = await MachineCrewService.create({ machineCode, memberName, roleLabel });
    res.status(201).json({ id });
  } catch (error: unknown) {
    const status = routeErrorStatus(error, 400);
    res.status(status).json({ error: routeErrorMessage(error, 'Failed to create crew member') });
  }
});

router.put('/:crewId', async (req, res) => {
  try {
    const crewId = req.params.crewId;
    const machineCode = req.body?.machineCode;
    if (!machineCode) return res.status(400).json({ error: 'machineCode is required' });
    await assertMachineScope(req.user!.id, req.user!.roles ?? [], String(machineCode));
    await MachineCrewService.update(crewId, {
      machineCode: String(machineCode),
      memberName: req.body?.memberName != null ? String(req.body.memberName) : undefined,
      roleLabel: req.body?.roleLabel != null ? String(req.body.roleLabel) : undefined,
    });
    res.json({ ok: true });
  } catch (error: unknown) {
    const status = routeErrorStatus(error, 400);
    res.status(status).json({ error: routeErrorMessage(error, 'Failed to update crew member') });
  }
});

router.delete('/:crewId', async (req, res) => {
  try {
    const machineCode = typeof req.query.machineCode === 'string' ? req.query.machineCode.trim() : '';
    if (!machineCode) return res.status(400).json({ error: 'machineCode query is required' });
    await assertMachineScope(req.user!.id, req.user!.roles ?? [], machineCode);
    await MachineCrewService.remove(req.params.crewId, machineCode);
    res.json({ ok: true });
  } catch (error: unknown) {
    const status = routeErrorStatus(error, 400);
    res.status(status).json({ error: routeErrorMessage(error, 'Failed to remove crew member') });
  }
});

export default router;
