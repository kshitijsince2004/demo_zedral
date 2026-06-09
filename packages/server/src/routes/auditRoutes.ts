import { Router } from 'express';
import { UserRole } from '@m1/shared-validation';
import { requireAuth, requireRole } from '../middleware/authMiddleware';
import { AuditTrailService } from '../services/AuditTrailService';

const router = Router();
router.use(require('express').json());
router.use(requireAuth);

// "Any non-GET method from a PLANT_HEAD session -> 403 at route"
router.use((req, res, next) => {
  if (req.method !== 'GET' && req.user?.roles?.includes(UserRole.PLANT_HEAD)) {
    return res.status(403).json({ error: 'Plant Head has read-only access to audit trails.' });
  }
  next();
});

router.get('/', requireRole([UserRole.PLANT_HEAD, UserRole.ADMIN]), async (req, res) => {
  try {
    const filters = {
      scope: req.query.scope ? String(req.query.scope) : 'plant',
      page: req.query.page ? Number(req.query.page) : 1,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : 50,
      from: req.query.from ? String(req.query.from) : undefined,
      to: req.query.to ? String(req.query.to) : undefined,
      action: req.query.action ? String(req.query.action) : undefined,
    };

    const result = await AuditTrailService.query(filters);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
