import type { ProcessRunRow, ProcessRunStatus } from './types';
import {
  resolveCrm6AreaCode,
  resolveProcessArea,
  toDateString,
  toNumber,
} from './lineArea';

interface ShiftContext {
  shiftLogId: string;
  prodDate: Date | string;
  shiftCode: string;
  processCode: string;
  millType: string | null;
}

function deriveStatus(
  holdMt: number | null,
  rejectionMt: number | null,
  forCtlMt: number | null,
): ProcessRunStatus {
  if ((forCtlMt ?? 0) > 0) return 'FOR_CTL';
  if ((rejectionMt ?? 0) > 0) return 'REJECT';
  if ((holdMt ?? 0) > 0) return 'HOLD';
  return 'OK';
}

function baseRun(
  ctx: ShiftContext,
  coilNo: string,
  areaCode: string,
  sourceTable: string,
  sourceEntryId: string | number | bigint,
  fields: Partial<ProcessRunRow>,
): ProcessRunRow {
  return {
    runId: `${sourceTable}:${sourceEntryId}`,
    coilNo,
    processCode: ctx.processCode,
    areaCode,
    prodDate: toDateString(ctx.prodDate),
    shiftCode: ctx.shiftCode,
    operatorCode: null,
    timeFrom: null,
    timeTo: null,
    outputWeightMt: null,
    outputThkMm: null,
    status: 'OK',
    sourceTable,
    sourceEntryId: String(sourceEntryId),
    ...fields,
  };
}

export function mapHrsRow(
  ctx: ShiftContext,
  row: Record<string, unknown>,
): ProcessRunRow {
  return baseRun(ctx, String(row.coil_no), 'HRS', 'txn.prod_hrs', row.entry_id as string, {
    timeFrom: row.time_from ? String(row.time_from) : null,
    timeTo: row.time_to ? String(row.time_to) : null,
    outputWeightMt: toNumber(row.weight_mt),
    outputThkMm: toNumber(row.nominal_thk_mm),
    status: deriveStatus(null, toNumber(row.scrap_mt), null),
    attrs: { scrap_mt: toNumber(row.scrap_mt), width_mm: toNumber(row.actual_width_mm) },
  });
}

export function mapPklRow(
  ctx: ShiftContext,
  row: Record<string, unknown>,
): ProcessRunRow {
  return baseRun(ctx, String(row.coil_no), 'PKLG', 'txn.prod_pkl', row.entry_id as string, {
    timeFrom: row.time_from ? String(row.time_from) : null,
    timeTo: row.time_to ? String(row.time_to) : null,
    outputWeightMt: toNumber(row.weight_mt),
    outputThkMm: toNumber(row.thk_mm),
    attrs: { width_mm: toNumber(row.width_mm), wip: row.wip },
  });
}

export function mapAnnCoilRow(
  ctx: ShiftContext,
  coilNo: string,
  charge: Record<string, unknown>,
): ProcessRunRow {
  const weight = toNumber(charge.unloading_wt_mt) ?? toNumber(charge.unloading_mt);
  return baseRun(ctx, coilNo, 'HPH', 'txn.ann_charge', charge.charge_no as string, {
    outputWeightMt: weight,
    status: charge.status === 'REJECTED' ? 'REJECT' : 'OK',
    attrs: {
      charge_no: charge.charge_no,
      base_no: charge.base_no,
      furnace_id: charge.furnace_id,
      loading_mt: toNumber(charge.loading_mt),
      temperature_degc: toNumber(charge.temperature_degc),
    },
  });
}

export function mapSkpRow(
  ctx: ShiftContext,
  row: Record<string, unknown>,
): ProcessRunRow {
  const areaCode = resolveProcessArea('SKP', ctx.millType);
  return baseRun(ctx, String(row.coil_no), areaCode, 'txn.prod_skp', row.entry_id as string, {
    outputWeightMt: toNumber(row.weight_mt),
    outputThkMm: toNumber(row.final_thk_mm) ?? toNumber(row.thk_mm),
    status: deriveStatus(toNumber(row.hold_mt), toNumber(row.rejection_mt), null),
    attrs: {
      wt_scrap_mt: toNumber(row.wt_scrap_mt),
      wt_skinpass_mt: toNumber(row.wt_skinpass_mt),
      surface_finish: row.surface_finish,
    },
  });
}

export function mapRwdRow(
  ctx: ShiftContext,
  row: Record<string, unknown>,
): ProcessRunRow {
  return baseRun(ctx, String(row.coil_no), 'RW_LINE', 'txn.prod_rwd', row.entry_id as string, {
    timeFrom: row.time_from ? String(row.time_from) : null,
    timeTo: row.time_to ? String(row.time_to) : null,
    outputWeightMt: toNumber(row.weight_mt),
    outputThkMm: toNumber(row.output_thk_mm) ?? toNumber(row.thk_mm),
    attrs: { width_mm: toNumber(row.width_mm), surface_finish: row.surface_finish },
  });
}

export function mapCrsRow(
  ctx: ShiftContext,
  row: Record<string, unknown>,
): ProcessRunRow {
  const areaCode = resolveProcessArea('CRS', ctx.millType);
  const rej =
    (toNumber(row.rejection_id_mt) ?? 0) + (toNumber(row.rejection_od_mt) ?? 0);
  return baseRun(ctx, String(row.coil_no), areaCode, 'txn.prod_crs', row.entry_id as string, {
    outputWeightMt: toNumber(row.output_wt_mt),
    outputThkMm: toNumber(row.nominal_thk_mm),
    status: deriveStatus(toNumber(row.hold_mt), rej || null, toNumber(row.for_ctl_mt)),
    attrs: {
      for_ctl_mt: toNumber(row.for_ctl_mt),
      slit_no: row.slit_no,
      hardness_hrb: toNumber(row.hardness_hrb),
    },
  });
}

export function mapCtlRow(
  ctx: ShiftContext,
  row: Record<string, unknown>,
): ProcessRunRow {
  const areaCode = resolveProcessArea('CTL', ctx.millType);
  return baseRun(ctx, String(row.coil_no), areaCode, 'txn.prod_ctl', row.entry_id as string, {
    timeFrom: row.time_from ? String(row.time_from) : null,
    timeTo: row.time_to ? String(row.time_to) : null,
    outputWeightMt: toNumber(row.total_prod_mt) ?? toNumber(row.weight_mt),
    outputThkMm: toNumber(row.thk_mm),
    status: deriveStatus(toNumber(row.hold_mt), toNumber(row.rejection_mt), null),
    attrs: {
      no_bundles: row.no_bundles,
      no_pieces: row.no_pieces,
      width_mm: toNumber(row.width_mm),
    },
  });
}

export function mapCrm6OrderRow(
  ctx: ShiftContext,
  order: Record<string, unknown>,
  machineCode: string,
  rolling: Record<string, unknown> | null,
  skinpass: Record<string, unknown> | null,
): ProcessRunRow {
  const subProcess = String(order.sub_process ?? 'ROLLING');
  const rerolling = Boolean(rolling?.rerolling);
  const areaCode = resolveCrm6AreaCode(machineCode, subProcess, rerolling);

  let weight = toNumber(order.ppc_weight_mt);
  let thk: number | null = toNumber(order.ppc_thk_mm);

  if (subProcess === 'ROLLING' && rolling) {
    weight = toNumber(rolling.actual_weight_mt) ?? weight;
    thk = toNumber(rolling.final_thk_mm) ?? thk;
  } else if (subProcess === 'SKIN_PASS' && skinpass) {
    weight = toNumber(skinpass.actual_weight_mt) ?? weight;
    thk = toNumber(skinpass.output_thk_mm) ?? thk;
  }

  const prodDate = order.production_day
    ? toDateString(order.production_day as Date | string)
    : toDateString(ctx.prodDate);

  return baseRun(ctx, String(order.coil_no), areaCode, 'txn.crm6_order', order.order_id as string, {
    prodDate,
    outputWeightMt: weight,
    outputThkMm: thk,
    attrs: {
      batch_number: order.batch_number,
      sub_process: subProcess,
      machine_code: machineCode,
      rerolling,
      grade_code: order.grade_code,
    },
  });
}
