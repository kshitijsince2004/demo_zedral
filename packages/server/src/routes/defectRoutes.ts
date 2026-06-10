import { Router } from 'express';
import { requireAuth } from '../middleware/authMiddleware';
import { assertLineOperation } from '../auth/lineAccessPolicy';
import { assertShiftLogAccess } from '../services/shiftLogAccessService';
import { DefectService } from '../services/ancillaryServices';
import { AuthError } from '../services/authService';

const router = Router();
router.use(require('express').json());
router.use(requireAuth);

router.post('/', async (req, res) => {
  try {
    const shiftLogId = req.body?.shiftLogId;
    if (shiftLogId) {
      await assertShiftLogAccess(req.user!, String(shiftLogId), 'WRITE');
    } else if (req.body?.processId) {
      assertLineOperation(req.user!, String(req.body.processId), 'WRITE');
    } else {
      return res.status(400).json({ error: 'shiftLogId or processId is required' });
    }
    const id = await DefectService.create(req.body, String(req.user!.id));
    res.status(201).json({ id });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Request failed';
    const status = error instanceof AuthError || message.includes('Forbidden') ? 403 : 400;
    res.status(status).json({ error: message });
  }
});

export default router;
