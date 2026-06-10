import type {
  LiveKpis,
  LiveOrderDetail,
  LiveOrderRow,
  LiveSnapshot,
  MachineHeadDashboardData,
  MachineLiveStatus,
  MachineStatusCard,
  MachineCommandCenterData,
  OrderJourneyView,
} from '@m1/shared-validation';
import { db } from '../db';
import { ProcessRouteService } from './ProcessRouteService';
import { MachineStateEventService } from './MachineStateEventService';
import { MachineRegistryService } from './MachineRegistryService';
const QUEUE_STATUSES = ['PENDING', 'PREPARING', 'IN_PROGRESS', 'STOPPAGE', 'COMPLETED'] as const;
const ACTIVE_STATUSES = ['PENDING', 'PREPARING', 'IN_PROGRESS', 'STOPPAGE'] as const;
const ORDER_STATUS_PRIORITY: Record<string, number> = {
  STOPPAGE: 4,
  IN_PROGRESS: 3,
  PREPARING: 2,
  PENDING: 1,
};

const PRODUCTION_ORDER_STATUSES = ['IN_PROGRESS', 'STOPPAGE'] as const;

const OPEN_EVENT_PRIORITY: Record<string, number> = {
  MAINTENANCE_STARTED: 50,
  STOPPAGE_STARTED: 40,
  RUNNING_STARTED: 30,
  IDLE_STARTED: 20,
};

function statusFromActiveOrder(
  orderStatus: string,
  stoppageCategory?: string | null,
): MachineLiveStatus | null {
  if (orderStatus === 'STOPPAGE') {
    return stoppageCategory === 'BREAKDOWN' ? 'BREAKDOWN' : 'STOPPAGE';
  }
  if (orderStatus === 'IN_PROGRESS') {
    return 'RUNNING';
  }
  return null;
}

function resolveMachineLiveStatus(
  masterStatus: string | null | undefined,
  event: {
    event_type: string;
    category_code?: string | null;
  } | undefined,
  activeOrder: {
    status: string;
    stoppage_category?: string | null;
  } | undefined,
): MachineLiveStatus {
  if (masterStatus === 'MAINTENANCE' || event?.event_type === 'MAINTENANCE_STARTED') {
    return 'MAINTENANCE';
  }

  const fromOrder = activeOrder
    ? statusFromActiveOrder(activeOrder.status, activeOrder.stoppage_category)
    : null;

  if (fromOrder === 'STOPPAGE' || fromOrder === 'BREAKDOWN') {
    return fromOrder;
  }
  if (event?.event_type === 'STOPPAGE_STARTED') {
    return event.category_code === 'BREAKDOWN' ? 'BREAKDOWN' : 'STOPPAGE';
  }

  if (fromOrder === 'RUNNING') {
    return 'RUNNING';
  }
  if (event?.event_type === 'RUNNING_STARTED' && activeOrder?.status === 'IN_PROGRESS') {
    return 'RUNNING';
  }
  if (event?.event_type === 'IDLE_STARTED') {
    return 'IDLE';
  }

  return 'IDLE';
}

function resolveStateSinceAt(
  status: MachineLiveStatus,
  event: { occurred_at: Date | string; event_type: string } | undefined,
  activeOrder: {
    prod_start_at?: Date | string | null;
    stoppage_start_at?: Date | string | null;
  } | undefined,
): Date | undefined {
  if (status === 'STOPPAGE' || status === 'BREAKDOWN') {
    const raw = event?.event_type === 'STOPPAGE_STARTED'
      ? event.occurred_at
      : activeOrder?.stoppage_start_at;
    return raw ? new Date(raw) : undefined;
  }
  if (status === 'RUNNING') {
    const raw = event?.event_type === 'RUNNING_STARTED'
      ? event.occurred_at
      : activeOrder?.prod_start_at;
    return raw ? new Date(raw) : undefined;
  }
  if (status === 'IDLE' || status === 'MAINTENANCE') {
    return event?.occurred_at ? new Date(event.occurred_at) : undefined;
  }
  return undefined;
}

function pickOpenEvent<T extends { event_type: string; occurred_at: Date | string }>(
  events: T[],
): T | undefined {
  if (events.length === 0) return undefined;
  return [...events].sort((a, b) => {
    const priA = OPEN_EVENT_PRIORITY[a.event_type] ?? 0;
    const priB = OPEN_EVENT_PRIORITY[b.event_type] ?? 0;
    if (priB !== priA) return priB - priA;
    return new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime();
  })[0];
}

function mapSixHiStatus(raw: string, prepReady?: boolean): LiveOrderRow['status'] {
  if (raw === 'PENDING' && prepReady) return 'PREPARING';
  return raw as LiveOrderRow['status'];
}

function processLabel(subProcess: string): string {
  if (subProcess === 'SKIN_PASS') return 'Skin Pass';
  if (subProcess === 'ROLLING') return 'Rolling';
  return subProcess;
}

function journeyProgress(journey: OrderJourneyView | null | undefined): {
  nextProcess?: string;
  completionPct?: number;
} {
  if (!journey || journey.steps.length === 0) {
    return { nextProcess: '—', completionPct: undefined };
  }
  const steps = journey.steps.filter((s) => s.label !== 'Packaging');
  const total = steps.length || 1;
  const completed = steps.filter((s) => s.status === 'COMPLETED').length;
  if (journey.status === 'COMPLETED') {
    return { nextProcess: 'Complete', completionPct: 100 };
  }
  const active = steps.find((s) => s.status === 'ACTIVE');
  const nextPending = steps.find((s) => s.status === 'PENDING');
  return {
    nextProcess: active?.label ?? nextPending?.label ?? '—',
    completionPct: Math.floor((completed / total) * 100),
  };
}

async function formatShiftWindow(shiftCode?: string | null): Promise<string | undefined> {
  if (!shiftCode) return undefined;
  const shift = await db.selectFrom('master.shift')
    .select(['name', 'start_time', 'end_time'])
    .where('shift_code', '=', shiftCode)
    .executeTakeFirst();
  if (!shift) return undefined;
  const fmt = (t: string) => String(t).slice(0, 5);
  return `${shift.name} - ${fmt(String(shift.start_time))} to ${fmt(String(shift.end_time))}`;
}
export { resolveMachineLiveStatus, resolveStateSinceAt, statusFromActiveOrder };

export class LiveService {
  static async getMachineScope(userId: number, roles: string[]): Promise<string[] | null> {
    if (roles.includes('PLANT_HEAD') || roles.includes('ADMIN')) return null;
    if (roles.includes('MACHINE_HEAD')) {
      const rows = await db.selectFrom('security.machine_access')
        .select('machine_code')
        .where('user_id', '=', userId)
        .execute();
      return rows.map((r) => r.machine_code);
    }
    return [];
  }

  static async getActiveOrders(
    machineFilter: string[] | null,
    planDate?: string,
    shiftCode?: string,
  ): Promise<LiveOrderRow[]> {
    const { SixHiService } = await import('./SixHiService');
    const defaultDate = planDate ?? new Date().toISOString().slice(0, 10);
    const defaultShift = shiftCode ?? 'B';

    let machines: string[];
    if (machineFilter === null) {
      machines = await MachineRegistryService.getOperationalMachineCodes(null);
    } else if (machineFilter.length === 0) {
      return [];
    } else {
      machines = machineFilter;
    }

    const machineContextsMap = await SixHiService.resolveMachinePlanContexts(
      defaultDate,
      defaultShift,
      machines,
    );
    const machineContexts = machines.map((machineCode) => ({
      machineCode,
      ...(machineContextsMap.get(machineCode) ?? { planDate: defaultDate, shiftCode: defaultShift }),
    }));

    if (machineContexts.length === 0) return [];

    let q = db.selectFrom('planning.ppc_batch as pb')
      .leftJoin('txn.crm6_order as o', 'o.batch_id', 'pb.batch_id')
      .leftJoin('master.machine as m', 'm.machine_code', 'pb.machine_code')
      .leftJoin('security.app_user as u', 'u.user_id', 'o.logged_in_user_id')
      .leftJoin('txn.crm6_rolling as r', 'r.order_id', 'o.order_id')
      .leftJoin('txn.crm6_skinpass as s', 's.order_id', 'o.order_id')
      .select([
        'pb.batch_number',
        'pb.customer_name',
        'pb.grade_code',
        'pb.machine_code',
        'm.name as machine_name',
        'pb.sub_process',
        'pb.ppc_weight_mt',
        'pb.destination',
        'pb.coil_no',
        'pb.shift_code',
        'pb.plan_date',
        'pb.queue_seq',
        'o.status',
        'o.prod_start_at',
        'o.prod_duration_min',
        'u.full_name as operator_name',
        'r.total_passes',
        's.output_thk_mm',
      ])
      .where('pb.machine_allocated', '=', true)
      .where((eb) =>
        eb.or(
          machineContexts.map((ctx) =>
            eb.and([
              eb('pb.machine_code', '=', ctx.machineCode),
              eb('pb.plan_date', '=', SixHiService.toPlanDate(ctx.planDate)),
              eb('pb.shift_code', '=', ctx.shiftCode),
            ]),
          ),
        ),
      )
      .where((eb) =>
        eb.or([
          eb('o.status', 'in', [...QUEUE_STATUSES]),
          eb('o.status', 'is', null),
        ]),
      );

    const rows = await q.orderBy('pb.queue_seq', 'asc').orderBy('pb.batch_number', 'asc').execute();

    const filtered = rows
      .filter((r) => {
        const st = r.status ?? 'PENDING';
        return QUEUE_STATUSES.includes(st as typeof QUEUE_STATUSES[number]) || st === 'PENDING';
      });

    const coilNos = filtered.map((r) => r.coil_no);
    const journeysByCoil = await ProcessRouteService.getJourneysByCoils(coilNos);

    const orders: LiveOrderRow[] = [];
    for (const r of filtered) {
      const prepReady = (r.status === 'PENDING' || r.status === 'PREPARING') && (
        (r.sub_process === 'ROLLING' && Number(r.total_passes) > 0) ||
        (r.sub_process === 'SKIN_PASS' && r.output_thk_mm != null)
      );
      const status = mapSixHiStatus(r.status ?? 'PENDING', prepReady);
      let runtimeMin = r.prod_duration_min ? Number(r.prod_duration_min) : undefined;
      if (!runtimeMin && r.prod_start_at) {
        runtimeMin = Math.round((Date.now() - new Date(r.prod_start_at).getTime()) / 60000);
      }
      const journey = journeysByCoil.get(r.coil_no) ?? null;
      const progress = journeyProgress(journey);
      orders.push({
        batchNumber: r.batch_number,
        customer: r.customer_name,
        grade: r.grade_code,
        machineCode: r.machine_code,
        machineName: r.machine_name ?? r.machine_code,
        currentProcess: processLabel(r.sub_process),
        operatorName: r.operator_name ?? undefined,
        runtimeMin,
        status,
        weightMt: Number(r.ppc_weight_mt),
        destination: r.destination === 'REWINDING' ? 'REWINDING' : r.destination === 'ANNEALING' ? 'ANNEALING' : undefined,
        subProcess: r.sub_process as LiveOrderRow['subProcess'],
        coilNo: r.coil_no,
        shiftCode: r.shift_code,
        nextProcess: progress.nextProcess,
        completionPct: progress.completionPct,
      });
    }
    return orders;
  }
  static async getMachineCards(
    machineFilter: string[] | null,
  ): Promise<MachineStatusCard[]> {
    let machinesQ = db.selectFrom('master.machine').selectAll().orderBy('machine_code', 'asc');
    if (machineFilter !== null) {
      if (machineFilter.length === 0) return [];
      machinesQ = machinesQ.where('machine_code', 'in', machineFilter);
    }
    const machines = await machinesQ.execute();

    // 1. Get the current active state event for each machine
    const currentEvents = await db.selectFrom('txn.machine_state_event as mse')
      .leftJoin('security.app_user as u', 'u.user_id', 'mse.operator_id')
      .leftJoin('master.stoppage_category as sc', 'sc.category_code', 'mse.category_code')
      .select([
        'mse.machine_code',
        'mse.event_type',
        'mse.occurred_at',
        'mse.batch_number',
        'mse.category_code',
        'mse.reason',
        'mse.shift_code',
        'u.full_name as operator_name',
        'sc.label as stoppage_label',
      ])
      .where('mse.ended_at', 'is', null)
      .execute();

    const eventsByMachine = new Map<string, typeof currentEvents[0]>();
    const eventsGrouped = new Map<string, typeof currentEvents>();
    for (const ev of currentEvents) {
      const bucket = eventsGrouped.get(ev.machine_code) ?? [];
      bucket.push(ev);
      eventsGrouped.set(ev.machine_code, bucket);
    }
    for (const [machineCode, evs] of eventsGrouped) {
      const picked = pickOpenEvent(evs);
      if (picked) eventsByMachine.set(machineCode, picked);
    }

    // 2. In-production orders per machine (any shift/plan — reflects true live state)
    const machineCodes = machines.map((m) => m.machine_code);
    const activeOrderRows = machineCodes.length > 0
      ? await db.selectFrom('planning.ppc_batch as pb')
          .innerJoin('txn.crm6_order as o', 'o.batch_id', 'pb.batch_id')
          .leftJoin('security.app_user as u', 'u.user_id', 'o.logged_in_user_id')
          .leftJoin('txn.crm6_rolling as r', 'r.order_id', 'o.order_id')
          .leftJoin('txn.crm6_skinpass as s', 's.order_id', 'o.order_id')
          .leftJoin('txn.order_stoppage as os', (join) =>
            join.onRef('os.order_id', '=', 'o.order_id').on('os.end_at', 'is', null))
          .leftJoin('master.stoppage_category as sc', 'sc.category_code', 'os.category_code')
          .select([
            'pb.machine_code',
            'o.batch_number',
            'o.status',
            'o.prod_start_at',
            'o.updated_at',
            'pb.coil_no',
            'pb.queue_seq',
            'u.full_name as operator_name',
            'os.category_code as stoppage_category',
            'os.start_at as stoppage_start_at',
            'sc.label as stoppage_label',
            'r.actual_weight_mt as rolling_weight',
            's.actual_weight_mt as skinpass_weight',
          ])
          .where('pb.machine_allocated', '=', true)
          .where('pb.machine_code', 'in', machineCodes)
          .where('o.status', 'in', [...PRODUCTION_ORDER_STATUSES])
          .orderBy('o.updated_at', 'desc')
          .execute()
      : [];

    const activeOrderByMachine = new Map<string, typeof activeOrderRows[0]>();
    for (const row of activeOrderRows) {
      if (!row.machine_code) continue;
      const existing = activeOrderByMachine.get(row.machine_code);
      if (!existing) {
        activeOrderByMachine.set(row.machine_code, row);
        continue;
      }
      const existingPri = ORDER_STATUS_PRIORITY[existing.status] ?? 0;
      const rowPri = ORDER_STATUS_PRIORITY[row.status] ?? 0;
      if (rowPri > existingPri) {
        activeOrderByMachine.set(row.machine_code, row);
      }
    }

    const orderStatsByBatch = new Map<string, typeof activeOrderRows[0]>();
    for (const o of activeOrderRows) {
      orderStatsByBatch.set(o.batch_number, o);
    }

    // 3. Rejects for today (for shift summary)
    const today = new Date().toISOString().slice(0, 10);
    const rejectedOrders = await db.selectFrom('txn.crm6_order as o')
      .innerJoin('planning.ppc_batch as pb', 'pb.batch_id', 'o.batch_id')
      .select(['pb.machine_code', 'pb.ppc_weight_mt'])
      .where('o.status', '=', 'REJECTED')
      .where('o.updated_at', '>=', new Date(today))
      .execute();

    const rejectsByMachine = new Map<string, { count: number, weightMt: number }>();
    for (const r of rejectedOrders) {
      if (!r.machine_code) continue;
      const prev = rejectsByMachine.get(r.machine_code) ?? { count: 0, weightMt: 0 };
      rejectsByMachine.set(r.machine_code, {
        count: prev.count + 1,
        weightMt: prev.weightMt + Number(r.ppc_weight_mt ?? 0),
      });
    }

    // 4. Map to cards
    return machines.map((m): MachineStatusCard => {
      const ev = eventsByMachine.get(m.machine_code);
      const activeOrder = activeOrderByMachine.get(m.machine_code);
      const rejects = rejectsByMachine.get(m.machine_code) ?? { count: 0, weightMt: 0 };
      const orderStats = activeOrder ?? (ev?.batch_number
        ? orderStatsByBatch.get(ev.batch_number)
        : undefined);

      const status = resolveMachineLiveStatus(m.machine_status, ev, activeOrder);

      const weight = orderStats?.skinpass_weight ?? orderStats?.rolling_weight;
      const stateSinceDate = resolveStateSinceAt(status, ev, activeOrder);
      const stateSince = stateSinceDate?.toISOString();

      let runtimeMin: number | undefined;
      if (status === 'RUNNING' && stateSinceDate) {
        runtimeMin = Math.round((Date.now() - stateSinceDate.getTime()) / 60000);
      }

      const batchNumber = (status === 'RUNNING' || status === 'STOPPAGE' || status === 'BREAKDOWN')
        ? (activeOrder?.batch_number ?? ev?.batch_number)
        : undefined;
      const isActive = status === 'RUNNING' || status === 'STOPPAGE' || status === 'BREAKDOWN';

      return {
        machineCode: m.machine_code,
        machineName: m.name,
        status,
        currentOrder: isActive ? (batchNumber ?? undefined) : undefined,
        currentCoil: isActive ? (orderStats?.coil_no ?? undefined) : undefined,
        currentOperator: isActive
          ? (activeOrder?.operator_name ?? ev?.operator_name ?? undefined)
          : undefined,
        stateSinceAt: stateSince,
        activeStoppageReason: (status === 'STOPPAGE' || status === 'BREAKDOWN')
          ? (ev?.stoppage_label ?? activeOrder?.stoppage_label ?? ev?.reason ?? ev?.category_code ?? activeOrder?.stoppage_category ?? undefined)
          : undefined,
        lastOrderBatchNumber: status === 'IDLE' ? (ev?.batch_number ?? activeOrder?.batch_number ?? undefined) : undefined,
        lastOperatorName: status === 'IDLE'
          ? (ev?.operator_name ?? activeOrder?.operator_name ?? undefined)
          : undefined,
        runtimeMin,
        productionWeightMt: weight ? Number(weight) : undefined,
        shiftProgressPct: undefined,
        rejectedCount: rejects.count,
        rejectedWeightMt: rejects.weightMt,
        lastUpdateAt: orderStats?.updated_at ? new Date(orderStats.updated_at).toISOString() : undefined,
        processCode: m.process_code ?? undefined,
        shiftCode: ev?.shift_code ?? undefined,
      };
    });
  }

  /** Full Machine Command Center payload for a specific machine */
  static async getMachineCommandCenterData(machineCode: string): Promise<MachineCommandCenterData | null> {
    const machine = await db.selectFrom('master.machine')
      .selectAll()
      .where('machine_code', '=', machineCode)
      .executeTakeFirst();
    if (!machine) return null;

    const cards = await this.getMachineCards([machineCode]);
    const card = cards[0];
    if (!card) return null;

    // Active order details
    let currentOrder: MachineCommandCenterData['currentOrder'] | undefined;
    const activeOrder = await db.selectFrom('txn.crm6_order as o')
      .innerJoin('planning.ppc_batch as pb', 'pb.batch_id', 'o.batch_id')
      .leftJoin('txn.crm6_rolling as r', 'r.order_id', 'o.order_id')
      .leftJoin('txn.crm6_skinpass as s', 's.order_id', 'o.order_id')
      .select([
        'pb.batch_number', 'pb.customer_name', 'pb.grade_code', 'pb.sub_process',
        'pb.ppc_weight_mt', 'pb.ppc_thk_mm', 'pb.input_thk_mm',
        'o.prod_start_at', 'o.prod_duration_min',
        'r.actual_weight_mt as rolling_actual',
        's.actual_weight_mt as skinpass_actual',
      ])
      .where('pb.machine_code', '=', machineCode)
      .where('pb.machine_allocated', '=', true)
      .where('o.status', 'in', ['IN_PROGRESS', 'STOPPAGE', 'PENDING', 'PREPARING'])
      .orderBy('pb.queue_seq', 'asc')
      .executeTakeFirst();

    if (activeOrder) {
      let runtimeMin = activeOrder.prod_duration_min ? Number(activeOrder.prod_duration_min) : undefined;
      if (!runtimeMin && activeOrder.prod_start_at) {
        runtimeMin = Math.round((Date.now() - new Date(activeOrder.prod_start_at).getTime()) / 60000);
      }
      const actualMt = activeOrder.rolling_actual ?? activeOrder.skinpass_actual;
      currentOrder = {
        batchNumber: activeOrder.batch_number,
        customer: activeOrder.customer_name,
        grade: activeOrder.grade_code,
        subProcess: activeOrder.sub_process,
        weightMt: Number(activeOrder.ppc_weight_mt),
        runningSinceAt: activeOrder.prod_start_at ? new Date(activeOrder.prod_start_at).toISOString() : undefined,
        runtimeMin,
        actualWeightMt: actualMt ? Number(actualMt) : undefined,
        targetThkMm: Number(activeOrder.ppc_thk_mm),
        inputThkMm: activeOrder.input_thk_mm ? Number(activeOrder.input_thk_mm) : undefined,
      };
    }

    // Active stoppage
    let activeStoppage: MachineCommandCenterData['activeStoppage'] | undefined;
    if ((card.status === 'STOPPAGE' || card.status === 'BREAKDOWN') && activeOrder) {
      const stop = await db.selectFrom('txn.order_stoppage as os')
        .leftJoin('security.app_user as u', 'u.user_id', 'os.operator_id')
        .leftJoin('master.stoppage_category as sc', 'sc.category_code', 'os.category_code')
        .select(['os.stoppage_id', 'os.category_code', 'sc.label', 'os.remarks', 'os.start_at', 'u.full_name'])
        .where('os.order_id', '=',
          db.selectFrom('txn.crm6_order').select('order_id').where('batch_number', '=', activeOrder.batch_number),
        )
        .where('os.end_at', 'is', null)
        .executeTakeFirst();
      if (stop) {
        activeStoppage = {
          stoppageId: String(stop.stoppage_id),
          reason: stop.remarks ?? stop.label ?? stop.category_code,
          categoryCode: stop.category_code,
          startAt: new Date(stop.start_at).toISOString(),
          operatorName: stop.full_name ?? undefined,
        };
      }
    }

    // Timeline + analytics from event service
    const [timeline, utilization] = await Promise.all([
      MachineStateEventService.getTimeline(machineCode, 24),
      MachineStateEventService.getUtilizationSummary(machineCode, 24),
    ]);

    const idleHistory = timeline.filter((e) => e.eventType === 'IDLE_STARTED');
    const stoppageHistory = timeline.filter((e) => e.eventType === 'STOPPAGE_STARTED');

    const nextOrder = await this.getNextOrder(machineCode);

    return {
      machineCode: machine.machine_code,
      machineName: machine.name,
      currentStatus: card.status,
      currentOperator: card.currentOperator,
      shiftCode: card.shiftCode,
      currentOrder,
      activeStoppage,
      idleHistory,
      stoppageHistory,
      timeline,
      utilization,
      nextOrder: nextOrder ?? undefined,
    };
  }

  /** Returns the next queued order for a machine (not yet started) */
  static async getNextOrder(machineCode: string) {
    const row = await db.selectFrom('planning.ppc_batch as pb')
      .leftJoin('txn.crm6_order as o', 'o.batch_id', 'pb.batch_id')
      .select(['pb.batch_number', 'pb.customer_name', 'pb.queue_seq', 'pb.ppc_weight_mt'])
      .where('pb.machine_code', '=', machineCode)
      .where('pb.machine_allocated', '=', true)
      .where((eb) => eb.or([
        eb('o.status', '=', 'PENDING'),
        eb('o.status', 'is', null),
      ]))
      .orderBy('pb.queue_seq', 'asc')
      .executeTakeFirst();
    if (!row) return null;
    return {
      batchNumber: row.batch_number,
      customer: row.customer_name,
      queuePosition: row.queue_seq ?? 1,
      weightMt: Number(row.ppc_weight_mt),
    };
  }
  static async getShiftQueueContext(userId: number): Promise<{ planDate: string; shiftCode: string }> {
    const { ShiftDetectionService } = await import('./ShiftDetectionService');
    const current = await ShiftDetectionService.getCurrentShift({ userId });
    return { planDate: current.prodDate, shiftCode: current.shiftCode };
  }

  static async getSnapshot(userId: number, roles: string[]): Promise<LiveSnapshot> {
    const machineFilter = await this.getMachineScope(userId, roles);
    const { planDate, shiftCode } = await this.getShiftQueueContext(userId);
    const machines = await this.getMachineCards(machineFilter);
    const orders = await this.getActiveOrders(machineFilter, planDate, shiftCode);

    const running = machines.filter((m) => m.status === 'RUNNING').length;
    const idle = machines.filter((m) => m.status === 'IDLE').length;
    const breakdown = machines.filter((m) => m.status === 'BREAKDOWN' || m.status === 'STOPPAGE').length;
    const queuedProductionMt = orders.reduce((s, o) => s + o.weightMt, 0);
    const stoppages = machines.filter((m) => m.status === 'STOPPAGE' || m.status === 'BREAKDOWN').length;
    const total = machines.length || 1;

    const kpis: LiveKpis = {
      runningMachines: running,
      idleMachines: idle,
      breakdownMachines: breakdown,
      activeOrders: orders.length,
      queuedProductionMt: Math.round(queuedProductionMt * 10) / 10,
      currentStoppages: stoppages,
      machinesRunningPct: Math.round((running / total) * 100),
      shiftPerformancePct: Math.min(100, Math.round((orders.filter((o) => o.status === 'IN_PROGRESS').length / Math.max(orders.length, 1)) * 100)),
    };

    return { kpis, machines, refreshedAt: new Date().toISOString() };
  }

  static async getOrderDetail(
    batchNumber: string,
    machineFilter: string[] | null = null,
  ): Promise<LiveOrderDetail | null> {
    const batch = await db.selectFrom('planning.ppc_batch as pb')
      .leftJoin('txn.crm6_order as o', 'o.batch_id', 'pb.batch_id')
      .leftJoin('master.machine as m', 'm.machine_code', 'pb.machine_code')
      .leftJoin('security.app_user as u', 'u.user_id', 'o.logged_in_user_id')
      .leftJoin('txn.crm6_rolling as r', 'r.order_id', 'o.order_id')
      .leftJoin('txn.crm6_skinpass as s', 's.order_id', 'o.order_id')
      .select([
        'pb.batch_number', 'pb.customer_name', 'pb.grade_code', 'pb.machine_code',
        'm.name as machine_name', 'pb.sub_process', 'pb.ppc_weight_mt', 'pb.destination',
        'pb.coil_no', 'pb.shift_code', 'pb.width_mm', 'pb.input_thk_mm', 'pb.ppc_thk_mm',
        'pb.ppc_reroll_flag', 'pb.active_rolling_pass_no',
        'pb.sap_order_no', 'o.status', 'o.prod_start_at', 'o.prod_duration_min',
        'u.full_name as operator_name', 'r.total_passes', 's.output_thk_mm', 'o.order_id',
      ])
      .where('pb.batch_number', '=', batchNumber)
      .executeTakeFirst();

    if (!batch) return null;

    if (machineFilter !== null) {
      if (machineFilter.length === 0) return null;
      if (!machineFilter.includes(batch.machine_code)) return null;
    }

    const prepReady = batch.status === 'PENDING' && (
      (batch.sub_process === 'ROLLING' && Number(batch.total_passes) > 0) ||
      (batch.sub_process === 'SKIN_PASS' && batch.output_thk_mm != null)
    );

    let journey = await ProcessRouteService.getJourneyByCoil(batch.coil_no);
    const isReroll = !!(batch.ppc_reroll_flag || (batch.active_rolling_pass_no && Number(batch.active_rolling_pass_no) > 1));
    if (journey && isReroll) {
      journey = {
        ...journey,
        steps: journey.steps.map((s) => ({
          ...s,
          isReroll: s.subProcess === 'ROLLING' ? true : s.isReroll,
          rollingPassNo: s.subProcess === 'ROLLING' && batch.active_rolling_pass_no
            ? Number(batch.active_rolling_pass_no)
            : s.rollingPassNo,
        })),
      };
    }

    const stoppages = batch.order_id
      ? await db.selectFrom('txn.order_stoppage')
          .selectAll()
          .where('order_id', '=', batch.order_id)
          .orderBy('start_at', 'desc')
          .execute()
      : [];

    const remarks = batch.order_id
      ? await db.selectFrom('txn.order_remark as r')
          .leftJoin('security.app_user as u', 'u.user_id', 'r.operator_id')
          .select(['r.remark_id', 'r.text', 'r.created_at', 'u.full_name'])
          .where('r.order_id', '=', batch.order_id)
          .orderBy('r.created_at', 'desc')
          .execute()
      : [];

    const productionHistory = journey?.steps.map((s) => ({
      step: s.label,
      completedAt: s.completedAt,
      status: s.status,
    })) ?? [];

    let runtimeMin = batch.prod_duration_min ? Number(batch.prod_duration_min) : undefined;
    if (!runtimeMin && batch.prod_start_at) {
      runtimeMin = Math.round((Date.now() - new Date(batch.prod_start_at).getTime()) / 60000);
    }

    const progress = journeyProgress(journey);
    const currentShiftWindow = await formatShiftWindow(batch.shift_code);
    const processRouteLabels = journey?.steps
      .filter((s) => s.label !== 'Packaging')
      .map((s) => s.label)
      .join(', ');

    return {
      batchNumber: batch.batch_number,
      customer: batch.customer_name,
      grade: batch.grade_code,
      machineCode: batch.machine_code,
      machineName: batch.machine_name ?? batch.machine_code,
      currentProcess: processLabel(batch.sub_process),
      operatorName: batch.operator_name ?? undefined,
      runtimeMin,
      status: mapSixHiStatus(batch.status ?? 'PENDING', prepReady),
      weightMt: Number(batch.ppc_weight_mt),
      destination: batch.destination === 'REWINDING' ? 'REWINDING' : batch.destination === 'ANNEALING' ? 'ANNEALING' : undefined,
      subProcess: batch.sub_process as LiveOrderDetail['subProcess'],
      coilNo: batch.coil_no,
      shiftCode: batch.shift_code,
      widthMm: Number(batch.width_mm),
      inputThkMm: batch.input_thk_mm ? Number(batch.input_thk_mm) : undefined,
      targetThkMm: Number(batch.ppc_thk_mm),
      sapOrderNo: batch.sap_order_no ?? undefined,
      processRouteLabels: processRouteLabels || undefined,
      currentShiftWindow,
      nextProcess: progress.nextProcess,
      completionPct: progress.completionPct,
      journey: journey ?? undefined,      stoppages: stoppages.map((s) => ({
        id: String(s.stoppage_id),
        category: s.category_code,
        breakdownCode: s.breakdown_code ?? undefined,
        startAt: new Date(s.start_at).toISOString(),
        endAt: s.end_at ? new Date(s.end_at).toISOString() : undefined,
        durationMin: s.duration_min ? Number(s.duration_min) : undefined,
        remarks: s.remarks ?? undefined,
      })),
      remarks: remarks.map((r) => ({
        id: String(r.remark_id),
        text: r.text,
        createdAt: new Date(r.created_at).toISOString(),
        operatorName: r.full_name ?? undefined,
      })),
      productionHistory,
    };
  }

  /** Completed production MT for a shift plan, using actual rolling/skin-pass weights. */
  static async getShiftCompletedProductionMt(
    machineFilter: string[] | null,
    planDate: string,
    shiftCode: string,
  ): Promise<{ actualMt: number; completedOrderCount: number }> {
    if (machineFilter !== null && machineFilter.length === 0) {
      return { actualMt: 0, completedOrderCount: 0 };
    }

    const { SixHiService } = await import('./SixHiService');

    let q = db
      .selectFrom('txn.crm6_order as o')
      .innerJoin('planning.ppc_batch as pb', 'pb.batch_id', 'o.batch_id')
      .select(['o.order_id', 'o.sub_process', 'pb.ppc_weight_mt'])
      .where('o.status', '=', 'COMPLETED')
      .where('pb.plan_date', '=', SixHiService.toPlanDate(planDate))
      .where('pb.shift_code', '=', shiftCode);

    if (machineFilter !== null) {
      q = q.where('pb.machine_code', 'in', machineFilter);
    }

    const rows = await q.execute();
    let actualMt = 0;
    for (const row of rows) {
      actualMt += await SixHiService.resolveOrderWeight(
        String(row.order_id),
        row.sub_process,
        Number(row.ppc_weight_mt),
      );
    }

    return {
      actualMt: Math.round(actualMt * 10) / 10,
      completedOrderCount: rows.length,
    };
  }

  static async getMachineHeadDashboard(
    userId: number,
    roles: string[],
  ): Promise<MachineHeadDashboardData> {
    const machineFilter = await this.getMachineScope(userId, roles);
    const { planDate, shiftCode } = await this.getShiftQueueContext(userId);
    const { SixHiService } = await import('./SixHiService');
    const orders = await this.getActiveOrders(machineFilter, planDate, shiftCode);
    const primaryMachine = machineFilter?.[0] ?? orders[0]?.machineCode ?? '6HI';
    const queueCtx = await SixHiService.resolveMachinePlanContext(planDate, shiftCode, primaryMachine);
    const machines = await this.getMachineCards(machineFilter);

    const shiftLog = await db.selectFrom('txn.shift_log')
      .select(['target_mt'])
      .where('prod_date', '=', SixHiService.toPlanDate(queueCtx.planDate))
      .where('shift_code', '=', queueCtx.shiftCode)
      .where('process_id', '=', 31)
      .executeTakeFirst();

    const completed = machineFilter
      ? await db
          .selectFrom('txn.crm6_order as o')
          .innerJoin('planning.ppc_batch as pb', 'pb.batch_id', 'o.batch_id')
          .select([
            'o.order_id',
            'o.sub_process',
            'pb.batch_number',
            'pb.machine_code',
            'o.prod_end_at',
            'pb.ppc_weight_mt',
          ])
          .where('o.status', '=', 'COMPLETED')
          .where('pb.machine_code', 'in', machineFilter)
          .orderBy('o.prod_end_at', 'desc')
          .limit(10)
          .execute()
      : await db
          .selectFrom('txn.crm6_order as o')
          .innerJoin('planning.ppc_batch as pb', 'pb.batch_id', 'o.batch_id')
          .select([
            'o.order_id',
            'o.sub_process',
            'pb.batch_number',
            'pb.machine_code',
            'o.prod_end_at',
            'pb.ppc_weight_mt',
          ])
          .where('o.status', '=', 'COMPLETED')
          .orderBy('o.prod_end_at', 'desc')
          .limit(10)
          .execute();

    let stoppageQ = db.selectFrom('txn.order_stoppage as os')
      .innerJoin('txn.crm6_order as o', 'o.order_id', 'os.order_id')
      .innerJoin('planning.ppc_batch as pb', 'pb.batch_id', 'o.batch_id')
      .innerJoin('master.stoppage_category as sc', 'sc.category_code', 'os.category_code')
      .select([
        'pb.batch_number',
        'pb.machine_code',
        'sc.label as category',
        'os.duration_min',
        'os.start_at',
      ])
      .where('os.end_at', 'is', null);
    if (machineFilter !== null) {
      if (machineFilter.length === 0) {
        return {
          orderQueue: [],
          shiftSummary: {
            shiftCode: queueCtx.shiftCode,
            planDate: queueCtx.planDate,
            targetMt: 0,
            actualMt: 0,
            queuedMt: 0,
            orderCount: 0,
            completedOrderCount: 0,
          },
          runtimeUtilization: [],
          stoppages: [],
          operatorActivity: [],
          productionHistory: [],
          handoverOverview: { pending: [], recent: [], awaitingAcceptance: 0 },
        };
      }
      stoppageQ = stoppageQ.where('pb.machine_code', 'in', machineFilter);
    }
    const stoppageRows = await stoppageQ.orderBy('os.start_at', 'desc').limit(15).execute();

    const queuedMt = Math.round(orders.reduce((s, o) => s + o.weightMt, 0) * 10) / 10;
    const { actualMt, completedOrderCount } = await this.getShiftCompletedProductionMt(
      machineFilter,
      queueCtx.planDate,
      queueCtx.shiftCode,
    );

    const { MachineHandoverService } = await import('./MachineHandoverService');
    const handoverOverview = await MachineHandoverService.getHandoverOverview(machineFilter);

    return {
      orderQueue: orders,
      shiftSummary: {
        shiftCode: queueCtx.shiftCode,
        planDate: queueCtx.planDate,
        targetMt: Number(shiftLog?.target_mt ?? 0),
        actualMt,
        queuedMt,
        orderCount: orders.length,
        completedOrderCount,
      },
      runtimeUtilization: await Promise.all(machines.map(async (m) => {
        try {
          const summary = await MachineStateEventService.getUtilizationSummary(m.machineCode, 24);
          return {
            machineCode: m.machineCode,
            machineName: m.machineName,
            runtimeUtilizationPct: summary.runningPct,
            windowHours: summary.windowHours,
          };
        } catch {
          return {
            machineCode: m.machineCode,
            machineName: m.machineName,
            runtimeUtilizationPct: 0,
            windowHours: 24,
          };
        }
      })),
      stoppages: stoppageRows.map((s) => ({
        batchNumber: s.batch_number,
        machineCode: s.machine_code,
        category: s.category,
        durationMin: s.duration_min ? Number(s.duration_min) : undefined,
        startAt: new Date(s.start_at).toISOString(),
      })),
      operatorActivity: orders
        .filter((o) => o.operatorName)
        .map((o) => ({
          operatorName: o.operatorName!,
          batchNumber: o.batchNumber,
          machineCode: o.machineCode,
          status: o.status,
        })),
      handoverOverview,
      productionHistory: await Promise.all(
        completed
          .filter((c) => c.prod_end_at)
          .map(async (c) => ({
            batchNumber: c.batch_number,
            machineCode: c.machine_code,
            completedAt: new Date(c.prod_end_at!).toISOString(),
            weightMt: await SixHiService.resolveOrderWeight(
              String(c.order_id),
              c.sub_process,
              Number(c.ppc_weight_mt),
            ),
          })),
      ),
    };
  }
}