import { Router } from 'express';
import { requireAuth } from '../middleware/authMiddleware';
import { assertShiftLogAccess } from '../services/shiftLogAccessService';
import { CrewService } from '../services/ancillaryServices';
import { AuthError } from '../services/authService';

const router = Router();
router.use(require('express').json());
router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    const shiftLogId = typeof req.query.shiftLogId === 'string' ? req.query.shiftLogId : '';
    if (!shiftLogId) {
      return res.status(400).json({ error: 'shiftLogId query parameter is required' });
    }
    await assertShiftLogAccess(req.user!, shiftLogId, 'READ');
    const crew = await CrewService.listByShiftLog(shiftLogId);
    res.json({ crew });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to load crew';
    const status = error instanceof AuthError || message.includes('Forbidden') ? 403 : 500;
    res.status(status).json({ error: message });
  }
});

router.post('/', async (req, res) => {
  try {
    const shiftLogId = req.body?.shiftLogId;
    if (!shiftLogId) {
      return res.status(400).json({ error: 'shiftLogId is required' });
    }
    await assertShiftLogAccess(req.user!, String(shiftLogId), 'WRITE');
    const id = await CrewService.create(req.body);
    res.status(201).json({ id });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to save crew';
    const status = error instanceof AuthError || message.includes('Forbidden') ? 403 : 400;
    res.status(status).json({ error: message });
  }
});

export default router;
