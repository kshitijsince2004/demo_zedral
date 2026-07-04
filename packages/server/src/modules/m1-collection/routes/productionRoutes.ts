import { Router, type Request, type Response } from 'express';
import {
  annSchema,
  crsSchema,
  ctlSchema,
  hrsSchema,
  pklSchema,
  rwdSchema,
  skpSchema,
} from '@m1/shared-validation';
import { requireAuth } from '../../../middleware/authMiddleware';
import { assertLineOperation } from '../../../auth/lineAccessPolicy';
import { getTenantId } from '../../../context';
import { ProductionService } from '../services/ProductionService';

const router = Router();
router.use(requireAuth);

function withTenant(body: unknown): unknown {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return body;
  }
  return {
    ...body,
    tenantId: 'tenantId' in body ? body.tenantId : getTenantId(),
  };
}

interface ValidationIssue {
  path: Array<string | number>;
  message: string;
}

interface SafeParseSchema<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false; error: { issues: ValidationIssue[] } };
}

function zodErrors(error: { issues: ValidationIssue[] }) {
  return error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}

function postProduction<T>(
  processCode: string,
  schema: SafeParseSchema<T>,
  save: (entry: T) => Promise<string>,
) {
  return async (req: Request, res: Response) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
      assertLineOperation(req.user, processCode, 'WRITE');

      const parsed = schema.safeParse(withTenant(req.body));
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid production payload', details: zodErrors(parsed.error) });
      }

      const id = await save(parsed.data);
      return res.status(201).json({ id });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Production capture failed';
      const status = message.includes('Forbidden') ? 403 : 400;
      return res.status(status).json({ error: message });
    }
  };
}

router.post('/hrs', postProduction('HRS', hrsSchema, ProductionService.saveHrs));
router.post('/pkl', postProduction('PKL', pklSchema, ProductionService.savePkl));
router.post('/ann', postProduction('ANN', annSchema, ProductionService.saveAnn));
router.post('/skp', postProduction('SKP', skpSchema, ProductionService.saveSkp));
router.post('/rwd', postProduction('RWD', rwdSchema, ProductionService.saveRwd));
router.post('/crs', postProduction('CRS', crsSchema, ProductionService.saveCrs));
router.post('/ctl', postProduction('CTL', ctlSchema, ProductionService.saveCtl));

export default router;
