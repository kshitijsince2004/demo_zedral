import { Router } from 'express';
import { requireAuth } from '../middleware/authMiddleware';
import { assertLineOperation } from '../auth/lineAccessPolicy';
import { HrsOrderService } from '../services/HrsOrderService';

const router = Router();

router.use(requireAuth);

function respondError(res: import('express').Response, context: string, error: unknown) {
  console.error(`${context}:`, error);
  const message = error instanceof Error ? error.message : 'Request failed';
  const conflict = message.startsWith('ACTIVE_ORDER_CONFLICT:');
  const forbidden = message.includes('Forbidden');
  res.status(conflict ? 409 : forbidden ? 403 : 400).json({ error: message });
}

/** Line ACL — same gate as `/stations/hrs/*` (machine-only blocked HRS line operators). */
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
    assertLineOperation(req.user, 'HRS', mode);
    return true;
  } catch (e) {
    respondError(res, 'hrs.authorize', e);
    return false;
  }
}

router.get('/queue', async (req, res) => {
  try {
    if (!authorizeLine(req, res, 'READ')) return;
    const result = await HrsOrderService.getQueue(req.user!.id);
    res.json(result);
  } catch (e) {
    respondError(res, 'hrs.queue', e);
  }
});

router.get('/orders/:coilNo', async (req, res) => {
  try {
    if (!authorizeLine(req, res, 'WRITE')) return;
    const order = await HrsOrderService.getOrder(req.params.coilNo, req.user!.id);
    res.json(order);
  } catch (e) {
    respondError(res, 'hrs.getOrder', e);
  }
});

router.post('/orders/:coilNo/start', async (req, res) => {
  try {
    if (!authorizeLine(req, res, 'WRITE')) return;
    const order = await HrsOrderService.startProduction(req.params.coilNo, req.user!.id);
    res.json(order);
  } catch (e) {
    respondError(res, 'hrs.start', e);
  }
});

router.post('/orders/:coilNo/end', async (req, res) => {
  try {
    if (!authorizeLine(req, res, 'WRITE')) return;
    const order = await HrsOrderService.endProduction(req.params.coilNo, req.user!.id);
    res.json(order);
  } catch (e) {
    respondError(res, 'hrs.end', e);
  }
});

router.post('/orders/:coilNo/reject', async (req, res) => {
  try {
    if (!authorizeLine(req, res, 'WRITE')) return;
    const reason = String(req.body?.rejectionReason ?? req.body?.reason ?? '');
    const remarks = String(req.body?.remarks ?? '');
    const order = await HrsOrderService.rejectOrder(
      req.params.coilNo,
      reason,
      remarks,
      req.user!.id,
    );
    res.json(order);
  } catch (e) {
    respondError(res, 'hrs.reject', e);
  }
});

router.post('/orders/:coilNo/reinstate', async (req, res) => {
  try {
    if (!authorizeLine(req, res, 'WRITE')) return;
    const target = req.body?.target === 'PENDING' ? 'PENDING' : 'PREPARING';
    const order = await HrsOrderService.reinstateOrder(
      req.params.coilNo,
      req.user!.id,
      target,
    );
    res.json(order);
  } catch (e) {
    respondError(res, 'hrs.reinstate', e);
  }
});

router.delete('/orders/:coilNo', async (req, res) => {
  try {
    if (!authorizeLine(req, res, 'WRITE')) return;
    const result = await HrsOrderService.deleteOrder(req.params.coilNo, req.user!.id);
    res.json(result);
  } catch (e) {
    respondError(res, 'hrs.delete', e);
  }
});

export default router;
