import { Router } from 'express';
import { UserRole } from '@m1/shared-validation';
import { requireAuth, requireRole } from '../middleware/authMiddleware';
import { LiveService } from '../services/LiveService';
import { MachineStateEventService } from '../services/MachineStateEventService';

const router = Router();
router.use(requireAuth);
router.use(requireRole([
  UserRole.MACHINE_HEAD,
  UserRole.SUPERVISOR,
  UserRole.PLANT_HEAD,
  UserRole.ADMIN,
]));

router.get('/snapshot', async (req, res) => {
  try {
    const roles = req.user?.roles ?? [];
    const snapshot = await LiveService.getSnapshot(req.user!.id, roles);
    res.json(snapshot);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to load snapshot';
    res.status(500).json({ error: msg });
  }
});

router.get('/orders', async (req, res) => {
  try {
    const roles = req.user?.roles ?? [];
    const filter = await LiveService.getMachineScope(req.user!.id, roles);
    const orders = await LiveService.getActiveOrders(filter);
    res.json({ orders, refreshedAt: new Date().toISOString() });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to load orders';
    res.status(500).json({ error: msg });
  }
});

router.get('/orders/:batchNo', async (req, res) => {
  try {
    const roles = req.user?.roles ?? [];
    const filter = await LiveService.getMachineScope(req.user!.id, roles);
    const detail = await LiveService.getOrderDetail(req.params.batchNo, filter);
    if (!detail) return res.status(404).json({ error: 'Order not found' });
    res.json(detail);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to load order';
    res.status(500).json({ error: msg });
  }
});

router.get('/machine-head-dashboard', async (req, res) => {
  try {
    const roles = req.user?.roles ?? [];
    const data = await LiveService.getMachineHeadDashboard(req.user!.id, roles);
    res.json(data);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to load machine head dashboard';
    res.status(500).json({ error: msg });
  }
});

router.get('/machines', async (req, res) => {
  try {
    const roles = req.user?.roles ?? [];
    const filter = await LiveService.getMachineScope(req.user!.id, roles);
    const machines = await LiveService.getMachineCards(filter);
    res.json({ machines, refreshedAt: new Date().toISOString() });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to load machines';
    res.status(500).json({ error: msg });
  }
});

// ── Machine-level state endpoints ────────────────────────────────────────────

/** GET /live/machines/:machineCode/state — current machine state + active event */
router.get('/machines/:machineCode/state', async (req, res) => {
  try {
    const data = await LiveService.getMachineCommandCenterData(req.params.machineCode);
    if (!data) return res.status(404).json({ error: 'Machine not found' });
    res.json(data);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to load machine state';
    res.status(500).json({ error: msg });
  }
});

/** GET /live/machines/:machineCode/timeline?hours=24 — event log */
router.get('/machines/:machineCode/timeline', async (req, res) => {
  try {
    const hours = Math.min(168, Math.max(1, Number(req.query.hours ?? 24)));
    const timeline = await MachineStateEventService.getTimeline(req.params.machineCode, hours);
    res.json({ machineCode: req.params.machineCode, hours, timeline, refreshedAt: new Date().toISOString() });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to load timeline';
    res.status(500).json({ error: msg });
  }
});

/** GET /live/machines/:machineCode/analytics?hours=24 — utilization summary */
router.get('/machines/:machineCode/analytics', async (req, res) => {
  try {
    const hours = Math.min(168, Math.max(1, Number(req.query.hours ?? 24)));
    const utilization = await MachineStateEventService.getUtilizationSummary(req.params.machineCode, hours);
    res.json(utilization);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to load analytics';
    res.status(500).json({ error: msg });
  }
});

/** GET /live/machines/:machineCode/next-order — next queued order for machine */
router.get('/machines/:machineCode/next-order', async (req, res) => {
  try {
    const next = await LiveService.getNextOrder(req.params.machineCode);
    res.json(next ?? null);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to load next order';
    res.status(500).json({ error: msg });
  }
});

/**
 * GET /live/stream — Server-Sent Events endpoint for real-time machine state push.
 * Sends machine state snapshot every 15 seconds. Client falls back to polling on error.
 */
router.get('/stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const sendEvent = async () => {
    try {
      const roles = req.user?.roles ?? [];
      const filter = await LiveService.getMachineScope(req.user!.id, roles);
      const machines = await LiveService.getMachineCards(filter);
      res.write(`data: ${JSON.stringify({ type: 'MACHINES_UPDATE', machines, ts: new Date().toISOString() })}\n\n`);
    } catch {
      // swallow — client will reconnect
    }
  };

  // Send immediately on connect, then every 15 seconds
  await sendEvent();
  const interval = setInterval(sendEvent, 15_000);

  // Heartbeat to keep connection alive through proxies
  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 30_000);

  req.on('close', () => {
    clearInterval(interval);
    clearInterval(heartbeat);
  });
});

export default router;
