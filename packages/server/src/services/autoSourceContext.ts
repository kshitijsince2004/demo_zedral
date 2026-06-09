import { db } from '../db';

/** Canonical cold-rolling sequence for previous-process lookup. */
export const PROCESS_CHAIN = ['HRS', 'PKL', 'CRM', 'ANN', 'SKP', 'RWD', 'CRS', 'CTL'] as const;

export type ProcessCode = (typeof PROCESS_CHAIN)[number];

export interface PlanContext {
  sapOrderNo: string | null;
  gradeCode: string | null;
  customerId: number | null;
  surfaceFinish: string | null;
  targetWidthMm: number | null;
  targetThkMm: number | null;
  plannedQtyMt: number | null;
  plannedProcessCode: string | null;
}

export interface CoilContext {
  coilNo: string;
  gradeCode: string | null;
  customerId: number | null;
  surfaceFinish: string | null;
  heatNo: string | null;
  nominalWidthMm: number | null;
  coilWidthMm: number | null;
  coilThkMm: number | null;
  weightMt: number | null;
}

export interface PreviousProcessContext {
  processCode: string;
  inThkMm: number | null;
  outThkMm: number | null;
  outWeightMt: number | null;
}

export interface GradeSpecContext {
  hardnessHrbMin: number | null;
  hardnessHrbMax: number | null;
  utsNmm2Min: number | null;
  utsNmm2Max: number | null;
  elongationPctMin: number | null;
  raUmMax: number | null;
}

export interface AutoSourceContext {
  processCode: string;
  coilNo: string;
  coil: CoilContext | null;
  plan: PlanContext | null;
  gradeSpec: GradeSpecContext | null;
  previousProcess: PreviousProcessContext | null;
}

function toNum(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function getPreviousProcessCode(processCode: string): string | null {
  const idx = PROCESS_CHAIN.indexOf(processCode.toUpperCase() as ProcessCode);
  return idx > 0 ? PROCESS_CHAIN[idx - 1] : null;
}

export async function loadAutoSourceContext(
  processCode: string,
  coilNo: string,
): Promise<AutoSourceContext> {
  const normalizedProcess = processCode.toUpperCase();
  const normalizedCoil = coilNo.trim();

  const coilRow = await db
    .selectFrom('coil.coil')
    .select([
      'coil_no',
      'grade_code',
      'customer_id',
      'surface_finish',
      'heat_no',
      'nominal_width_mm',
      'coil_width_mm',
      'coil_thk_mm',
      'weight_mt',
    ])
    .where('coil_no', '=', normalizedCoil)
    .executeTakeFirst();

  const coil: CoilContext | null = coilRow
    ? {
        coilNo: coilRow.coil_no,
        gradeCode: coilRow.grade_code,
        customerId: coilRow.customer_id,
        surfaceFinish: coilRow.surface_finish,
        heatNo: coilRow.heat_no,
        nominalWidthMm: toNum(coilRow.nominal_width_mm),
        coilWidthMm: toNum(coilRow.coil_width_mm),
        coilThkMm: toNum(coilRow.coil_thk_mm),
        weightMt: toNum(coilRow.weight_mt),
      }
    : null;

  const planRows = await db
    .selectFrom('planning.coil_plan as cp')
    .leftJoin('planning.plan_order as po', 'cp.plan_order_id', 'po.plan_order_id')
    .leftJoin('master.process as p', 'cp.planned_process_id', 'p.process_id')
    .select([
      'po.sap_order_no',
      'po.grade_code',
      'po.customer_id',
      'po.surface_finish',
      'po.target_width_mm',
      'po.target_thk_mm',
      'po.planned_qty_mt',
      'p.code as planned_process_code',
      'cp.seq_no',
    ])
    .where('cp.coil_no', '=', normalizedCoil)
    .orderBy('cp.seq_no', 'asc')
    .execute();

  const planRow =
    planRows.find((row) => row.planned_process_code === normalizedProcess) ?? planRows[0];
  const plan: PlanContext | null = planRow
    ? {
        sapOrderNo: planRow.sap_order_no,
        gradeCode: planRow.grade_code,
        customerId: planRow.customer_id,
        surfaceFinish: planRow.surface_finish,
        targetWidthMm: toNum(planRow.target_width_mm),
        targetThkMm: toNum(planRow.target_thk_mm),
        plannedQtyMt: toNum(planRow.planned_qty_mt),
        plannedProcessCode: planRow.planned_process_code,
      }
    : null;

  const gradeCode = coil?.gradeCode ?? plan?.gradeCode ?? null;
  const customerId = coil?.customerId ?? plan?.customerId ?? null;

  let gradeSpec: GradeSpecContext | null = null;
  if (gradeCode) {
    const specRows = await db
      .selectFrom('master.grade_spec')
      .select([
        'hardness_hrb_min',
        'hardness_hrb_max',
        'uts_nmm2_min',
        'uts_nmm2_max',
        'elongation_pct_min',
        'ra_um_max',
        'customer_id',
      ])
      .where('grade_code', '=', gradeCode)
      .where((eb) =>
        customerId
          ? eb.or([eb('customer_id', '=', customerId), eb('customer_id', 'is', null)])
          : eb('customer_id', 'is', null),
      )
      .orderBy('customer_id', 'desc')
      .execute();

    const spec = specRows[0];
    if (spec) {
      gradeSpec = {
        hardnessHrbMin: toNum(spec.hardness_hrb_min),
        hardnessHrbMax: toNum(spec.hardness_hrb_max),
        utsNmm2Min: toNum(spec.uts_nmm2_min),
        utsNmm2Max: toNum(spec.uts_nmm2_max),
        elongationPctMin: toNum(spec.elongation_pct_min),
        raUmMax: toNum(spec.ra_um_max),
      };
    }
  }

  const prevCode = getPreviousProcessCode(normalizedProcess);
  let previousProcess: PreviousProcessContext | null = null;
  if (prevCode) {
    const prevProc = await db
      .selectFrom('master.process')
      .select('process_id')
      .where('code', '=', prevCode)
      .executeTakeFirst();

    if (prevProc) {
      const hist = await db
        .selectFrom('coil.coil_process_history')
        .select(['in_thk_mm', 'out_thk_mm', 'out_weight_mt'])
        .where('coil_no', '=', normalizedCoil)
        .where('process_id', '=', prevProc.process_id)
        .executeTakeFirst();

      if (hist) {
        previousProcess = {
          processCode: prevCode,
          inThkMm: toNum(hist.in_thk_mm),
          outThkMm: toNum(hist.out_thk_mm),
          outWeightMt: toNum(hist.out_weight_mt),
        };
      }
    }
  }

  return {
    processCode: normalizedProcess,
    coilNo: normalizedCoil,
    coil,
    plan,
    gradeSpec,
    previousProcess,
  };
}
