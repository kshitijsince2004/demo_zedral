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

/** Complete HRS/PKL order after prod row write (rail End only posted /production/* before). */
async function completeHrsPklOrder(processCode: string, coilNo: string, userId: number) {
  if (processCode === 'HRS') {
    const { HrsOrderService } = await import('../../../services/HrsOrderService');
    await HrsOrderService.endProduction(coilNo, userId);
    return;
  }
  if (processCode === 'PKL') {
    const { PklOrderService } = await import('../../../services/PklOrderService');
    await PklOrderService.endProduction(coilNo, userId);
  }
}

/** Fail before insert when an open stoppage would block endProduction. */
async function assertHrsPklReadyToEnd(processCode: string, coilNo: string, userId: number) {
  if (processCode === 'HRS') {
    const { HrsOrderService } = await import('../../../services/HrsOrderService');
    const order = await HrsOrderService.getOrder(coilNo, userId);
    if (order.activeStoppageId) {
      throw new Error('Close open stoppage before ending production');
    }
    return;
  }
  if (processCode === 'PKL') {
    const { PklOrderService } = await import('../../../services/PklOrderService');
    const order = await PklOrderService.getOrder(coilNo, userId);
    if (order.activeStoppageId) {
      throw new Error('Close open stoppage before ending production');
    }
  }
}

function withTenant(body: unknown): unknown {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return body;
  }
  const next: Record<string, unknown> = {
    ...(body as Record<string, unknown>),
    tenantId: 'tenantId' in body ? (body as { tenantId?: unknown }).tenantId : getTenantId(),
  };
  // Clients occasionally POST numeric shiftLogId; schema requires string.
  if (next.shiftLogId != null) next.shiftLogId = String(next.shiftLogId);
  return next;
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

      const coilNo = (parsed.data as { coilNo?: string }).coilNo;
      if (coilNo && (processCode === 'HRS' || processCode === 'PKL')) {
        try {
          await assertHrsPklReadyToEnd(processCode, coilNo, req.user.id);
        } catch (preErr) {
          const msg = preErr instanceof Error ? preErr.message : '';
          if (/Close open stoppage/i.test(msg)) throw preErr instanceof Error ? preErr : new Error(msg);
          // Missing / non-running order → allow capture-only save below.
        }
      }

      const id = await save(parsed.data);
      if (coilNo && (processCode === 'HRS' || processCode === 'PKL')) {
        try {
          await completeHrsPklOrder(processCode, coilNo, req.user.id);
        } catch (endErr) {
          const endMsg = endErr instanceof Error ? endErr.message : 'Order end failed';
          // Capture-only path when no running order (legacy / re-save).
          if (!/Only running orders can be completed/i.test(endMsg)) {
            throw endErr instanceof Error ? endErr : new Error(endMsg);
          }
        }
      }
      return res.status(201).json({ id });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Production capture failed';
      const status = message.includes('Forbidden') ? 403 : 400;
      return res.status(status).json({ error: message });
    }
  };
}

router.post('/hrs', postProduction('HRS', hrsSchema, (entry) => ProductionService.saveHrs(entry)));
/** Mid-run HRS save — persist without ending timer/order. */
router.post('/hrs/draft', async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
    assertLineOperation(req.user, 'HRS', 'WRITE');
    const parsed = hrsSchema.safeParse(withTenant(req.body));
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid production payload', details: zodErrors(parsed.error) });
    }
    const id = await ProductionService.saveHrs(parsed.data, { draft: true });
    return res.status(201).json({ id, draft: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Production draft save failed';
    const status = message.includes('Forbidden') ? 403 : 400;
    return res.status(status).json({ error: message });
  }
});
/** Finalize PKL order — save prod row + endProduction (rail End → OrderEndModal only). */
router.post('/pkl', postProduction('PKL', pklSchema, (entry) => ProductionService.savePkl(entry)));
/** Mid-run save — persist prod fields without ending timer/order. */
router.post('/pkl/draft', async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
    assertLineOperation(req.user, 'PKL', 'WRITE');
    const parsed = pklSchema.safeParse(withTenant(req.body));
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid production payload', details: zodErrors(parsed.error) });
    }
    const id = await ProductionService.savePkl(parsed.data, { draft: true });
    return res.status(201).json({ id, draft: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Production draft save failed';
    const status = message.includes('Forbidden') ? 403 : 400;
    return res.status(status).json({ error: message });
  }
});
router.post('/ann', postProduction('ANN', annSchema, ProductionService.saveAnn));
router.post('/skp', postProduction('SKP', skpSchema, ProductionService.saveSkp));
router.post('/rwd', postProduction('RWD', rwdSchema, ProductionService.saveRwd));
router.post('/crs', postProduction('CRS', crsSchema, ProductionService.saveCrs));
router.post('/ctl', postProduction('CTL', ctlSchema, ProductionService.saveCtl));

export default router;
