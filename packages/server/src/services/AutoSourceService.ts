import { db } from '../db';
import {
  formatDisplayCoilNo,
  mapPlanSurfaceToCode,
  parseCoilIdentity,
} from '../utils/rwdFieldMappers';
import { parsePlanCount } from '../utils/ctlFieldMappers';

export type FieldSource = 'Plan' | 'Prior' | 'Master' | 'Manual' | 'Derived';

export interface PrefillField<T = unknown> {
  value: T;
  source: FieldSource;
}

export interface ProcessPrefill {
  coilNo: string;
  displayCoilNo?: string;
  gradeCode?: PrefillField<string>;
  customerName?: PrefillField<string>;
  widthMm?: PrefillField<number>;
  thicknessMm?: PrefillField<number>;
  weightMt?: PrefillField<number>;
  heatNo?: PrefillField<string>;
  routeRaw?: PrefillField<string>;
  batchNumber?: PrefillField<string>;
  /** PKL / HRS trace — mother coil. */
  motherCoilNo?: PrefillField<string>;
  /** PKL slit id from plan. */
  slitId?: PrefillField<string>;
  /** Pre-Stage thickness used when operator leaves observed blank (RWD-Q1). */
  outputThkMmFallback?: PrefillField<number>;
  /** Plan surface as M/B; null/absent → operator must choose (RWD-Q2). */
  surfaceFinish?: PrefillField<'M' | 'B'>;
  /** CTL plan nominal cut length (display; Set/Actual are operator). */
  nominalLengthMm?: PrefillField<number>;
  /** CTL planned piece count from plan Pcs column. */
  plannedPcs?: PrefillField<number>;
  /** CTL plan No of Rows (bundle/row hint). */
  plannedBundles?: PrefillField<number>;
  /** CTL Prod. Version line hint (e.g. CTL5). */
  prodVersion?: PrefillField<string>;
  [key: string]: unknown;
}

/** Explicit columns for hot plan reads (no selectAll / no unused blobs except CTL raw_row_json). */
const PPC_PLAN_COLS = [
  'batch_id',
  'coil_no',
  'slit_id',
  'grade_code',
  'customer_name',
  'width_mm',
  'input_thk_mm',
  'ppc_thk_mm',
  'ppc_weight_mt',
  'process_route_raw',
  'batch_number',
  'roll_finish',
  'raw_row_json',
  'from_work_center',
  'machine_code',
] as const;

const PRIOR_HRS_COLS = ['entry_id', 'coil_no', 'actual_width_mm', 'nominal_thk_mm', 'weight_mt'] as const;
const PRIOR_PKL_COLS = ['entry_id', 'coil_no', 'width_mm', 'thk_mm', 'weight_mt'] as const;
const PRIOR_RWD_COLS = ['entry_id', 'coil_no', 'width_mm', 'output_thk_mm', 'weight_mt'] as const;
const PRIOR_CRS_COLS = ['entry_id', 'coil_no', 'coil_width_mm', 'nominal_thk_mm', 'output_wt_mt'] as const;

function field<T>(value: T | null | undefined, source: FieldSource): PrefillField<T> | undefined {
  if (value == null || value === '') return undefined;
  return { value: value as T, source };
}

async function loadPriorOutput(processCode: string, coilNo: string) {
  switch (processCode) {
    case 'PKL':
      return db.selectFrom('txn.prod_hrs').select([...PRIOR_HRS_COLS]).where('coil_no', '=', coilNo)
        .orderBy('entry_id', 'desc').executeTakeFirst();
    case 'RWD':
      return db.selectFrom('txn.prod_pkl').select([...PRIOR_PKL_COLS]).where('coil_no', '=', coilNo)
        .orderBy('entry_id', 'desc').executeTakeFirst();
    case 'ANN':
      return db.selectFrom('txn.prod_rwd').select([...PRIOR_RWD_COLS]).where('coil_no', '=', coilNo)
        .orderBy('entry_id', 'desc').executeTakeFirst();
    case 'CRS':
      return db.selectFrom('txn.prod_rwd').select([...PRIOR_RWD_COLS]).where('coil_no', '=', coilNo)
        .orderBy('entry_id', 'desc').executeTakeFirst();
    case 'CTL':
      return db.selectFrom('txn.prod_crs').select([...PRIOR_CRS_COLS]).where('coil_no', '=', coilNo)
        .orderBy('entry_id', 'desc').executeTakeFirst();
    default:
      return null;
  }
}

function applyPrior(result: ProcessPrefill, prior: Record<string, unknown>, processCode: string) {
  const widthKey = processCode === 'PKL' ? 'actual_width_mm'
    : processCode === 'CRS' || processCode === 'CTL' ? 'coil_width_mm' : 'width_mm';
  const thkKey = processCode === 'PKL' ? 'nominal_thk_mm'
    : processCode === 'RWD' ? 'output_thk_mm'
    : processCode === 'CRS' || processCode === 'CTL' ? 'nominal_thk_mm' : 'thk_mm';
  const wtKey = processCode === 'CRS' || processCode === 'CTL' ? 'output_wt_mt' : 'weight_mt';

  if (!result.widthMm && prior[widthKey] != null) {
    result.widthMm = field(Number(prior[widthKey]), 'Prior');
  }
  if (!result.thicknessMm && prior[thkKey] != null) {
    result.thicknessMm = field(Number(prior[thkKey]), 'Prior');
  }
  // CTL-Q1: prior weight preferred over plan — always overwrite when prior has weight.
  if (processCode === 'CTL' && prior[wtKey] != null) {
    result.weightMt = field(Number(prior[wtKey]), 'Prior');
  } else if (!result.weightMt && prior[wtKey] != null) {
    result.weightMt = field(Number(prior[wtKey]), 'Prior');
  }
  if (processCode === 'RWD' && !result.outputThkMmFallback && prior[thkKey] != null) {
    result.outputThkMmFallback = field(Number(prior[thkKey]), 'Prior');
  }
}

function parseRawRowJson(raw: unknown): Record<string, unknown> | null {
  if (raw == null) return null;
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : null;
    } catch {
      return null;
    }
  }
  return null;
}

function applyCtlPlanExtras(result: ProcessPrefill, batch: Record<string, unknown>) {
  const extras = parseRawRowJson(batch.raw_row_json);
  const lengthMm = extras?.lengthMm != null ? Number(extras.lengthMm)
    : extras?.length_mm != null ? Number(extras.length_mm) : undefined;
  if (lengthMm != null && Number.isFinite(lengthMm)) {
    result.nominalLengthMm = field(lengthMm, 'Plan');
  }

  const plannedPcs = extras?.plannedPcs != null ? Number(extras.plannedPcs)
    : parsePlanCount(extras?.pcs);
  if (plannedPcs != null && Number.isFinite(plannedPcs)) {
    result.plannedPcs = field(Math.trunc(plannedPcs), 'Plan');
  }

  const plannedBundles = parsePlanCount(extras?.noOfRows);
  if (plannedBundles != null && plannedBundles > 0) {
    result.plannedBundles = field(plannedBundles, 'Plan');
  }

  const prodVersion = extras?.prodVersion != null ? String(extras.prodVersion)
    : extras?.prod_version != null ? String(extras.prod_version) : undefined;
  if (prodVersion) result.prodVersion = field(prodVersion, 'Plan');
}

async function loadScopedPlanBatch(
  coilNo: string,
  scope: { fromWc: string; machineCode: string },
) {
  const scoped = await db.selectFrom('planning.ppc_batch')
    .select([...PPC_PLAN_COLS])
    .where('coil_no', '=', coilNo)
    .where((eb) => eb.or([
      eb('from_work_center', '=', scope.fromWc),
      eb('machine_code', '=', scope.machineCode),
    ]))
    .orderBy('batch_id', 'desc')
    .executeTakeFirst();
  if (scoped) return scoped;

  const { coilNo: base, slitId } = parseCoilIdentity(coilNo);
  if (slitId) {
    const bySlit = await db.selectFrom('planning.ppc_batch')
      .select([...PPC_PLAN_COLS])
      .where('coil_no', '=', base)
      .where('slit_id', '=', slitId)
      .where((eb) => eb.or([
        eb('from_work_center', '=', scope.fromWc),
        eb('machine_code', '=', scope.machineCode),
      ]))
      .orderBy('batch_id', 'desc')
      .executeTakeFirst();
    if (bySlit) return bySlit;
  }

  return db.selectFrom('planning.ppc_batch')
    .select([...PPC_PLAN_COLS])
    .where('batch_number', '=', coilNo)
    .where((eb) => eb.or([
      eb('from_work_center', '=', scope.fromWc),
      eb('machine_code', '=', scope.machineCode),
    ]))
    .orderBy('batch_id', 'desc')
    .executeTakeFirst();
}

async function loadPlanBatch(processCode: string, coilNo: string) {
  if (processCode === 'RWD') {
    return loadScopedPlanBatch(coilNo, { fromWc: 'R', machineCode: 'RWD' });
  }
  if (processCode === 'CTL') {
    return loadScopedPlanBatch(coilNo, { fromWc: 'L', machineCode: 'CTL' });
  }

  return db.selectFrom('planning.ppc_batch')
    .select([...PPC_PLAN_COLS])
    .where('coil_no', '=', coilNo)
    .orderBy('batch_id', 'desc')
    .executeTakeFirst();
}

function buildPrefillFromParts(
  code: string,
  coilNo: string,
  batch: Record<string, unknown> | null | undefined,
  prior: Record<string, unknown> | null | undefined,
  coil: {
    grade_code: string | null;
    nominal_width_mm: unknown;
    coil_width_mm: unknown;
    coil_thk_mm: unknown;
    weight_mt: unknown;
    heat_no: string | null;
    parent_coil_no: string | null;
    customer_name: string | null;
  } | null | undefined,
): ProcessPrefill {
  const result: ProcessPrefill = { coilNo, displayCoilNo: coilNo };

  if (batch) {
    result.displayCoilNo = formatDisplayCoilNo(
      String(batch.coil_no ?? coilNo),
      batch.slit_id != null ? String(batch.slit_id) : null,
    );
    result.gradeCode = field(batch.grade_code != null ? String(batch.grade_code) : undefined, 'Plan');
    result.customerName = field(batch.customer_name != null ? String(batch.customer_name) : undefined, 'Plan');
    result.widthMm = field(batch.width_mm != null ? Number(batch.width_mm) : undefined, 'Plan');
    const preStage = batch.input_thk_mm ?? batch.ppc_thk_mm;
    result.thicknessMm = field(preStage != null ? Number(preStage) : undefined, 'Plan');
    result.weightMt = field(batch.ppc_weight_mt != null ? Number(batch.ppc_weight_mt) : undefined, 'Plan');
    if (batch.process_route_raw) {
      result.routeRaw = field(String(batch.process_route_raw), 'Plan');
    }
    if (batch.batch_number) {
      result.batchNumber = field(String(batch.batch_number), 'Plan');
    }
    if (code === 'PKL') {
      if (batch.slit_id) result.slitId = field(String(batch.slit_id), 'Plan');
      if (batch.coil_no && batch.coil_no !== coilNo) {
        result.motherCoilNo = field(String(batch.coil_no), 'Plan');
      } else {
        const { coilNo: base } = parseCoilIdentity(coilNo);
        if (base && base !== coilNo) result.motherCoilNo = field(base, 'Plan');
        else if (batch.coil_no) result.motherCoilNo = field(String(batch.coil_no), 'Plan');
      }
    }
    if (code === 'RWD') {
      const fallbackThk = batch.input_thk_mm ?? batch.ppc_thk_mm;
      result.outputThkMmFallback = field(
        fallbackThk != null ? Number(fallbackThk) : undefined,
        'Plan',
      );
      const surface = mapPlanSurfaceToCode(batch.roll_finish != null ? String(batch.roll_finish) : null);
      if (surface) result.surfaceFinish = field(surface, 'Plan');
    }
    if (code === 'CTL') {
      applyCtlPlanExtras(result, batch);
    }
  }

  if (prior) applyPrior(result, prior, code);

  if (coil) {
    if (!result.gradeCode) result.gradeCode = field(coil.grade_code ?? undefined, 'Master');
    if (!result.customerName) result.customerName = field(coil.customer_name ?? undefined, 'Master');
    if (!result.widthMm) {
      const w = coil.nominal_width_mm ?? coil.coil_width_mm;
      result.widthMm = field(w != null ? Number(w) : undefined, 'Master');
    }
    if (!result.thicknessMm) {
      result.thicknessMm = field(coil.coil_thk_mm != null ? Number(coil.coil_thk_mm) : undefined, 'Master');
    }
    if (!result.weightMt) {
      result.weightMt = field(coil.weight_mt != null ? Number(coil.weight_mt) : undefined, 'Master');
    }
    if (!result.heatNo) result.heatNo = field(coil.heat_no ?? undefined, 'Master');
    if (code === 'PKL' && !result.motherCoilNo && coil.parent_coil_no) {
      result.motherCoilNo = field(coil.parent_coil_no, 'Master');
    }
    if (code === 'RWD' && !result.outputThkMmFallback && coil.coil_thk_mm != null) {
      result.outputThkMmFallback = field(Number(coil.coil_thk_mm), 'Master');
    }
  }

  return result;
}

export class AutoSourceService {
  static async resolvePrefill(processCode: string, coilNo: string): Promise<ProcessPrefill> {
    const code = processCode.toUpperCase();
    const batch = await loadPlanBatch(code, coilNo);
    const prior = await loadPriorOutput(code, coilNo);
    const coil = await db.selectFrom('coil.coil as c')
      .leftJoin('master.customer as cu', 'c.customer_id', 'cu.customer_id')
      .select([
        'c.grade_code',
        'c.nominal_width_mm',
        'c.coil_width_mm',
        'c.coil_thk_mm',
        'c.weight_mt',
        'c.heat_no',
        'c.parent_coil_no',
        'cu.customer_name as customer_name',
      ])
      .where('c.coil_no', '=', coilNo)
      .executeTakeFirst();

    return buildPrefillFromParts(
      code,
      coilNo,
      batch as Record<string, unknown> | undefined,
      prior as Record<string, unknown> | undefined,
      coil,
    );
  }

  /**
   * Batch prefill for queue pages (≤200). Set-based plan/prior/master loads for ANN/CRS;
   * CTL/RWD keep scoped plan resolution per coil (same as resolvePrefill).
   */
  static async resolvePrefillMany(
    processCode: string,
    coilNos: string[],
  ): Promise<Map<string, ProcessPrefill>> {
    const code = processCode.toUpperCase();
    const unique = [...new Set(coilNos.filter(Boolean))];
    const out = new Map<string, ProcessPrefill>();
    if (unique.length === 0) return out;

    // Scoped plan paths stay per-coil (identical to resolvePrefill).
    if (code === 'RWD' || code === 'CTL') {
      await Promise.all(unique.map(async (coilNo) => {
        out.set(coilNo, await this.resolvePrefill(code, coilNo));
      }));
      return out;
    }

    const planRows = await db.selectFrom('planning.ppc_batch')
      .select([...PPC_PLAN_COLS])
      .where('coil_no', 'in', unique)
      .orderBy('batch_id', 'desc')
      .execute();
    const planByCoil = new Map<string, Record<string, unknown>>();
    for (const row of planRows) {
      if (!planByCoil.has(row.coil_no)) planByCoil.set(row.coil_no, row as Record<string, unknown>);
    }

    let priorByCoil = new Map<string, Record<string, unknown>>();
    if (code === 'ANN' || code === 'CRS') {
      const priors = await db.selectFrom('txn.prod_rwd')
        .select([...PRIOR_RWD_COLS])
        .where('coil_no', 'in', unique)
        .orderBy('entry_id', 'desc')
        .execute();
      for (const row of priors) {
        if (!priorByCoil.has(row.coil_no)) priorByCoil.set(row.coil_no, row as Record<string, unknown>);
      }
    } else if (code === 'PKL') {
      const priors = await db.selectFrom('txn.prod_hrs')
        .select([...PRIOR_HRS_COLS])
        .where('coil_no', 'in', unique)
        .orderBy('entry_id', 'desc')
        .execute();
      for (const row of priors) {
        if (!priorByCoil.has(row.coil_no)) priorByCoil.set(row.coil_no, row as Record<string, unknown>);
      }
    }

    const coils = await db.selectFrom('coil.coil as c')
      .leftJoin('master.customer as cu', 'c.customer_id', 'cu.customer_id')
      .select([
        'c.coil_no',
        'c.grade_code',
        'c.nominal_width_mm',
        'c.coil_width_mm',
        'c.coil_thk_mm',
        'c.weight_mt',
        'c.heat_no',
        'c.parent_coil_no',
        'cu.customer_name as customer_name',
      ])
      .where('c.coil_no', 'in', unique)
      .execute();
    const coilByNo = new Map(coils.map((c) => [c.coil_no, c]));

    for (const coilNo of unique) {
      out.set(
        coilNo,
        buildPrefillFromParts(
          code,
          coilNo,
          planByCoil.get(coilNo),
          priorByCoil.get(coilNo),
          coilByNo.get(coilNo),
        ),
      );
    }
    return out;
  }
}
