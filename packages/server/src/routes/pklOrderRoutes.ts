import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/authMiddleware';
import { assertMachineAccess } from '../auth/machineAccessPolicy';
import { PklOrderService } from '../services/PklOrderService';

const router = Router();

router.use(requireAuth);

const stoppageSchema = z.object({
  categoryCode: z.string().min(1),
  breakdownCode: z.string().optional(),
  remarks: z.string().optional(),
});

function zodMsg(error: z.ZodError): string {
  return error.issues.map((e) => e.message).join('; ');
}

function respondError(res: import('express').Response, context: string, error: unknown) {
  console.error(`${context}:`, error);
  const message = error instanceof Error ? error.message : 'Request failed';
  const conflict = message.startsWith('ACTIVE_ORDER_CONFLICT:');
  res.status(conflict ? 409 : 400).json({ error: message });
}

function authorizeMachine(
  req: import('express').Request,
  res: import('express').Response,
  mode: 'READ' | 'WRITE',
): boolean {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthenticated' });
    return false;
  }
  try {
    assertMachineAccess(req.user, 'PKL', { mode });
    return true;
  } catch (e) {
    respondError(res, 'pkl.authorize', e);
    return false;
  }
}

router.get('/queue', async (req, res) => {
  try {
    if (!authorizeMachine(req, res, 'READ')) return;
    const result = await PklOrderService.getQueue(req.user!.id);
    res.json(result);
  } catch (e) {
    respondError(res, 'pkl.queue', e);
  }
});

router.get('/orders/:coilNo', async (req, res) => {
  try {
    if (!authorizeMachine(req, res, 'WRITE')) return;
    const order = await PklOrderService.getOrder(req.params.coilNo, req.user!.id);
    res.json(order);
  } catch (e) {
    respondError(res, 'pkl.getOrder', e);
  }
});

router.post('/orders/:coilNo/start', async (req, res) => {
  try {
    if (!authorizeMachine(req, res, 'WRITE')) return;
    const order = await PklOrderService.startProduction(req.params.coilNo, req.user!.id);
    res.json(order);
  } catch (e) {
    respondError(res, 'pkl.start', e);
  }
});

router.post('/orders/:coilNo/end', async (req, res) => {
  try {
    if (!authorizeMachine(req, res, 'WRITE')) return;
    const order = await PklOrderService.endProduction(req.params.coilNo, req.user!.id);
    res.json(order);
  } catch (e) {
    respondError(res, 'pkl.end', e);
  }
});

router.post('/orders/:coilNo/stoppages', async (req, res) => {
  try {
    const parsed = stoppageSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: zodMsg(parsed.error) });
    }
    if (!authorizeMachine(req, res, 'WRITE')) return;
    const order = await PklOrderService.addStoppage(
      req.params.coilNo,
      parsed.data.categoryCode,
      parsed.data.breakdownCode,
      parsed.data.remarks,
      req.user!.id,
    );
    res.json(order);
  } catch (e) {
    respondError(res, 'pkl.stoppage', e);
  }
});

router.post('/orders/:coilNo/stoppages/start', async (req, res) => {
  try {
    const parsed = stoppageSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: zodMsg(parsed.error) });
    }
    if (!authorizeMachine(req, res, 'WRITE')) return;
    const order = await PklOrderService.addStoppage(
      req.params.coilNo,
      parsed.data.categoryCode,
      parsed.data.breakdownCode,
      parsed.data.remarks,
      req.user!.id,
    );
    res.json(order);
  } catch (e) {
    respondError(res, 'pkl.stoppageStart', e);
  }
});

router.patch('/orders/:coilNo/stoppages/:stoppageId', async (req, res) => {
  try {
    const parsed = stoppageSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: zodMsg(parsed.error) });
    }
    if (!authorizeMachine(req, res, 'WRITE')) return;
    const order = await PklOrderService.updateStoppage(
      req.params.coilNo,
      req.params.stoppageId,
      parsed.data.categoryCode,
      parsed.data.breakdownCode,
      parsed.data.remarks,
      req.user!.id,
    );
    res.json(order);
  } catch (e) {
    respondError(res, 'pkl.stoppageUpdate', e);
  }
});

router.patch('/orders/:coilNo/stoppages/:stoppageId/end', async (req, res) => {
  try {
    if (!authorizeMachine(req, res, 'WRITE')) return;
    const order = await PklOrderService.endStoppage(
      req.params.coilNo,
      req.params.stoppageId,
      req.user!.id,
    );
    res.json(order);
  } catch (e) {
    respondError(res, 'pkl.stoppageEnd', e);
  }
});

router.post('/orders/:coilNo/reject', async (req, res) => {
  try {
    if (!authorizeMachine(req, res, 'WRITE')) return;
    const reason = String(req.body?.rejectionReason ?? req.body?.reason ?? '');
    const remarks = String(req.body?.remarks ?? '');
    const order = await PklOrderService.rejectOrder(
      req.params.coilNo,
      reason,
      remarks,
      req.user!.id,
    );
    res.json(order);
  } catch (e) {
    respondError(res, 'pkl.reject', e);
  }
});

router.post('/orders/:coilNo/reinstate', async (req, res) => {
  try {
    if (!authorizeMachine(req, res, 'WRITE')) return;
    const target = req.body?.target === 'PENDING' ? 'PENDING' : 'PREPARING';
    const order = await PklOrderService.reinstateOrder(
      req.params.coilNo,
      req.user!.id,
      target,
    );
    res.json(order);
  } catch (e) {
    respondError(res, 'pkl.reinstate', e);
  }
});

export default router;
