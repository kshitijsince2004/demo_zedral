import { Router } from 'express';
import { requireAuth } from '../middleware/authMiddleware';
import { assertLineOperation } from '../auth/lineAccessPolicy';
import { PklOrderService } from '../services/PklOrderService';
import { logger } from '../utils/logger';

const router = Router();

router.use(requireAuth);

function respondError(res: import('express').Response, context: string, error: unknown) {
  logger.error(`${context}:`, error);
  const message = error instanceof Error ? error.message : 'Request failed';
  if (/permission denied/i.test(message)) {
    res.status(500).json({ error: 'Database permission denied' });
    return;
  }
  const conflict = message.startsWith('ACTIVE_ORDER_CONFLICT:');
  const forbidden = message.includes('Forbidden');
  res.status(conflict ? 409 : forbidden ? 403 : 400).json({ error: message });
}

/** Line ACL — same gate as `/stations/pkl/*` (machine-only blocked PKL line operators). */
function authorizeLine(
  req: import('express').Request,
  res: import('express').Response,
  mode: 'READ' | 'WRITE',
): boolean {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthenticated' });
    return false;
  }
  try {
    assertLineOperation(req.user, 'PKL', mode);
    return true;
  } catch (e) {
    respondError(res, 'pkl.authorize', e);
    return false;
  }
}

router.get('/queue', async (req, res) => {
  try {
    if (!authorizeLine(req, res, 'READ')) return;
    const result = await PklOrderService.getQueue(req.user!.id);
    res.json(result);
  } catch (e) {
    respondError(res, 'pkl.queue', e);
  }
});

router.get('/orders/:coilNo', async (req, res) => {
  try {
    if (!authorizeLine(req, res, 'READ')) return;
    const order = await PklOrderService.getOrder(req.params.coilNo, req.user!.id);
    res.json(order);
  } catch (e) {
    respondError(res, 'pkl.getOrder', e);
  }
});

router.post('/orders/:coilNo/start', async (req, res) => {
  try {
    if (!authorizeLine(req, res, 'WRITE')) return;
    const order = await PklOrderService.startProduction(
      req.params.coilNo,
      req.user!.id,
      req.body?.batchNumber != null ? String(req.body.batchNumber) : undefined,
    );
    res.json(order);
  } catch (e) {
    respondError(res, 'pkl.start', e);
  }
});

router.post('/orders/:coilNo/end', async (req, res) => {
  try {
    if (!authorizeLine(req, res, 'WRITE')) return;
    const order = await PklOrderService.endProduction(
      req.params.coilNo,
      req.user!.id,
      req.body?.batchNumber != null ? String(req.body.batchNumber) : undefined,
    );
    res.json(order);
  } catch (e) {
    respondError(res, 'pkl.end', e);
  }
});

router.post('/orders/:coilNo/reject', async (req, res) => {
  try {
    if (!authorizeLine(req, res, 'WRITE')) return;
    const reason = String(req.body?.rejectionReason ?? req.body?.reason ?? '');
    const remarks = String(req.body?.remarks ?? '');
    const batchNumber = req.body?.batchNumber != null ? String(req.body.batchNumber) : undefined;
    const order = await PklOrderService.rejectOrder(
      req.params.coilNo,
      reason,
      remarks,
      req.user!.id,
      batchNumber,
    );
    res.json(order);
  } catch (e) {
    respondError(res, 'pkl.reject', e);
  }
});

router.post('/orders/:coilNo/reinstate', async (req, res) => {
  try {
    if (!authorizeLine(req, res, 'WRITE')) return;
    const target = req.body?.target === 'PENDING' ? 'PENDING' : 'PREPARING';
    const batchNumber = req.body?.batchNumber != null ? String(req.body.batchNumber) : undefined;
    const order = await PklOrderService.reinstateOrder(
      req.params.coilNo,
      req.user!.id,
      target,
      batchNumber,
    );
    res.json(order);
  } catch (e) {
    respondError(res, 'pkl.reinstate', e);
  }
});

router.delete('/orders/:coilNo', async (req, res) => {
  try {
    if (!authorizeLine(req, res, 'WRITE')) return;
    const result = await PklOrderService.deleteOrder(req.params.coilNo, req.user!.id);
    res.json(result);
  } catch (e) {
    respondError(res, 'pkl.delete', e);
  }
});

export default router;
