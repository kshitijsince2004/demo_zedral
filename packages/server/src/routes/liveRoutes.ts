import { Router } from 'express';
import { UserRole } from '@m1/shared-validation';
import { requireAuth, requireRole } from '../middleware/authMiddleware';
import { LiveDashboardService, LiveOrderService } from '../services/live';
import { MachineStateEventService } from '../services/MachineStateEventService';

const router = Router();
router.use(requireAuth);
router.use(requireRole([
  UserRole.SUPERVISOR,
  UserRole.MACHINE_HEAD,
  UserRole.PLANT_HEAD,
  UserRole.ADMIN,
]));

router.get('/snapshot', async (req, res) => {
  try {
    const roles = req.user?.roles ?? [];
    const snapshot = await LiveDashboardService.getSnapshot(req.user!.id, roles);
    res.json(snapshot);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to load snapshot';
    res.status(500).json({ error: msg });
  }
});

router.get('/orders', async (req, res) => {
  try {
    const roles = req.user?.roles ?? [];
    let filter = await LiveDashboardService.getMachineScope(req.user!.id, roles);
    const machine = typeof req.query.machine === 'string' ? req.query.machine.toUpperCase() : undefined;
    if (machine) {
      if (filter === null) filter = [machine];
      else filter = filter.filter((m) => m === machine);
    }
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    const subProcess = typeof req.query.subProcess === 'string' ? req.query.subProcess : undefined;
    // Live queue ignores plan date/shift (backlog + in-progress). date/shift kept for response metadata.
    const planDate = typeof req.query.date === 'string' ? req.query.date.slice(0, 10) : undefined;
    const shiftCode = typeof req.query.shift === 'string' ? req.query.shift.toUpperCase() : undefined;
    const ctx = planDate && shiftCode
      ? { prodDate: planDate, shiftCode }
      : await LiveDashboardService.getShiftQueueContext(
        req.user!.id,
        machine,
      );
    const orders = await LiveOrderService.getActiveOrders(filter, ctx.prodDate, ctx.shiftCode, {
      search,
      subProcess,
    });
    res.json({ orders, prodDate: ctx.prodDate, shiftCode: ctx.shiftCode, refreshedAt: new Date().toISOString() });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to load orders';
    res.status(500).json({ error: msg });
  }
});

router.get('/rejected-orders', async (req, res) => {
  try {
    const roles = req.user?.roles ?? [];
    let filter = await LiveDashboardService.getMachineScope(req.user!.id, roles);
    const machine = typeof req.query.machine === 'string' ? req.query.machine.toUpperCase() : undefined;
    if (machine) {
      if (filter === null) filter = [machine];
      else filter = filter.filter((m) => m === machine);
    }
    const dateFrom = typeof req.query.dateFrom === 'string' ? req.query.dateFrom.slice(0, 10) : undefined;
    const dateTo = typeof req.query.dateTo === 'string' ? req.query.dateTo.slice(0, 10) : undefined;
    const date = typeof req.query.date === 'string' ? req.query.date.slice(0, 10) : undefined;
    const shiftCode = typeof req.query.shiftCode === 'string' ? req.query.shiftCode.toUpperCase() : undefined;
    const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined;
    const orders = await LiveOrderService.getRejectedOrders(filter, {
      dateFrom: dateFrom ?? date,
      dateTo: dateTo ?? date,
      shiftCode,
      limit: Number.isFinite(limit) ? limit : undefined,
    });
    res.json({ orders, refreshedAt: new Date().toISOString() });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to load rejected orders';
    res.status(500).json({ error: msg });
  }
});

router.get('/orders/:batchNo', async (req, res) => {
  try {
    const roles = req.user?.roles ?? [];
    const filter = await LiveDashboardService.getMachineScope(req.user!.id, roles);
    const detail = await LiveOrderService.getOrderDetail(req.params.batchNo, filter);
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
    const machine = typeof req.query.machine === 'string' ? req.query.machine : undefined;
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    const subProcess = typeof req.query.subProcess === 'string' ? req.query.subProcess : undefined;
    const shift = typeof req.query.shift === 'string' ? req.query.shift.toUpperCase() : undefined;
    const data = await LiveDashboardService.getMachineHeadDashboard(req.user!.id, roles, {
      machine,
      search,
      subProcess,
      shift,
    });
    res.json(data);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to load machine head dashboard';
    res.status(500).json({ error: msg });
  }
});

router.get('/machines', async (req, res) => {
  try {
    const roles = req.user?.roles ?? [];
    const filter = await LiveDashboardService.getMachineScope(req.user!.id, roles);
    const machine = typeof req.query.machine === 'string' ? req.query.machine.toUpperCase() : undefined;
    const contextMachine = machine
      ?? (filter?.length === 1 ? filter[0] : undefined);
    const ctx = await LiveDashboardService.getShiftQueueContext(req.user!.id, contextMachine);
    const machines = await LiveDashboardService.getMachineCards(filter);
    res.json({ machines, prodDate: ctx.prodDate, shiftCode: ctx.shiftCode, refreshedAt: new Date().toISOString() });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to load machines';
    res.status(500).json({ error: msg });
  }
});

// ── Machine-level state endpoints ────────────────────────────────────────────

/** GET /live/machines/:machineCode/state — current machine state + active event */
router.get('/machines/:machineCode/state', async (req, res) => {
  try {
    const roles = req.user?.roles ?? [];
    const filter = await LiveDashboardService.getMachineScope(req.user!.id, roles);
    if (filter !== null) {
      if (filter.length === 0 || !filter.includes(req.params.machineCode)) {
        return res.status(403).json({ error: 'Machine not in your scope' });
      }
    }
    const data = await LiveDashboardService.getMachineCommandCenterData(req.params.machineCode);
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
    const roles = req.user?.roles ?? [];
    const filter = await LiveDashboardService.getMachineScope(req.user!.id, roles);
    if (filter !== null) {
      if (filter.length === 0 || !filter.includes(req.params.machineCode)) {
        return res.status(403).json({ error: 'Machine not in your scope' });
      }
    }
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
    const roles = req.user?.roles ?? [];
    const filter = await LiveDashboardService.getMachineScope(req.user!.id, roles);
    if (filter !== null) {
      if (filter.length === 0 || !filter.includes(req.params.machineCode)) {
        return res.status(403).json({ error: 'Machine not in your scope' });
      }
    }
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
    const next = await LiveOrderService.getNextOrder(req.params.machineCode);
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
      const filter = await LiveDashboardService.getMachineScope(req.user!.id, roles);
      const machines = await LiveDashboardService.getMachineCards(filter);
      res.write(`data: ${JSON.stringify({ type: 'MACHINES_UPDATE', machines, ts: new Date().toISOString() })}\n\n`);
    } catch {
      // swallow — client will reconnect
    }
  };

  // Send immediately on connect, then every 8 seconds (matches client poll)
  await sendEvent();
  const interval = setInterval(sendEvent, 8_000);

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
