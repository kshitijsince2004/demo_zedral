import { Router } from 'express';
import { UserRole } from '@m1/shared-validation';
import { requireAuth, requireRole } from '../middleware/authMiddleware';
import { ExportService } from '../services/ExportService';
import { finalizeDprMonth } from '../export/jobs/DprMonthLock';
import { ExportJobService, parseExportRequest } from '../export/jobs/ExportJobService';
import type { ExportType } from '../export/types';

const router = Router();
router.use(require('express').json());
router.use(requireAuth);
router.use(requireRole([UserRole.SUPERVISOR, UserRole.PLANT_HEAD, UserRole.ADMIN]));

function httpStatusForJob(status: string): number {
  if (status === 'FAILED') return 500;
  if (status === 'PENDING' || status === 'PROCESSING') return 202;
  return 201;
}

async function runExport(req: any, res: any, body: Record<string, unknown>) {
  try {
    const view = await ExportService.createFromRequest(body, req.user!);
    const code = httpStatusForJob(view.status);
    if (code === 500) {
      return res.status(500).json({ error: view.error || 'Export failed', ...view });
    }
    res.status(code).json(view);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Export failed';
    const status = message.includes('Forbidden') ? 403 : 400;
    res.status(status).json({ error: message });
  }
}

router.get('/download/:jobId', async (req, res) => {
  try {
    const resolved = await ExportService.resolveDownload(req.params.jobId, req.user!);
    if (resolved.redirectUrl) {
      return res.redirect(resolved.redirectUrl);
    }
    const { filePath, format } = resolved;
    const isXlsx = format === 'XLSX';
    const isPdf = format === 'PDF';
    res.setHeader(
      'Content-Type',
      isPdf
        ? 'application/pdf'
        : isXlsx
          ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          : 'text/csv; charset=utf-8',
    );
    const ext = isPdf ? 'pdf' : isXlsx ? 'xlsx' : 'csv';
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="export_${req.params.jobId}.${ext}"`,
    );
    res.sendFile(filePath);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Download failed';
    const status =
      message === 'Export job not found' || message === 'Export file not found'
        ? 404
        : message.includes('Forbidden')
          ? 403
          : 400;
    res.status(status).json({ error: message });
  }
});

/** POST /exports — canonical trigger (reportingService.createExport). */
router.post('/', async (req, res) => {
  const body = req.body?.type
    ? req.body
    : { type: 'RAW', format: req.body.format, scope: req.body.scope ?? req.body };
  await runExport(req, res, body);
});

/** GET /exports/notifications — jobs completed in the last 60s (optional in-app alert). */
router.get('/notifications', async (req, res) => {
  try {
    const within = req.query.within ? Number(req.query.within) : 60;
    const jobs = await ExportJobService.listRecentCompletions(req.user!, within);
    res.json({ jobs });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to load notifications';
    res.status(500).json({ error: message });
  }
});

/** POST /exports/dpr/finalize — lock a DPR month from further overwrites. */
router.post('/dpr/finalize', async (req, res) => {
  try {
    const month = String(req.body?.month ?? '');
    await finalizeDprMonth(month, req.user!);
    res.json({ ok: true, month });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Finalize failed';
    const status = message.includes('Forbidden') ? 403 : 400;
    res.status(status).json({ error: message });
  }
});

/** GET /exports?list=1 — export job history with pagination. */
router.get('/', async (req, res) => {
  const q = req.query as Record<string, unknown>;
  if (q.list === '1' || q.history === '1') {
    try {
      const result = await ExportJobService.listJobs(req.user!, {
        type: q.type ? String(q.type).toUpperCase() as ExportType : undefined,
        from: q.from ? String(q.from) : undefined,
        to: q.to ? String(q.to) : undefined,
        page: q.page ? Number(q.page) : undefined,
        limit: q.limit ? Number(q.limit) : undefined,
      });
      return res.json(result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to list exports';
      return res.status(500).json({ error: message });
    }
  }

  const { scope, format } = ExportService.parseQueryParams(q);
  await runExport(req, res, parseExportRequest({ type: 'RAW', format, scope }) as unknown as Record<string, unknown>);
});

router.get(['/:jobId', '/status/:jobId'], async (req, res) => {
  try {
    const job = await ExportService.getJobView(req.params.jobId, req.user!);
    if (!job) return res.status(404).json({ error: 'Export job not found' });
    res.json(job);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to load job';
    const status = message.includes('Forbidden') ? 403 : 500;
    res.status(status).json({ error: message });
  }
});

export default router;
