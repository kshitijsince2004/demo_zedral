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
import { assertLineOperation } from '../auth/lineAccessPolicy';
import { denyPlantHeadPpc } from '../auth/ppcAuthorization';
import type { LineAccessLevel } from '../services/authService';
import { db } from '../db';
import { SixHiService } from '../services/SixHiService';
import { parseCrmMillCode } from '../utils/machineAllocation';
import { PPCImportService } from '../services/PPCImportService';
import multer from 'multer';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function respondSixHiServerError(res: import('express').Response, context: string, error: unknown) {
  console.error(`${context}:`, error);
  const message = error instanceof Error ? error.message : 'Import failed';
  res.status(500).json({ error: message });
}

function requireSixHi(operation: LineAccessLevel) {
  return (req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
    try {
      assertLineOperation(req.user, '6HI', operation);
      next();
    } catch (e: unknown) {
      res.status(403).json({ error: e instanceof Error ? e.message : 'Forbidden' });
    }
  };
}

router.use(requireAuth);

router.post('/import/ppc', requireRole([UserRole.ADMIN]), upload.single('file'), async (req, res) => {
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

router.post('/import/ppc/preview', denyPlantHeadPpc('PPC_PREVIEW'), requireRole([UserRole.ADMIN, UserRole.MACHINE_HEAD]), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'XLSX file required' });
    const sheetTypeRaw = String(req.body?.sheetType ?? 'ROLLING').toUpperCase();
    const sheetType =
      sheetTypeRaw === 'SKIN_PASS' ? 'SKIN_PASS'
      : sheetTypeRaw === 'REWINDING' ? 'REWINDING'
      : sheetTypeRaw === 'ANNEALING' ? 'ANNEALING'
      : 'ROLLING';
    const shiftCode = String(req.body?.shiftCode ?? 'B').toUpperCase();
    const result = await PPCImportService.previewRollingXlsx(
      req.file.buffer,
      req.file.originalname,
      req.user!.id,
      sheetType,
      shiftCode,
    );
    if (result.headerError) return res.status(400).json({ error: result.headerError });
    res.status(201).json(result);
  } catch (e: unknown) {
    respondSixHiServerError(res, 'PPC preview', e);
  }
});

router.put('/import/ppc/preview/:sessionId/machines', denyPlantHeadPpc('PPC_PREVIEW_MACHINES'), requireRole([UserRole.ADMIN, UserRole.MACHINE_HEAD]), async (req, res) => {
  try {
    const assignments = req.body?.assignments as { batchNumber: string; machineCode: string }[] | undefined;
    if (!Array.isArray(assignments) || assignments.length === 0) {
      return res.status(400).json({ error: 'assignments array required' });
    }
    const rows = await PPCImportService.updatePreviewMachines(
      req.params.sessionId,
      assignments.map((a) => ({
        batchNumber: a.batchNumber,
        machineCode: (['6HI', '4HI', '2HI'].includes(a.machineCode) ? a.machineCode : '6HI') as '6HI' | '4HI' | '2HI',
      })),
    );
    res.json({ rows });
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'Machine update failed' });
  }
});

router.post('/import/ppc/preview/:sessionId/commit', denyPlantHeadPpc('PPC_PREVIEW_COMMIT'), requireRole([UserRole.ADMIN, UserRole.MACHINE_HEAD]), async (req, res) => {
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

router.post('/orders/transfer-machine', denyPlantHeadPpc('PPC_TRANSFER_MACHINE'), requireRole([UserRole.ADMIN, UserRole.MACHINE_HEAD]), async (req, res) => {
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
    const results = await SixHiService.transferMachines(
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
    const data = await SixHiService.getStoppageCategories();
    res.json(data);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Failed to load categories' });
  }
});

router.get('/master/defect-codes', requireSixHi('READ'), async (_req, res) => {
  try {
    const data = await SixHiService.getDefectCodes();
    res.json(data);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Failed to load defect codes' });
  }
});

router.post('/master/defect-codes', requireSixHi('WRITE'), async (req, res) => {
  try {
    const data = await SixHiService.saveDefectCode(req.body);
    res.json(data);
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'Failed to save defect code' });
  }
});

router.patch('/master/defect-codes/:code/toggle', requireSixHi('WRITE'), async (req, res) => {
  try {
    const data = await SixHiService.toggleDefectCode(req.params.code, req.body.isActive);
    res.json(data);
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'Failed to toggle defect code' });
  }
});

router.post('/master/stoppage-categories', requireSixHi('WRITE'), async (req, res) => {
  try {
    const data = await SixHiService.saveStoppageCategory(req.body);
    res.json(data);
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'Failed to save stoppage category' });
  }
});

router.patch('/master/stoppage-categories/:code/toggle', requireSixHi('WRITE'), async (req, res) => {
  try {
    const data = await SixHiService.toggleStoppageCategory(req.params.code, req.body.isActive);
    res.json(data);
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'Failed to toggle stoppage category' });
  }
});

router.post('/master/stoppage-codes', requireSixHi('WRITE'), async (req, res) => {
  try {
    const data = await SixHiService.saveStoppageCode(req.body);
    res.json(data);
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'Failed to save stoppage code' });
  }
});

router.patch('/master/stoppage-codes/:code/toggle', requireSixHi('WRITE'), async (req, res) => {
  try {
    const data = await SixHiService.toggleStoppageCode(req.params.code, req.body.isActive);
    res.json(data);
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'Failed to toggle stoppage code' });
  }
});

router.get('/active-order', requireSixHi('READ'), async (req, res) => {
  try {
    const machine = String(req.query.machine ?? '6HI').toUpperCase();
    const active = await SixHiService.findActiveMachineOrder(parseCrmMillCode(machine) ?? '6HI');
    res.json(active);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Failed to load active order' });
  }
});

router.get('/queue', requireSixHi('READ'), async (req, res) => {
  try {
    const subProcess = String(req.query.subProcess ?? 'ROLLING').toUpperCase().replace(' ', '_');
    const planDate = String(req.query.date ?? new Date().toISOString().slice(0, 10));
    const shiftCode = String(req.query.shift ?? 'B').toUpperCase();
    const machine = String(req.query.machine ?? '6HI').toUpperCase();
    if (!['ROLLING', 'SKIN_PASS'].includes(subProcess)) {
      return res.status(400).json({ error: 'subProcess must be ROLLING or SKIN_PASS' });
    }
    const parsedMachine = parseCrmMillCode(machine);
    if (!parsedMachine) {
      return res.status(400).json({ error: 'machine must be 6HI, 4HI, or 2HI' });
    }
    const result = await SixHiService.getQueue(
      subProcess as 'ROLLING' | 'SKIN_PASS',
      planDate,
      shiftCode,
      parsedMachine,
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

router.get('/orders/:batchNo', requireSixHi('READ'), async (req, res) => {
  try {
    const order = await SixHiService.getOrder(req.params.batchNo, req.user!.id);
    res.json(order);
  } catch (e: unknown) {
    res.status(404).json({ error: e instanceof Error ? e.message : 'Order not found' });
  }
});

router.post('/orders/:batchNo/allocate-machine', requireSixHi('WRITE'), async (req, res) => {
  try {
    const machineCode = String(req.body?.machineCode ?? '').trim();
    if (!machineCode) return res.status(400).json({ error: 'machineCode required' });
    const order = await SixHiService.allocateMachine(
      req.params.batchNo,
      machineCode,
      req.user!.id,
    );
    res.json(order);
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'Machine allocation failed' });
  }
});

router.post('/orders/transfer-machines', requireSixHi('WRITE'), async (req, res) => {
  try {
    const { batchNumbers, machineCode } = req.body;
    if (!Array.isArray(batchNumbers) || batchNumbers.length === 0) {
      return res.status(400).json({ error: 'batchNumbers array required' });
    }
    if (!machineCode) return res.status(400).json({ error: 'machineCode required' });
    
    const results = await SixHiService.transferMachines(
      batchNumbers,
      machineCode as any,
      req.user!.id,
      req.user!.roles
    );
    res.json({ results });
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'Bulk transfer failed' });
  }
});

router.post('/orders/:batchNo/start', requireSixHi('WRITE'), async (req, res) => {
  try {
    const order = await SixHiService.startProduction(req.params.batchNo, req.user!.id);
    res.json(order);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Start failed';
    if (msg.startsWith('ACTIVE_ORDER_CONFLICT:')) {
      const batch = await db.selectFrom('planning.ppc_batch')
        .select('machine_code')
        .where('batch_number', '=', req.params.batchNo)
        .executeTakeFirst();
      const mc = batch?.machine_code ?? '6HI';
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
    const order = await SixHiService.endProduction(req.params.batchNo, req.user!.id, defectCodes);
    res.json(order);
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'End failed' });
  }
});

router.patch('/orders/:batchNo/rolling', requireSixHi('WRITE'), async (req, res) => {
  const parsed = SixHiRollingUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const order = await SixHiService.updateRolling(req.params.batchNo, {
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
    const order = await SixHiService.updateSkinPass(req.params.batchNo, parsed.data, req.user!.id);
    res.json(order);
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'Update failed' });
  }
});

router.post('/orders/:batchNo/stoppages/start', requireSixHi('WRITE'), async (req, res) => {
  try {
    // Default to '12' (Operational) to start the timer immediately
    const order = await SixHiService.addStoppage(req.params.batchNo, '12', undefined, undefined, req.user!.id);
    res.json(order);
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'Stoppage start failed' });
  }
});

router.post('/orders/:batchNo/stoppages', requireSixHi('WRITE'), async (req, res) => {
  const parsed = SixHiOrderStoppageSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const order = await SixHiService.addStoppage(
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
    const order = await SixHiService.updateStoppage(
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
    const order = await SixHiService.endStoppage(req.params.batchNo, req.params.stoppageId, req.user!.id);
    res.json(order);
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'End stoppage failed' });
  }
});

router.post('/orders/:batchNo/reject', requireSixHi('WRITE'), async (req, res) => {
  try {
    const { defectCodes, remarks } = req.body;
    if (!Array.isArray(defectCodes)) {
      return res.status(400).json({ error: 'defectCodes must be an array of strings' });
    }
    const order = await SixHiService.rejectOrder(req.params.batchNo, defectCodes, remarks, req.user!.id);
    res.json(order);
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'Order rejection failed' });
  }
});

router.post('/orders/:batchNo/remarks', requireSixHi('WRITE'), async (req, res) => {
  const parsed = SixHiRemarkSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const order = await SixHiService.addRemark(req.params.batchNo, parsed.data.text, req.user!.id);
    res.json(order);
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'Remark failed' });
  }
});

router.post('/orders/:batchNo/roll-change', requireSixHi('WRITE'), async (req, res) => {
  const parsed = SixHiRollChangeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const order = await SixHiService.logRollChange(
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
    const summary = await SixHiService.getShiftSummary(req.params.shiftLogId);
    res.json(summary);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Summary failed' });
  }
});

router.post('/shift-summary/:shiftLogId', requireSixHi('WRITE'), async (req, res) => {
  const parsed = SixHiShiftSummarySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const summary = await SixHiService.saveShiftSummary(
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
