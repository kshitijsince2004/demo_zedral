import { Router } from 'express';
import {
  ManualRerollCaptureSchema,
  ManualRerollEndSchema,
  ManualRerollHoldSchema,
  ManualRerollRemarkSchema,
  ManualRerollStartSchema,
  ManualRerollStoppageStartSchema,
  ManualRerollStoppageUpdateSchema,
  ManualRerollSummarySchema,
  UserRole,
  normalizeRoles,
} from '@m1/shared-validation';
import { requireAuth } from '../middleware/authMiddleware';
import { requireTenantFlag } from '../middleware/tenantFlagMiddleware';
import { assertMachineAccess } from '../auth/machineAccessPolicy';
import { db } from '../db';
import { ACTIVE_REROLL_CONFLICT, ManualRerollService } from '../services/ManualRerollService';
import { ShiftDetectionService } from '../services/ShiftDetectionService';
import { currentPlantDate, endOfPlantDay, startOfPlantDay } from '../utils/dateOnly';

const router = Router();

router.use(requireAuth);
router.use(requireTenantFlag('mode.manual_reroll'));

type ManualRerollMill = '6HI' | '4HI';

function parseManualRerollMill(raw: string): ManualRerollMill | null {
  const m = String(raw).trim().toUpperCase();
  if (m === '6HI' || m === '4HI') return m;
  return null;
}

function resolveMill(
  req: import('express').Request,
  res: import('express').Response,
): ManualRerollMill | null {
  const raw = req.body?.machine ?? req.query?.machine;
  if (raw == null || String(raw).trim() === '') {
    res.status(400).json({ error: 'machine param required' });
    return null;
  }
  const machine = parseManualRerollMill(String(raw));
  if (!machine) {
    res.status(400).json({ error: 'Invalid or missing CRM mill code (expected 6HI or 4HI)' });
    return null;
  }
  return machine;
}

function requireManualRerollRead(
  req: import('express').Request,
  res: import('express').Response,
  next: import('express').NextFunction,
) {
  if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
  const machine = resolveMill(req, res);
  if (!machine) return;
  try {
    assertMachineAccess(req.user, machine, { mode: 'READ' });
    (req as import('express').Request & { crmMill?: ManualRerollMill }).crmMill = machine;
    next();
  } catch (e: unknown) {
    res.status(403).json({ error: e instanceof Error ? e.message : 'Forbidden' });
  }
}

function requireManualRerollWrite(
  req: import('express').Request,
  res: import('express').Response,
  next: import('express').NextFunction,
) {
  if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
  const roles = normalizeRoles(req.user.roles);
  if (!roles.includes(UserRole.OPERATOR) && !roles.includes(UserRole.ADMIN)) {
    return res.status(403).json({ error: 'Forbidden: Manual Re-Roll write is operator-only' });
  }
  const machine = resolveMill(req, res);
  if (!machine) return;
  try {
    assertMachineAccess(req.user, machine, { mode: 'WRITE' });
    (req as import('express').Request & { crmMill?: ManualRerollMill }).crmMill = machine;
    next();
  } catch (e: unknown) {
    res.status(403).json({ error: e instanceof Error ? e.message : 'Forbidden' });
  }
}

const PENDING_SELECT = [
  'o.order_id',
  'o.batch_number',
  'o.coil_no as order_coil_no',
  'o.status',
  'o.customer_name',
  'pb.machine_code',
  'pb.grade_code',
  'pb.coil_no',
  'pb.slit_id',
  'pb.roll_finish',
  'pb.sub_process',
  'pb.ppc_weight_mt',
  'pb.ppc_thk_mm',
  'pb.width_mm',
] as const;

/** Startable overlay queue — same status bucket SixHi uses for combine. */
const REROLL_QUEUE_STATUSES = ['PENDING', 'PREPARING'] as const;

function mapPendingOrder(row: Record<string, unknown>) {
  const motherCoil = String(
    (row.coil_no as string | null | undefined)?.trim()
    || (row.order_coil_no as string | null | undefined)?.trim()
    || row.batch_number
    || '',
  );
  return {
    kind: 'pending' as const,
    orderId: String(row.order_id),
    batchNumber: row.batch_number as string,
    coilNo: motherCoil,
    status: (row.status as string) === 'PREPARING' ? 'PREPARING' : 'PENDING',
    customer: row.customer_name as string,
    grade: (row.grade_code as string | null) ?? null,
    machineCode: row.machine_code as string,
    slitId: (row.slit_id as string | null) ?? null,
    rollFinish: (row.roll_finish as string | null) ?? null,
    subProcess: (row.sub_process as string | null) ?? null,
    weightMt: row.ppc_weight_mt == null ? null : Number(row.ppc_weight_mt),
    thkMm: row.ppc_thk_mm == null ? null : Number(row.ppc_thk_mm),
    widthMm: row.width_mm == null ? null : Number(row.width_mm),
  };
}

async function lookupOrder(machine: ManualRerollMill, batchNumber: string) {
  return db
    .selectFrom('txn.crm_order as o')
    .innerJoin('planning.ppc_batch as pb', 'pb.batch_id', 'o.batch_id')
    .select([
      'o.order_id',
      'o.batch_number',
      'o.status',
      'o.customer_name',
      'pb.machine_code',
      'pb.grade_code',
      'pb.ppc_weight_mt',
    ])
    .where('pb.machine_code', '=', machine)
    .where('o.batch_number', '=', batchNumber)
    .executeTakeFirst();
}

function sessionError(res: import('express').Response, e: unknown, fallback: string) {
  const msg = e instanceof Error ? e.message : fallback;
  if (msg === 'SESSION_NOT_FOUND' || msg === 'STOPPAGE_NOT_FOUND') {
    return res.status(404).json({ error: msg === 'STOPPAGE_NOT_FOUND' ? 'Stoppage not found' : 'Session not found' });
  }
  if (msg === ACTIVE_REROLL_CONFLICT) {
    return res.status(409).json({ error: 'A re-roll session is already active on this machine' });
  }
  if (msg.startsWith('ACTIVE_ORDER_CONFLICT:')) {
    return res.status(409).json({
      error: 'Machine is running a normal production order',
      activeBatchNumber: msg.split(':')[1],
    });
  }
  if (msg === 'HOLD_REMARKS_REQUIRED') {
    return res.status(400).json({ error: 'Hold remarks are required' });
  }
  if (msg === 'SESSION_NOT_ON_HOLD') {
    return res.status(400).json({ error: 'Session is not on hold' });
  }
  if (msg === 'SESSION_NOT_PREPARING') {
    return res.status(400).json({ error: 'Session is not in preparing' });
  }
  if (msg === 'SESSION_STILL_PREPARING') {
    return res.status(400).json({ error: 'Start production before ending, or cancel prepare' });
  }
  return res.status(400).json({ error: msg });
}

// ponytail: read-only search lives in the route so ManualRerollService never touches crm_order
router.get('/orders', requireManualRerollRead, async (req, res) => {
  try {
    const machine = (req as import('express').Request & { crmMill?: ManualRerollMill }).crmMill!;
    const q = String(req.query.q ?? '').trim();
    let query = db
      .selectFrom('txn.crm_order as o')
      .innerJoin('planning.ppc_batch as pb', 'pb.batch_id', 'o.batch_id')
      .select([...PENDING_SELECT])
      .where('pb.machine_code', '=', machine)
      .where('o.status', 'in', [...REROLL_QUEUE_STATUSES])
      .orderBy('o.updated_at', 'desc')
      .limit(q ? 80 : 500);

    if (q) {
      const like = `%${q}%`;
      query = query.where((eb) =>
        eb.or([
          eb('o.batch_number', 'ilike', like),
          eb('o.coil_no', 'ilike', like),
          eb('pb.coil_no', 'ilike', like),
          eb('o.customer_name', 'ilike', like),
        ]),
      );
    }

    const rows = await query.execute();
    const claimed = await ManualRerollService.listClaimedBatchNumbers(machine);
    res.json({
      orders: rows
        .filter((row) => !claimed.has(String(row.batch_number)))
        .map((row) => mapPendingOrder(row as any)),
    });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Order search failed' });
  }
});

router.get('/queue', requireManualRerollRead, async (req, res) => {
  try {
    const machine = (req as import('express').Request & { crmMill?: ManualRerollMill }).crmMill!;
    const q = String(req.query.q ?? '').trim();
    const day = String(req.query.date ?? currentPlantDate());

    let pendingQuery = db
      .selectFrom('txn.crm_order as o')
      .innerJoin('planning.ppc_batch as pb', 'pb.batch_id', 'o.batch_id')
      .select([...PENDING_SELECT])
      .where('pb.machine_code', '=', machine)
      .where('o.status', 'in', [...REROLL_QUEUE_STATUSES])
      .orderBy('o.updated_at', 'desc')
      .limit(q ? 80 : 500);

    if (q) {
      const like = `%${q}%`;
      pendingQuery = pendingQuery.where((eb) =>
        eb.or([
          eb('o.batch_number', 'ilike', like),
          eb('o.coil_no', 'ilike', like),
          eb('pb.coil_no', 'ilike', like),
          eb('o.customer_name', 'ilike', like),
        ]),
      );
    }

    const [pendingRows, sessions, active, claimed] = await Promise.all([
      pendingQuery.execute(),
      ManualRerollService.listQueueSessions(machine, startOfPlantDay(day)),
      ManualRerollService.getActiveSession(machine),
      ManualRerollService.listClaimedBatchNumbers(machine),
    ]);

    const pending = pendingRows
      .filter((row) => !claimed.has(String(row.batch_number)))
      .map((row) => mapPendingOrder(row as any));
    const sessionCards = sessions.map((s) => ({
      kind: 'session' as const,
      sessionId: s.sessionId,
      orderId: s.orderId,
      batchNumber: s.batchNumber,
      batchNumbers: s.batchNumbers,
      status: s.status,
      machineCode: s.machineCode,
      weightMt: s.rerollQuantity,
      actualWeightMt: s.actualWeightMt,
      passes: s.passes,
      remarks: s.remarks,
      startTime: s.startTime,
      endTime: s.endTime,
      durationMin: s.durationMin,
      activeStoppage: s.activeStoppage ?? null,
      stoppages: s.stoppages ?? [],
    }));

    res.json({ pending, sessions: sessionCards, active, date: day });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Queue failed' });
  }
});

router.post('/sessions', requireManualRerollWrite, async (req, res) => {
  try {
    const parsed = ManualRerollStartSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.errors.map((err) => err.message).join('; ') });
    }
    const machine = parsed.data.machine;
    const batchNumbers = [...new Set(
      (parsed.data.batchNumbers?.length ? parsed.data.batchNumbers : [parsed.data.batchNumber])
        .map((b) => b.trim())
        .filter(Boolean),
    )];
    const primaryBatch = parsed.data.batchNumber;
    if (!batchNumbers.includes(primaryBatch)) batchNumbers.unshift(primaryBatch);

    const orders = await Promise.all(batchNumbers.map((batch) => lookupOrder(machine, batch)));
    const missing = batchNumbers.filter((batch, i) => !orders[i]);
    if (missing.length > 0) {
      return res.status(404).json({ error: `Order ${missing[0]} not found on ${machine}` });
    }
    const notStartable = orders.find((row) => row && !REROLL_QUEUE_STATUSES.includes(row.status as typeof REROLL_QUEUE_STATUSES[number]));
    if (notStartable) {
      return res.status(400).json({
        error: `Order ${notStartable.batch_number} is ${notStartable.status} — only PENDING/PREPARING can start re-roll`,
      });
    }
    const claimed = await ManualRerollService.listClaimedBatchNumbers(machine);
    const alreadyClaimed = batchNumbers.find((batch) => claimed.has(batch));
    if (alreadyClaimed) {
      return res.status(400).json({
        error: `Order ${alreadyClaimed} already has an open or completed Manual Re-Roll session`,
      });
    }
    const primary = orders[batchNumbers.indexOf(primaryBatch)]!;
    const weight = parsed.data.rerollQuantity ?? orders.reduce((sum, row) => {
      const qty = row?.ppc_weight_mt == null ? 0 : Number(row.ppc_weight_mt);
      return sum + (Number.isFinite(qty) ? qty : 0);
    }, 0);

    const shift = await ShiftDetectionService.getCurrentShift({
      userId: req.user!.id,
      machineCode: machine,
    });

    const session = await ManualRerollService.prepareSession({
      machine,
      batchNumber: primary.batch_number,
      batchNumbers,
      orderId: primary.order_id,
      rerollQuantity: weight || null,
      remarks: parsed.data.remarks,
      operatorId: req.user!.id,
      shiftCode: shift.shiftCode,
    });
    res.status(201).json(session);
  } catch (e: unknown) {
    sessionError(res, e, 'Prepare failed');
  }
});

router.post('/sessions/:id/start', requireManualRerollWrite, async (req, res) => {
  try {
    const session = await ManualRerollService.startPreparedSession(req.params.id);
    res.json(session);
  } catch (e: unknown) {
    sessionError(res, e, 'Start failed');
  }
});

router.patch('/sessions/:id/capture', requireManualRerollWrite, async (req, res) => {
  try {
    const parsed = ManualRerollCaptureSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.errors.map((err) => err.message).join('; ') });
    }
    const session = await ManualRerollService.updateCapture(req.params.id, {
      actualWeightMt: parsed.data.actualWeightMt,
      actualWeightSource: parsed.data.actualWeightSource,
      actualWeightPhotoHash: parsed.data.actualWeightPhotoHash,
      ocrConfidence: parsed.data.ocrConfidence,
      ocrRawText: parsed.data.ocrRawText,
      destination: parsed.data.destination,
      destinationOverride: parsed.data.destinationOverride,
      etr: parsed.data.etr,
      dtr: parsed.data.dtr,
      inputThkMm: parsed.data.inputThkMm,
      targetThkMm: parsed.data.targetThkMm,
      passes: parsed.data.passes,
    });
    res.json(session);
  } catch (e: unknown) {
    sessionError(res, e, 'Capture save failed');
  }
});

router.get('/sessions/:id', requireManualRerollRead, async (req, res) => {
  try {
    const session = await ManualRerollService.getSessionById(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (session.machineCode !== (req as import('express').Request & { crmMill?: ManualRerollMill }).crmMill) {
      return res.status(404).json({ error: 'Session not found' });
    }
    res.json(session);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Failed to load session' });
  }
});

router.post('/sessions/:id/end', requireManualRerollWrite, async (req, res) => {
  try {
    const parsed = ManualRerollEndSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.errors.map((err) => err.message).join('; ') });
    }
    const session = await ManualRerollService.endSession(req.params.id, req.user!.id, parsed.data.remarks);
    res.json(session);
  } catch (e: unknown) {
    sessionError(res, e, 'End failed');
  }
});

router.post('/sessions/:id/cancel', requireManualRerollWrite, async (req, res) => {
  try {
    const parsed = ManualRerollEndSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.errors.map((err) => err.message).join('; ') });
    }
    const session = await ManualRerollService.cancelSession(req.params.id, req.user!.id, parsed.data.remarks);
    res.json(session);
  } catch (e: unknown) {
    sessionError(res, e, 'Cancel failed');
  }
});

router.post('/sessions/:id/hold', requireManualRerollWrite, async (req, res) => {
  try {
    const parsed = ManualRerollHoldSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.errors.map((err) => err.message).join('; ') });
    }
    const session = await ManualRerollService.holdSession(req.params.id, parsed.data.remarks);
    res.json(session);
  } catch (e: unknown) {
    sessionError(res, e, 'Hold failed');
  }
});

router.post('/sessions/:id/resume', requireManualRerollWrite, async (req, res) => {
  try {
    const session = await ManualRerollService.resumeSession(req.params.id);
    res.json(session);
  } catch (e: unknown) {
    sessionError(res, e, 'Resume failed');
  }
});

/** Close hold so the batch can be started again from Pending. */
router.post('/sessions/:id/release-to-pending', requireManualRerollWrite, async (req, res) => {
  try {
    const session = await ManualRerollService.releaseToPending(req.params.id, req.user!.id);
    res.json(session);
  } catch (e: unknown) {
    sessionError(res, e, 'Release failed');
  }
});

router.patch('/sessions/:id/remarks', requireManualRerollWrite, async (req, res) => {
  try {
    const parsed = ManualRerollRemarkSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.errors.map((err) => err.message).join('; ') });
    }
    const session = await ManualRerollService.updateRemarks(req.params.id, parsed.data.remarks);
    res.json(session);
  } catch (e: unknown) {
    sessionError(res, e, 'Remark failed');
  }
});

router.post('/sessions/:id/stoppages/start', requireManualRerollWrite, async (req, res) => {
  try {
    const parsed = ManualRerollStoppageStartSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.errors.map((err) => err.message).join('; ') });
    }
    const session = await ManualRerollService.startStoppage({
      sessionId: req.params.id,
      categoryCode: parsed.data.categoryCode,
      stoppageCode: parsed.data.stoppageCode,
      remarks: parsed.data.remarks,
      operatorId: req.user!.id,
    });
    res.status(201).json(session);
  } catch (e: unknown) {
    sessionError(res, e, 'Start stoppage failed');
  }
});

router.patch('/sessions/:id/stoppages/:stoppageId', requireManualRerollWrite, async (req, res) => {
  try {
    const parsed = ManualRerollStoppageUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.errors.map((err) => err.message).join('; ') });
    }
    const session = await ManualRerollService.updateStoppage({
      sessionId: req.params.id,
      stoppageId: req.params.stoppageId,
      categoryCode: parsed.data.categoryCode,
      stoppageCode: parsed.data.stoppageCode,
      remarks: parsed.data.remarks,
    });
    res.json(session);
  } catch (e: unknown) {
    sessionError(res, e, 'Update stoppage failed');
  }
});

router.post('/sessions/:id/stoppages/:stoppageId/end', requireManualRerollWrite, async (req, res) => {
  try {
    const parsed = ManualRerollStoppageUpdateSchema.safeParse(req.body ?? { machine: req.body?.machine });
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.errors.map((err) => err.message).join('; ') });
    }
    const session = await ManualRerollService.endStoppage({
      sessionId: req.params.id,
      stoppageId: req.params.stoppageId,
      categoryCode: parsed.data.categoryCode,
      stoppageCode: parsed.data.stoppageCode,
      remarks: parsed.data.remarks,
    });
    res.json(session);
  } catch (e: unknown) {
    sessionError(res, e, 'End stoppage failed');
  }
});

router.get('/sessions', requireManualRerollRead, async (req, res) => {
  try {
    const machine = (req as import('express').Request & { crmMill?: ManualRerollMill }).crmMill!;
    const [sessions, active] = await Promise.all([
      ManualRerollService.listSessions(machine),
      ManualRerollService.getActiveSession(machine),
    ]);
    res.json({ sessions, active });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Failed to list sessions' });
  }
});

router.get('/overlay', requireManualRerollRead, async (req, res) => {
  try {
    const raw = String(req.query.batchNumbers ?? '').trim();
    const batchNumbers = raw
      ? raw.split(',').map((b) => b.trim()).filter(Boolean)
      : [];
    if (batchNumbers.length === 0) {
      return res.status(400).json({ error: 'batchNumbers query required' });
    }
    const overlay = await ManualRerollService.getOverlay(batchNumbers);
    res.json({ overlay });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Overlay failed' });
  }
});

router.get('/summary', requireManualRerollRead, async (req, res) => {
  try {
    const parsed = ManualRerollSummarySchema.safeParse({
      machine: req.query.machine,
      from: req.query.from,
      to: req.query.to,
      shift: req.query.shift || undefined,
    });
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.errors.map((err) => err.message).join('; ') });
    }
    const summary = await ManualRerollService.getProductionSummary({
      machine: parsed.data.machine,
      from: startOfPlantDay(parsed.data.from),
      to: endOfPlantDay(parsed.data.to),
      fromLabel: parsed.data.from,
      toLabel: parsed.data.to,
      shift: parsed.data.shift,
    });
    res.json(summary);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Summary failed' });
  }
});

export default router;
