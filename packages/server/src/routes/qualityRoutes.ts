import { Router } from 'express';
import { UserRole } from '@m1/shared-validation';
import { requireAuth, requireRole } from '../middleware/authMiddleware';
import { SpecResolverService } from '../services/SpecResolverService';
import { SpecFetchService } from '../services/SpecFetchService';
import { QualitySpecService } from '../services/QualitySpecService';
import { ProcessSheetService } from '../services/ProcessSheetService';

const router = Router();
router.use(requireAuth);

const qualityWrite = requireRole([UserRole.QUALITY, UserRole.ADMIN]);
const qualityRead = requireRole([
  UserRole.OPERATOR,
  UserRole.MACHINE_HEAD,
  UserRole.QUALITY,
  UserRole.PLANT_HEAD,
  UserRole.ADMIN,
]);

router.get('/parameters', qualityWrite, async (_req, res) => {
  const rows = await QualitySpecService.listParameters();
  res.json(rows);
});

router.post('/parameters', qualityWrite, async (req, res) => {
  const row = await QualitySpecService.upsertParameter(req.body);
  res.status(201).json(row);
});

router.patch('/parameters/:code', qualityWrite, async (req, res) => {
  // Tier 2: applies_to changes require reason (recorded via body for audit payload)
  if (req.body?.appliesTo != null || req.body?.applies_to != null) {
    if (!String(req.body?.changeReason ?? req.body?.reason ?? '').trim()) {
      return res.status(400).json({ error: 'changeReason required when updating applies_to' });
    }
  }
  const row = await QualitySpecService.upsertParameter({
    ...req.body,
    parameterCode: req.params.code,
  });
  res.json(row);
});

router.get('/parameters/:code/blast-radius', qualityWrite, async (req, res) => {
  res.json(await QualitySpecService.parameterBlastRadius(req.params.code));
});

router.post('/parameters/:code/retire', qualityWrite, async (req, res) => {
  const confirm = String(req.body?.confirm ?? '');
  if (confirm !== req.params.code) {
    return res.status(400).json({ error: 'Type the parameter code to confirm retire' });
  }
  res.json(await QualitySpecService.retireParameter(req.params.code));
});

router.get('/specs', qualityWrite, async (req, res) => {
  const rows = await QualitySpecService.listSpecs({
    gradeCode: req.query.grade ? String(req.query.grade) : undefined,
    customerId: req.query.customer != null ? Number(req.query.customer) : undefined,
    status: req.query.status ? String(req.query.status) : undefined,
  });
  res.json(rows);
});

router.post('/specs', qualityWrite, async (req, res) => {
  try {
    const created = await QualitySpecService.createSpec(req.body, String(req.user?.id ?? 'SYSTEM'));
    res.status(201).json(created);
  } catch (e: unknown) {
    res.status(409).json({ error: e instanceof Error ? e.message : 'Create failed' });
  }
});

router.get('/specs/:id', qualityWrite, async (req, res) => {
  const detail = await QualitySpecService.getSpecDetail(Number(req.params.id));
  if (!detail) return res.status(404).json({ error: 'Spec not found' });
  res.json(detail);
});

router.post('/specs/:id/retire', qualityWrite, async (req, res) => {
  const confirm = String(req.body?.confirm ?? '');
  const detail = await QualitySpecService.getSpecDetail(Number(req.params.id));
  if (!detail) return res.status(404).json({ error: 'Spec not found' });
  if (confirm !== detail.sheet.grade_code) {
    return res.status(400).json({ error: 'Type the grade_code to confirm retire' });
  }
  res.json(await QualitySpecService.retireSpec(Number(req.params.id)));
});

router.get('/specs/:id/versions', qualityWrite, async (req, res) => {
  const rows = await QualitySpecService.listVersions(Number(req.params.id));
  res.json(rows);
});

router.post('/specs/:id/versions', qualityWrite, async (req, res) => {
  const created = await QualitySpecService.createDraftVersion(
    Number(req.params.id),
    req.body,
    String(req.user?.id ?? 'SYSTEM'),
  );
  res.status(201).json(created);
});

router.get('/versions/:versionId', qualityWrite, async (req, res) => {
  const detail = await QualitySpecService.getVersionDetail(Number(req.params.versionId));
  if (!detail) return res.status(404).json({ error: 'Version not found' });
  res.json(detail);
});

router.put('/versions/:versionId', qualityWrite, async (req, res) => {
  try {
    const updated = await QualitySpecService.updateDraftValues(Number(req.params.versionId), req.body?.values ?? []);
    res.json(updated);
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'Update failed' });
  }
});

router.post('/versions/:versionId/publish', qualityWrite, async (req, res) => {
  try {
    const published = await QualitySpecService.publishVersion(
      Number(req.params.versionId),
      String(req.user?.id ?? 'SYSTEM'),
    );
    res.json(published);
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'Publish failed' });
  }
});

router.get('/versions/:versionId/where-used', qualityWrite, async (req, res) => {
  const used = await QualitySpecService.whereUsed(Number(req.params.versionId));
  res.json(used);
});

router.get('/resolve', qualityRead, async (req, res) => {
  if (req.query.sapOrder) {
    const snap = await SpecResolverService.resolveForSapOrder(String(req.query.sapOrder));
    if (snap) return res.json({ ...snap, mode: 'snapshot' });
  }
  const resolved = await SpecResolverService.resolve({
    gradeCode: String(req.query.grade ?? ''),
    customerId: req.query.customer != null && req.query.customer !== '' ? Number(req.query.customer) : null,
    materialCode: req.query.material != null ? String(req.query.material) : '',
    surfaceFinish: req.query.surface != null ? String(req.query.surface) : null,
    widthMm: req.query.width != null && req.query.width !== '' ? Number(req.query.width) : null,
    finishThkMm: req.query.thk != null && req.query.thk !== '' ? Number(req.query.thk) : null,
    lengthMm: req.query.length != null && req.query.length !== '' ? Number(req.query.length) : null,
    atTime: req.query.at ? new Date(String(req.query.at)) : undefined,
  });
  res.json(resolved ? { ...resolved, mode: 'resolved' } : null);
});

router.get('/orders/:planOrderId/spec', qualityRead, async (req, res) => {
  const resolved = await SpecResolverService.resolveForOrder(req.params.planOrderId);
  res.json(resolved);
});

router.put('/orders/:planOrderId/spec', qualityWrite, async (req, res) => {
  try {
    const versionId = Number(req.body?.versionId ?? req.body?.version_id);
    const reason = String(req.body?.overrideReason ?? req.body?.override_reason ?? '');
    if (!Number.isFinite(versionId)) {
      return res.status(400).json({ error: 'versionId required' });
    }
    const row = await QualitySpecService.repinOrderSpec(
      req.params.planOrderId,
      versionId,
      reason,
      String(req.user?.id ?? 'SYSTEM'),
    );
    res.json(row);
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'Re-pin failed' });
  }
});

router.post('/orders/:planOrderId/spec/attach', qualityWrite, async (req, res) => {
  try {
    const row = await QualitySpecService.attachResolvedSpec(
      req.params.planOrderId,
      String(req.user?.id ?? 'SYSTEM'),
      { force: Boolean(req.body?.force) },
    );
    if (!row) return res.status(404).json({ error: 'No matching ACTIVE spec for this order' });
    res.json(row);
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'Attach failed' });
  }
});

router.get('/fetch', qualityRead, async (req, res) => {
  const by = String(req.query.by ?? 'grade+customer') as 'order' | 'grade+customer' | 'sheet' | 'coil';
  const groups = req.query.groups ? String(req.query.groups).split(',').filter(Boolean) : undefined;
  const parameters = req.query.parameters
    ? String(req.query.parameters).split(',').filter(Boolean)
    : undefined;
  const projection = req.query.projection
    ? String(req.query.projection).split(',').filter(Boolean)
    : undefined;
  const rows = await SpecFetchService.fetch({
    by,
    orderId: req.query.orderId as string | undefined,
    coilNo: req.query.coilNo ? String(req.query.coilNo) : undefined,
    gradeCode: req.query.grade ? String(req.query.grade) : undefined,
    customerId: req.query.customer != null && req.query.customer !== '' ? Number(req.query.customer) : null,
    process: req.query.process ? String(req.query.process) : undefined,
    groups,
    parameters,
    projection,
    mode: (req.query.mode as 'resolved' | 'snapshot' | 'draft') || 'resolved',
    mandatoryOnly: req.query.mandatoryOnly === 'true',
  });
  res.json(rows);
});

router.post('/fetch/batch', qualityRead, async (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  res.json(await SpecFetchService.fetchBatch(items));
});

router.get('/qc-measurements', qualityRead, async (req, res) => {
  const rows = await QualitySpecService.listQcMeasurements({
    coilNo: req.query.coilNo ? String(req.query.coilNo) : undefined,
    processCode: req.query.process ? String(req.query.process) : undefined,
    verdict: req.query.verdict ? String(req.query.verdict) : undefined,
    limit: req.query.limit ? Number(req.query.limit) : 100,
  });
  res.json(rows);
});

router.post('/qc-measurements', qualityRead, async (req, res) => {
  const body = req.body ?? {};
  const versionId = body.versionId != null ? Number(body.versionId) : null;
  const measured = body.measuredValue ?? body.measuredValueNum ?? body.measuredValueText ?? null;
  const verdict = versionId
    ? await SpecResolverService.evaluate({
        versionId,
        parameterCode: String(body.parameterCode),
        measuredValue: measured,
      })
    : 'NOT_EVALUATED';
  const saved = await QualitySpecService.saveQcMeasurement({
    ...body,
    verdict,
    measuredBy: String(req.user?.id ?? 'SYSTEM'),
  });
  res.status(201).json(saved);
});

router.post('/qc-measurements/batch', qualityRead, async (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  const saved = [];
  for (const body of items.slice(0, 50)) {
    const versionId = body.versionId != null ? Number(body.versionId) : null;
    const measured = body.measuredValue ?? body.measuredValueNum ?? body.measuredValueText ?? null;
    const verdict = versionId
      ? await SpecResolverService.evaluate({
          versionId,
          parameterCode: String(body.parameterCode),
          measuredValue: measured,
        })
      : 'NOT_EVALUATED';
    saved.push(
      await QualitySpecService.saveQcMeasurement({
        ...body,
        verdict,
        measuredBy: String(req.user?.id ?? 'SYSTEM'),
      }),
    );
  }
  res.status(201).json(saved);
});

// ---- Process sheets (Phase 5) ----
router.get('/process-sheets', qualityWrite, async (req, res) => {
  res.json(
    await ProcessSheetService.list({
      gradeCode: req.query.grade ? String(req.query.grade) : undefined,
    }),
  );
});

router.get('/process-sheets/:id', qualityWrite, async (req, res) => {
  const detail = await ProcessSheetService.getDetail(Number(req.params.id));
  if (!detail) return res.status(404).json({ error: 'Not found' });
  res.json(detail);
});

router.post('/process-sheets', qualityWrite, async (req, res) => {
  try {
    const created = await ProcessSheetService.create(req.body, String(req.user?.id ?? 'SYSTEM'));
    res.status(201).json(created);
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'Create failed' });
  }
});

router.put('/process-sheets/steps/:stepId/checks', qualityWrite, async (req, res) => {
  const codes = Array.isArray(req.body?.parameterCodes) ? req.body.parameterCodes.map(String) : [];
  res.json(await ProcessSheetService.setStepChecks(Number(req.params.stepId), codes));
});

router.post('/process-sheets/:id/publish', qualityWrite, async (req, res) => {
  try {
    res.json(await ProcessSheetService.publish(Number(req.params.id)));
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'Publish failed' });
  }
});

router.post('/process-sheets/:id/retire', qualityWrite, async (req, res) => {
  res.json(await ProcessSheetService.retire(Number(req.params.id)));
});

export default router;
