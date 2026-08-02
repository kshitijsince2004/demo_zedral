import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/authMiddleware';
import { assertLineOperation } from '../auth/lineAccessPolicy';
import { ProcessStationService } from '../services/ProcessStationService';

const router = Router();

function requireProcess(processParam: string) {
  return ProcessStationService.assertProcessCode(processParam);
}

const pklChartSchema = z.object({
  shiftLogId: z.string().min(1),
  chartTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  tanks: z.array(z.object({
    tankNo: z.number().int().min(1).max(3),
    tankLevel: z.number().optional(),
    tankTempDegc: z.number().optional(),
    acidStrengthPct: z.number().optional(),
    ironStrengthPct: z.number().optional(),
  })),
  line: z.object({
    steamInletKgcm2: z.number().optional(),
    steamOutletKgcm2: z.number().optional(),
    steamOutletBurnerKgcm2: z.number().optional(),
    dosageAcid: z.number().optional(),
    dosageWater: z.number().optional(),
    dosageInhibitor: z.number().optional(),
    rinseCl: z.number().optional(),
    rinsePh: z.number().optional(),
    rinseFlow: z.number().optional(),
    rinseTempDegc: z.number().optional(),
    rinseAcidPct: z.number().optional(),
    rinseIronPct: z.number().optional(),
    burnerPressureKgcm2: z.number().optional(),
    hotAirTempDegc: z.number().optional(),
    lineIncharge: z.string().optional(),
  }).optional(),
});

const annChargeSchema = z.object({
  action: z.enum(['create', 'roster', 'transition', 'disposition', 'advance-stage', 'skip-stage', 'reading', 'stoppage-start', 'stoppage-end']),
  chargeNo: z.string().optional(),
  baseNo: z.string().optional(),
  shiftLogId: z.string().optional(),
  furnaceId: z.number().optional(),
  coolingHoodId: z.number().optional(),
  annealingBatchNo: z.string().optional(),
  soakTempDegc: z.number().optional(),
  soakTimeHr: z.number().optional(),
  gradeCode: z.string().optional(),
  coilNo: z.string().optional(),
  seqNo: z.number().optional(),
  coils: z.array(z.object({ coilNo: z.string(), seqNo: z.number().optional() })).optional(),
  disposition: z.enum(['ADVANCE', 'HOLD', 'REJECT']).optional(),
  unloadRemark: z.string().optional(),
  stageCode: z.string().optional(),
  skipReason: z.string().optional(),
  authorizedBy: z.number().optional(),
  transitionTempDegc: z.number().optional(),
  status: z.enum(['IN_PROCESS', 'FOR_ANN', 'RW', 'DONE']).optional(),
  dewPointN2: z.number().optional(),
  dewPointH2: z.number().optional(),
  temperatureDegc: z.number().optional(),
  shiftCode: z.string().optional(),
  chargeTemp: z.number().optional(),
  gasTemp: z.number().optional(),
  fcTemp: z.number().optional(),
  n2h2Flow: z.number().optional(),
  basePress: z.number().optional(),
  baseFanRpm: z.number().optional(),
  fuelFlow: z.number().optional(),
  rcfRpm: z.number().optional(),
  categoryCode: z.string().optional(),
  reason: z.string().optional(),
  remark: z.string().optional(),
  stoppageId: z.coerce.string().optional(),
});

router.get('/pkl/chart/:shiftLogId', requireAuth, async (req, res) => {
  try {
    assertLineOperation(req.user!, 'PKL', 'READ');
    const rows = await ProcessStationService.getPklChart(req.params.shiftLogId);
    res.json({ rows });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Chart load failed' });
  }
});

router.post('/pkl/chart', requireAuth, async (req, res) => {
  try {
    assertLineOperation(req.user!, 'PKL', 'WRITE');
    const parsed = pklChartSchema.parse(req.body);
    await ProcessStationService.upsertPklChart(parsed.shiftLogId, parsed.chartTime, parsed.tanks, parsed.line);
    res.status(201).json({ ok: true });
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'Chart save failed' });
  }
});

router.get('/pkl/shift-metrics/:shiftLogId', requireAuth, async (req, res) => {
  try {
    assertLineOperation(req.user!, 'PKL', 'READ');
    res.json(await ProcessStationService.getPklShiftMetrics(req.params.shiftLogId));
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Metrics failed' });
  }
});

router.get('/pkl/spec-limits', requireAuth, async (req, res) => {
  try {
    assertLineOperation(req.user!, 'PKL', 'READ');
    res.json({ limits: await ProcessStationService.listPklSpecLimits() });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Spec limits failed' });
  }
});

router.post('/pkl/spec-limits', requireAuth, async (req, res) => {
  try {
    assertLineOperation(req.user!, 'PKL', 'WRITE');
    await ProcessStationService.upsertPklSpecLimit({
      paramKey: String(req.body?.paramKey ?? ''),
      tankScope: String(req.body?.tankScope ?? 'LINE'),
      minVal: req.body?.minVal != null ? Number(req.body.minVal) : null,
      maxVal: req.body?.maxVal != null ? Number(req.body.maxVal) : null,
      unit: req.body?.unit ?? null,
      isActive: req.body?.isActive !== false,
    });
    res.status(201).json({ ok: true });
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'Upsert failed' });
  }
});

/** Soft-delete via is_active=false (ponytail: no hard DELETE). */
router.delete('/pkl/spec-limits', requireAuth, async (req, res) => {
  try {
    assertLineOperation(req.user!, 'PKL', 'WRITE');
    await ProcessStationService.upsertPklSpecLimit({
      paramKey: String(req.body?.paramKey ?? req.query?.paramKey ?? ''),
      tankScope: String(req.body?.tankScope ?? req.query?.tankScope ?? 'LINE'),
      isActive: false,
    });
    res.json({ ok: true });
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'Delete failed' });
  }
});

router.get('/pkl/shift-review', requireAuth, async (req, res) => {
  try {
    assertLineOperation(req.user!, 'PKL', 'READ');
    const shiftLogId = String(req.query.shiftLogId ?? '');
    if (!shiftLogId) return res.status(400).json({ error: 'shiftLogId required' });
    res.json(await ProcessStationService.getPklShiftReview(shiftLogId));
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'PKL shift review failed' });
  }
});

router.get('/pkl/chart-config', requireAuth, async (req, res) => {
  try {
    assertLineOperation(req.user!, 'PKL', 'READ');
    res.json({ config: await ProcessStationService.getPklChartConfig() });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Config failed' });
  }
});

router.post('/pkl/chart-config', requireAuth, async (req, res) => {
  try {
    assertLineOperation(req.user!, 'PKL', 'WRITE');
    const hours = Number(req.body?.intervalHours ?? 2);
    const labels = Array.isArray(req.body?.readingLabels) ? req.body.readingLabels.map(String) : undefined;
    await ProcessStationService.setPklChartConfig(hours, labels);
    res.json({ ok: true });
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'Config save failed' });
  }
});

router.get('/ann/charges', requireAuth, async (req, res) => {
  try {
    assertLineOperation(req.user!, 'ANN', 'READ');
    const charges = await ProcessStationService.getAnnCharges();
    res.json({ charges });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Charge board failed' });
  }
});

router.get('/ann/charges/:chargeNo', requireAuth, async (req, res) => {
  try {
    assertLineOperation(req.user!, 'ANN', 'READ');
    const detail = await ProcessStationService.getAnnChargeDetail(req.params.chargeNo);
    if (!detail) return res.status(404).json({ error: 'Charge not found' });
    res.json(detail);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Charge detail failed' });
  }
});

router.get('/ann/spec-limits', requireAuth, async (req, res) => {
  try {
    assertLineOperation(req.user!, 'ANN', 'READ');
    res.json({ limits: await ProcessStationService.listAnnSpecLimits() });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Spec limits failed' });
  }
});

router.post('/ann/spec-limits', requireAuth, async (req, res) => {
  try {
    assertLineOperation(req.user!, 'ANN', 'WRITE');
    await ProcessStationService.upsertAnnSpecLimit({
      paramKey: String(req.body?.paramKey ?? ''),
      scope: String(req.body?.scope ?? 'ALL'),
      minVal: req.body?.minVal != null ? Number(req.body.minVal) : null,
      maxVal: req.body?.maxVal != null ? Number(req.body.maxVal) : null,
      unit: req.body?.unit ?? null,
      isActive: req.body?.isActive !== false,
    });
    res.status(201).json({ ok: true });
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'Upsert failed' });
  }
});

router.get('/ann/bases', requireAuth, async (req, res) => {
  try {
    assertLineOperation(req.user!, 'ANN', 'READ');
    res.json({ bases: await ProcessStationService.listAnnBases() });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Bases failed' });
  }
});

router.post('/ann/bases', requireAuth, async (req, res) => {
  try {
    assertLineOperation(req.user!, 'ANN', 'WRITE');
    const baseNo = await ProcessStationService.createAnnBase({
      baseNo: String(req.body?.baseNo ?? ''),
      capacityMaxCoils: req.body?.capacityMaxCoils != null ? Number(req.body.capacityMaxCoils) : null,
      capacityMaxWtMt: req.body?.capacityMaxWtMt != null ? Number(req.body.capacityMaxWtMt) : null,
      capacityMaxHeightMm: req.body?.capacityMaxHeightMm != null ? Number(req.body.capacityMaxHeightMm) : null,
      soakTimeAdjHr: req.body?.soakTimeAdjHr != null ? Number(req.body.soakTimeAdjHr) : null,
    });
    res.status(201).json({ baseNo });
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'Create base failed' });
  }
});

router.get('/ann/shift-review', requireAuth, async (req, res) => {
  try {
    assertLineOperation(req.user!, 'ANN', 'READ');
    const shiftLogId = String(req.query.shiftLogId ?? '');
    if (!shiftLogId) return res.status(400).json({ error: 'shiftLogId required' });
    res.json(await ProcessStationService.getAnnShiftReview(shiftLogId));
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'ANN shift review failed' });
  }
});

router.get('/ann/stoppage-categories', requireAuth, async (req, res) => {
  try {
    assertLineOperation(req.user!, 'ANN', 'READ');
    res.json({ categories: await ProcessStationService.listAnnStoppageCategories() });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Stoppage categories failed' });
  }
});

router.get('/ann/board', requireAuth, async (req, res) => {
  try {
    assertLineOperation(req.user!, 'ANN', 'READ');
    res.json({ board: await ProcessStationService.getAnnBoard() });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Board failed' });
  }
});

router.post('/ann/charges', requireAuth, async (req, res) => {
  try {
    assertLineOperation(req.user!, 'ANN', 'WRITE');
    const body = annChargeSchema.parse(req.body);

    if (body.action === 'create') {
      if (!body.chargeNo || !body.shiftLogId) {
        return res.status(400).json({ error: 'chargeNo and shiftLogId required' });
      }
      const chargeNo = await ProcessStationService.createAnnCharge({
        chargeNo: body.chargeNo,
        baseNo: body.baseNo,
        shiftLogId: body.shiftLogId,
        furnaceId: body.furnaceId,
        coolingHoodId: body.coolingHoodId,
        annealingBatchNo: body.annealingBatchNo,
        soakTempDegc: body.soakTempDegc,
        soakTimeHr: body.soakTimeHr,
        gradeCode: body.gradeCode,
        coils: body.coils,
      });
      return res.status(201).json({ chargeNo });
    }

    if (body.action === 'roster') {
      if (!body.chargeNo || !body.coilNo) {
        return res.status(400).json({ error: 'chargeNo and coilNo required' });
      }
      await ProcessStationService.rosterAnnCoil(body.chargeNo, body.coilNo, body.seqNo);
      return res.json({ ok: true });
    }

    if (body.action === 'disposition') {
      if (!body.chargeNo || !body.coilNo || !body.disposition) {
        return res.status(400).json({ error: 'chargeNo, coilNo, disposition required' });
      }
      await ProcessStationService.setAnnCoilDisposition(body.chargeNo, body.coilNo, body.disposition, body.unloadRemark);
      return res.json({ ok: true });
    }

    if (body.action === 'advance-stage') {
      if (!body.chargeNo) return res.status(400).json({ error: 'chargeNo required' });
      const result = await ProcessStationService.advanceAnnStage(body.chargeNo, {
        transitionTempDegc: body.transitionTempDegc,
        userId: req.user?.id ? Number(req.user.id) : undefined,
      });
      return res.json(result);
    }

    if (body.action === 'skip-stage') {
      if (!body.chargeNo || !body.stageCode || body.authorizedBy == null) {
        return res.status(400).json({ error: 'chargeNo, stageCode, authorizedBy required' });
      }
      await ProcessStationService.skipAnnStage(body.chargeNo, body.stageCode, {
        authorizedBy: body.authorizedBy,
        reason: body.skipReason,
      });
      return res.json({ ok: true });
    }

    if (body.action === 'reading') {
      if (!body.chargeNo) return res.status(400).json({ error: 'chargeNo required' });
      await ProcessStationService.appendAnnReading({
        chargeNo: body.chargeNo,
        baseNo: body.baseNo,
        shiftCode: body.shiftCode,
        operatorUserId: req.user?.id ? Number(req.user.id) : undefined,
        chargeTemp: body.chargeTemp,
        gasTemp: body.gasTemp,
        fcTemp: body.fcTemp,
        n2h2Flow: body.n2h2Flow,
        basePress: body.basePress,
        baseFanRpm: body.baseFanRpm,
        fuelFlow: body.fuelFlow,
        rcfRpm: body.rcfRpm,
      });
      return res.status(201).json({ ok: true });
    }

    if (body.action === 'stoppage-start') {
      if (!body.chargeNo || !body.categoryCode) {
        return res.status(400).json({ error: 'chargeNo and categoryCode required' });
      }
      await ProcessStationService.startAnnStoppage({
        chargeNo: body.chargeNo,
        categoryCode: body.categoryCode,
        reason: body.reason,
        remark: body.remark,
        baseNo: body.baseNo,
      });
      return res.status(201).json({ ok: true });
    }

    if (body.action === 'stoppage-end') {
      if (!body.stoppageId) return res.status(400).json({ error: 'stoppageId required' });
      await ProcessStationService.endAnnStoppage(body.stoppageId);
      return res.json({ ok: true });
    }

    if (body.action === 'transition') {
      if (!body.chargeNo || !body.status) {
        return res.status(400).json({ error: 'chargeNo and status required' });
      }
      await ProcessStationService.transitionAnnCharge(body.chargeNo, body.status, {
        furnaceId: body.furnaceId,
        dewPointN2: body.dewPointN2,
        dewPointH2: body.dewPointH2,
        temperatureDegc: body.temperatureDegc,
      });
      return res.json({ ok: true });
    }

    res.status(400).json({ error: 'Unknown action' });
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'Charge action failed' });
  }
});

// Specific /crs/* routes before /:process/* so "crs" is not treated as a process param only.
router.get('/hrs/shift-metrics/:shiftLogId', requireAuth, async (req, res) => {
  try {
    assertLineOperation(req.user!, 'HRS', 'READ');
    const metrics = await ProcessStationService.getHrsShiftMetrics(req.params.shiftLogId);
    res.json(metrics);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Metrics failed' });
  }
});

router.get('/crs/shift-metrics/:shiftLogId', requireAuth, async (req, res) => {
  try {
    assertLineOperation(req.user!, 'CRS', 'READ');
    const metrics = await ProcessStationService.getCrsShiftMetrics(req.params.shiftLogId);
    res.json(metrics);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Metrics failed' });
  }
});

router.get('/crs/assignment', requireAuth, async (req, res) => {
  try {
    assertLineOperation(req.user!, 'CRS', 'READ');
    const rows = await ProcessStationService.listCrsAssignmentBoard();
    res.json({ rows });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Assignment board failed' });
  }
});

router.post('/crs/assignment', requireAuth, async (req, res) => {
  try {
    assertLineOperation(req.user!, 'CRS', 'WRITE');
    const batchId = String(req.body?.batchId ?? '');
    const machineCode = String(req.body?.machineCode ?? '');
    const overrideReason = req.body?.overrideReason ? String(req.body.overrideReason) : undefined;
    const result = await ProcessStationService.assignCrsMachine(batchId, machineCode, overrideReason);
    res.json(result);
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'Assign failed' });
  }
});

router.get('/:process/queue', requireAuth, async (req, res) => {
  try {
    const code = requireProcess(req.params.process);
    assertLineOperation(req.user!, code, 'READ');
    const cards = await ProcessStationService.getQueue(code, req.user!.id);
    res.json({ queue: cards });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Queue load failed';
    const status = msg.includes('Forbidden') ? 403 : msg.includes('Unknown') ? 400 : 500;
    res.status(status).json({ error: msg });
  }
});

router.get('/:process/entry/:coilNo', requireAuth, async (req, res) => {
  try {
    const code = requireProcess(req.params.process);
    assertLineOperation(req.user!, code, 'READ');
    const prefill = await ProcessStationService.getEntryPrefill(code, req.params.coilNo);
    res.json(prefill);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Prefill failed';
    res.status(500).json({ error: msg });
  }
});

router.post('/:process/manual', requireAuth, async (req, res) => {
  try {
    const code = requireProcess(req.params.process);
    assertLineOperation(req.user!, code, 'WRITE');
    const result = await ProcessStationService.createManualCoil(code, req.body, req.user!.id);
    res.status(201).json(result);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Manual coil creation failed';
    res.status(400).json({ error: msg });
  }
});

router.get('/:process/shift/:shiftLogId/stoppages', requireAuth, async (req, res) => {
  try {
    const code = requireProcess(req.params.process);
    assertLineOperation(req.user!, code, 'READ');
    res.json(await ProcessStationService.listShiftStoppages(code, String(req.params.shiftLogId)));
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Stoppage history failed' });
  }
});

router.post('/:process/start', requireAuth, async (req, res) => {
  try {
    const code = requireProcess(req.params.process);
    assertLineOperation(req.user!, code, 'WRITE');
    const coilNo = String(req.body?.coilNo ?? '');
    if (!coilNo) return res.status(400).json({ error: 'coilNo required' });
    res.json(await ProcessStationService.startCoil(code, coilNo, req.user!.id));
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'Start failed' });
  }
});

router.post('/:process/stoppages/start', requireAuth, async (req, res) => {
  try {
    const code = requireProcess(req.params.process);
    assertLineOperation(req.user!, code, 'WRITE');
    const { StoppageService } = await import('../services/StoppageService');
    const stoppageId = await StoppageService.startOpen({
      shiftLogId: String(req.body?.shiftLogId ?? ''),
      stoppageCode: String(req.body?.stoppageCode ?? ''),
      remarks: req.body?.remarks ? String(req.body.remarks) : undefined,
      machineCode: code,
    }, String(req.user!.id));
    res.status(201).json({ stoppageId });
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'Stoppage start failed' });
  }
});

router.post('/:process/stoppages/:stoppageId/end', requireAuth, async (req, res) => {
  try {
    const code = requireProcess(req.params.process);
    assertLineOperation(req.user!, code, 'WRITE');
    const { StoppageService } = await import('../services/StoppageService');
    const stoppageId = await StoppageService.endOpen(String(req.params.stoppageId));
    res.json({ stoppageId });
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'Stoppage end failed' });
  }
});

router.post('/:process/hold', requireAuth, async (req, res) => {
  try {
    const code = requireProcess(req.params.process);
    assertLineOperation(req.user!, code, 'WRITE');
    const coilNo = String(req.body?.coilNo ?? '');
    if (!coilNo) return res.status(400).json({ error: 'coilNo required' });
    const remarks = String(req.body?.remarks ?? 'Operator hold');
    const reason = String(req.body?.reason ?? req.body?.rejectionReason ?? 'HOLD');
    res.json(await ProcessStationService.holdCoil(code, coilNo, req.user!.id, reason, remarks));
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'Hold failed' });
  }
});

export default router;
