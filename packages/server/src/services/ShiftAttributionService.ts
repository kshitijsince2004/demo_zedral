import { db } from '../db';
import { SixHiExecutionService, SixHiShiftService } from './sixHi';
import { assertRuntimeAccounting } from '../validation/manufacturingValidation';
import {
  isBreakdownStoppageCategory,
  resolveStoppageMinutes,
} from '../validation/manufacturingValidation';
import { calcShiftDurationMinutes } from '../utils/kpiCalculator';
import { formatPlantDate, postgresDateOnly } from '../utils/dateOnly';

export interface AttributionSlice {
  orderId: number;
  machineCode: string;
  shiftLogId: string;
  shiftCode: string;
  prodDate: string;
  runtimeMinutes: number;
  productionMt: number;
  stoppageMinutes: number;
  breakdownMinutes: number;
}

export class ShiftAttributionService {
  static async resolveShiftLogId(shiftCode: string, prodDate: string): Promise<string | null> {
    const { ShiftDetectionService } = await import('./ShiftDetectionService');
    const resolved = await ShiftDetectionService.resolveShift({ shiftCode, planDate: prodDate });
    return resolved.shiftLogId;
  }

  /** Single writer for order↔shift attribution slices. */
  static async attributeOrder(
    orderId: string | number,
    shiftLogId: string,
    extras?: Partial<Pick<AttributionSlice, 'machineCode' | 'runtimeMinutes' | 'productionMt' | 'stoppageMinutes' | 'breakdownMinutes'>>,
  ): Promise<void> {
    const id = String(orderId);
    const log = await db
      .selectFrom('txn.shift_log')
      .select(['shift_code', 'prod_date'])
      .where('shift_log_id', '=', shiftLogId)
      .executeTakeFirst();
    if (!log) return;

    let machineCode = extras?.machineCode;
    if (!machineCode) {
      const row = await db
        .selectFrom('txn.crm_order as o')
        .innerJoin('planning.ppc_batch as pb', 'pb.batch_id', 'o.batch_id')
        .select('pb.machine_code')
        .where('o.order_id', '=', id)
        .executeTakeFirst();
      machineCode = row?.machine_code ?? 'UNKNOWN';
    }

    await this.upsertSlice({
      orderId: Number(id),
      machineCode,
      shiftLogId,
      shiftCode: String(log.shift_code).toUpperCase(),
      prodDate: formatPlantDate(log.prod_date as Date),
      runtimeMinutes: extras?.runtimeMinutes ?? 0,
      productionMt: extras?.productionMt ?? 0,
      stoppageMinutes: extras?.stoppageMinutes ?? 0,
      breakdownMinutes: extras?.breakdownMinutes ?? 0,
    });
  }

  static async upsertSlice(slice: AttributionSlice): Promise<void> {
    const shiftLog = await db
      .selectFrom('txn.shift_log as sl')
      .leftJoin('master.shift as s', 's.shift_code', 'sl.shift_code')
      .select(['s.start_time', 's.end_time'])
      .where('sl.shift_log_id', '=', slice.shiftLogId)
      .executeTakeFirst();

    if (shiftLog?.start_time && shiftLog?.end_time) {
      const shiftDuration = calcShiftDurationMinutes(
        String(shiftLog.start_time).slice(0, 5),
        String(shiftLog.end_time).slice(0, 5),
      );
      assertRuntimeAccounting(slice.runtimeMinutes, slice.stoppageMinutes, shiftDuration);
    }

    await db
      .insertInto('txn.order_shift_attribution')
      .values({
        order_id: String(slice.orderId),
        shift_log_id: slice.shiftLogId,
        machine_code: slice.machineCode,
        shift_code: slice.shiftCode,
        prod_date: postgresDateOnly(slice.prodDate),
        runtime_minutes: slice.runtimeMinutes,
        production_mt: slice.productionMt,
        stoppage_minutes: slice.stoppageMinutes,
        breakdown_minutes: slice.breakdownMinutes,
      })
      .onConflict((oc) =>
        oc.columns(['order_id', 'shift_log_id', 'machine_code']).doUpdateSet({
          runtime_minutes: slice.runtimeMinutes,
          production_mt: slice.productionMt,
          stoppage_minutes: slice.stoppageMinutes,
          breakdown_minutes: slice.breakdownMinutes,
        }),
      )
      .execute();
  }

  /** Attribute active order runtime/stoppages for an outgoing shift slice on one machine. */
  static async attributeMachineOrder(
    machineCode: string,
    shiftCode: string,
    prodDate: string,
  ): Promise<void> {
    const active = await SixHiExecutionService.findActiveMachineOrder(machineCode);
    if (!active) return;

    const order = await db
      .selectFrom('txn.crm_order as o')
      .innerJoin('planning.ppc_batch as pb', 'pb.batch_id', 'o.batch_id')
      .select([
        'o.order_id',
        'o.prod_start_at',
        'o.prod_duration_min',
        'o.ppc_weight_mt',
        'o.sub_process',
      ])
      .where('o.batch_number', '=', active.batchNumber)
      .executeTakeFirst();

    if (!order) return;

    const shiftLogId = await this.resolveShiftLogId(shiftCode, prodDate);
    if (!shiftLogId) return;

    const runtimeMinutes = order.prod_duration_min ?? 0;
    const weightMt = await SixHiExecutionService.resolveOrderWeight(
      String(order.order_id),
      order.sub_process,
      Number(order.ppc_weight_mt),
    );

    const stoppageRows = await db
      .selectFrom('txn.stoppage as os')
      .leftJoin('master.stoppage_category as sc', 'sc.category_code', 'os.category_code')
      .select(['os.duration_min', 'os.start_at', 'os.end_at', 'os.category_code', 'sc.requires_breakdown_code'])
      .where('os.order_id', '=', String(order.order_id))
      .execute();

    let stoppageMinutes = 0;
    let breakdownMinutes = 0;
    for (const s of stoppageRows) {
      const mins = resolveStoppageMinutes(s.start_at, s.end_at, s.duration_min);
      stoppageMinutes += mins;
      if (isBreakdownStoppageCategory(s.category_code, s.requires_breakdown_code)) {
        breakdownMinutes += mins;
      }
    }

    await this.upsertSlice({
      orderId: Number(order.order_id),
      machineCode,
      shiftLogId,
      shiftCode,
      prodDate,
      runtimeMinutes,
      productionMt: weightMt,
      stoppageMinutes,
      breakdownMinutes,
    });
  }

  static async getShiftMetrics(shiftLogId: string, machineCode?: string) {
    // Live from orders + stoppages (attribution is only written at shift boundary /
    // reattribution and is often empty mid-shift — handover and shift review both
    // call this, so they must share the same live source).
    const live = await this.computeLiveShiftMetrics(shiftLogId, machineCode);

    const inProgress = await db
      .selectFrom('txn.crm_order as o')
      .innerJoin('planning.ppc_batch as pb', 'pb.batch_id', 'o.batch_id')
      .select(['o.batch_number', 'o.status', 'o.sub_process', 'pb.machine_code'])
      .where('o.status', 'in', ['IN_PROGRESS', 'STOPPAGE'])
      .where('o.shift_log_id', '=', shiftLogId)
      .$if(!!machineCode, (qb) => qb.where('pb.machine_code', '=', machineCode!))
      .execute();

    const shiftWindow = await db
      .selectFrom('txn.shift_log as sl')
      .leftJoin('master.shift as s', 's.shift_code', 'sl.shift_code')
      .select(['s.start_time', 's.end_time'])
      .where('sl.shift_log_id', '=', shiftLogId)
      .executeTakeFirst();

    return {
      totalRuntimeMinutes: live.totalRuntimeMinutes,
      totalStoppageMinutes: live.totalStoppageMinutes,
      totalBreakdownMinutes: live.totalBreakdownMinutes,
      machineUtilizationPct: live.machineUtilizationPct,
      shiftCapacityMinutes: shiftWindow?.start_time && shiftWindow?.end_time
        ? calcShiftDurationMinutes(
            String(shiftWindow.start_time).slice(0, 5),
            String(shiftWindow.end_time).slice(0, 5),
          )
        : 8 * 60,
      ordersInProgress: inProgress.map((o) => ({
        batchNumber: o.batch_number,
        status: o.status,
        subProcess: o.sub_process,
        machineCode: o.machine_code,
      })),
    };
  }

  /**
   * Aggregate runtime / stoppage / breakdown for a shift from live order + stoppage rows.
   * Includes manual (order_id null) machine stoppages on the same shift_log.
   * Open stoppages use elapsed minutes when duration_min is unset.
   * In-progress orders use wall time minus stoppages when prod_duration_min is unset.
   */
  static async computeLiveShiftMetrics(shiftLogId: string, machineCode?: string) {
    let orderQ = db
      .selectFrom('txn.crm_order as o')
      .innerJoin('planning.ppc_batch as pb', 'pb.batch_id', 'o.batch_id')
      .select([
        'o.order_id',
        'o.status',
        'o.prod_start_at',
        'o.prod_duration_min',
        'pb.machine_code',
      ])
      .where('o.shift_log_id', '=', shiftLogId)
      .where((eb) =>
        eb.or([
          eb('o.status', 'in', ['IN_PROGRESS', 'STOPPAGE', 'COMPLETED', 'REJECTED']),
          eb('o.prod_start_at', 'is not', null),
        ]),
      );
    if (machineCode) orderQ = orderQ.where('pb.machine_code', '=', machineCode);

    const orders = await orderQ.execute();
    const orderIds = orders.map((o) => String(o.order_id));
    const now = Date.now();

    const orderStoppages = orderIds.length > 0
      ? await db
        .selectFrom('txn.stoppage as os')
        .leftJoin('master.stoppage_category as sc', 'sc.category_code', 'os.category_code')
        .select([
          'os.order_id',
          'os.duration_min',
          'os.start_at',
          'os.end_at',
          'os.category_code',
          'sc.requires_breakdown_code',
        ])
        .where('os.order_id', 'in', orderIds)
        .execute()
      : [];

    let manualQ = db
      .selectFrom('txn.stoppage as os')
      .leftJoin('master.stoppage_category as sc', 'sc.category_code', 'os.category_code')
      .select([
        'os.duration_min',
        'os.start_at',
        'os.end_at',
        'os.category_code',
        'sc.requires_breakdown_code',
      ])
      .where('os.order_id', 'is', null)
      .where('os.shift_log_id', '=', shiftLogId);
    if (machineCode) manualQ = manualQ.where('os.machine_code', '=', machineCode);
    const manualStoppages = await manualQ.execute();

    const stoppagesByOrder = new Map<string, typeof orderStoppages>();
    for (const s of orderStoppages) {
      const key = String(s.order_id);
      const list = stoppagesByOrder.get(key) ?? [];
      list.push(s);
      stoppagesByOrder.set(key, list);
    }

    let totalRuntime = 0;
    let totalStoppage = 0;
    let totalBreakdown = 0;

    for (const order of orders) {
      const oid = String(order.order_id);
      const stops = stoppagesByOrder.get(oid) ?? [];
      let stopMin = 0;
      let breakMin = 0;
      for (const s of stops) {
        const mins = resolveStoppageMinutes(s.start_at, s.end_at, s.duration_min, now);
        stopMin += mins;
        if (isBreakdownStoppageCategory(s.category_code, s.requires_breakdown_code)) {
          breakMin += mins;
        }
      }
      totalStoppage += stopMin;
      totalBreakdown += breakMin;

      if (order.prod_duration_min != null && Number(order.prod_duration_min) > 0) {
        totalRuntime += Number(order.prod_duration_min);
      } else if (
        order.prod_start_at
        && (order.status === 'IN_PROGRESS' || order.status === 'STOPPAGE')
      ) {
        const startMs = order.prod_start_at instanceof Date
          ? order.prod_start_at.getTime()
          : new Date(String(order.prod_start_at)).getTime();
        const wallMin = Math.max(0, Math.round((now - startMs) / 60000));
        totalRuntime += Math.max(0, wallMin - stopMin);
      }
    }

    for (const s of manualStoppages) {
      const mins = resolveStoppageMinutes(s.start_at, s.end_at, s.duration_min, now);
      totalStoppage += mins;
      if (isBreakdownStoppageCategory(s.category_code, s.requires_breakdown_code)) {
        totalBreakdown += mins;
      }
    }

    const machineUtilizationPct =
      totalRuntime + totalStoppage > 0
        ? Math.round((totalRuntime / (totalRuntime + totalStoppage)) * 1000) / 10
        : 0;

    return {
      totalRuntimeMinutes: totalRuntime,
      totalStoppageMinutes: totalStoppage,
      totalBreakdownMinutes: totalBreakdown,
      machineUtilizationPct,
    };
  }

  /** Persist live metrics into order_shift_attribution so handover snapshots stay durable. */
  static async syncShiftAttribution(shiftLogId: string, machineCode?: string): Promise<void> {
    const log = await db
      .selectFrom('txn.shift_log')
      .select(['shift_code', 'prod_date'])
      .where('shift_log_id', '=', shiftLogId)
      .executeTakeFirst();
    if (!log) return;

    let orderQ = db
      .selectFrom('txn.crm_order as o')
      .innerJoin('planning.ppc_batch as pb', 'pb.batch_id', 'o.batch_id')
      .select([
        'o.order_id',
        'o.status',
        'o.prod_start_at',
        'o.prod_duration_min',
        'o.ppc_weight_mt',
        'o.sub_process',
        'pb.machine_code',
      ])
      .where('o.shift_log_id', '=', shiftLogId)
      .where((eb) =>
        eb.or([
          eb('o.status', 'in', ['IN_PROGRESS', 'STOPPAGE', 'COMPLETED', 'REJECTED']),
          eb('o.prod_start_at', 'is not', null),
        ]),
      );
    if (machineCode) orderQ = orderQ.where('pb.machine_code', '=', machineCode);

    const orders = await orderQ.execute();
    if (orders.length === 0) return;

    const orderIds = orders.map((o) => String(o.order_id));
    const stoppageRows = await db
      .selectFrom('txn.stoppage as os')
      .leftJoin('master.stoppage_category as sc', 'sc.category_code', 'os.category_code')
      .select([
        'os.order_id',
        'os.duration_min',
        'os.start_at',
        'os.end_at',
        'os.category_code',
        'sc.requires_breakdown_code',
      ])
      .where('os.order_id', 'in', orderIds)
      .execute();

    const now = Date.now();
    const shiftCode = String(log.shift_code).toUpperCase();
    const prodDate = formatPlantDate(log.prod_date as Date);

    for (const order of orders) {
      const oid = String(order.order_id);
      const stops = stoppageRows.filter((s) => String(s.order_id) === oid);
      let stopMin = 0;
      let breakMin = 0;
      for (const s of stops) {
        const mins = resolveStoppageMinutes(s.start_at, s.end_at, s.duration_min, now);
        stopMin += mins;
        if (isBreakdownStoppageCategory(s.category_code, s.requires_breakdown_code)) {
          breakMin += mins;
        }
      }

      let runtimeMinutes = order.prod_duration_min != null ? Number(order.prod_duration_min) : 0;
      if (
        runtimeMinutes <= 0
        && order.prod_start_at
        && (order.status === 'IN_PROGRESS' || order.status === 'STOPPAGE')
      ) {
        const startMs = order.prod_start_at instanceof Date
          ? order.prod_start_at.getTime()
          : new Date(String(order.prod_start_at)).getTime();
        const wallMin = Math.max(0, Math.round((now - startMs) / 60000));
        runtimeMinutes = Math.max(0, wallMin - stopMin);
      }

      if (runtimeMinutes <= 0 && stopMin <= 0) continue;

      const weightMt = await SixHiExecutionService.resolveOrderWeight(
        oid,
        order.sub_process,
        Number(order.ppc_weight_mt),
      );

      try {
        await this.upsertSlice({
          orderId: Number(oid),
          machineCode: order.machine_code ?? 'UNKNOWN',
          shiftLogId,
          shiftCode,
          prodDate,
          runtimeMinutes,
          productionMt: weightMt,
          stoppageMinutes: stopMin,
          breakdownMinutes: breakMin,
        });
      } catch (err) {
        // ponytail: skip slices that fail shift-duration accounting rather than blocking preview
        console.warn('[ShiftAttribution] sync slice skipped', oid, err instanceof Error ? err.message : err);
      }
    }
  }
}
