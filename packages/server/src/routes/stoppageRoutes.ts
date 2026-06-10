import { Router } from 'express';
import { requireAuth } from '../middleware/authMiddleware';
import { assertShiftLogAccess } from '../services/shiftLogAccessService';
import { StoppageService } from '../services/ancillaryServices';
import { AuthError } from '../services/authService';

const router = Router();
router.use(require('express').json());
router.use(requireAuth);

router.post('/', async (req, res) => {
  try {
    const shiftLogId = req.body?.shiftLogId;
    if (!shiftLogId) {
      return res.status(400).json({ error: 'shiftLogId is required' });
    }
    await assertShiftLogAccess(req.user!, String(shiftLogId), 'WRITE');
    const id = await StoppageService.create(req.body, String(req.user!.id));
    res.status(201).json({ id });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Request failed';
    const status = error instanceof AuthError || message.includes('Forbidden') ? 403 : 400;
    res.status(status).json({ error: message });
  }
});

export default router;
