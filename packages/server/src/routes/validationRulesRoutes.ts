import { Router } from 'express';
import { db } from '../db';
import { ValidationConfigService } from '../services/ValidationConfigService';
import { requireAuth, requireRole } from '../middleware/authMiddleware';
import { UserRole } from '@m1/shared-validation';

const router = Router();
const validationConfigService = new ValidationConfigService(db);

/**
 * 6.1 Implement `GET /validation-rules`
 * Returns all active validation rules
 */
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const rules = await validationConfigService.getConfiguredRules(false);
    res.json(rules);
  } catch (err) {
    next(err);
  }
});

/**
 * 6.3 Implement `GET /validation-rules/version`
 * Returns the current ruleset version
 */
router.get('/version', requireAuth, async (req, res, next) => {
  try {
    const version = await validationConfigService.getVersion();
    res.json({ version });
  } catch (err) {
    next(err);
  }
});

/**
 * 6.2 Implement `POST /validation-rules/:fieldId`
 * Updates a validation rule (ADMIN only)
 */
router.post('/:fieldId', requireAuth, requireRole([UserRole.ADMIN]), async (req, res, next) => {
  try {
    const { fieldId } = req.params;
    const ruleData = req.body;
    const username = req.user?.username || 'admin'; // Provided by requireAuth
    
    await validationConfigService.updateRule(fieldId, ruleData, username);
    
    res.status(200).json({ success: true, message: 'Rule updated' });
  } catch (err) {
    next(err);
  }
});

export default router;
