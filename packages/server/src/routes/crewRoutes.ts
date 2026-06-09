import { Router } from 'express';
import { requireAuth } from '../middleware/authMiddleware';
import { CrewService } from '../services/ancillaryServices';

const router = Router();
router.use(require('express').json());
router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    const shiftLogId = typeof req.query.shiftLogId === 'string' ? req.query.shiftLogId : '';
    if (!shiftLogId) {
      return res.status(400).json({ error: 'shiftLogId query parameter is required' });
    }
    const crew = await CrewService.listByShiftLog(shiftLogId);
    res.json({ crew });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to load crew';
    res.status(500).json({ error: message });
  }
});

router.post('/', async (req, res) => {
  try {
    const id = await CrewService.create(req.body);
    res.status(201).json({ id });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to save crew';
    res.status(400).json({ error: message });
  }
});

export default router;
