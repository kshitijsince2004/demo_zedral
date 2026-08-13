import { Router } from 'express';
import { z } from 'zod';
import { UserRole } from '@m1/shared-validation';
import { requireAuth, requireRole } from '../middleware/authMiddleware';
import { assertMachineAccess, isMachineAccessForbidden } from '../auth/machineAccessPolicy';
import { RewindingOrderService } from '../services/RewindingOrderService';
import { assertRewindingMachine, parseRewindingMachineCode, resolveRewindingWriteMachine } from '../utils/rewindingMachines';
import { isVersionConflict, versionConflictBody } from '../utils/versionConflict';
import { logger } from '../utils/logger';

const router = Router();

router.use(requireAuth);

const manualSchema = z.object({
  batch_number: z.string().min(1),
  plan_date: z.string().min(1),
  shift_code: z.string().min(1),
  machine_code: z.string().min(1),
  coil_no: z.string().min(1),
  slit_id: z.string().optional(),
  customer_name: z.string().min(1),
  grade_code: z.string().min(1),
  width_mm: z.number().positive(),
  input_thk_mm: z.number().positive().optional(),
  ppc_thk_mm: z.number().positive(),
  ppc_weight_mt: z.number().positive(),
  roll_finish: z.string().optional(),
});

const stoppageSchema = z.object({
  categoryCode: z.string().min(1),
  breakdownCode: z.string().optional(),
  remarks: z.string().optional(),
});

const captureSchema = z.object({
  weightMt: z.number().optional(),
  rwTension1Kg: z.number().optional(),
  rwTension2Kg: z.number().optional(),
  rwTension3Kg: z.number().optional(),
  outputThkMm: z.number().optional(),
  surfaceFinish: z.string().optional(),
  remarks: z.string().optional(),
  complete: z.boolean().optional(),
}).superRefine((data, ctx) => {
  // Default complete=true — require weight so empty body cannot End an order.
  if (data.complete !== false && (data.weightMt == null || !(data.weightMt > 0))) {
    ctx.addIssue({ code: 'custom', message: 'weightMt is required to complete capture', path: ['weightMt'] });
  }
});

function zodMsg(error: z.ZodError): string {
  return error.issues.map((e) => e.message).join('; ');
}

function respondError(res: import('express').Response, context: string, error: unknown) {
  logger.error(`${context}:`, error);
  if (isVersionConflict(error)) {
    res.status(409).json(versionConflictBody(error));
    return;
  }
  const message = error instanceof Error ? error.message : 'Request failed';
  if (message.startsWith('ACTIVE_ORDER_CONFLICT:')) {
    res.status(409).json({ error: message });
    return;
  }
  if (isMachineAccessForbidden(error) || message.startsWith('Forbidden')) {
    res.status(403).json({ error: message });
    return;
  }
  if (/not found|unknown batch/i.test(message)) {
    res.status(404).json({ error: message });
    return;
  }
  if (/permission denied/i.test(message)) {
    res.status(500).json({ error: 'Database permission denied' });
    return;
  }
  res.status(400).json({ error: message });
}

async function authorizeMachine(
  req: import('express').Request,
  res: import('express').Response,
  machineCode: string,
): Promise<boolean> {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthenticated' });
    return false;
  }
  try {
    assertRewindingMachine(machineCode);
    assertMachineAccess(req.user, machineCode, { mode: 'WRITE' });
    return true;
  } catch (e) {
    respondError(res, 'rewinding.authorize', e);
    return false;
  }
}

function hubMachineFromReq(req: import('express').Request) {
  const raw = req.query?.machine ?? req.body?.machine;
  return parseRewindingMachineCode(String(raw ?? ''));
}

/** Authorize against allocated mill, or hub mill for unallocated RWD-coded plans. */
async function authorizeOrderBatch(
  req: import('express').Request,
  res: import('express').Response,
  batchNo: string,
): Promise<boolean> {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthenticated' });
    return false;
  }
  const peek = await RewindingOrderService.peekOrderMachine(batchNo);
  let target = resolveRewindingWriteMachine(peek, hubMachineFromReq(req));
  if (!target) {
    const order = await RewindingOrderService.getOrder(batchNo, req.user.id);
    target = parseRewindingMachineCode(order.machineCode);
  }
  if (!target) {
    res.status(400).json({ error: 'machine param required' });
    return false;
  }
  return authorizeMachine(req, res, target);
}

router.get('/machines', (_req, res) => {
  res.json({ machines: RewindingOrderService.rewindingPool() });
});

router.get('/queue', async (req, res) => {
  try {
    const raw = String(req.query.machine ?? 'RWD').toUpperCase();
    const machine = parseRewindingMachineCode(raw);
    if (!machine) return res.status(400).json({ error: 'machine must be RWD or 2HI' });
    if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
    try {
      assertRewindingMachine(machine);
      assertMachineAccess(req.user, machine, { mode: 'READ' });
    } catch (e) {
      respondError(res, 'rewinding.authorize', e);
      return;
    }
    const result = await RewindingOrderService.getQueue(machine, { backfillUserId: req.user.id });
    res.json(result);
  } catch (e) {
    respondError(res, 'rewinding.queue', e);
  }
});

router.post(
  '/orders/manual',
  requireRole([UserRole.ADMIN, UserRole.MACHINE_HEAD, UserRole.OPERATOR]),
  async (req, res) => {
    try {
      const parsed = manualSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: zodMsg(parsed.error) });
      }
      if (!(await authorizeMachine(req, res, parsed.data.machine_code))) return;
      const result = await RewindingOrderService.createManualBatch(parsed.data, req.user!.id);
      res.status(201).json(result);
    } catch (e) {
      respondError(res, 'rewinding.manual', e);
    }
  },
);

router.post('/orders/start-combined', async (req, res) => {
  try {
    const batchNumbers = Array.isArray(req.body?.batchNumbers)
      ? req.body.batchNumbers.map(String)
      : [];
    for (const batchNo of batchNumbers) {
      if (!(await authorizeOrderBatch(req, res, batchNo))) return;
    }
    const mode = req.body?.mode === 'prepare' ? 'prepare' as const : 'start' as const;
    const orders = await RewindingOrderService.startCombinedProduction(batchNumbers, req.user!.id, { mode });
    res.json({ orders });
  } catch (e) {
    respondError(res, 'rewinding.startCombined', e);
  }
});

router.post('/orders/cancel-combined', async (req, res) => {
  try {
    const batchNumbers = Array.isArray(req.body?.batchNumbers)
      ? req.body.batchNumbers.map(String)
      : [];
    for (const batchNo of batchNumbers) {
      if (!(await authorizeOrderBatch(req, res, batchNo))) return;
    }
    const orders = await RewindingOrderService.cancelCombinedProduction(batchNumbers, req.user!.id);
    res.json({ orders });
  } catch (e) {
    respondError(res, 'rewinding.cancelCombined', e);
  }
});

router.get('/orders/:batchNo', async (req, res) => {
  try {
    // Read-only: do not create rwd_order on GET; fall back to plan row for pending cards.
    const existing =
      (await RewindingOrderService.getExistingOrder(req.params.batchNo))
      ?? (await RewindingOrderService.getPlanOrderDetail(req.params.batchNo));
    if (!existing) return res.status(404).json({ error: `Order not found: ${req.params.batchNo}` });
    if (!(await authorizeOrderBatch(req, res, req.params.batchNo))) return;
    res.json(existing);
  } catch (e) {
    respondError(res, 'rewinding.getOrder', e);
  }
});

router.post('/orders/:batchNo/allocate-machine', async (req, res) => {
  try {
    const machine = String(req.body?.machineCode ?? '').toUpperCase();
    // Require WRITE on destination; if already allocated to another machine, need READ on source.
    if (!(await authorizeMachine(req, res, machine))) return;
    const existing = await RewindingOrderService.peekOrderMachine(req.params.batchNo);
    if (
      existing.machineAllocated
      && existing.machineCode
      && existing.machineCode !== machine
    ) {
      try {
        assertMachineAccess(req.user!, existing.machineCode, { mode: 'READ' });
      } catch (e) {
        respondError(res, 'rewinding.allocate.source', e);
        return;
      }
    }
    const order = await RewindingOrderService.allocateMachine(
      req.params.batchNo,
      machine,
      req.user!.id,
    );
    res.json(order);
  } catch (e) {
    respondError(res, 'rewinding.allocate', e);
  }
});

router.post('/orders/:batchNo/start', async (req, res) => {
  try {
    if (!(await authorizeOrderBatch(req, res, req.params.batchNo))) return;
    const order = await RewindingOrderService.startProduction(req.params.batchNo, req.user!.id);
    res.json(order);
  } catch (e) {
    respondError(res, 'rewinding.start', e);
  }
});

router.post('/orders/:batchNo/end', async (req, res) => {
  try {
    if (!(await authorizeOrderBatch(req, res, req.params.batchNo))) return;
    const order = await RewindingOrderService.endProduction(req.params.batchNo, req.user!.id);
    res.json(order);
  } catch (e) {
    respondError(res, 'rewinding.end', e);
  }
});

router.patch('/orders/:batchNo/capture', async (req, res) => {
  try {
    const parsed = captureSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: zodMsg(parsed.error) });
    }
    if (!(await authorizeOrderBatch(req, res, req.params.batchNo))) return;
    const order = await RewindingOrderService.capture(
      req.params.batchNo,
      req.user!.id,
      parsed.data,
    );
    res.json(order);
  } catch (e) {
    respondError(res, 'rewinding.capture', e);
  }
});

async function handleAddStoppage(req: import('express').Request, res: import('express').Response) {
  try {
    const parsed = stoppageSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: zodMsg(parsed.error) });
    }
    if (!(await authorizeOrderBatch(req, res, req.params.batchNo))) return;
    const order = await RewindingOrderService.addStoppage(
      req.params.batchNo,
      parsed.data.categoryCode,
      parsed.data.breakdownCode,
      parsed.data.remarks,
      req.user!.id,
    );
    res.json(order);
  } catch (e) {
    respondError(res, 'rewinding.stoppage', e);
  }
}

router.post('/orders/:batchNo/stoppages', handleAddStoppage);
router.post('/orders/:batchNo/stoppages/start', handleAddStoppage);

router.patch('/orders/:batchNo/stoppages/:stoppageId', async (req, res) => {
  try {
    const parsed = stoppageSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: zodMsg(parsed.error) });
    }
    if (!(await authorizeOrderBatch(req, res, req.params.batchNo))) return;
    const order = await RewindingOrderService.updateStoppage(
      req.params.batchNo,
      req.params.stoppageId,
      parsed.data.categoryCode,
      parsed.data.breakdownCode,
      parsed.data.remarks,
      req.user!.id,
    );
    res.json(order);
  } catch (e) {
    respondError(res, 'rewinding.stoppageUpdate', e);
  }
});

router.patch('/orders/:batchNo/stoppages/:stoppageId/end', async (req, res) => {
  try {
    if (!(await authorizeOrderBatch(req, res, req.params.batchNo))) return;
    const order = await RewindingOrderService.endStoppage(
      req.params.batchNo,
      req.params.stoppageId,
      req.user!.id,
    );
    res.json(order);
  } catch (e) {
    respondError(res, 'rewinding.stoppageEnd', e);
  }
});

router.post('/orders/:batchNo/reject', async (req, res) => {
  try {
    if (!(await authorizeOrderBatch(req, res, req.params.batchNo))) return;
    const reason = String(req.body?.rejectionReason ?? req.body?.reason ?? '');
    const remarks = String(req.body?.remarks ?? '');
    const order = await RewindingOrderService.rejectOrder(
      req.params.batchNo,
      reason,
      remarks,
      req.user!.id,
    );
    res.json(order);
  } catch (e) {
    respondError(res, 'rewinding.reject', e);
  }
});

router.post('/orders/:batchNo/reinstate', async (req, res) => {
  try {
    if (!(await authorizeOrderBatch(req, res, req.params.batchNo))) return;
    const target = req.body?.target === 'PENDING' ? 'PENDING' : 'PREPARING';
    const order = await RewindingOrderService.reinstateOrder(
      req.params.batchNo,
      req.user!.id,
      target,
    );
    res.json(order);
  } catch (e) {
    respondError(res, 'rewinding.reinstate', e);
  }
});

export default router;
