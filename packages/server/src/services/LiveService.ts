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
import { sql } from 'kysely';
import { db } from '../db';
import { loadOrderRejection } from './orderRejectionLoader';
import { ProcessRouteService } from './ProcessRouteService';
import { MachineStateEventService } from './MachineStateEventService';
import { MachineRegistryService } from './MachineRegistryService';
import { MachineCrewService } from './MachineCrewService';
import { currentPlantDate, startOfDateFilter } from '../utils/dateOnly';
/** Live shopfloor queue — no COMPLETED (those belong in production history). */
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

function pickOperatorRemarks(
  activeOrder?: { stoppage_remarks?: string | null },
  ev?: { reason?: string | null; category_code?: string | null },
): string | undefined {
  const orderRemarks = activeOrder?.stoppage_remarks?.trim();
  if (orderRemarks) return orderRemarks;
  const eventReason = ev?.reason?.trim();
  if (!eventReason) return undefined;
  if (ev?.category_code && eventReason === ev.category_code) return undefined;
  return eventReason;
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
        .where('user_id', '=', userId as any)
        .execute();
      return rows.map((r) => r.machine_code);
    }
    return [];
  }

  /**
   * Live shopfloor queue for allocated machines.
   * planDate/shiftCode are intentionally unused: backlog + in-progress work spans
   * planned shifts. Pass opts.planScoped to filter PENDING/PREPARING by plan.
   */
  static async getActiveOrders(
    machineFilter: string[] | null,
    planDate?: string,
    shiftCode?: string,
    opts: { search?: string; planScoped?: boolean; subProcess?: string } = {},
  ): Promise<LiveOrderRow[]> {
    let machines: string[];
    if (machineFilter === null) {
      machines = await MachineRegistryService.getOperationalMachineCodes(null);
    } else if (machineFilter.length === 0) {
      return [];
    } else {
      machines = machineFilter;
    }

    let q = db.selectFrom('planning.ppc_batch as pb')
      .leftJoin('txn.crm_order as o', 'o.batch_id', 'pb.batch_id')
      .leftJoin('master.machine as m', 'm.machine_code', 'pb.machine_code')
      .leftJoin('security.app_user as u', 'u.user_id', 'o.logged_in_user_id')
      .leftJoin('txn.crm_rolling as r', 'r.order_id', 'o.order_id')
      .leftJoin('txn.crm_skinpass as s', 's.order_id', 'o.order_id')
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
        'pb.slit_id',
        'pb.shift_code',
        'pb.plan_date',
        'pb.queue_seq',
        'o.status',
        'o.coil_no as order_coil_no',
        'o.slit_id as order_slit_id',
        'o.prod_start_at',
        'o.prod_duration_min',
        'u.full_name as operator_name',
        'r.total_passes',
        's.output_thk_mm',
      ])
      .where('pb.machine_allocated', '=', true)
      .where('pb.machine_code', 'in', machines)
      .where((eb) =>
        eb.or([
          eb('o.status', 'in', [...ACTIVE_STATUSES]),
          eb('o.status', 'is', null),
        ]),
      );

    if (opts.subProcess === 'ROLLING' || opts.subProcess === 'SKIN_PASS') {
      q = q.where('pb.sub_process', '=', opts.subProcess);
    }
    if (opts.search?.trim()) {
      const term = `%${opts.search.trim()}%`;
      q = q.where((eb) =>
        eb.or([
          eb('pb.batch_number', 'ilike', term),
          eb('pb.coil_no', 'ilike', term),
          eb('pb.slit_id', 'ilike', term),
          eb('pb.customer_name', 'ilike', term),
          eb('pb.grade_code', 'ilike', term),
        ]),
      );
    }
    // ponytail: planScoped only for explicit plan views; live boards keep backlog
    if (opts.planScoped && planDate && shiftCode) {
      const { SixHiShiftService } = await import('./sixHi');
      q = q.where((eb) =>
        eb.or([
          eb('o.status', 'in', [...PRODUCTION_ORDER_STATUSES]),
          eb.and([
            eb.or([
              eb('o.status', 'in', ['PENDING', 'PREPARING']),
              eb('o.status', 'is', null),
            ]),
            eb('pb.plan_date', '=', SixHiShiftService.toPlanDate(planDate)),
            eb('pb.shift_code', '=', shiftCode),
          ]),
        ]),
      );
    }

    const rows = await q.orderBy('pb.queue_seq', 'asc').orderBy('pb.batch_number', 'asc').execute();

    const filtered = rows
      .filter((r) => {
        const st = r.status ?? 'PENDING';
        return ACTIVE_STATUSES.includes(st as typeof ACTIVE_STATUSES[number]);
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
      const coilNo = (r.order_coil_no ?? r.coil_no ?? '').trim() || r.batch_number;
      const slitId = (r.order_slit_id ?? r.slit_id ?? undefined) || undefined;
      const journey = journeysByCoil.get(r.coil_no) ?? journeysByCoil.get(coilNo) ?? null;
      const progress = journeyProgress(journey);
      // No logged-in user → fall back to the machine's crew-register operator.
      const operatorName = r.operator_name ?? (r.machine_code
        ? await MachineCrewService.getOperatorName(r.machine_code)
        : undefined);
      orders.push({
        batchNumber: r.batch_number,
        customer: r.customer_name,
        grade: r.grade_code,
        machineCode: r.machine_code,
        machineName: r.machine_name ?? r.machine_code,
        currentProcess: processLabel(r.sub_process),
        operatorName,
        runtimeMin,
        status,
        weightMt: Number(r.ppc_weight_mt),
        destination: r.destination === 'REWINDING' ? 'REWINDING' : r.destination === 'ANNEALING' ? 'ANNEALING' : undefined,
        subProcess: r.sub_process as LiveOrderRow['subProcess'],
        coilNo,
        motherCoil: coilNo,
        slitId: slitId?.trim() || undefined,
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
        .innerJoin('txn.crm_order as o', 'o.batch_id', 'pb.batch_id')
        .leftJoin('security.app_user as u', 'u.user_id', 'o.logged_in_user_id')
        .leftJoin('txn.crm_rolling as r', 'r.order_id', 'o.order_id')
        .leftJoin('txn.crm_skinpass as s', 's.order_id', 'o.order_id')
        .leftJoin('txn.stoppage as os', (join) =>
          join.onRef('os.order_id', '=', 'o.order_id').on('os.end_at', 'is', null))
        .leftJoin('master.stoppage_category as sc', 'sc.category_code', 'os.category_code')
        .select([
          'pb.machine_code',
          'o.batch_number',
          'o.status',
          'o.prod_start_at',
          'o.updated_at',
          'pb.coil_no',
          'pb.customer_name',
          'pb.queue_seq',
          'u.full_name as operator_name',
          'os.category_code as stoppage_category',
          'os.start_at as stoppage_start_at',
          'os.remarks as stoppage_remarks',
          'sc.label as stoppage_label',
          'r.actual_weight_mt as rolling_weight',
          's.actual_weight_mt as skinpass_weight',
          'pb.ppc_weight_mt',
        ])
        .where('pb.machine_allocated', '=', true)
        .where('pb.machine_code', 'in', machineCodes)
        .where('o.status', 'in', [...PRODUCTION_ORDER_STATUSES])
        .orderBy('o.updated_at', 'desc')
        .execute()
      : [];

    const activeOrdersByMachine = new Map<string, typeof activeOrderRows>();
    const activeOrderByMachine = new Map<string, typeof activeOrderRows[0]>();
    for (const row of activeOrderRows) {
      if (!row.machine_code) continue;
      const bucket = activeOrdersByMachine.get(row.machine_code) ?? [];
      if (!bucket.some((r) => r.batch_number === row.batch_number)) {
        bucket.push(row);
        activeOrdersByMachine.set(row.machine_code, bucket);
      }
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
    const today = currentPlantDate();
    const rejectedOrders = await db.selectFrom('txn.crm_order as o')
      .innerJoin('planning.ppc_batch as pb', 'pb.batch_id', 'o.batch_id')
      .select(['pb.machine_code', 'pb.ppc_weight_mt'])
      .where('o.status', '=', 'REJECTED')
      .where('o.updated_at', '>=', startOfDateFilter(today))
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

    // 3b. ACTIVE session shift per machine (prefer over event PPC shift)
    const { ShiftDetectionService } = await import('./ShiftDetectionService');
    const sessionShiftByMachine = new Map<string, string>();
    await Promise.all(
      machineCodes.map(async (code) => {
        const detected = await ShiftDetectionService.getCurrentShift({ machineCode: code });
        if (detected.source === 'SESSION') {
          sessionShiftByMachine.set(code, detected.shiftCode);
        }
      }),
    );

    // 4. Map to cards
    return machines.map((m): MachineStatusCard => {
      const ev = eventsByMachine.get(m.machine_code);
      const activeOrder = activeOrderByMachine.get(m.machine_code);
      const machineActiveOrders = activeOrdersByMachine.get(m.machine_code) ?? [];
      const rejects = rejectsByMachine.get(m.machine_code) ?? { count: 0, weightMt: 0 };
      const orderStats = activeOrder ?? (ev?.batch_number
        ? orderStatsByBatch.get(ev.batch_number)
        : undefined);

      const status = resolveMachineLiveStatus(m.machine_status, ev, activeOrder);

      const weight = orderStats?.skinpass_weight ?? orderStats?.rolling_weight;
      const targetMt = Number(orderStats?.ppc_weight_mt ?? 0);
      const actualMt = weight != null ? Number(weight) : 0;
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
        operatorRemarks: (status === 'STOPPAGE' || status === 'BREAKDOWN' || status === 'RUNNING' || status === 'IDLE')
          ? pickOperatorRemarks(activeOrder, ev)
          : undefined,
        lastOrderBatchNumber: status === 'IDLE' ? (ev?.batch_number ?? activeOrder?.batch_number ?? undefined) : undefined,
        lastOperatorName: status === 'IDLE'
          ? (ev?.operator_name ?? activeOrder?.operator_name ?? undefined)
          : undefined,
        runtimeMin,
        productionWeightMt: weight ? Number(weight) : undefined,
        shiftProgressPct: targetMt > 0 ? Math.round(Math.min((actualMt / targetMt) * 100, 100)) : undefined,
        rejectedCount: rejects.count,
        rejectedWeightMt: rejects.weightMt,
        lastUpdateAt: orderStats?.updated_at ? new Date(orderStats.updated_at).toISOString() : undefined,
        processCode: m.process_code ?? undefined,
        shiftCode: sessionShiftByMachine.get(m.machine_code) ?? ev?.shift_code ?? undefined,
        activeOrderCount: machineActiveOrders.length > 1 ? machineActiveOrders.length : undefined,
        activeOrders: machineActiveOrders.length > 1
          ? machineActiveOrders.map((o) => ({
            batchNumber: o.batch_number,
            coilNo: o.coil_no ?? undefined,
            status: o.status,
            customer: o.customer_name ?? undefined,
            weightMt: o.ppc_weight_mt != null ? Number(o.ppc_weight_mt) : undefined,
          }))
          : undefined,
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
    const activeOrders = await db.selectFrom('txn.crm_order as o')
      .innerJoin('planning.ppc_batch as pb', 'pb.batch_id', 'o.batch_id')
      .leftJoin('txn.crm_rolling as r', 'r.order_id', 'o.order_id')
      .leftJoin('txn.crm_skinpass as s', 's.order_id', 'o.order_id')
      .select([
        'pb.batch_number', 'pb.coil_no', 'pb.customer_name', 'pb.grade_code', 'pb.sub_process',
        'pb.ppc_weight_mt', 'pb.ppc_thk_mm', 'pb.input_thk_mm',
        'o.status', 'o.prod_start_at', 'o.prod_duration_min',
        'r.actual_weight_mt as rolling_actual',
        's.actual_weight_mt as skinpass_actual',
      ])
      .where('pb.machine_code', '=', machineCode)
      .where('pb.machine_allocated', '=', true)
      .where('o.status', 'in', ['IN_PROGRESS', 'STOPPAGE'])
      .orderBy('pb.queue_seq', 'asc')
      .execute();

    const activeOrder = activeOrders[0];
    const activeOrderSummaries = activeOrders.map((row) => {
      let runtimeMin = row.prod_duration_min ? Number(row.prod_duration_min) : undefined;
      if (!runtimeMin && row.prod_start_at) {
        runtimeMin = Math.round((Date.now() - new Date(row.prod_start_at).getTime()) / 60000);
      }
      const actualMt = row.rolling_actual ?? row.skinpass_actual;
      return {
        batchNumber: row.batch_number,
        coilNo: row.coil_no ?? undefined,
        customer: row.customer_name,
        grade: row.grade_code,
        subProcess: row.sub_process,
        status: row.status,
        weightMt: Number(row.ppc_weight_mt),
        targetThkMm: Number(row.ppc_thk_mm),
        inputThkMm: row.input_thk_mm ? Number(row.input_thk_mm) : undefined,
        runtimeMin,
        actualWeightMt: actualMt ? Number(actualMt) : undefined,
      };
    });

    if (activeOrder) {
      const summary = activeOrderSummaries[0];
      currentOrder = {
        batchNumber: summary.batchNumber,
        customer: summary.customer,
        grade: summary.grade,
        subProcess: summary.subProcess,
        weightMt: summary.weightMt,
        runningSinceAt: activeOrder.prod_start_at ? new Date(activeOrder.prod_start_at).toISOString() : undefined,
        runtimeMin: summary.runtimeMin,
        actualWeightMt: summary.actualWeightMt,
        targetThkMm: summary.targetThkMm,
        inputThkMm: summary.inputThkMm,
      };
    }

    // Active stoppage
    let activeStoppage: MachineCommandCenterData['activeStoppage'] | undefined;
    if ((card.status === 'STOPPAGE' || card.status === 'BREAKDOWN') && activeOrder) {
      const stop = await db.selectFrom('txn.stoppage as os')
        .leftJoin('security.app_user as u', 'u.user_id', 'os.operator_id')
        .leftJoin('master.stoppage_category as sc', 'sc.category_code', 'os.category_code')
        .select(['os.stoppage_id', 'os.category_code', 'sc.label', 'os.remarks', 'os.start_at', 'u.full_name'])
        .where('os.order_id', '=',
          db.selectFrom('txn.crm_order').select('order_id').where('batch_number', '=', activeOrder.batch_number),
        )
        .where('os.end_at', 'is', null)
        .executeTakeFirst();
      if (stop) {
        activeStoppage = {
          stoppageId: String(stop.stoppage_id),
          reason: stop.label ?? stop.category_code,
          categoryCode: stop.category_code,
          startAt: new Date(stop.start_at).toISOString(),
          operatorName: stop.full_name ?? undefined,
          remarks: stop.remarks?.trim() || undefined,
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

    const orderQueue = await db.selectFrom('planning.ppc_batch as pb')
      .innerJoin('txn.crm_order as o', 'o.batch_id', 'pb.batch_id')
      .select([
        'pb.batch_number',
        'pb.customer_name',
        'pb.ppc_weight_mt',
        'pb.sub_process',
        'o.status',
        'pb.queue_seq',
      ])
      .where('pb.machine_code', '=', machineCode)
      .where('pb.machine_allocated', '=', true)
      .where('o.status', 'in', ['PENDING', 'PREPARING', 'IN_PROGRESS', 'STOPPAGE'])
      .orderBy('pb.queue_seq', 'asc')
      .limit(20)
      .execute();

    const completedOrders = await db.selectFrom('txn.crm_order as o')
      .innerJoin('planning.ppc_batch as pb', 'pb.batch_id', 'o.batch_id')
      .select([
        'pb.batch_number',
        'pb.customer_name',
        'pb.ppc_weight_mt',
        'pb.sub_process',
        'o.prod_end_at',
      ])
      .where('pb.machine_code', '=', machineCode)
      .where('o.status', '=', 'COMPLETED')
      .orderBy('o.prod_end_at', 'desc')
      .limit(15)
      .execute();

    return {
      machineCode: machine.machine_code,
      machineName: machine.name,
      currentStatus: card.status,
      currentOperator: card.currentOperator,
      shiftCode: card.shiftCode,
      currentOrder,
      activeOrderCount: activeOrderSummaries.length > 1 ? activeOrderSummaries.length : undefined,
      activeOrders: activeOrderSummaries.length > 1 ? activeOrderSummaries : undefined,
      activeStoppage,
      idleHistory,
      stoppageHistory,
      timeline,
      utilization,
      nextOrder: nextOrder ?? undefined,
      orderQueue: orderQueue.map((q) => ({
        batchNumber: q.batch_number,
        customer: q.customer_name,
        status: q.status,
        weightMt: Number(q.ppc_weight_mt),
        subProcess: q.sub_process,
      })),
      completedOrders: completedOrders.map((c) => ({
        batchNumber: c.batch_number,
        customer: c.customer_name,
        completedAt: c.prod_end_at ? new Date(c.prod_end_at).toISOString() : '',
        weightMt: Number(c.ppc_weight_mt),
        subProcess: c.sub_process,
      })),
    };
  }

  /** Returns the next queued order for a machine (not yet started) */
  static async getNextOrder(machineCode: string) {
    const row = await db.selectFrom('planning.ppc_batch as pb')
      .leftJoin('txn.crm_order as o', 'o.batch_id', 'pb.batch_id')
      .select(['pb.batch_number', 'pb.customer_name', 'pb.queue_seq', 'pb.ppc_weight_mt', 'pb.sub_process'])
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
      subProcess: row.sub_process ?? undefined,
    };
  }
  static async getShiftQueueContext(
    userId: number,
    machineCode?: string,
  ): Promise<{ prodDate: string; shiftCode: string }> {
    const { ShiftDetectionService } = await import('./ShiftDetectionService');
    const current = await ShiftDetectionService.getCurrentShift({
      userId,
      machineCode: machineCode || undefined,
    });
    return { prodDate: current.prodDate, shiftCode: current.shiftCode };
  }

  /** Prefer a concrete machine for session pin: explicit code, else sole scoped machine. */
  private static resolveContextMachine(
    machineFilter: string[] | null,
    preferred?: string,
  ): string | undefined {
    if (preferred && preferred !== 'ALL') return preferred.toUpperCase();
    if (machineFilter?.length === 1) return machineFilter[0];
    return undefined;
  }

  static async getSnapshot(userId: number, roles: string[]): Promise<LiveSnapshot> {
    const machineFilter = await this.getMachineScope(userId, roles);
    const contextMachine = this.resolveContextMachine(machineFilter);
    const { prodDate, shiftCode } = await this.getShiftQueueContext(userId, contextMachine);
    const machines = await this.getMachineCards(machineFilter);
    const orders = await this.getActiveOrders(machineFilter, prodDate, shiftCode);

    const { ProductionMetricsService } = await import('./ProductionMetricsService');
    const [shiftMetrics, productionTodayMt] = await Promise.all([
      ProductionMetricsService.getShiftMetrics(prodDate, shiftCode, machineFilter),
      ProductionMetricsService.getPlantProductionForDate(prodDate),
    ]);

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
      activeOrders: orders.filter((o) => o.status === 'IN_PROGRESS' || o.status === 'STOPPAGE').length,
      queuedProductionMt: Math.round(queuedProductionMt * 10) / 10,
      currentStoppages: stoppages,
      machinesRunningPct: machines.length > 0 ? Math.round((running / total) * 100) : 0,
      shiftPerformancePct: shiftMetrics.shiftPerformancePct,
      prodDate: shiftMetrics.prodDate,
      shiftCode: shiftMetrics.shiftCode,
      shiftLogId: shiftMetrics.shiftLogId,
      shiftTargetMt: shiftMetrics.targetMt,
      shiftProductionMt: shiftMetrics.totalProdMt,
      shiftCompletedProdMt: shiftMetrics.completedProdMt,
      shiftInProgressProdMt: shiftMetrics.inProgressProdMt,
      shiftRollingMt: shiftMetrics.totalRollingMt,
      shiftSkinpassMt: shiftMetrics.totalSkinpassMt,
      productionTodayMt,
    };

    return { kpis, machines, refreshedAt: new Date().toISOString() };
  }

  static async getOrderDetail(
    batchNumber: string,
    machineFilter: string[] | null = null,
  ): Promise<LiveOrderDetail | null> {
    const batch = await db.selectFrom('planning.ppc_batch as pb')
      .leftJoin('txn.crm_order as o', 'o.batch_id', 'pb.batch_id')
      .leftJoin('master.machine as m', 'm.machine_code', 'pb.machine_code')
      .leftJoin('security.app_user as u', 'u.user_id', 'o.logged_in_user_id')
      .leftJoin('txn.crm_rolling as r', 'r.order_id', 'o.order_id')
      .leftJoin('txn.crm_skinpass as s', 's.order_id', 'o.order_id')
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
      ? await db.selectFrom('txn.stoppage')
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

    const status = mapSixHiStatus(batch.status ?? 'PENDING', prepReady);
    const rejection = status === 'REJECTED' && batch.order_id
      ? await loadOrderRejection(batch.order_id)
      : undefined;
    const operatorName = batch.operator_name ?? (batch.machine_code
      ? await MachineCrewService.getOperatorName(batch.machine_code)
      : undefined);

    return {
      batchNumber: batch.batch_number,
      customer: batch.customer_name,
      grade: batch.grade_code,
      machineCode: batch.machine_code,
      machineName: batch.machine_name ?? batch.machine_code,
      currentProcess: processLabel(batch.sub_process),
      operatorName,
      runtimeMin,
      status,
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
      journey: journey ?? undefined, stoppages: stoppages.map((s) => ({
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
      rejection,
    };
  }

  static async getRejectedOrders(
    machineFilter: string[] | null,
    opts: { dateFrom?: string; dateTo?: string; shiftCode?: string; limit?: number } = {},
  ) {
    const limit = opts.limit ?? 50;
    let q = db.selectFrom('txn.crm_order as o')
      .innerJoin('planning.ppc_batch as pb', 'pb.batch_id', 'o.batch_id')
      .leftJoin('txn.order_rejection as rej', 'rej.order_id', 'o.order_id')
      .leftJoin('security.app_user as u', 'u.user_id', 'rej.operator_id')
      .select([
        'pb.batch_number',
        'pb.machine_code',
        'pb.shift_code',
        'pb.plan_date',
        'pb.coil_no',
        'pb.slit_id',
        'o.sub_process',
        'o.prod_end_at',
        sql<string>`COALESCE(rej.rejection_reason, 'No reason provided')`.as('reason'),
        sql<string>`COALESCE(u.full_name, 'Unknown')`.as('operator'),
        'pb.ppc_weight_mt',
      ])
      .where('o.status', '=', 'REJECTED')
      .orderBy('o.prod_end_at', 'desc')
      .limit(limit);

    if (machineFilter !== null) {
      if (machineFilter.length === 0) return [];
      q = q.where('pb.machine_code', 'in', machineFilter);
    }
    if (opts.dateFrom) {
      q = q.where(sql`date(pb.plan_date)`, '>=', sql`${opts.dateFrom}::date`);
    }
    if (opts.dateTo) {
      q = q.where(sql`date(pb.plan_date)`, '<=', sql`${opts.dateTo}::date`);
    }
    if (opts.shiftCode) {
      q = q.where('pb.shift_code', '=', opts.shiftCode);
    }

    const rows = await q.execute();
    return rows.map((r) => {
      const coilNo = r.coil_no ?? undefined;
      const slitId = r.slit_id?.trim() || undefined;
      return {
        batchNumber: r.batch_number,
        machineCode: r.machine_code,
        rejectionTime: r.prod_end_at ? new Date(r.prod_end_at).toISOString() : '',
        reason: r.reason,
        rejectedBy: r.operator,
        weightMt: Number(r.ppc_weight_mt),
        shiftCode: r.shift_code ?? undefined,
        planDate: r.plan_date ? String(r.plan_date).slice(0, 10) : undefined,
        subProcess: r.sub_process ?? undefined,
        coilNo,
        motherCoil: coilNo,
        slitId,
      };
    });
  }

  /** Production MT for a shift plan (saved weights: completed + in-progress). */
  static async getShiftCompletedProductionMt(
    machineFilter: string[] | null,
    planDate: string,
    shiftCode: string,
  ): Promise<{
    actualMt: number;
    completedOrderCount: number;
    inProgressOrderCount: number;
    orderCount: number;
    completedProdMt: number;
    inProgressMt: number;
    totalProdMt: number;
    targetCompletedMt: number;
  }> {
    const zeros = {
      actualMt: 0,
      completedOrderCount: 0,
      inProgressOrderCount: 0,
      orderCount: 0,
      completedProdMt: 0,
      inProgressMt: 0,
      totalProdMt: 0,
      targetCompletedMt: 0,
    };
    if (machineFilter !== null && machineFilter.length === 0) {
      return zeros;
    }

    const { SixHiShiftService } = await import('./sixHi');
    const shiftLogIds = await SixHiShiftService.resolveShiftLogIdsForPlan(planDate, shiftCode);
    if (shiftLogIds.length === 0) return zeros;

    const machineScope = machineFilter && machineFilter.length > 0 ? machineFilter : undefined;
    const summary = await SixHiShiftService.getShiftSummary(shiftLogIds, machineScope);
    const round = (n: number) => Math.round(n * 10) / 10;
    const completedOrderCount = summary.completedOrders?.length ?? 0;
    const inProgressOrderCount = summary.ordersInProgress?.length ?? 0;

    return {
      actualMt: round(summary.totalProdMt),
      totalProdMt: round(summary.totalProdMt),
      completedProdMt: round(summary.completedProdMt ?? 0),
      inProgressMt: round(summary.inProgressProdMt ?? 0),
      targetCompletedMt: round(summary.targetCompletedMt ?? 0),
      completedOrderCount,
      inProgressOrderCount,
      orderCount: completedOrderCount + inProgressOrderCount,
    };
  }

  static async getMachineHeadDashboard(
    userId: number,
    roles: string[],
    opts: { machine?: string; search?: string; subProcess?: string; shift?: string } = {},
  ): Promise<MachineHeadDashboardData> {
    let machineFilter = await this.getMachineScope(userId, roles);
    if (opts.machine && opts.machine !== 'ALL') {
      const code = opts.machine.toUpperCase();
      if (machineFilter === null) machineFilter = [code];
      else machineFilter = machineFilter.filter((m) => m === code);
    }
    const contextMachine = this.resolveContextMachine(
      machineFilter,
      opts.machine && opts.machine !== 'ALL' ? opts.machine : undefined,
    );
    const ctx = await this.getShiftQueueContext(userId, contextMachine);
    const prodDate = ctx.prodDate;
    const shiftCode = opts.shift && opts.shift !== 'ALL' ? opts.shift.toUpperCase() : ctx.shiftCode;
    const { SixHiExecutionService, SixHiShiftService } = await import('./sixHi');
    const search = opts.search?.trim() || undefined;
    const subProcess = opts.subProcess === 'ROLLING' || opts.subProcess === 'SKIN_PASS'
      ? opts.subProcess
      : undefined;

    // Empty scope must short-circuit before any `IN ()` SQL (truthy [] would 500).
    if (machineFilter !== null && machineFilter.length === 0) {
      return {
        orderQueue: [],
        shiftSummary: {
          shiftCode,
          prodDate,
          targetMt: 0,
          actualMt: 0,
          completedProdMt: 0,
          inProgressMt: 0,
          totalProdMt: 0,
          queuedMt: 0,
          orderCount: 0,
          completedOrderCount: 0,
        },
        runtimeUtilization: [],
        stoppages: [],
        operatorActivity: [],
        productionHistory: [],
        handoverOverview: { pending: [], recent: [], awaitingAcceptance: 0 },
        rejectedOrders: [],
        rejectedOrderCount: 0,
      };
    }

    const orders = await this.getActiveOrders(machineFilter, prodDate, shiftCode, { search, subProcess });
    const machines = await this.getMachineCards(machineFilter);
    const shiftLogIds = await SixHiShiftService.resolveShiftLogIdsForPlan(prodDate, shiftCode);
    const shiftLogId = shiftLogIds[0] ?? null;

    let completedQ = db
      .selectFrom('txn.crm_order as o')
      .innerJoin('planning.ppc_batch as pb', 'pb.batch_id', 'o.batch_id')
      .select([
        'o.order_id',
        'o.sub_process',
        'pb.batch_number',
        'pb.machine_code',
        'pb.coil_no',
        'pb.slit_id',
        'o.coil_no as order_coil_no',
        'o.slit_id as order_slit_id',
        'o.prod_end_at',
        'pb.ppc_weight_mt',
      ])
      .where('o.status', '=', 'COMPLETED')
      .orderBy('o.prod_end_at', 'desc')
      // Full shift production history (not just the last 10) — see Task 2.3.
      .limit(200);
    if (shiftLogIds.length > 0) {
      completedQ = completedQ.where('o.shift_log_id', 'in', shiftLogIds);
    } else {
      completedQ = completedQ
        .where('pb.plan_date', '=', SixHiShiftService.toPlanDate(prodDate))
        .where('pb.shift_code', '=', shiftCode);
    }
    if (machineFilter !== null) {
      completedQ = completedQ.where('pb.machine_code', 'in', machineFilter);
    }
    if (subProcess) {
      completedQ = completedQ.where('o.sub_process', '=', subProcess);
    }
    if (search) {
      const term = `%${search}%`;
      completedQ = completedQ.where((eb) =>
        eb.or([
          eb('pb.batch_number', 'ilike', term),
          eb('pb.coil_no', 'ilike', term),
        ]),
      );
    }
    const completed = await completedQ.execute();

    let rejectedQ = db.selectFrom('txn.crm_order as o')
      .innerJoin('planning.ppc_batch as pb', 'pb.batch_id', 'o.batch_id')
      .leftJoin('txn.order_rejection as rej', 'rej.order_id', 'o.order_id')
      .leftJoin('security.app_user as u', 'u.user_id', 'rej.operator_id')
      .select([
        'pb.batch_number',
        'pb.machine_code',
        'pb.shift_code',
        'pb.plan_date',
        'pb.coil_no',
        'pb.slit_id',
        'o.sub_process',
        'o.prod_end_at',
        sql<string>`COALESCE(rej.rejection_reason, 'No reason provided')`.as('reason'),
        sql<string>`COALESCE(u.full_name, 'Unknown')`.as('operator'),
        'pb.ppc_weight_mt',
      ])
      .where('o.status', '=', 'REJECTED')
      .orderBy('o.prod_end_at', 'desc')
      .limit(10);

    let rejectedCountQ = db.selectFrom('txn.crm_order as o')
      .innerJoin('planning.ppc_batch as pb', 'pb.batch_id', 'o.batch_id')
      .select(sql<number>`count(*)::int`.as('n'))
      .where('o.status', '=', 'REJECTED');

    if (shiftLogIds.length > 0) {
      rejectedQ = rejectedQ.where('o.shift_log_id', 'in', shiftLogIds);
      rejectedCountQ = rejectedCountQ.where('o.shift_log_id', 'in', shiftLogIds);
    } else {
      const plan = SixHiShiftService.toPlanDate(prodDate);
      rejectedQ = rejectedQ.where('pb.plan_date', '=', plan).where('pb.shift_code', '=', shiftCode);
      rejectedCountQ = rejectedCountQ.where('pb.plan_date', '=', plan).where('pb.shift_code', '=', shiftCode);
    }
    if (machineFilter !== null) {
      rejectedQ = rejectedQ.where('pb.machine_code', 'in', machineFilter);
      rejectedCountQ = rejectedCountQ.where('pb.machine_code', 'in', machineFilter);
    }
    if (subProcess) {
      rejectedQ = rejectedQ.where('o.sub_process', '=', subProcess);
      rejectedCountQ = rejectedCountQ.where('o.sub_process', '=', subProcess);
    }
    if (search) {
      const term = `%${search}%`;
      rejectedQ = rejectedQ.where((eb) =>
        eb.or([
          eb('pb.batch_number', 'ilike', term),
          eb('pb.coil_no', 'ilike', term),
        ]),
      );
    }
    const rejected = await rejectedQ.execute();
    const rejectedCountRow = await rejectedCountQ.executeTakeFirst();
    const rejectedOrderCount = rejectedCountRow?.n ?? 0;

    // Stoppage HISTORY for the shift (open + closed), not just active — see Task 2.5.
    let stoppageQ = db.selectFrom('txn.stoppage as os')
      .innerJoin('txn.crm_order as o', 'o.order_id', 'os.order_id')
      .innerJoin('planning.ppc_batch as pb', 'pb.batch_id', 'o.batch_id')
      .innerJoin('master.stoppage_category as sc', 'sc.category_code', 'os.category_code')
      .select([
        'pb.batch_number',
        'pb.machine_code',
        'pb.sub_process',
        'pb.coil_no',
        'pb.slit_id',
        'o.coil_no as order_coil_no',
        'o.slit_id as order_slit_id',
        'sc.label as category',
        'os.remarks',
        'os.duration_min',
        'os.start_at',
        'os.end_at',
      ]);
    if (shiftLogIds.length > 0) {
      stoppageQ = stoppageQ.where('o.shift_log_id', 'in', shiftLogIds);
    }
    if (machineFilter !== null) {
      stoppageQ = stoppageQ.where('pb.machine_code', 'in', machineFilter);
    }
    if (subProcess) {
      stoppageQ = stoppageQ.where('pb.sub_process', '=', subProcess);
    }
    if (search) {
      const term = `%${search}%`;
      stoppageQ = stoppageQ.where((eb) =>
        eb.or([
          eb('pb.batch_number', 'ilike', term),
          eb('pb.coil_no', 'ilike', term),
        ]),
      );
    }
    const stoppageRows = await stoppageQ.orderBy('os.start_at', 'desc').limit(200).execute();

    const queuedMt = Math.round(orders.reduce((s, o) => s + o.weightMt, 0) * 10) / 10;
    const {
      actualMt,
      completedOrderCount,
      orderCount,
      completedProdMt,
      inProgressMt,
      totalProdMt,
      targetCompletedMt,
    } = await this.getShiftCompletedProductionMt(
      machineFilter,
      prodDate,
      shiftCode,
    );

    const { MachineHandoverService } = await import('./MachineHandoverService');
    let handoverOverview = await MachineHandoverService.getHandoverOverview(machineFilter);
    if (subProcess || search) {
      const matchHandover = (h: { subProcess?: string; batchNumber?: string | null; machineCode: string }) => {
        if (subProcess && h.subProcess && h.subProcess !== subProcess) return false;
        if (search) {
          const q = search.toLowerCase();
          const hay = `${h.batchNumber ?? ''} ${h.machineCode}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      };
      handoverOverview = {
        ...handoverOverview,
        pending: handoverOverview.pending.filter(matchHandover),
        recent: handoverOverview.recent.filter(matchHandover),
      };
    }

    return {
      orderQueue: orders,
      shiftSummary: {
        shiftCode: shiftCode,
        prodDate: prodDate,
        // Target MT done = summed PPC/planned weight of orders COMPLETED this shift
        // (not txn.shift_log.target_mt, which is a single plan figure). See Task 3.
        targetMt: targetCompletedMt,
        actualMt,
        completedProdMt,
        inProgressMt,
        totalProdMt,
        queuedMt,
        orderCount,
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
      stoppages: stoppageRows.map((s) => {
        const coilNo = ((s as { order_coil_no?: string | null }).order_coil_no ?? s.coil_no ?? '').trim() || undefined;
        const slitId = ((s as { order_slit_id?: string | null }).order_slit_id ?? s.slit_id)?.trim() || undefined;
        const startAt = new Date(s.start_at);
        const endAt = s.end_at ? new Date(s.end_at) : null;
        const isActive = endAt === null;
        const durationMin = s.duration_min != null
          ? Number(s.duration_min)
          : isActive
            ? Math.max(0, Math.round((Date.now() - startAt.getTime()) / 60000))
            : undefined;
        return {
          batchNumber: s.batch_number,
          machineCode: s.machine_code,
          category: s.category,
          durationMin,
          startAt: startAt.toISOString(),
          endAt: endAt ? endAt.toISOString() : undefined,
          status: isActive ? ('ACTIVE' as const) : ('ENDED' as const),
          subProcess: s.sub_process ?? undefined,
          remarks: s.remarks?.trim() || undefined,
          coilNo,
          motherCoil: coilNo,
          slitId,
        };
      }),
      operatorActivity: orders
        .filter((o) => o.operatorName)
        .map((o) => ({
          operatorName: o.operatorName!,
          batchNumber: o.batchNumber,
          machineCode: o.machineCode,
          status: o.status,
          subProcess: o.subProcess,
          coilNo: o.coilNo,
          motherCoil: o.motherCoil ?? o.coilNo,
          slitId: o.slitId,
        })),
      handoverOverview,
      productionHistory: await Promise.all(
        completed
          .filter((c) => c.prod_end_at)
          .map(async (c) => {
            const coilNo = ((c as { order_coil_no?: string | null }).order_coil_no ?? c.coil_no ?? '').trim() || undefined;
            const slitId = ((c as { order_slit_id?: string | null }).order_slit_id ?? c.slit_id)?.trim() || undefined;
            return {
              batchNumber: c.batch_number,
              machineCode: c.machine_code,
              completedAt: new Date(c.prod_end_at!).toISOString(),
              weightMt: await SixHiExecutionService.resolveOrderWeight(
                String(c.order_id),
                c.sub_process,
                Number(c.ppc_weight_mt),
              ),
              subProcess: c.sub_process ?? undefined,
              coilNo,
              motherCoil: coilNo,
              slitId,
            };
          }),
      ),
      rejectedOrders: rejected.map((r) => {
        const coilNo = r.coil_no ?? undefined;
        const slitId = r.slit_id?.trim() || undefined;
        return {
          batchNumber: r.batch_number,
          machineCode: r.machine_code,
          rejectionTime: new Date(r.prod_end_at || Date.now()).toISOString(),
          reason: r.reason || 'No reason provided',
          rejectedBy: r.operator || 'Unknown',
          weightMt: Number(r.ppc_weight_mt || 0),
          shiftCode: r.shift_code ?? undefined,
          planDate: r.plan_date ? String(r.plan_date).slice(0, 10) : undefined,
          subProcess: r.sub_process ?? undefined,
          coilNo,
          motherCoil: coilNo,
          slitId,
        };
      }),
      rejectedOrderCount,
    };
  }
}