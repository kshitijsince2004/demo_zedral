import { Router } from 'express';
import { requireAuth } from '../middleware/authMiddleware';
import { StoppageService } from '../services/ancillaryServices';

const router = Router();
router.use(require('express').json());
router.use(requireAuth);

router.post('/', async (req, res) => {
  try {
    const id = await StoppageService.create(req.body, String(req.user!.id));
    res.status(201).json({ id });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

export default router;
