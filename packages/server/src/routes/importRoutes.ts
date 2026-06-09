import { Router } from 'express';
import multer from 'multer';
import { UserRole } from '@m1/shared-validation';
import { requireAuth, requireRole } from '../middleware/authMiddleware';
import { ImportService } from '../services/ImportService';

function respondImportServerError(res: import('express').Response, error: unknown) {
  console.error('Import route error:', error);
  res.status(500).json({ error: 'Import failed' });
}

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.use(requireAuth);

/**
 * Accepts either:
 * - multipart/form-data with `file` + optional `source` (CSV/SAP)
 * - application/json with `{ fileName, rows }`
 */
router.post(
  '/',
  requireRole([UserRole.ADMIN]),
  upload.single('file'),
  async (req, res) => {
    try {
      let result;

      if (req.file) {
        const source = (req.body?.source === 'SAP' ? 'SAP' : 'CSV') as 'CSV' | 'SAP';
        const csvText = req.file.buffer.toString('utf-8');
        const importResult = await ImportService.importFromCsvText(
          source,
          req.file.originalname,
          csvText,
          req.user!.id,
        );

        if (importResult.headerError) {
          return res.status(400).json({ error: importResult.headerError });
        }
        result = importResult;
      } else {
        const { fileName, rows } = req.body;
        if (!rows || !Array.isArray(rows)) {
          return res.status(400).json({
            error: 'Provide a CSV file upload or a JSON body with a rows array',
          });
        }
        result = await ImportService.importFromJson(fileName || 'API_Upload', rows, req.user!.id);
      }

      const batch = await ImportService.getBatch(result.batchId);
      const status =
        result.status === 'PARTIAL' ? 207 : result.status === 'FAILED' ? 400 : 201;
      res.status(status).json(batch ?? result);
    } catch (error: unknown) {
      respondImportServerError(res, error);
    }
  },
);

router.get('/plans/:processId/:date', async (req, res) => {
  try {
    const plans = await ImportService.getPlansByProcess(
      req.params.processId,
      new Date(req.params.date),
    );
    res.json(plans);
  } catch (error: unknown) {
    respondImportServerError(res, error);
  }
});

router.get('/:batchId/error-rows', requireRole([UserRole.ADMIN]), async (req, res) => {
  try {
    const csv = await ImportService.getErrorRowsCsv(req.params.batchId);
    if (!csv) {
      return res.status(404).json({ error: 'No error rows for this batch' });
    }
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="import_errors_${req.params.batchId}.csv"`,
    );
    res.send(csv);
  } catch (error: unknown) {
    respondImportServerError(res, error);
  }
});

router.get('/:batchId', requireRole([UserRole.ADMIN]), async (req, res) => {
  try {
    const batch = await ImportService.getBatch(req.params.batchId);
    if (!batch) {
      return res.status(404).json({ error: 'Import batch not found' });
    }
    res.json(batch);
  } catch (error: unknown) {
    respondImportServerError(res, error);
  }
});

export default router;
