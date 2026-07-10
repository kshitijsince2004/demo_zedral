import { db } from '../db';
import { calcPerformance } from '../utils/kpiCalculator';
import { formatPlantDate } from '@m1/shared-validation';

/** Single source of truth for shift production totals (6HI capture → dashboards). */
export interface ShiftProductionMetrics {
  shiftLogId: string | null;
  prodDate: string;
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

function toProdDateString(prodDate: string | Date): string {
  return formatPlantDate(prodDate);
}

export class ProductionMetricsService {
  /**
   * Live shift production from txn.crm6_order + rolling/skinpass weights.
   * Same aggregation used by operator shift summary and machine dashboard.
   */
  static async getShiftMetrics(
    prodDate: string,
    shiftCode: string,
    machineFilter?: string[] | null,
  ): Promise<ShiftProductionMetrics> {
    const { SixHiShiftService } = await import('./sixHi');
    const dateStr = toProdDateString(prodDate);
    const shiftLogId = await SixHiShiftService.resolveShiftLogIdForPlan(dateStr, shiftCode);

    const zeros: ShiftProductionMetrics = {
      shiftLogId: null,
      prodDate: dateStr,
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
      prodDate: dateStr,
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
  static async getPlantProductionForDate(prodDate: string): Promise<number> {
    const { SixHiShiftService } = await import('./sixHi');
    const processId = await SixHiShiftService.getProcessId();
    const date = SixHiShiftService.toPlanDate(prodDate);

    const rows = await db.selectFrom('txn.shift_log')
      .select('shift_log_id')
      .where('process_id', '=', processId)
      .where('prod_date', '=', date)
      .execute();

    let total = 0;
    for (const row of rows) {
      total += await SixHiShiftService.getProducedMt(String(row.shift_log_id));
    }
    return Math.round(total * 10) / 10;
  }
}
