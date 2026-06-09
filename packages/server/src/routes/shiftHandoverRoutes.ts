import { Router } from 'express';
import { requireAuth } from '../middleware/authMiddleware';
import { ShiftLogService } from '../services/shiftLogService';
import { assertShiftLogAccess } from '../services/shiftLogAccessService';

const router = Router();
router.use(require('express').json());
router.use(requireAuth);

/** @deprecated Prefer GET /shift-logs/:id/handover/summary */
router.get('/:id/summary', async (req, res) => {
  try {
    await assertShiftLogAccess(req.user!, req.params.id, 'READ');
    const summary = await ShiftLogService.getHandoverSummary(req.params.id);
    res.json(summary);
  } catch (error: any) {
    const status = error.message?.includes('Forbidden') ? 403 : 404;
    res.status(status).json({ error: error.message });
  }
});

/** @deprecated Use POST /shift-logs/:id/handover with incoming badge + PIN attestation */
router.post('/:id/confirm', (_req, res) => {
  res.status(410).json({
    error: 'Deprecated endpoint. Use POST /shift-logs/:id/handover with incomingBadge and incomingPin.',
  });
});

export default router;
