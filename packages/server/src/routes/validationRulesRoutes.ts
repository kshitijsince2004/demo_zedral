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
 * 6.2 Implement `POST /validation-rules`
 * Updates or creates a validation rule (ADMIN only)
 */
router.post('/', requireAuth, requireRole([UserRole.ADMIN]), async (req, res, next) => {
  try {
    const { ruleId, fieldId, ...ruleData } = req.body;
    const username = req.user?.username || 'admin'; // Provided by requireAuth
    
    await validationConfigService.upsertRule(ruleId, fieldId, ruleData, username);
    
    res.status(200).json({ success: true, message: 'Rule upserted' });
  } catch (err) {
    next(err);
  }
});

router.delete('/:ruleId', requireAuth, requireRole([UserRole.ADMIN]), async (req, res, next) => {
  try {
    const { ruleId } = req.params;
    const username = req.user?.username || 'admin';
    await validationConfigService.deactivateRule(ruleId, username);
    res.status(200).json({ success: true, message: 'Rule deactivated' });
  } catch (err) {
    next(err);
  }
});

export default router;
