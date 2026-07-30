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
    steamInletKgcm2: z.number().optional(),
    steamOutletKgcm2: z.number().optional(),
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
  })),
});

const annChargeSchema = z.object({
  action: z.enum(['create', 'roster', 'transition']),
  chargeNo: z.string().optional(),
  baseNo: z.string().optional(),
  shiftLogId: z.string().optional(),
  furnaceId: z.number().optional(),
  gradeCode: z.string().optional(),
  coilNo: z.string().optional(),
  seqNo: z.number().optional(),
  status: z.enum(['IN_PROCESS', 'FOR_ANN', 'RW', 'DONE']).optional(),
  dewPointN2: z.number().optional(),
  dewPointH2: z.number().optional(),
  temperatureDegc: z.number().optional(),
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
    await ProcessStationService.upsertPklChart(parsed.shiftLogId, parsed.chartTime, parsed.tanks);
    res.status(201).json({ ok: true });
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'Chart save failed' });
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
        gradeCode: body.gradeCode,
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

router.get('/:process/queue', requireAuth, async (req, res) => {
  try {
    const code = requireProcess(req.params.process);
    assertLineOperation(req.user!, code, 'READ');
    const cards = await ProcessStationService.getQueue(code);
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
    const result = await ProcessStationService.createManualCoil(code, req.body);
    res.status(201).json(result);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Manual coil creation failed';
    res.status(400).json({ error: msg });
  }
});

export default router;
