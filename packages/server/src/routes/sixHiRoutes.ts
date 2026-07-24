import { Router } from 'express';
import {
  SixHiManualOrderSchema,
  SixHiOrderStoppageSchema,
  SixHiRemarkSchema,
  SixHiRollChangeSchema,
  SixHiRollingUpdateSchema,
  SixHiShiftSummarySchema,
  SixHiSkinPassUpdateSchema,
} from '@m1/shared-validation';
import { UserRole } from '@m1/shared-validation';
import { requireAuth, requireRole } from '../middleware/authMiddleware';
import { assertMachineAccess, isMachineAccessForbidden } from '../auth/machineAccessPolicy';
import { denyPlantHeadPpc } from '../auth/ppcAuthorization';
import type { LineAccessLevel } from '../services/authService';
import { db } from '../db';
import {
  SixHiConfigService,
  SixHiExecutionService,
  SixHiQueueService,
  SixHiShiftService,
  SixHiStoppageService,
} from '../services/sixHi';
import { parseCrmMillCode, assertMachineForSubProcess, type CrmMillCode } from '../utils/machineAllocation';
import { PPCImportService } from '../services/PPCImportService';
import { ShiftDetectionService } from '../services/ShiftDetectionService';
import { currentPlantDate, formatPlantDate, startOfPlantDay, endOfPlantDay } from '../utils/dateOnly';
import { SixHiService } from '../services/SixHiService';
import { MachineCrewService } from '../services/MachineCrewService';
import multer from 'multer';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function respondSixHiServerError(res: import('express').Response, context: string, error: unknown) {
  console.error(`${context}:`, error);
  const message = error instanceof Error ? error.message : 'Import failed';
  res.status(500).json({ error: message });
}

async function shiftCodeFromQueryOrCurrent(
  rawShift: unknown,
  userId: number,
  machineCode?: string,
): Promise<string> {
  const explicit = String(rawShift ?? '').trim().toUpperCase();
  if (explicit) return explicit;
  const detected = await ShiftDetectionService.getCurrentShift({ userId, machineCode });
  return detected.shiftCode.toUpperCase();
}

function resolveRequiredCrmMill(
  req: import('express').Request,
  res: import('express').Response,
): CrmMillCode | null {
  const raw = req.body?.machine ?? req.query?.machine;
  if (raw == null || String(raw).trim() === '') {
    res.status(400).json({ error: 'machine param required' });
    return null;
  }
  const machine = parseCrmMillCode(String(raw).toUpperCase());
  if (!machine) {
    res.status(400).json({ error: 'Invalid or missing CRM mill code (expected 6HI, 4HI, or 2HI)' });
    return null;
  }
  return machine;
}

/** Derive mill from order batch and enforce machine access (write routes that omit ?machine=). */
async function authorizeOrderBatchMill(
  req: import('express').Request,
  res: import('express').Response,
  batchNo: string,
): Promise<CrmMillCode | null> {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthenticated' });
    return null;
  }
  const millRow = await db
    .selectFrom('txn.crm_order as o')
    .innerJoin('planning.ppc_batch as pb', 'pb.batch_id', 'o.batch_id')
    .select('pb.machine_code')
    .where('o.batch_number', '=', batchNo)
    .executeTakeFirst();

  if (!millRow) {
    res.status(404).json({ error: 'Order not found' });
    return null;
  }

  if (millRow.machine_code) {
    const mill = parseCrmMillCode(String(millRow.machine_code).toUpperCase());
    if (mill) {
      try {
        // Supervisor may reinstate / act on held orders without mill WRITE grants.
        const mode = req.user.roles.includes(UserRole.SUPERVISOR as string) ? 'READ' : 'WRITE';
        assertMachineAccess(req.user, mill, { mode });
        (req as import('express').Request & { crmMill?: CrmMillCode }).crmMill = mill;
        return mill;
      } catch (e: unknown) {
        if (isMachineAccessForbidden(e)) {
          res.status(403).json({ error: e instanceof Error ? e.message : 'Forbidden' });
          return null;
        }
        throw e;
      }
    }
  }

  return null;
}

// operation kept in the signature so the 42 call sites (requireSixHi('READ'|'WRITE')) don't change.
function requireCrmMill(operation: LineAccessLevel) {
  return (req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
    try {
      const machine = resolveRequiredCrmMill(req, res);
      if (!machine) return;
      // Machine-wise scope: security.machine_access holds 6HI/4HI/2HI; ADMIN/PLANT_HEAD bypass inside.
      assertMachineAccess(req.user, machine, { mode: operation === 'READ' ? 'READ' : 'WRITE' });
      (req as import('express').Request & { crmMill?: CrmMillCode }).crmMill = machine;
      next();
    } catch (e: unknown) {
      res.status(403).json({ error: e instanceof Error ? e.message : 'Forbidden' });
    }
  };
}

/** Order allocation — supervisor may assign without per-machine rows (role-gated separately). */
function requireCrmMillAssignment() {
  return (req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
    try {
      // allocate-machine client sends body.machineCode (not body.machine).
      const raw = req.body?.machine ?? req.query?.machine ?? req.body?.machineCode;
      if (raw == null || String(raw).trim() === '') {
        return res.status(400).json({ error: 'machine param required' });
      }
      const machine = parseCrmMillCode(String(raw).toUpperCase());
      if (!machine) {
        return res.status(400).json({ error: 'Invalid or missing CRM mill code (expected 6HI, 4HI, or 2HI)' });
      }
      if (req.user.roles.includes(UserRole.SUPERVISOR as string)) {
        (req as import('express').Request & { crmMill?: CrmMillCode }).crmMill = machine;
        return next();
      }
      assertMachineAccess(req.user, machine);
      (req as import('express').Request & { crmMill?: CrmMillCode }).crmMill = machine;
      next();
    } catch (e: unknown) {
      res.status(403).json({ error: e instanceof Error ? e.message : 'Forbidden' });
    }
  };
}

const requireSixHi = requireCrmMill; // keep name to minimize churn across 42 handlers

router.use(requireAuth);

router.post('/import/ppc', requireRole([UserRole.ADMIN, UserRole.SUPERVISOR]), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'CSV file required' });
    const result = await PPCImportService.importFromCsvText(
      req.file.originalname,
      req.file.buffer.toString('utf-8'),
      req.user!.id,
    );
    if (result.headerError) return res.status(400).json({ error: result.headerError });
    const status = result.status === 'FAILED' ? 400 : result.status === 'PARTIAL' ? 207 : 201;
    res.status(status).json(result);
  } catch (e: unknown) {
    respondSixHiServerError(res, 'PPC CSV import', e);
  }
});

router.post('/import/ppc/preview', denyPlantHeadPpc('PPC_PREVIEW'), requireRole([UserRole.ADMIN, UserRole.MACHINE_HEAD, UserRole.SUPERVISOR]), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'XLSX file required' });
    const sheetTypeRaw = String(req.body?.sheetType ?? 'ROLLING').toUpperCase();
    const sheetType =
      sheetTypeRaw === 'SKIN_PASS' ? 'SKIN_PASS'
      : sheetTypeRaw === 'REWINDING' ? 'REWINDING'
      : sheetTypeRaw === 'ANNEALING' ? 'ANNEALING'
      : 'ROLLING';
    const result = await PPCImportService.previewRollingXlsx(
      req.file.buffer,
      req.file.originalname,
      req.user!.id,
      sheetType,
    );
    if (result.headerError) return res.status(400).json({ error: result.headerError });
    res.status(201).json(result);
  } catch (e: unknown) {
    respondSixHiServerError(res, 'PPC preview', e);
  }
});

router.put('/import/ppc/preview/:sessionId/machines', denyPlantHeadPpc('PPC_PREVIEW_MACHINES'), requireRole([UserRole.ADMIN, UserRole.MACHINE_HEAD, UserRole.SUPERVISOR]), async (req, res) => {
  try {
    const assignments = req.body?.assignments as { batchNumber: string; machineCode: string }[] | undefined;
    if (!Array.isArray(assignments) || assignments.length === 0) {
      return res.status(400).json({ error: 'assignments array required' });
    }
    const rows = await PPCImportService.updatePreviewMachines(
      req.params.sessionId,
      assignments.map((a) => {
        const machineCode = parseCrmMillCode(String(a.machineCode ?? '').toUpperCase());
        if (!machineCode) {
          throw new Error(`Invalid machineCode "${a.machineCode}" (expected 6HI, 4HI, or 2HI)`);
        }
        return { batchNumber: a.batchNumber, machineCode };
      }),
    );
    res.json({ rows });
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'Machine update failed' });
  }
});

router.post('/import/ppc/preview/:sessionId/commit', denyPlantHeadPpc('PPC_PREVIEW_COMMIT'), requireRole([UserRole.ADMIN, UserRole.MACHINE_HEAD, UserRole.SUPERVISOR]), async (req, res) => {
  try {
    const batchNumbers = Array.isArray(req.body?.batchNumbers)
      ? (req.body.batchNumbers as unknown[]).map((b) => String(b).trim()).filter(Boolean)
      : undefined;
    const result = await PPCImportService.commitRollingSession(
      req.params.sessionId,
      req.user!.id,
      batchNumbers,
    );
    const status = result.status === 'FAILED' ? 400 : result.status === 'PARTIAL' ? 207 : 201;
    res.status(status).json(result);
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'Commit failed' });
  }
});

router.post('/orders/transfer-machine', denyPlantHeadPpc('PPC_TRANSFER_MACHINE'), requireRole([UserRole.ADMIN, UserRole.MACHINE_HEAD, UserRole.SUPERVISOR]), async (req, res) => {
  try {
    const batchNumbers = req.body?.batchNumbers as string[] | undefined;
    const targetMachine = String(req.body?.targetMachine ?? '').toUpperCase();
    if (!Array.isArray(batchNumbers) || batchNumbers.length === 0) {
      return res.status(400).json({ error: 'batchNumbers array required' });
    }
    const parsedMachine = parseCrmMillCode(targetMachine);
    if (!parsedMachine) {
      return res.status(400).json({ error: 'targetMachine must be 6HI, 4HI, or 2HI' });
    }
    const roles = req.user!.roles ?? [];
    const results = await SixHiConfigService.transferMachines(
      batchNumbers,
      parsedMachine,
      req.user!.id,
      roles,
    );
    res.json({ results });
  } catch (e: unknown) {
    res.status(403).json({ error: e instanceof Error ? e.message : 'Transfer failed' });
  }
});

router.get('/master/stoppage-categories', requireSixHi('READ'), async (_req, res) => {
  try {
    const data = await SixHiConfigService.getStoppageCategories();
    res.json(data.categories);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Failed to load categories' });
  }
});

router.get('/master/defect-codes', requireSixHi('READ'), async (_req, res) => {
  try {
    const data = await SixHiConfigService.getDefectCodes();
    res.json(data);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Failed to load defect codes' });
  }
});

router.post('/master/defect-codes', requireSixHi('WRITE'), async (req, res) => {
  try {
    const data = await SixHiConfigService.saveDefectCode(req.body);
    res.json(data);
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'Failed to save defect code' });
  }
});

router.patch('/master/defect-codes/:code/toggle', requireSixHi('WRITE'), async (req, res) => {
  try {
    const data = await SixHiConfigService.toggleDefectCode(req.params.code, req.body.isActive);
    res.json(data);
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'Failed to toggle defect code' });
  }
});

router.post('/master/stoppage-categories', requireSixHi('WRITE'), async (req, res) => {
  try {
    const data = await SixHiConfigService.saveStoppageCategory(req.body);
    res.json(data);
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'Failed to save stoppage category' });
  }
});

router.patch('/master/stoppage-categories/:code/toggle', requireSixHi('WRITE'), async (req, res) => {
  try {
    const data = await SixHiConfigService.toggleStoppageCategory(req.params.code, req.body.isActive);
    res.json(data);
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'Failed to toggle stoppage category' });
  }
});

router.post('/master/stoppage-codes', requireSixHi('WRITE'), async (req, res) => {
  try {
    const data = await SixHiConfigService.saveStoppageCode(req.body);
    res.json(data);
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'Failed to save stoppage code' });
  }
});

router.patch('/master/stoppage-codes/:code/toggle', requireSixHi('WRITE'), async (req, res) => {
  try {
    const data = await SixHiConfigService.toggleStoppageCode(req.params.code, req.body.isActive);
    res.json(data);
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'Failed to toggle stoppage code' });
  }
});

router.get('/active-order', requireSixHi('READ'), async (req, res) => {
  try {
    const machine = resolveRequiredCrmMill(req, res);
    if (!machine) return;
    const active = await SixHiExecutionService.findActiveMachineOrder(machine);
    res.json(active);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Failed to load active order' });
  }
});

router.get('/manual-stoppage', requireSixHi('READ'), async (req, res) => {
  try {
    const machine = resolveRequiredCrmMill(req, res);
    if (!machine) return;
    const status = await SixHiExecutionService.getManualStoppageStatus(machine);
    res.json(status);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Failed to load manual stoppage status' });
  }
});

router.post('/manual-stoppage/start', requireSixHi('WRITE'), async (req, res) => {
  try {
    const machine = resolveRequiredCrmMill(req, res);
    if (!machine) return;
    const parsed = SixHiOrderStoppageSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const status = await SixHiExecutionService.startManualStoppage(
      machine,
      parsed.data.categoryCode.trim(),
      parsed.data.breakdownCode?.trim() || undefined,
      parsed.data.remarks?.trim() || undefined,
      req.user!.id,
    );
    res.json(status);
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'Failed to start manual stoppage' });
  }
});

router.patch('/manual-stoppage', requireSixHi('WRITE'), async (req, res) => {
  try {
    const machine = resolveRequiredCrmMill(req, res);
    if (!machine) return;
    const parsed = SixHiOrderStoppageSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const rollChange = req.body.rollChange as {
      rollPosition?: 'IN' | 'OUT';
      newRollNo?: string;
      newRollCode?: string;
    } | undefined;
    const status = await SixHiExecutionService.updateManualStoppage(
      machine,
      parsed.data.categoryCode.trim(),
      parsed.data.breakdownCode?.trim() || undefined,
      parsed.data.remarks?.trim() || undefined,
      rollChange,
    );
    res.json(status);
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'Failed to update manual stoppage' });
  }
});

router.post('/manual-stoppage/end', requireSixHi('WRITE'), async (req, res) => {
  try {
    const machine = resolveRequiredCrmMill(req, res);
    if (!machine) return;
    const status = await SixHiExecutionService.endManualStoppage(machine, req.user!.id);
    res.json(status);
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'Failed to end manual stoppage' });
  }
});

router.get('/queue', requireSixHi('READ'), async (req, res) => {
  try {
    const subProcess = String(req.query.subProcess ?? 'ROLLING').toUpperCase().replace(' ', '_');
    const parsedMachine = resolveRequiredCrmMill(req, res);
    if (!parsedMachine) return;
    const shiftCode = await shiftCodeFromQueryOrCurrent(req.query.shift, req.user!.id, parsedMachine);
    const detected = await ShiftDetectionService.getCurrentShift({
      userId: req.user!.id,
      machineCode: parsedMachine,
    });
    const viewDate = typeof req.query.date === 'string'
      ? formatPlantDate(req.query.date)
      : currentPlantDate();
    if (!['ROLLING', 'SKIN_PASS'].includes(subProcess)) {
      return res.status(400).json({ error: 'subProcess must be ROLLING or SKIN_PASS' });
    }
    let shiftLogId = req.query.shiftLogId ? String(req.query.shiftLogId) : undefined;
    if (!shiftLogId) {
      // Prefer operational detection date so completed/hold stay on the active shift.
      shiftLogId = (await SixHiService.resolveShiftLogIdForPlan(detected.prodDate, shiftCode)) ?? undefined;
    }
    const result = await SixHiQueueService.getQueue(
      subProcess as 'ROLLING' | 'SKIN_PASS',
      viewDate,
      shiftCode,
      parsedMachine,
      shiftLogId,
    );
    res.json(result);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Queue load failed' });
  }
});

router.post('/orders/manual', requireSixHi('WRITE'), async (req, res) => {
  try {
    const validation = SixHiManualOrderSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ error: validation.error.errors.map((e) => e.message).join('; ') });
    }
    const result = await PPCImportService.createManualBatch(validation.data, req.user!.id);
    res.status(201).json(result);
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'Manual order creation failed' });
  }
});

// Must be registered before /orders/:batchNo or "completed" is treated as a batch number.
// Uses requireAuth (not requireSixHi) so machine param is optional — "ALL" works without it.
// Machine-scope is enforced manually: ADMIN/PLANT_HEAD see all; MACHINE_HEAD sees their assigned machines.
router.get('/orders/completed', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });

  try {
    const rawMachine = req.query.machine ? String(req.query.machine).toUpperCase() : undefined;
    const date = req.query.date ? formatPlantDate(String(req.query.date)) : undefined;
    const shiftCode = req.query.shiftCode ? String(req.query.shiftCode).toUpperCase() : undefined;
    // Prefer resolved shift-log scoping so "completed this shift" matches the rest
    // of the dashboard (Overview / Completed count), not a raw calendar-day window.
    // Include mill_type siblings — orders may sit on mill-specific logs.
    let shiftLogIds: string[] | undefined;
    if (req.query.shiftLogId) {
      shiftLogIds = await SixHiService.expandSiblingShiftLogIds(String(req.query.shiftLogId));
    } else if (date && shiftCode && shiftCode !== 'ALL') {
      shiftLogIds = await SixHiService.resolveShiftLogIdsForPlan(date, shiftCode);
    }

    // Resolve machine scope for the requesting user — prefer DB grants over
    // stale JWT claims (same source as LiveService.getMachineScope).
    const isAdmin = req.user.roles.includes(UserRole.ADMIN as string);
    const isPlantHead = req.user.roles.includes(UserRole.PLANT_HEAD as string);
    let userMachineAccess = (req.user.machineAccess ?? []).map((m) => m.toUpperCase());
    if (!isAdmin && !isPlantHead && req.user.roles.includes(UserRole.MACHINE_HEAD as string)) {
      const rows = await db.selectFrom('security.machine_access')
        .select('machine_code')
        .where('user_id', '=', req.user.id as any)
        .execute();
      userMachineAccess = rows.map((r) => r.machine_code.toUpperCase());
    }

    // If a specific machine is requested, verify the user can access it
    if (rawMachine && rawMachine !== 'ALL') {
      if (!isAdmin && !isPlantHead && !userMachineAccess.includes(rawMachine)) {
        return res.status(403).json({ error: `Access to machine ${rawMachine} denied` });
      }
    }

    // Determine which machines to query
    // null/undefined rawMachine or 'ALL' → scope to user's allowed machines (or all for admin/plant head)
    const scopedMachines: string[] | null =
      rawMachine && rawMachine !== 'ALL'
        ? [rawMachine]
        : isAdmin || isPlantHead
          ? null // all machines
          : userMachineAccess; // MACHINE_HEAD: only their assigned machines

    let q = db.selectFrom('txn.crm_order as o')
      .innerJoin('planning.ppc_batch as pb', 'pb.batch_id', 'o.batch_id')
      .leftJoin('master.machine as m', 'm.machine_code', 'pb.machine_code')
      .leftJoin('security.app_user as u', 'u.user_id', 'o.logged_in_user_id')
      .select([
        'pb.batch_number',
        'pb.customer_name',
        'pb.grade_code',
        'pb.machine_code',
        'm.name as machine_name',
        'pb.sub_process',
        'pb.ppc_weight_mt',
        'pb.coil_no',
        'pb.slit_id',
        'o.coil_no as order_coil_no',
        'o.slit_id as order_slit_id',
        'pb.shift_code',
        'pb.plan_date',
        'o.status',
        'o.prod_start_at',
        'o.prod_end_at',
        'u.full_name as operator_name',
      ])
      .where('o.status', '=', 'COMPLETED');

    if (scopedMachines !== null) {
      if (scopedMachines.length === 0) {
        return res.json([]); // user has no machine access
      }
      q = q.where('pb.machine_code', 'in', scopedMachines);
    }
    if (shiftLogIds && shiftLogIds.length > 0) {
      q = q.where('o.shift_log_id', 'in', shiftLogIds);
    } else {
      if (date) {
        q = q.where('o.prod_end_at', '>=', startOfPlantDay(date))
          .where('o.prod_end_at', '<=', endOfPlantDay(date));
      }
      if (shiftCode && shiftCode !== 'ALL') {
        q = q.where('pb.shift_code', '=', shiftCode);
      }
    }

    const rows = await q.orderBy('o.prod_end_at', 'desc').limit(200).execute();
    res.json(await Promise.all(rows.map(async (r) => {
      const coilNo = ((r as { order_coil_no?: string | null }).order_coil_no ?? r.coil_no ?? '').trim() || undefined;
      const slitId = ((r as { order_slit_id?: string | null }).order_slit_id ?? r.slit_id)?.trim() || undefined;
      // No logged-in user → fall back to the machine's crew-register operator.
      const operatorName = r.operator_name
        ?? (r.machine_code ? await MachineCrewService.getOperatorName(r.machine_code) : undefined);
      return {
        batchNumber: r.batch_number,
        customer: r.customer_name,
        grade: r.grade_code,
        machineCode: r.machine_code,
        machineName: r.machine_name,
        subProcess: r.sub_process,
        weightMt: Number(r.ppc_weight_mt),
        coilNo,
        motherCoil: coilNo,
        slitId,
        shiftCode: r.shift_code,
        planDate: r.plan_date,
        status: r.status,
        prodStartAt: r.prod_start_at,
        prodEndAt: r.prod_end_at,
        operatorName,
      };
    })));
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Failed to load completed orders' });
  }
});

// Read-by-batch: mill is derived from the order record (not ?machine=).
// Write routes keep requireSixHi('WRITE') → resolveRequiredCrmMill unchanged.
router.get('/orders/:batchNo', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
  try {
    const millRow = await db
      .selectFrom('txn.crm_order as o')
      .innerJoin('planning.ppc_batch as pb', 'pb.batch_id', 'o.batch_id')
      .select('pb.machine_code')
      .where('o.batch_number', '=', req.params.batchNo)
      .executeTakeFirst();

    if (!millRow) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Authorize against the order's mill when one is assigned. Unallocated
    // orders have no mill scope to enforce (ADMIN/PLANT_HEAD still bypass
    // inside assertMachineAccess when a mill is present).
    if (millRow.machine_code) {
      const mill = parseCrmMillCode(String(millRow.machine_code).toUpperCase());
      if (mill) {
        assertMachineAccess(req.user, mill);
        (req as import('express').Request & { crmMill?: CrmMillCode }).crmMill = mill;
      }
    }

    const order = await SixHiExecutionService.getOrder(req.params.batchNo, req.user.id);
    res.json(order);
  } catch (e: unknown) {
    if (isMachineAccessForbidden(e)) {
      return res.status(403).json({ error: e instanceof Error ? e.message : 'Forbidden' });
    }
    res.status(404).json({ error: e instanceof Error ? e.message : 'Order not found' });
  }
});

router.delete(
  '/orders/:batchNo',
  async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
    const roles = req.user.roles;
    const isSupervisor = roles.includes(UserRole.SUPERVISOR);
    const mayDelete =
      roles.includes(UserRole.ADMIN) ||
      roles.includes(UserRole.PLANT_HEAD) ||
      roles.includes(UserRole.MACHINE_HEAD) ||
      isSupervisor;
    if (!mayDelete) return res.status(403).json({ error: 'Forbidden' });

    // Mill access is machine-scoped (6HI/4HI/2HI), not process-line ROLLING.
    // Legacy assertLineOperation(user, '6HI', WRITE) wrongly treated the mill as a line.
    if (!roles.includes(UserRole.ADMIN) && !roles.includes(UserRole.PLANT_HEAD)) {
      const mill = await authorizeOrderBatchMill(req, res, req.params.batchNo);
      if (res.headersSent) return;
      if (!mill) {
        // Unallocated order: allow if user can reach any CRM mill (MH machine list / supervisor all-mills).
        const allowed = (req.user.machineAccess ?? []).map((m) => m.toUpperCase());
        const hasCrm = allowed.some((m) => m === '6HI' || m === '4HI' || m === '2HI');
        if (!hasCrm && !isSupervisor) {
          return res.status(403).json({ error: 'Forbidden: No access to CRM mills' });
        }
      }
    }

    try {
      const result = await SixHiExecutionService.deleteOrder(req.params.batchNo, req.user.id);
      res.json(result);
    } catch (e: unknown) {
      res.status(400).json({ error: e instanceof Error ? e.message : 'Delete failed' });
    }
  },
);

router.post(
  '/orders/:batchNo/allocate-machine',
  // Operators allocate during CRM start flow; MH/Supervisor assign from the board.
  // Mill WRITE still required for non-supervisors via requireCrmMillAssignment.
  requireRole([
    UserRole.OPERATOR,
    UserRole.MACHINE_HEAD,
    UserRole.PLANT_HEAD,
    UserRole.ADMIN,
    UserRole.SUPERVISOR,
  ]),
  requireCrmMillAssignment(),
  async (req, res) => {
  try {
    const machineCode = String(req.body?.machineCode ?? '').trim();
    if (!machineCode) return res.status(400).json({ error: 'machineCode required' });
    const order = await SixHiQueueService.allocateMachine(
      req.params.batchNo,
      machineCode,
      req.user!.id,
      { reason: req.body?.reason },
    );
    res.json(order);
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'Machine allocation failed' });
  }
});

router.get(
  '/order-assignment',
  requireRole([UserRole.MACHINE_HEAD, UserRole.PLANT_HEAD, UserRole.ADMIN, UserRole.SUPERVISOR]),
  async (req, res) => {
    try {
      const board = await SixHiQueueService.getOrderAssignmentBoard();
      res.json(board);
    } catch (e: unknown) {
      res.status(500).json({ error: e instanceof Error ? e.message : 'Failed to load order assignment' });
    }
  },
);

router.post(
  '/order-assignment/transfer',
  requireRole([UserRole.MACHINE_HEAD, UserRole.PLANT_HEAD, UserRole.ADMIN, UserRole.SUPERVISOR]),
  async (req, res) => {
    try {
      const batchNumbers: string[] = Array.isArray(req.body?.batchNumbers)
        ? req.body.batchNumbers.map((b: unknown) => String(b).trim()).filter(Boolean)
        : req.body?.batchNumber
          ? [String(req.body.batchNumber).trim()]
          : [];
      const machineCode = String(req.body?.machineCode ?? '').trim();
      const reason = req.body?.reason ? String(req.body.reason) : undefined;
      if (batchNumbers.length === 0) return res.status(400).json({ error: 'batchNumber or batchNumbers required' });
      if (!machineCode) return res.status(400).json({ error: 'machineCode required' });

      const transferType = batchNumbers.length > 1 ? 'BULK' : 'SINGLE';
      const results = await SixHiConfigService.transferMachines(
        batchNumbers,
        machineCode,
        req.user!.id,
        req.user!.roles,
        reason,
        transferType,
      );
      const failed = results.filter((r) => !r.ok);
      if (failed.length === results.length) {
        return res.status(400).json({ error: failed[0]?.error ?? 'Transfer failed', results });
      }
      res.json({ ok: true, results, transferType });
    } catch (e: unknown) {
      res.status(400).json({ error: e instanceof Error ? e.message : 'Transfer failed' });
    }
  },
);

router.post('/orders/transfer-machines', requireSixHi('WRITE'), async (req, res) => {
  try {
    const { batchNumbers, machineCode, reason } = req.body;
    if (!Array.isArray(batchNumbers) || batchNumbers.length === 0) {
      return res.status(400).json({ error: 'batchNumbers array required' });
    }
    if (!machineCode) return res.status(400).json({ error: 'machineCode required' });
    
    const results = await SixHiConfigService.transferMachines(
      batchNumbers,
      machineCode as any,
      req.user!.id,
      req.user!.roles,
      reason ? String(reason) : undefined,
    );
    res.json({ results });
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'Bulk transfer failed' });
  }
});

router.post('/orders/start-combined', requireSixHi('WRITE'), async (req, res) => {
  try {
    const { batchNumbers } = req.body;
    if (!Array.isArray(batchNumbers) || batchNumbers.length === 0) {
      return res.status(400).json({ error: 'batchNumbers array required' });
    }
    const cleanBatchNumbers = batchNumbers.filter((batch): batch is string => typeof batch === 'string' && batch.trim().length > 0);
    const orders = await SixHiExecutionService.startCombinedProduction(cleanBatchNumbers, req.user!.id);
    res.json({ orders });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Start failed';
    if (msg.startsWith('ACTIVE_ORDER_CONFLICT:')) {
      return res.status(409).json({
        error: 'Another order is already active on this machine',
        activeBatchNumber: msg.split(':')[1],
      });
    }
    res.status(400).json({ error: msg });
  }
});

router.post('/orders/:batchNo/start', requireSixHi('WRITE'), async (req, res) => {
  try {
    const order = await SixHiExecutionService.startProduction(req.params.batchNo, req.user!.id);
    res.json(order);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Start failed';
    if (msg.startsWith('ACTIVE_ORDER_CONFLICT:')) {
      const batch = await db.selectFrom('planning.ppc_batch')
        .select('machine_code')
        .where('batch_number', '=', req.params.batchNo)
        .executeTakeFirst();
      const mc = batch?.machine_code ?? 'unknown';
      return res.status(409).json({
        error: `Another order is already active on CRM ${mc}`,
        activeBatchNumber: msg.split(':')[1],
        machineCode: mc,
      });
    }
    res.status(400).json({ error: msg });
  }
});

router.post('/orders/:batchNo/end', requireSixHi('WRITE'), async (req, res) => {
  try {
    const { defectCodes } = req.body;
    const order = await SixHiExecutionService.endProduction(req.params.batchNo, req.user!.id, defectCodes);
    res.json(order);
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'End failed' });
  }
});

router.patch('/orders/:batchNo/rolling', requireSixHi('WRITE'), async (req, res) => {
  const parsed = SixHiRollingUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const machine = resolveRequiredCrmMill(req, res);
    if (!machine) return;
    assertMachineForSubProcess('ROLLING', machine);
    const order = await SixHiExecutionService.updateRolling(req.params.batchNo, {
      ...parsed.data,
      destinationOverride: req.body.destinationOverride ?? false,
      passes: parsed.data.passes,
      totalPasses: parsed.data.passes.length,
      finalThkMm: parsed.data.passes.length > 0 ? parsed.data.passes[parsed.data.passes.length - 1].thicknessMm : undefined,
    }, req.user!.id);
    res.json(order);
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'Update failed' });
  }
});

router.patch('/orders/:batchNo/skinpass', requireSixHi('WRITE'), async (req, res) => {
  const parsed = SixHiSkinPassUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const order = await SixHiExecutionService.updateSkinPass(req.params.batchNo, parsed.data, req.user!.id);
    res.json(order);
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'Update failed' });
  }
});

router.post('/orders/:batchNo/stoppages/start', requireSixHi('WRITE'), async (req, res) => {
  try {
    // Default to '12' (Operational) to start the timer immediately
    const order = await SixHiStoppageService.addStoppage(req.params.batchNo, '12', undefined, undefined, req.user!.id);
    res.json(order);
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'Stoppage start failed' });
  }
});

router.post('/orders/:batchNo/stoppages', requireSixHi('WRITE'), async (req, res) => {
  const parsed = SixHiOrderStoppageSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const order = await SixHiStoppageService.addStoppage(
      req.params.batchNo,
      parsed.data.categoryCode,
      parsed.data.breakdownCode,
      parsed.data.remarks,
      req.user!.id,
    );
    res.json(order);
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'Stoppage failed' });
  }
});

router.patch('/orders/:batchNo/stoppages/:stoppageId', requireSixHi('WRITE'), async (req, res) => {
  const parsed = SixHiOrderStoppageSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const order = await SixHiStoppageService.updateStoppage(
      req.params.batchNo,
      req.params.stoppageId,
      parsed.data.categoryCode,
      parsed.data.breakdownCode,
      parsed.data.remarks,
      req.user!.id,
    );
    res.json(order);
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'Update stoppage failed' });
  }
});

router.patch('/orders/:batchNo/stoppages/:stoppageId/end', requireSixHi('WRITE'), async (req, res) => {
  try {
    const order = await SixHiStoppageService.endStoppage(req.params.batchNo, req.params.stoppageId, req.user!.id);
    res.json(order);
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'End stoppage failed' });
  }
});

router.post('/orders/:batchNo/reject', requireSixHi('WRITE'), async (req, res) => {
  try {
    const { defectCodes, remarks, rejectionReason } = req.body;
    if (!rejectionReason || typeof rejectionReason !== 'string') {
      return res.status(400).json({ error: 'rejectionReason is required' });
    }
    if (!remarks || typeof remarks !== 'string' || !remarks.trim()) {
      return res.status(400).json({ error: 'remarks are required' });
    }
    const codes = Array.isArray(defectCodes) ? defectCodes.filter((c): c is string => typeof c === 'string') : [];
    const order = await SixHiExecutionService.rejectOrder(
      req.params.batchNo,
      rejectionReason,
      codes,
      remarks,
      req.user!.id,
    );
    res.json(order);
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'Order rejection failed' });
  }
});

router.post('/orders/:batchNo/reinstate', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
  try {
    await authorizeOrderBatchMill(req, res, req.params.batchNo);
    if (res.headersSent) return;
    const rawTarget = req.body?.target;
    const target = rawTarget === 'PENDING' ? 'PENDING' : 'PREPARING';
    const order = await SixHiExecutionService.reinstateOrder(
      req.params.batchNo,
      req.user.id,
      target,
    );
    res.json(order);
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'Order reinstate failed' });
  }
});

router.post('/orders/:batchNo/remarks', requireSixHi('WRITE'), async (req, res) => {
  const parsed = SixHiRemarkSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const order = await SixHiExecutionService.addRemark(
      req.params.batchNo,
      parsed.data.text,
      req.user!.id,
      parsed.data.defects,
    );
    res.json(order);
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'Remark failed' });
  }
});

router.post('/orders/:batchNo/roll-change', requireSixHi('WRITE'), async (req, res) => {
  const parsed = SixHiRollChangeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const order = await SixHiExecutionService.logRollChange(
      req.params.batchNo,
      parsed.data.rollPosition,
      parsed.data.newRollNo,
      parsed.data.newRollCode,
      parsed.data.reasonText,
      req.user!.id,
    );
    res.json(order);
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'Roll change failed' });
  }
});

router.get('/shift-summary/:shiftLogId', requireSixHi('READ'), async (req, res) => {
  try {
    const machine = req.query.machine ? String(req.query.machine).toUpperCase() : undefined;
    const summary = await SixHiShiftService.getShiftSummary(req.params.shiftLogId, machine);
    res.json(summary);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Summary failed' });
  }
});

router.get('/shift/:shiftLogId/stoppages', requireSixHi('READ'), async (req, res) => {
  try {
    const machine = req.query.machine ? String(req.query.machine).toUpperCase() : undefined;
    const stoppages = await SixHiStoppageService.getShiftStoppages(req.params.shiftLogId, machine);
    res.json(stoppages);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Failed to load shift stoppages' });
  }
});

router.post('/shift-summary/:shiftLogId', requireSixHi('WRITE'), async (req, res) => {
  const parsed = SixHiShiftSummarySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const summary = await SixHiShiftService.saveShiftSummary(
      req.params.shiftLogId,
      parsed.data.scrapKg,
      parsed.data.coolantTempDegC,
      parsed.data.coolantPressKgCm2,
      req.user!.id,
    );
    res.json(summary);
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'Save summary failed' });
  }
});

export default router;
