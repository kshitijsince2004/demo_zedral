import { Router } from 'express';
import { requireAuth, requireLineAccess } from '../middleware/authMiddleware';
import { AutoSourceService } from '../services/AutoSourceService';

const router = Router();
router.use(require('express').json());
router.use(requireAuth);

router.get('/:processId/:coilNo', requireLineAccess('READ'), async (req, res) => {
  try {
    const { processId, coilNo } = req.params;
    const fields = await AutoSourceService.getPrefilledFields(processId.toUpperCase(), coilNo);
    res.json({ fields });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
