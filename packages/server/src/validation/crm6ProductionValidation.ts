import { db } from '../db';
import { assertQuantityWithinProduction, assertRuntimeAccounting, ManufacturingValidationError } from './manufacturingValidation';
import { resolveShiftWindowBounds } from './manufacturingValidation';
import { calcShiftDurationMinutes } from '../utils/kpiCalculator';

export async function resolveOrderProductionMt(orderId: string | number): Promise<number> {
  const row = await db
    .selectFrom('txn.crm_order as o')
    .innerJoin('planning.ppc_batch as pb', 'pb.batch_id', 'o.batch_id')
    .leftJoin('txn.crm_rolling as r', 'r.order_id', 'o.order_id')
    .leftJoin('txn.crm_skinpass as s', 's.order_id', 'o.order_id')
    .select(['o.ppc_weight_mt', 'r.actual_weight_mt as rolling_actual', 's.actual_weight_mt as skinpass_actual'])
    .where('o.order_id', '=', String(orderId))
    .executeTakeFirst();

  if (!row) throw new ManufacturingValidationError('Order not found');

  const actual = row.skinpass_actual ?? row.rolling_actual;
  if (actual != null && Number(actual) > 0) return Number(actual);
  return Number(row.ppc_weight_mt ?? 0);
}

export async function assertCrm6OutputWeight(
  orderId: string | number,
  actualWeightMt: number | null | undefined,
): Promise<void> {
  if (actualWeightMt == null) return;

  const ppc = await db
    .selectFrom('txn.crm_order')
    .select('ppc_weight_mt')
    .where('order_id', '=', String(orderId))
    .executeTakeFirst();

  const plannedMt = Number(ppc?.ppc_weight_mt ?? 0);
  assertQuantityWithinProduction(actualWeightMt, plannedMt, 'Actual production weight');
}

export async function assertCrm6DefectQuantities(
  orderId: string | number,
  defects: Array<{ quantityAffected?: number }> | undefined,
): Promise<void> {
  if (!defects?.length) return;
  const productionMt = await resolveOrderProductionMt(orderId);
  for (const defect of defects) {
    if (defect.quantityAffected == null) continue;
    assertQuantityWithinProduction(defect.quantityAffected, productionMt, 'Defect quantity');
  }
}

export async function assertCrm6ScrapKg(
  shiftLogId: string,
  scrapKg: number | undefined,
): Promise<void> {
  if (scrapKg == null || scrapKg <= 0) return;

  const { SixHiExecutionService } = await import('../services/sixHi');
  const productionMt = await SixHiExecutionService.getProducedMt(shiftLogId);
  const scrapMt = scrapKg / 1000;
  assertQuantityWithinProduction(scrapMt, productionMt, 'Scrap');
}

export async function assertOrderRuntimeAccounting(
  orderId: string | number,
  runtimeMinutes: number,
  stoppageMinutes: number,
): Promise<void> {
  const ctx = await db
    .selectFrom('txn.crm_order as o')
    .leftJoin('txn.shift_log as sl', 'sl.shift_log_id', 'o.shift_log_id')
    .innerJoin('master.shift as s', (join) =>
      join.onRef('s.shift_code', '=', 'o.shift_code'),
    )
    .select(['sl.prod_date as sl_prod_date', 'o.prod_date', 's.start_time', 's.end_time'])
    .where('o.order_id', '=', String(orderId))
    .executeTakeFirst();

  if (!ctx?.start_time || !ctx?.end_time) return;

  const prodDateRaw = ctx.sl_prod_date ?? ctx.prod_date;
  if (!prodDateRaw) return;
  const prodDate = prodDateRaw instanceof Date ? prodDateRaw : new Date(prodDateRaw);
  const bounds = resolveShiftWindowBounds(
    prodDate,
    String(ctx.start_time).slice(0, 5),
    String(ctx.end_time).slice(0, 5),
  );
  assertRuntimeAccounting(runtimeMinutes, stoppageMinutes, bounds.durationMinutes);
}

export async function assertShiftLogRuntimeAccounting(shiftLogId: string): Promise<void> {
  const shiftLog = await db
    .selectFrom('txn.shift_log as sl')
    .leftJoin('master.shift as s', 's.shift_code', 'sl.shift_code')
    .select(['sl.shift_code', 's.start_time', 's.end_time'])
    .where('sl.shift_log_id', '=', shiftLogId)
    .executeTakeFirst();

  if (!shiftLog?.start_time || !shiftLog?.end_time) return;

  const shiftDuration = calcShiftDurationMinutes(
    String(shiftLog.start_time).slice(0, 5),
    String(shiftLog.end_time).slice(0, 5),
  );

  const stoppageRows = await db
    .selectFrom('txn.stoppage as os')
    .leftJoin('txn.crm_order as o', 'o.order_id', 'os.order_id')
    .select(['os.duration_min'])
    .where((eb) =>
      eb.or([
        eb('os.shift_log_id', '=', shiftLogId),
        eb('o.shift_log_id', '=', shiftLogId)
      ])
    )
    .execute();

  const downtimeMinutes = stoppageRows.reduce((s, r) => s + Number(r.duration_min ?? 0), 0);

  const runtimeRows = await db
    .selectFrom('txn.order_shift_attribution')
    .select(['runtime_minutes'])
    .where('shift_log_id', '=', shiftLogId)
    .execute();

  const runtimeMinutes = runtimeRows.reduce((s, r) => s + Number(r.runtime_minutes ?? 0), 0);
  assertRuntimeAccounting(runtimeMinutes, downtimeMinutes, shiftDuration);
}
