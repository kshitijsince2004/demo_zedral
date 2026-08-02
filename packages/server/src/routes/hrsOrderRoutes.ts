import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/authMiddleware';
import { assertMachineAccess } from '../auth/machineAccessPolicy';
import { HrsOrderService } from '../services/HrsOrderService';

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
    assertMachineAccess(req.user, 'HRS', { mode });
    return true;
  } catch (e) {
    respondError(res, 'hrs.authorize', e);
    return false;
  }
}

router.get('/queue', async (req, res) => {
  try {
    if (!authorizeMachine(req, res, 'READ')) return;
    const result = await HrsOrderService.getQueue(req.user!.id);
    res.json(result);
  } catch (e) {
    respondError(res, 'hrs.queue', e);
  }
});

router.get('/orders/:coilNo', async (req, res) => {
  try {
    if (!authorizeMachine(req, res, 'WRITE')) return;
    const order = await HrsOrderService.getOrder(req.params.coilNo, req.user!.id);
    res.json(order);
  } catch (e) {
    respondError(res, 'hrs.getOrder', e);
  }
});

router.post('/orders/:coilNo/start', async (req, res) => {
  try {
    if (!authorizeMachine(req, res, 'WRITE')) return;
    const order = await HrsOrderService.startProduction(req.params.coilNo, req.user!.id);
    res.json(order);
  } catch (e) {
    respondError(res, 'hrs.start', e);
  }
});

router.post('/orders/:coilNo/end', async (req, res) => {
  try {
    if (!authorizeMachine(req, res, 'WRITE')) return;
    const order = await HrsOrderService.endProduction(req.params.coilNo, req.user!.id);
    res.json(order);
  } catch (e) {
    respondError(res, 'hrs.end', e);
  }
});

router.post('/orders/:coilNo/stoppages', async (req, res) => {
  try {
    const parsed = stoppageSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: zodMsg(parsed.error) });
    }
    if (!authorizeMachine(req, res, 'WRITE')) return;
    const order = await HrsOrderService.addStoppage(
      req.params.coilNo,
      parsed.data.categoryCode,
      parsed.data.breakdownCode,
      parsed.data.remarks,
      req.user!.id,
    );
    res.json(order);
  } catch (e) {
    respondError(res, 'hrs.stoppage', e);
  }
});

router.post('/orders/:coilNo/stoppages/start', async (req, res) => {
  try {
    const parsed = stoppageSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: zodMsg(parsed.error) });
    }
    if (!authorizeMachine(req, res, 'WRITE')) return;
    const order = await HrsOrderService.addStoppage(
      req.params.coilNo,
      parsed.data.categoryCode,
      parsed.data.breakdownCode,
      parsed.data.remarks,
      req.user!.id,
    );
    res.json(order);
  } catch (e) {
    respondError(res, 'hrs.stoppageStart', e);
  }
});

router.patch('/orders/:coilNo/stoppages/:stoppageId', async (req, res) => {
  try {
    const parsed = stoppageSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: zodMsg(parsed.error) });
    }
    if (!authorizeMachine(req, res, 'WRITE')) return;
    const order = await HrsOrderService.updateStoppage(
      req.params.coilNo,
      req.params.stoppageId,
      parsed.data.categoryCode,
      parsed.data.breakdownCode,
      parsed.data.remarks,
      req.user!.id,
    );
    res.json(order);
  } catch (e) {
    respondError(res, 'hrs.stoppageUpdate', e);
  }
});

router.patch('/orders/:coilNo/stoppages/:stoppageId/end', async (req, res) => {
  try {
    if (!authorizeMachine(req, res, 'WRITE')) return;
    const order = await HrsOrderService.endStoppage(
      req.params.coilNo,
      req.params.stoppageId,
      req.user!.id,
    );
    res.json(order);
  } catch (e) {
    respondError(res, 'hrs.stoppageEnd', e);
  }
});

router.post('/orders/:coilNo/reject', async (req, res) => {
  try {
    if (!authorizeMachine(req, res, 'WRITE')) return;
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
    if (!authorizeMachine(req, res, 'WRITE')) return;
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

export default router;
