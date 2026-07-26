import { db } from '../db';
import { assertQuantityWithinProduction, assertRuntimeAccounting, ManufacturingValidationError } from './manufacturingValidation';
import { resolveShiftWindowBounds } from './manufacturingValidation';
import { calcShiftDurationMinutes } from '../utils/kpiCalculator';
import { parsePlantDateOnly, type ActualWeightOcrFields } from '@m1/shared-validation';

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

/** Require hash when source is OCR; reject reused photo hashes outside this order's combined group. */
export async function assertActualWeightOcrCapture(
  orderId: string | number,
  data: ActualWeightOcrFields,
): Promise<void> {
  if (data.actualWeightSource === 'ocr' && !data.actualWeightPhotoHash) {
    throw new ManufacturingValidationError(
      'actualWeightPhotoHash is required when actualWeightSource is ocr',
    );
  }

  const hash = data.actualWeightPhotoHash;
  if (!hash) return;

  const order = await db
    .selectFrom('txn.crm_order')
    .select(['order_id', 'combined_group_id'])
    .where('order_id', '=', String(orderId))
    .executeTakeFirst();

  if (!order) throw new ManufacturingValidationError('Order not found');

  const groupId = order.combined_group_id;

  // Sibling orders in the same combined run may share one capture hash.
  let rollingQ = db
    .selectFrom('txn.crm_rolling as r')
    .innerJoin('txn.crm_order as o', 'o.order_id', 'r.order_id')
    .select('r.order_id')
    .where('r.actual_weight_photo_hash', '=', hash)
    .where('r.order_id', '!=', String(orderId));

  let skinQ = db
    .selectFrom('txn.crm_skinpass as s')
    .innerJoin('txn.crm_order as o', 'o.order_id', 's.order_id')
    .select('s.order_id')
    .where('s.actual_weight_photo_hash', '=', hash)
    .where('s.order_id', '!=', String(orderId));

  if (groupId) {
    rollingQ = rollingQ.where((eb) =>
      eb.or([
        eb('o.combined_group_id', 'is', null),
        eb('o.combined_group_id', '!=', groupId),
      ]),
    );
    skinQ = skinQ.where((eb) =>
      eb.or([
        eb('o.combined_group_id', 'is', null),
        eb('o.combined_group_id', '!=', groupId),
      ]),
    );
  }

  const rollingHit = await rollingQ.limit(1).executeTakeFirst();
  const skinHit = await skinQ.limit(1).executeTakeFirst();

  if (rollingHit || skinHit) {
    throw new ManufacturingValidationError(
      'This weight photo was already used on another production record',
    );
  }
}

/** DB column patch for OCR audit fields — only when source is present in the payload. */
export function actualWeightOcrDbPatch(data: ActualWeightOcrFields): Record<string, unknown> | null {
  if (data.actualWeightSource === undefined) return null;
  if (data.actualWeightSource === 'ocr') {
    return {
      actual_weight_source: 'ocr',
      actual_weight_photo_hash: data.actualWeightPhotoHash ?? null,
      ocr_confidence: data.ocrConfidence ?? null,
      ocr_raw_text: data.ocrRawText ?? null,
    };
  }
  return {
    actual_weight_source: data.actualWeightSource ?? 'manual',
    actual_weight_photo_hash: null,
    ocr_confidence: null,
    ocr_raw_text: null,
  };
}

export function mapActualWeightOcrFields(row: {
  actual_weight_source?: string | null;
  actual_weight_photo_hash?: string | null;
  ocr_confidence?: string | number | null;
  ocr_raw_text?: string | null;
}): ActualWeightOcrFields {
  const source = row.actual_weight_source === 'ocr' || row.actual_weight_source === 'manual'
    ? row.actual_weight_source
    : undefined;
  return {
    actualWeightSource: source,
    actualWeightPhotoHash: row.actual_weight_photo_hash ?? undefined,
    ocrConfidence: row.ocr_confidence != null ? Number(row.ocr_confidence) : undefined,
    ocrRawText: row.ocr_raw_text ?? undefined,
  };
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
  const prodDate = prodDateRaw instanceof Date
    ? prodDateRaw
    : parsePlantDateOnly(String(prodDateRaw));
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
