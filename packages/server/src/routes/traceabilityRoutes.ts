import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/authMiddleware';
import { UserRole } from '@m1/shared-validation';
import { TraceabilityService } from '../services/TraceabilityService';

const router = Router();
router.use(require('express').json());
router.use(requireAuth);

router.get('/', requireRole([UserRole.PLANT_HEAD, UserRole.SUPERVISOR, UserRole.ADMIN]), async (req, res) => {
  try {
    const query = req.query.q as string;
    if (!query) {
      return res.status(400).json({ error: 'Query parameter q is required' });
    }

    const result = await TraceabilityService.search(query);
    res.json(result);
  } catch (error: any) {
    res.status(404).json({ error: error.message });
  }
});

export default router;
