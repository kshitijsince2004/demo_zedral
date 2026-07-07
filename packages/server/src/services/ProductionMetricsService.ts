import { db } from '../db';
import { calcPerformance } from '../utils/kpiCalculator';

/** Single source of truth for shift production totals (6HI capture → dashboards). */
export interface ShiftProductionMetrics {
  shiftLogId: string | null;
  planDate: string;
  shiftCode: string;
  targetMt: number;
  totalProdMt: number;
  completedProdMt: number;
  inProgressProdMt: number;
  totalRollingMt: number;
  totalSkinpassMt: number;
  completedOrderCount: number;
  shiftPerformancePct: number;
}

function toPlanDateString(planDate: string | Date): string {
  if (typeof planDate === 'string') return planDate.slice(0, 10);
  return planDate.toISOString().slice(0, 10);
}

export class ProductionMetricsService {
  /**
   * Live shift production from txn.crm6_order + rolling/skinpass weights.
   * Same aggregation used by operator shift summary and machine dashboard.
   */
  static async getShiftMetrics(
    planDate: string,
    shiftCode: string,
    machineFilter?: string[] | null,
  ): Promise<ShiftProductionMetrics> {
    const { SixHiShiftService } = await import('./sixHi');
    const dateStr = toPlanDateString(planDate);
    const shiftLogId = await SixHiShiftService.resolveShiftLogIdForPlan(dateStr, shiftCode);

    const zeros: ShiftProductionMetrics = {
      shiftLogId: null,
      planDate: dateStr,
      shiftCode,
      targetMt: 0,
      totalProdMt: 0,
      completedProdMt: 0,
      inProgressProdMt: 0,
      totalRollingMt: 0,
      totalSkinpassMt: 0,
      completedOrderCount: 0,
      shiftPerformancePct: 0,
    };

    if (!shiftLogId) return zeros;

    const shiftRow = await db.selectFrom('txn.shift_log')
      .select('target_mt')
      .where('shift_log_id', '=', shiftLogId)
      .executeTakeFirst();

    const machineScope = machineFilter && machineFilter.length > 0 ? machineFilter : undefined;
    const summary = await SixHiShiftService.getShiftSummary(shiftLogId, machineScope);
    const targetMt = Number(shiftRow?.target_mt ?? 0);

    return {
      shiftLogId,
      planDate: dateStr,
      shiftCode,
      targetMt,
      totalProdMt: summary.totalProdMt,
      completedProdMt: summary.completedProdMt ?? 0,
      inProgressProdMt: summary.inProgressProdMt ?? 0,
      totalRollingMt: summary.totalRollingMt,
      totalSkinpassMt: summary.totalSkinpassMt,
      completedOrderCount: summary.completedOrders?.length ?? 0,
      shiftPerformancePct: calcPerformance(summary.totalProdMt, targetMt),
    };
  }

  /** Sum live 6HI production for all shifts on a calendar date (plant “production today”). */
  static async getPlantProductionForDate(planDate: string): Promise<number> {
    const { SixHiShiftService } = await import('./sixHi');
    const processId = await SixHiShiftService.getProcessId();
    const prodDate = SixHiShiftService.toPlanDate(planDate);

    const rows = await db.selectFrom('txn.shift_log')
      .select('shift_log_id')
      .where('process_id', '=', processId)
      .where('prod_date', '=', prodDate)
      .execute();

    let total = 0;
    for (const row of rows) {
      total += await SixHiShiftService.getProducedMt(String(row.shift_log_id));
    }
    return Math.round(total * 10) / 10;
  }
}
