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
const ACTIVE_STATUSES = ['PENDING', 'PREPARING', 'IN_PROGRESS', 'STOPPAGE'] as const;

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

  static async getActiveOrders(machineFilter: string[] | null): Promise<LiveOrderRow[]> {
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
        'o.status',
        'o.prod_start_at',
        'o.prod_duration_min',
        'u.full_name as operator_name',
        'r.total_passes',
        's.output_thk_mm',
      ])
      .where((eb) =>
        eb.or([
          eb('o.status', 'in', [...ACTIVE_STATUSES]),
          eb('o.status', 'is', null),
        ]),
      )
      .where('pb.machine_allocated', '=', true);

    if (machineFilter !== null) {
      if (machineFilter.length === 0) return [];
      q = q.where('pb.machine_code', 'in', machineFilter);
    }

    const rows = await q.orderBy('pb.queue_seq', 'asc').execute();

    const filtered = rows
      .filter((r) => {
        const st = r.status ?? 'PENDING';
        return ACTIVE_STATUSES.includes(st as typeof ACTIVE_STATUSES[number]) || st === 'PENDING';
      })
      .filter((r) => r.status !== 'COMPLETED');

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
      const journey = await ProcessRouteService.getJourneyByCoil(r.coil_no);
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
  static async getMachineCards(machineFilter: string[] | null): Promise<MachineStatusCard[]> {
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
    for (const ev of currentEvents) {
      // Prioritize events if multiple are somehow open (shouldn't happen, but just in case)
      eventsByMachine.set(ev.machine_code, ev);
    }

    // 2. Fetch active order weights for the batch numbers referenced in the current events
    const activeBatchNumbers = Array.from(eventsByMachine.values())
      .map(e => e.batch_number)
      .filter((b): b is string => b !== null);

    const activeOrders = activeBatchNumbers.length > 0
      ? await db.selectFrom('txn.crm6_order as o')
          .innerJoin('planning.ppc_batch as pb', 'pb.batch_id', 'o.batch_id')
          .leftJoin('txn.crm6_rolling as r', 'r.order_id', 'o.order_id')
          .leftJoin('txn.crm6_skinpass as s', 's.order_id', 'o.order_id')
          .select([
            'o.batch_number',
            'o.updated_at',
            'pb.coil_no',
            'r.actual_weight_mt as rolling_weight',
            's.actual_weight_mt as skinpass_weight',
          ])
          .where('o.batch_number', 'in', activeBatchNumbers)
          .execute()
      : [];

    const orderStatsByBatch = new Map<string, typeof activeOrders[0]>();
    for (const o of activeOrders) {
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
      const rejects = rejectsByMachine.get(m.machine_code) ?? { count: 0, weightMt: 0 };
      const orderStats = ev?.batch_number ? orderStatsByBatch.get(ev.batch_number) : undefined;

      let status: MachineLiveStatus = 'IDLE';
      if (m.machine_status === 'MAINTENANCE' || ev?.event_type === 'MAINTENANCE_STARTED') {
        status = 'MAINTENANCE';
      } else if (ev?.event_type === 'STOPPAGE_STARTED') {
        status = ev.category_code === 'BREAKDOWN' ? 'BREAKDOWN' : 'STOPPAGE';
      } else if (ev?.event_type === 'RUNNING_STARTED') {
        status = 'RUNNING';
      }

      const weight = orderStats?.skinpass_weight ?? orderStats?.rolling_weight;
      let runtimeMin: number | undefined;
      
      if (status === 'RUNNING' && ev?.occurred_at) {
        runtimeMin = Math.round((Date.now() - new Date(ev.occurred_at).getTime()) / 60000);
      }

      return {
        machineCode: m.machine_code,
        machineName: m.name,
        status,
        currentOrder: (status === 'RUNNING' || status === 'STOPPAGE' || status === 'BREAKDOWN') ? (ev?.batch_number ?? undefined) : undefined,
        currentCoil: (status === 'RUNNING' || status === 'STOPPAGE' || status === 'BREAKDOWN') ? (orderStats?.coil_no ?? undefined) : undefined,
        currentOperator: (status === 'RUNNING' || status === 'STOPPAGE' || status === 'BREAKDOWN') ? (ev?.operator_name ?? undefined) : undefined,
        stateSinceAt: ev?.occurred_at ? new Date(ev.occurred_at).toISOString() : undefined,
        activeStoppageReason: (status === 'STOPPAGE' || status === 'BREAKDOWN')
          ? (ev?.stoppage_label ?? ev?.reason ?? ev?.category_code ?? undefined)
          : undefined,
        lastOrderBatchNumber: status === 'IDLE' ? (ev?.batch_number ?? undefined) : undefined,
        lastOperatorName: status === 'IDLE' ? (ev?.operator_name ?? undefined) : undefined,
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
    if (card.status === 'STOPPAGE' && activeOrder) {
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
  static async getSnapshot(userId: number, roles: string[]): Promise<LiveSnapshot> {
    const machineFilter = await this.getMachineScope(userId, roles);
    const machines = await this.getMachineCards(machineFilter);
    const orders = await this.getActiveOrders(machineFilter);

    const running = machines.filter((m) => m.status === 'RUNNING').length;
    const idle = machines.filter((m) => m.status === 'IDLE').length;
    const breakdown = machines.filter((m) => m.status === 'BREAKDOWN' || m.status === 'STOPPAGE').length;
    const productionMt = orders.reduce((s, o) => s + o.weightMt, 0);
    const stoppages = orders.filter((o) => o.status === 'STOPPAGE').length;
    const total = machines.length || 1;

    const kpis: LiveKpis = {
      runningMachines: running,
      idleMachines: idle,
      breakdownMachines: breakdown,
      activeOrders: orders.length,
      currentProductionMt: Math.round(productionMt * 10) / 10,
      currentStoppages: stoppages,
      utilizationPct: Math.round((running / total) * 100),
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

  static async getMachineHeadDashboard(
    userId: number,
    roles: string[],
  ): Promise<MachineHeadDashboardData> {
    const machineFilter = await this.getMachineScope(userId, roles);
    const orders = await this.getActiveOrders(machineFilter);
    const machines = await this.getMachineCards(machineFilter);
    const today = new Date().toISOString().slice(0, 10);
    const shiftCode = orders[0]?.shiftCode ?? 'B';

    const shiftLog = await db.selectFrom('txn.shift_log')
      .select(['target_mt'])
      .where('prod_date', '=', new Date(today))
      .where('shift_code', '=', shiftCode)
      .where('process_id', '=', 31)
      .executeTakeFirst();

    const completed = machineFilter
      ? await db.selectFrom('txn.crm6_order as o')
          .innerJoin('planning.ppc_batch as pb', 'pb.batch_id', 'o.batch_id')
          .select(['pb.batch_number', 'pb.machine_code', 'o.prod_end_at', 'pb.ppc_weight_mt'])
          .where('o.status', '=', 'COMPLETED')
          .where('pb.machine_code', 'in', machineFilter)
          .orderBy('o.prod_end_at', 'desc')
          .limit(10)
          .execute()
      : await db.selectFrom('txn.crm6_order as o')
          .innerJoin('planning.ppc_batch as pb', 'pb.batch_id', 'o.batch_id')
          .select(['pb.batch_number', 'pb.machine_code', 'o.prod_end_at', 'pb.ppc_weight_mt'])
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
          shiftSummary: { shiftCode: 'B', planDate: today, targetMt: 0, actualMt: 0, orderCount: 0 },
          utilization: [],
          stoppages: [],
          operatorActivity: [],
          productionHistory: [],
          handoverOverview: { pending: [], recent: [], awaitingAcceptance: 0 },
        };
      }
      stoppageQ = stoppageQ.where('pb.machine_code', 'in', machineFilter);
    }
    const stoppageRows = await stoppageQ.orderBy('os.start_at', 'desc').limit(15).execute();

    const actualMt = orders.reduce((s, o) => s + o.weightMt, 0);

    const { MachineHandoverService } = await import('./MachineHandoverService');
    const handoverOverview = await MachineHandoverService.getHandoverOverview(machineFilter);

    return {
      orderQueue: orders,
      shiftSummary: {
        shiftCode,
        planDate: today,
        targetMt: Number(shiftLog?.target_mt ?? 0),
        actualMt: Math.round(actualMt * 10) / 10,
        orderCount: orders.length,
      },
      utilization: await Promise.all(machines.map(async (m) => {
        try {
          const summary = await MachineStateEventService.getUtilizationSummary(m.machineCode, 24);
          return {
            machineCode: m.machineCode,
            machineName: m.machineName,
            utilizationPct: summary.runningPct,
          };
        } catch {
          // Fallback: no event data yet — report 0
          return {
            machineCode: m.machineCode,
            machineName: m.machineName,
            utilizationPct: 0,
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
      productionHistory: completed
        .filter((c) => c.prod_end_at)
        .map((c) => ({
          batchNumber: c.batch_number,
          machineCode: c.machine_code,
          completedAt: new Date(c.prod_end_at!).toISOString(),
          weightMt: Number(c.ppc_weight_mt),
        })),
    };
  }
}