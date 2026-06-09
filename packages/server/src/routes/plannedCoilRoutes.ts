import { Router } from 'express';
import { PlannedCoilService } from '../services/PlannedCoilService';
import { requireAuth } from '../middleware/authMiddleware';

const router = Router();
router.use(require('express').json());
router.use(requireAuth);

router.get('/process/:processCode', async (req, res) => {
  try {
    const processCode = req.params.processCode;
    if (!processCode) {
      return res.status(400).json({ error: 'Invalid processCode' });
    }
    const coils = await PlannedCoilService.getPlannedCoilsByProcess(processCode);
    res.json(coils);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
