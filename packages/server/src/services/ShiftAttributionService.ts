import { db } from '../db';
import { SixHiExecutionService, SixHiShiftService } from './sixHi';
import { assertRuntimeAccounting } from '../validation/manufacturingValidation';
import { calcShiftDurationMinutes } from '../utils/kpiCalculator';
import { parseDateOnly } from '../utils/dateOnly';

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
    const processId = await SixHiShiftService.getProcessId();
    const row = await db
      .selectFrom('txn.shift_log')
      .select('shift_log_id')
      .where('process_id', '=', processId)
      .where('shift_code', '=', shiftCode)
      .where('prod_date', '=', parseDateOnly(prodDate))
      .executeTakeFirst();
    return row ? String(row.shift_log_id) : null;
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
        prod_date: parseDateOnly(slice.prodDate),
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
      .selectFrom('txn.crm6_order as o')
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
      .selectFrom('txn.order_stoppage')
      .select(['duration_min', 'category_code'])
      .where('order_id', '=', String(order.order_id))
      .execute();

    let stoppageMinutes = 0;
    let breakdownMinutes = 0;
    for (const s of stoppageRows) {
      const mins = s.duration_min ? Number(s.duration_min) : 0;
      stoppageMinutes += mins;
      if (s.category_code === 'BREAKDOWN') breakdownMinutes += mins;
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
    let q = db
      .selectFrom('txn.order_shift_attribution')
      .select([
        'order_id',
        'machine_code',
        'runtime_minutes',
        'production_mt',
        'stoppage_minutes',
        'breakdown_minutes',
      ])
      .where('shift_log_id', '=', shiftLogId);

    if (machineCode) q = q.where('machine_code', '=', machineCode);

    const rows = await q.execute();
    const totalRuntime = rows.reduce((s, r) => s + Number(r.runtime_minutes), 0);
    const totalStoppage = rows.reduce((s, r) => s + Number(r.stoppage_minutes), 0);
    const totalBreakdown = rows.reduce((s, r) => s + Number(r.breakdown_minutes), 0);
    // Runtime utilization: productive runtime ÷ (runtime + stoppage)
    const machineUtilizationPct =
      totalRuntime + totalStoppage > 0
        ? Math.round((totalRuntime / (totalRuntime + totalStoppage)) * 1000) / 10
        : 0;

    const inProgress = await db
      .selectFrom('txn.crm6_order as o')
      .innerJoin('planning.ppc_batch as pb', 'pb.batch_id', 'o.batch_id')
      .select(['o.batch_number', 'o.status', 'o.sub_process', 'pb.machine_code'])
      .where('o.status', 'in', ['IN_PROGRESS', 'STOPPAGE'])
      .$if(!!machineCode, (qb) => qb.where('pb.machine_code', '=', machineCode!))
      .execute();

    const shiftWindow = await db
      .selectFrom('txn.shift_log as sl')
      .leftJoin('master.shift as s', 's.shift_code', 'sl.shift_code')
      .select(['s.start_time', 's.end_time'])
      .where('sl.shift_log_id', '=', shiftLogId)
      .executeTakeFirst();

    return {
      totalRuntimeMinutes: totalRuntime,
      totalStoppageMinutes: totalStoppage,
      totalBreakdownMinutes: totalBreakdown,
      machineUtilizationPct,
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
}
