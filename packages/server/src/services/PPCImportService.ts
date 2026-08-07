import { randomUUID } from 'crypto';
import { SixHiManualOrderSchema, PPCImportRowSchema } from '@m1/shared-validation';
import type { z } from 'zod';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { db } from '../db';
import type { Database } from '../db';
import { parsePpcCsv, ppcDataRowNumber } from '../utils/ppcCsvParser';
import {
  parseRollingPlanXlsx,
  type ParsedRollingPlanRow,
  type PpcXlsxSheetType,
} from '../utils/rollingPlanXlsxParser';
import { parseRewindingPlanXlsx } from '../utils/rewindingPlanXlsxParser';
import { parseCtlPlanXlsx } from '../utils/ctlPlanXlsxParser';
import { parseHrsPlanXlsx } from '../utils/hrsPlanXlsxParser';
import { parsePklPlanXlsx } from '../utils/pklPlanXlsxParser';
import { parseAnnPlanXlsx } from '../utils/annPlanXlsxParser';
import { ProcessRouteService, parseRouteString, routeCodeFromBatch } from './ProcessRouteService';
import { QualitySpecService } from './QualitySpecService';
import {
  getLiveSession,
  previewSessionStore,
  PREVIEW_SESSION_TTL_MS,
  type ImportLineScope,
} from './previewSessionStore';
import { indexBulk, indexBatch } from '../elastic/traceabilityIndexer';
import { currentPlantDate, postgresDateOnly } from '../utils/dateOnly';
import { ShiftDetectionService } from './ShiftDetectionService';
import { derivedChildCoilNo } from '../utils/childCoil';

/** Thrown when an import row would overwrite active production data. */
export class ProductionSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProductionSafetyError';
  }
}

/** Classification of an existing batch row w.r.t. production safety. */
interface SafetyCheck {
  isNew: boolean;
  isAllocated: boolean;
  hasOrder: boolean;
  orderStatus: string | null;
  hasProduction: boolean;
  isDangerous: boolean;
  skipReason: string | null;
  /** Journey progressed past the target line — do not re-inject. */
  journeyAdvancedPast: boolean;
}

/** Preview status label returned to the client for each row. */
export type PreviewRowStatus =
  | 'new'
  | 'safe-update'
  | 'allocation-protected'
  | 'in-production'
  | 'completed'
  | 'duplicate-in-file'
  | 'duplicate-skipped'
  | 'will-merge'
  | 'advanced-skipped'
  | 'already-in-line';

export type { ImportLineScope };

/** Line-scoped MH import — route token + default sheet + machine rewrite. */
export const LINE_IMPORT_SCOPE: Record<ImportLineScope, {
  routeCode: string;
  processCode: string;
  defaultSheet: PpcXlsxSheetType;
  machineCode: string;
}> = {
  HRS: { routeCode: 'S', processCode: 'HRS', defaultSheet: 'HRS', machineCode: 'HRS' },
  PKL: { routeCode: 'P', processCode: 'PKL', defaultSheet: 'PKL', machineCode: 'PKL' },
  RWD: { routeCode: 'R', processCode: 'RWD', defaultSheet: 'REWINDING', machineCode: 'RWD' },
  ANN: { routeCode: 'F', processCode: 'ANN', defaultSheet: 'ANNEALING', machineCode: 'ANN' },
  CTL: { routeCode: 'LE', processCode: 'CTL', defaultSheet: 'CTL', machineCode: 'CTL' },
};

export function parseImportLineScope(raw: unknown): ImportLineScope | undefined {
  const v = String(raw ?? '').trim().toUpperCase();
  if (v === 'HRS' || v === 'PKL' || v === 'RWD' || v === 'ANN' || v === 'CTL') return v;
  return undefined;
}

interface PpcRow {
  batch_number: string;
  plan_date: string;
  shift_code: string;
  machine_code: string;
  sub_process: string;
  coil_no: string;
  slit_id?: string;
  customer_name: string;
  grade_code: string;
  width_mm: number;
  input_thk_mm?: number;
  ppc_thk_mm: number;
  ppc_weight_mt: number;
  destination?: string;
  roll_finish?: string;
  ppc_reroll_flag?: boolean;
  queue_seq?: number;
  sap_order_no?: string;
  process_route?: string;
}
type DbConn = Kysely<Database>;

function processCodeFromBatchMachine(machineCode: string, subProcess: string): string | null {
  const code = routeCodeFromBatch(machineCode, subProcess);
  if (!code) {
    const direct: Record<string, string> = {
      HRS: 'HRS', PKL: 'PKL', ANN: 'ANN', RWD: 'RWD', CRS: 'CRS', CTL: 'CTL',
    };
    return direct[machineCode] ?? null;
  }
  try {
    return parseRouteString(code)[0]?.processCode ?? null;
  } catch {
    return null;
  }
}

function routeHasToken(routeRaw: string | null | undefined, routeCode: string): boolean {
  if (!routeRaw) return false;
  try {
    return parseRouteString(routeRaw).some((s) => s.routeCode === routeCode);
  } catch {
    return false;
  }
}

function dedupKeyForRow(row: ParsedRollingPlanRow, lineScope?: ImportLineScope): string {
  if (lineScope === 'HRS' || row.machineCode === 'HRS') {
    const extras = (row.rawExtras ?? {}) as Record<string, unknown>;
    const slitLabel = String(extras.hrsSlitLabel ?? row.slitId ?? '').trim().toUpperCase();
    const width = Number.isFinite(row.widthMm) ? row.widthMm : 0;
    return `${row.coilNo}|${slitLabel}|${width.toFixed(3)}`;
  }
  return row.batchNumber;
}

function numberFromUnknown(raw: unknown): number | undefined {
  if (raw == null || raw === '') return undefined;
  const n = Number.parseFloat(String(raw));
  return Number.isFinite(n) ? n : undefined;
}

/** Journey-aware row class for import fail-safe / dedup (A4). */
export type JourneyImportClass =
  | { kind: 'new' }
  | { kind: 'already-in-line'; reason: string }
  | { kind: 'already-advanced'; reason: string };

export async function classifyJourneyForLine(
  conn: DbConn,
  coilNo: string,
  processCode: string,
  /** When set, only that batch is "already in line" — sibling batches of the same coil stay importable. */
  batchNumber?: string,
): Promise<JourneyImportClass> {
  const journey = await conn.selectFrom('planning.order_journey')
    .select(['journey_id', 'current_step_no'])
    .where('coil_no', '=', coilNo)
    .where('status', '=', 'ACTIVE')
    .executeTakeFirst();
  if (!journey) return { kind: 'new' };

  const steps = await conn.selectFrom('planning.order_journey_step')
    .select(['step_no', 'status', 'queue_batch_id', 'process_code', 'display_label'])
    .where('journey_id', '=', String(journey.journey_id))
    .orderBy('step_no', 'asc')
    .execute();

  const target = steps.find((s) => s.process_code === processCode);
  if (!target) return { kind: 'new' };

  const current = steps.find((s) => s.step_no === journey.current_step_no);
  const currentLabel = current?.display_label ?? current?.process_code ?? `step ${journey.current_step_no}`;

  if (target.status === 'COMPLETED' || Number(journey.current_step_no) > Number(target.step_no)) {
    return {
      kind: 'already-advanced',
      reason: `Coil has advanced past ${processCode} in its route (now at ${currentLabel}) — handled downstream`,
    };
  }

  if (
    (target.status === 'PENDING' || target.status === 'ACTIVE')
    && target.queue_batch_id != null
  ) {
    if (batchNumber) {
      const linked = await conn.selectFrom('planning.ppc_batch')
        .select('batch_number')
        .where('batch_id', '=', String(target.queue_batch_id))
        .executeTakeFirst();
      // Different plan batch, same mother coil → separate work unit (batch-keyed import).
      if (linked && linked.batch_number !== batchNumber) {
        return { kind: 'new' };
      }
    }
    return {
      kind: 'already-in-line',
      reason: `Coil already queued on ${processCode} — cannot re-import`,
    };
  }

  // PENDING/ACTIVE with no queue batch = fail-safe inject.
  return { kind: 'new' };
}

function mapPreviewRow(
  row: ParsedRollingPlanRow,
  previewStatus: PreviewRowStatus = 'new',
  mergeTargetBatchNumber?: string,
  skipReason?: string,
) {
  return {
    rowNum: row.rowNum,
    batchNumber: row.batchNumber,
    planDate: row.planDate,
    shiftCode: row.shiftCode,
    machineCode: row.machineCode,
    subProcess: row.subProcess,
    coilNo: row.coilNo,
    customerName: row.customerName,
    gradeCode: row.gradeCode,
    widthMm: row.widthMm,
    finishThkMm: row.finishThkMm,
    inputThkMm: row.inputThkMm,
    passTargetThkMm: row.passTargetThkMm,
    rollingPassNo: row.rollingPassNo,
    ppcWeightMt: row.ppcWeightMt,
    ppcRerollFlag: row.ppcRerollFlag,
    destination: row.destination,
    rollFinish: row.rollFinish,
    processRouteRaw: row.processRouteRaw,
    errors: row.errors,
    previewStatus,
    mergeTargetBatchNumber,
    skipReason,
  };
}

function rollingRowToSchemaInput(row: ParsedRollingPlanRow): PpcRow {
  return {
    batch_number: row.batchNumber,
    plan_date: row.planDate,
    shift_code: row.shiftCode,
    machine_code: row.machineCode,
    sub_process: row.subProcess,
    coil_no: row.coilNo,
    slit_id: row.slitId,
    customer_name: row.customerName,
    grade_code: row.gradeCode,
    width_mm: row.widthMm,
    input_thk_mm: row.inputThkMm,
    ppc_thk_mm: row.passTargetThkMm ?? row.finishThkMm,
    ppc_weight_mt: row.ppcWeightMt,
    destination: row.destination,
    roll_finish: row.rollFinish,
    ppc_reroll_flag: row.ppcRerollFlag,
    sap_order_no: row.sapOrderNo,
    process_route: row.processRouteCanonical ?? row.processRouteRaw,
  };
}

function queueKey(machineCode: string, subProcess: string, planDate: string, shiftCode: string): string {
  return `${machineCode}|${subProcess}|${planDate}|${shiftCode}`;
}

/** Identity for pending merge — all order-defining fields except plan_date/shift/batch_number. */
function pendingMergeIdentityKey(row: {
  coil_no: string;
  slit_id?: string | null;
  customer_name: string;
  grade_code: string;
  width_mm: number;
  ppc_thk_mm: number;
  ppc_weight_mt: number;
  sub_process: string;
  machine_code: string;
  destination?: string | null;
  roll_finish?: string | null;
  ppc_reroll_flag?: boolean | null;
  sap_order_no?: string | null;
}): string {
  return [
    row.coil_no,
    row.slit_id ?? '',
    row.customer_name,
    row.grade_code,
    row.width_mm,
    row.ppc_thk_mm,
    row.ppc_weight_mt,
    row.sub_process,
    row.machine_code,
    row.destination ?? '',
    row.roll_finish ?? '',
    row.ppc_reroll_flag ? '1' : '0',
    row.sap_order_no ?? '',
  ].join('|');
}

function batchRowMergeIdentityKey(b: {
  coil_no: string;
  slit_id: string | null;
  customer_name: string;
  grade_code: string;
  width_mm: number | string;
  ppc_thk_mm: number | string;
  ppc_weight_mt: number | string;
  sub_process: string;
  machine_code: string;
  destination: string | null;
  roll_finish: string | null;
  ppc_reroll_flag: boolean | null;
  sap_order_no: string | null;
}): string {
  return pendingMergeIdentityKey({
    coil_no: b.coil_no,
    slit_id: b.slit_id,
    customer_name: b.customer_name,
    grade_code: b.grade_code,
    width_mm: Number(b.width_mm),
    ppc_thk_mm: Number(b.ppc_thk_mm),
    ppc_weight_mt: Number(b.ppc_weight_mt),
    sub_process: b.sub_process,
    machine_code: b.machine_code,
    destination: b.destination,
    roll_finish: b.roll_finish,
    ppc_reroll_flag: b.ppc_reroll_flag,
    sap_order_no: b.sap_order_no,
  });
}

/**
 * Fields safe to update on an already-allocated batch.
 * Machine allocation, queue position, plan date, shift, and sub-process are locked.
 */
const ALLOCATION_SAFE_FIELDS = [
  'customer_name',
  'grade_code',
  'width_mm',
  'input_thk_mm',
  'ppc_thk_mm',
  'finish_thk_mm',
  'ppc_weight_mt',
  'destination',
  'roll_finish',
  'ppc_reroll_flag',
  'sap_order_no',
  'process_route_raw',
  'process_route_canonical',
  'ppc_remarks',
  'import_remark',
  'min_thk_tol_mm',
  'max_thk_tol_mm',
  'sp_ra_max_um',
  'sp_ra_min_um',
  'import_batch_id',
  'raw_row_json',
] as const;

export class PPCImportService {
  /** Auto-provision PPC grades (e.g. D, EDD, C-62) that are not yet in master.grade. */
  private static async ensureCoil(
    conn: DbConn,
    params: {
      coilNo: string;
      gradeCode: string;
      widthMm: number;
      coilThkMm: number;
      weightMt: number;
    },
  ): Promise<void> {
    await conn.insertInto('coil.coil')
      .values({
        coil_no: params.coilNo,
        grade_code: params.gradeCode,
        nominal_width_mm: params.widthMm,
        coil_thk_mm: params.coilThkMm,
        weight_mt: params.weightMt,
        status: 'PLANNED',
      })
      .onConflict((oc) => oc.column('coil_no').doUpdateSet({
        grade_code: params.gradeCode,
        nominal_width_mm: params.widthMm,
        coil_thk_mm: params.coilThkMm,
        weight_mt: params.weightMt,
        status: 'PLANNED',
      }))
      .execute();
  }

  /** Default shift windows for the canonical shift codes, used when auto-provisioning. */
  private static readonly SHIFT_DEFAULTS: Record<string, { name: string; start: string; end: string }> = {
    A: { name: 'Morning Shift', start: '06:00:00', end: '14:00:00' },
    B: { name: 'Afternoon Shift', start: '14:00:00', end: '22:00:00' },
    C: { name: 'Night Shift', start: '22:00:00', end: '06:00:00' },
    GEN: { name: 'General Shift', start: '09:00:00', end: '17:00:00' },
  };

  /**
   * Auto-provision a shift code (e.g. A/B/C/GEN) that is not yet in master.shift,
   * mirroring ensureGrade/ensureCoil so a missing/unseeded shift does not fail the
   * ppc_batch.shift_code foreign key for every imported row.
   */
  private static async ensureShift(shiftCode: string, conn: DbConn = db): Promise<void> {
    const code = shiftCode.trim().toUpperCase();
    if (!code) throw new Error('Shift code required');

    const existing = await conn.selectFrom('master.shift')
      .select('shift_code')
      .where('shift_code', '=', code)
      .executeTakeFirst();
    if (existing) return;

    const defaults = this.SHIFT_DEFAULTS[code] ?? {
      name: `Shift ${code}`,
      start: '00:00:00',
      end: '00:00:00',
    };

    await conn.insertInto('master.shift')
      .values({
        shift_code: code,
        name: defaults.name,
        start_time: defaults.start,
        end_time: defaults.end,
      })
      .onConflict((oc) => oc.column('shift_code').doNothing())
      .execute();
  }

  private static async ensureGrade(gradeCode: string, conn: DbConn = db): Promise<void> {
    const code = gradeCode.trim();
    if (!code) throw new Error('Grade code required');

    const existing = await conn.selectFrom('master.grade')
      .select('grade_code')
      .where('grade_code', '=', code)
      .executeTakeFirst();
    if (existing) return;

    await conn.insertInto('master.grade')
      .values({
        grade_code: code,
        description: `PPC import grade ${code}`,
        grade_family: 'PPC',
      })
      .onConflict((oc) => oc.column('grade_code').doNothing())
      .execute();
  }

  private static async seedQueueSeq(
    conn: DbConn,
    machineCode: string,
    subProcess: string,
    planDate: string,
    shiftCode: string,
    counters: Map<string, number>,
  ): Promise<number> {
    const key = queueKey(machineCode, subProcess, planDate, shiftCode);
    if (!counters.has(key)) {
      const maxSeq = await conn.selectFrom('planning.ppc_batch')
        .select(conn.fn.max('queue_seq').as('max_seq'))
        .where('machine_code', '=', machineCode)
        .where('sub_process', '=', subProcess)
        .where(sql`plan_date`, '=', sql`${postgresDateOnly(planDate)}::date`)
        .where('shift_code', '=', shiftCode)
        .executeTakeFirst();
      counters.set(key, Number(maxSeq?.max_seq) || 0);
    }
    const next = counters.get(key)! + 1;
    counters.set(key, next);
    return next;
  }

  /**
   * Find an existing pending batch with identical order identity (plan_date may differ).
   * Batches from the current import run are excluded so same-file rows with different
   * batch_numbers are not silently merged into each other.
   */
  private static async findMatchingPendingBatch(
    trx: DbConn,
    row: PpcRow,
    currentImportBatchId: number,
  ): Promise<{ batch_id: string } | undefined> {
    const targetKey = pendingMergeIdentityKey(row);
    const candidates = await trx.selectFrom('planning.ppc_batch as pb')
      .leftJoin('txn.crm_order as o', 'o.batch_id', 'pb.batch_id')
      .selectAll('pb')
      .where('pb.coil_no', '=', row.coil_no)
      .where('pb.sub_process', '=', row.sub_process)
      .where('pb.machine_allocated', '=', false)
      .where((eb) => eb.or([
        eb('o.status', 'is', null),
        eb('o.status', 'in', ['PENDING', 'PREPARING']),
      ]))
      .where((eb) => eb.or([
        eb('pb.import_batch_id', 'is', null),
        eb('pb.import_batch_id', '!=', String(currentImportBatchId)),
      ]))
      .execute();

    const match = candidates.find((c) => batchRowMergeIdentityKey(c) === targetKey);
    return match ? { batch_id: String(match.batch_id) } : undefined;
  }

  /**
   * Coil-scoped safety independent of ppc_batch existence (closes G1 inject-path gap).
   * Consults line order + production tables and journey for the target process.
   */
  static async checkCoilSafetyForLine(
    trx: DbConn,
    coilNo: string,
    processCode: string,
    batchNumber?: string,
  ): Promise<{ isDangerous: boolean; skipReason: string | null; orderStatus: string | null }> {
    // ponytail: join only the target line — ANN import must not depend on hrs/pkl/rwd tables
    let orderStatus: string | null = null;
    let hasProduction = false;

    if (processCode === 'ANN') {
      const row = await trx.selectFrom('coil.coil as c')
        .leftJoin('txn.ann_charge_coil as acc', 'acc.coil_no', 'c.coil_no')
        .leftJoin('txn.ann_charge as ac', 'ac.charge_no', 'acc.charge_no')
        .select(['ac.status as ann_status'])
        .where('c.coil_no', '=', coilNo)
        .executeTakeFirst();
      orderStatus = row?.ann_status ?? null;
    } else if (processCode === 'HRS') {
      const row = await trx.selectFrom('coil.coil as c')
        .leftJoin('txn.hrs_order as hrs', 'hrs.coil_no', 'c.coil_no')
        .leftJoin('txn.prod_hrs as ph', 'ph.coil_no', 'c.coil_no')
        .select(['hrs.status as hrs_status', 'ph.entry_id as prod_hrs_id'])
        .where('c.coil_no', '=', coilNo)
        .executeTakeFirst();
      orderStatus = row?.hrs_status ?? null;
      hasProduction = row?.prod_hrs_id != null;
    } else if (processCode === 'PKL') {
      const row = await trx.selectFrom('coil.coil as c')
        .leftJoin('txn.pkl_order as pkl', 'pkl.coil_no', 'c.coil_no')
        .leftJoin('txn.prod_pkl as pp', 'pp.coil_no', 'c.coil_no')
        .select(['pkl.status as pkl_status', 'pp.entry_id as prod_pkl_id'])
        .where('c.coil_no', '=', coilNo)
        .executeTakeFirst();
      orderStatus = row?.pkl_status ?? null;
      hasProduction = row?.prod_pkl_id != null;
    } else if (processCode === 'RWD') {
      const row = await trx.selectFrom('coil.coil as c')
        .leftJoin('txn.prod_rwd as pr', 'pr.coil_no', 'c.coil_no')
        .select(['pr.entry_id as prod_rwd_id', 'pr.weight_mt as prod_rwd_weight'])
        .where('c.coil_no', '=', coilNo)
        .executeTakeFirst();
      const rwd = await trx.selectFrom('txn.rwd_order as rwd')
        .innerJoin('planning.ppc_batch as pb', 'pb.batch_id', 'rwd.batch_id')
        .select('rwd.status')
        .where('pb.coil_no', '=', coilNo)
        .executeTakeFirst();
      orderStatus = rwd?.status ?? null;
      hasProduction = row?.prod_rwd_id != null
        || (row?.prod_rwd_weight != null && Number(row.prod_rwd_weight) > 0);
    }

    const journeyClass = await classifyJourneyForLine(trx, coilNo, processCode, batchNumber);
    if (journeyClass.kind === 'already-advanced' || journeyClass.kind === 'already-in-line') {
      return { isDangerous: true, skipReason: journeyClass.reason, orderStatus };
    }

    const live = orderStatus === 'IN_PROGRESS' || orderStatus === 'STOPPAGE' || orderStatus === 'COMPLETED';
    if (live) {
      return {
        isDangerous: true,
        skipReason: `Coil already ${orderStatus} on ${processCode} — cannot re-import`,
        orderStatus,
      };
    }
    if (hasProduction) {
      return {
        isDangerous: true,
        skipReason: 'Production weight already captured — cannot overwrite planning data',
        orderStatus,
      };
    }

    return { isDangerous: false, skipReason: null, orderStatus };
  }

  /**
   * Inspect an existing ppc_batch row to determine whether it is safe to update.
   * Covers CRM/RWD plus HRS/PKL/ANN line orders and journey progress past the target line.
   */
  private static async checkProductionSafety(
    trx: DbConn,
    batchId: string | number,
  ): Promise<SafetyCheck> {
    const row = await trx.selectFrom('planning.ppc_batch as pb')
      .leftJoin('txn.crm_order as o', 'o.batch_id', 'pb.batch_id')
      .leftJoin('txn.crm_rolling as r', 'r.order_id', 'o.order_id')
      .leftJoin('txn.crm_skinpass as sp', 'sp.order_id', 'o.order_id')
      .leftJoin('txn.rwd_order as rwd', 'rwd.batch_id', 'pb.batch_id')
      .leftJoin('txn.prod_rwd as pr', 'pr.coil_no', 'pb.coil_no')
      .leftJoin('txn.hrs_order as hrs', 'hrs.coil_no', 'pb.coil_no')
      .leftJoin('txn.pkl_order as pkl', 'pkl.coil_no', 'pb.coil_no')
      .leftJoin('txn.prod_hrs as ph', 'ph.coil_no', 'pb.coil_no')
      .leftJoin('txn.prod_pkl as pp', 'pp.coil_no', 'pb.coil_no')
      .leftJoin('txn.ann_charge_coil as acc', 'acc.coil_no', 'pb.coil_no')
      .leftJoin('txn.ann_charge as ac', 'ac.charge_no', 'acc.charge_no')
      .select([
        'pb.coil_no',
        'pb.machine_code',
        'pb.sub_process',
        'pb.machine_allocated',
        'o.status as order_status',
        'r.actual_weight_mt as rolling_weight',
        'sp.actual_weight_mt as skinpass_weight',
        'rwd.status as rwd_status',
        'pr.entry_id as prod_rwd_id',
        'pr.weight_mt as prod_rwd_weight',
        'hrs.status as hrs_status',
        'pkl.status as pkl_status',
        'ac.status as ann_status',
        'ph.entry_id as prod_hrs_id',
        'pp.entry_id as prod_pkl_id',
      ])
      .where('pb.batch_id', '=', String(batchId))
      .executeTakeFirst();

    if (!row) {
      return {
        isNew: true, isAllocated: false, hasOrder: false, orderStatus: null,
        hasProduction: false, isDangerous: false, skipReason: null, journeyAdvancedPast: false,
      };
    }

    const isAllocated = Boolean(row.machine_allocated);
    const orderStatus =
      row.order_status ?? row.rwd_status ?? row.hrs_status ?? row.pkl_status ?? row.ann_status ?? null;
    const hasOrder = orderStatus != null;
    const hasProduction =
      (row.rolling_weight != null && Number(row.rolling_weight) > 0) ||
      (row.skinpass_weight != null && Number(row.skinpass_weight) > 0) ||
      row.prod_rwd_id != null ||
      (row.prod_rwd_weight != null && Number(row.prod_rwd_weight) > 0) ||
      row.prod_hrs_id != null ||
      row.prod_pkl_id != null;

    const processCode = processCodeFromBatchMachine(row.machine_code, row.sub_process ?? '');
    let journeyAdvancedPast = false;
    let journeyReason: string | null = null;
    if (processCode) {
      const journeyClass = await classifyJourneyForLine(trx, row.coil_no, processCode);
      if (journeyClass.kind === 'already-advanced') {
        journeyAdvancedPast = true;
        journeyReason = journeyClass.reason;
      }
    }

    const lineLabel = processCode ?? row.machine_code;
    const liveLineStatuses = new Set(['IN_PROGRESS', 'STOPPAGE', 'COMPLETED']);
    const lineDangerous = orderStatus != null && liveLineStatuses.has(orderStatus);

    const isDangerous =
      orderStatus === 'IN_PROGRESS' ||
      orderStatus === 'COMPLETED' ||
      orderStatus === 'STOPPAGE' ||
      hasProduction ||
      journeyAdvancedPast;

    let skipReason: string | null = null;
    if (journeyAdvancedPast && journeyReason) {
      skipReason = journeyReason;
    } else if (lineDangerous && (row.hrs_status || row.pkl_status || row.ann_status) && !row.order_status && !row.rwd_status) {
      skipReason = `Coil already ${orderStatus} on ${lineLabel} — cannot re-import`;
    } else if (orderStatus === 'IN_PROGRESS' || orderStatus === 'STOPPAGE') {
      skipReason = 'Order is currently IN_PROGRESS — cannot overwrite planning data';
    } else if (orderStatus === 'COMPLETED') {
      skipReason = 'Order is COMPLETED — production data is immutable';
    } else if (hasProduction) {
      skipReason = 'Production weight already captured — cannot overwrite planning data';
    } else if (isAllocated) {
      skipReason = 'Batch is already machine-allocated — operationally locked for import';
    }

    return {
      isNew: false, isAllocated, hasOrder, orderStatus, hasProduction,
      isDangerous, skipReason, journeyAdvancedPast,
    };
  }

  static async createManualBatch(row: z.infer<typeof SixHiManualOrderSchema>, userId: number) {
    const validation = SixHiManualOrderSchema.safeParse(row);
    if (!validation.success) {
      throw new Error(validation.error.errors.map((e) => e.message).join('; '));
    }

    const data = validation.data;
    const dup = await db.selectFrom('planning.ppc_batch')
      .select('batch_id')
      .where('batch_number', '=', data.batch_number)
      .executeTakeFirst();
    if (dup) {
      throw new Error(`Duplicate batch number: ${data.batch_number}`);
    }

    await this.ensureGrade(data.grade_code);

    const importBatch = await db.insertInto('planning.import_batch')
      .values({
        source: 'MANUAL',
        file_name: `manual-${data.batch_number}`,
        row_count: 1,
        status: 'PENDING',
        imported_by: userId,
      })
      .returning('import_batch_id')
      .executeTakeFirstOrThrow();

    const ppcRow: PpcRow = {
      ...data,
      sub_process: data.sub_process,
      destination: data.destination,
    };

    await db.transaction().execute(async (trx) => {
      await this.ensureShift(ppcRow.shift_code, trx);
      await this.upsertPpcRow(trx, ppcRow, Number(importBatch.import_batch_id));
    });

    await db.updateTable('planning.import_batch')
      .set({ status: 'LOADED', error_count: 0, row_count: 1 })
      .where('import_batch_id', '=', importBatch.import_batch_id)
      .execute();

    // Index into Elasticsearch
    try {
      const insertedRow = await db.selectFrom('planning.ppc_batch')
        .selectAll()
        .where('batch_number', '=', data.batch_number)
        .executeTakeFirst();
      if (insertedRow) {
        await indexBatch(insertedRow);
      }
    } catch (e) {
      console.error('[elastic] Failed to index manual batch:', e);
    }

    return { batchNumber: data.batch_number };
  }

  private static async upsertPpcRow(
    trx: DbConn,
    row: PpcRow,
    importBatchId: number,
  ): Promise<{ action: 'inserted' | 'updated' | 'skipped'; batchNumber: string; reason?: string }> {
    const processCode = processCodeFromBatchMachine(row.machine_code, row.sub_process);
    if (processCode) {
      const journeyClass = await classifyJourneyForLine(trx, row.coil_no, processCode, row.batch_number);
      if (journeyClass.kind === 'already-advanced' || journeyClass.kind === 'already-in-line') {
        throw new ProductionSafetyError(journeyClass.reason);
      }
      const coilSafety = await this.checkCoilSafetyForLine(trx, row.coil_no, processCode, row.batch_number);
      if (coilSafety.isDangerous) {
        throw new ProductionSafetyError(coilSafety.skipReason!);
      }
    }

    let existing = await trx.selectFrom('planning.ppc_batch')
      .select('batch_id')
      .where('batch_number', '=', row.batch_number)
      .executeTakeFirst();

    if (!existing) {
      const pendingMatch = await this.findMatchingPendingBatch(trx, row, importBatchId);
      if (pendingMatch) existing = { batch_id: pendingMatch.batch_id };
    }

    const inputThkMm = row.sub_process === 'SKIN_PASS'
      ? row.input_thk_mm
      : (row.input_thk_mm ?? row.ppc_thk_mm + 0.9);
    if (inputThkMm == null) {
      throw new Error(
        row.sub_process === 'SKIN_PASS'
          ? `Pre-stage thickness required for skin pass batch ${row.batch_number}`
          : `Input thickness required for batch ${row.batch_number}`,
      );
    }

    const batchValues = {
      plan_date: postgresDateOnly(row.plan_date),
      shift_code: row.shift_code,
      machine_code: row.machine_code,
      sub_process: row.sub_process,
      coil_no: row.coil_no,
      slit_id: row.slit_id ?? null,
      customer_name: row.customer_name,
      grade_code: row.grade_code,
      width_mm: row.width_mm,
      input_thk_mm: inputThkMm,
      ppc_thk_mm: row.ppc_thk_mm,
      ppc_weight_mt: row.ppc_weight_mt,
      destination: row.destination ?? null,
      roll_finish: row.roll_finish ?? null,
      ppc_reroll_flag: row.ppc_reroll_flag ?? false,
      queue_seq: row.queue_seq ?? null,
      sap_order_no: row.sap_order_no ?? null,
      process_route_raw: row.process_route ?? null,
      import_batch_id: importBatchId,
      raw_row_json: JSON.stringify(row),
      machine_allocated: false,
    };

    let batchId: number;
    let storedBatchNumber = row.batch_number;
    if (existing) {
      batchId = Number(existing.batch_id);
      const safety = await this.checkProductionSafety(trx, batchId);

      if (safety.isDangerous) {
        throw new ProductionSafetyError(safety.skipReason!);
      }

      if (safety.isAllocated) {
        // Operationally locked — skip entirely per policy
        throw new ProductionSafetyError(safety.skipReason!);
      }

      // Safe unallocated update — keep existing batch_number (pending merge identity).
      await trx.updateTable('planning.ppc_batch')
        .set(batchValues)
        .where('batch_id', '=', String(batchId))
        .execute();
      const kept = await trx
        .selectFrom('planning.ppc_batch')
        .select('batch_number')
        .where('batch_id', '=', String(batchId))
        .executeTakeFirstOrThrow();
      storedBatchNumber = kept.batch_number;
    } else {
      const inserted = await trx.insertInto('planning.ppc_batch')
        .values({ batch_number: row.batch_number, ...batchValues })
        .returning('batch_id')
        .executeTakeFirstOrThrow();
      batchId = Number(inserted.batch_id);
    }

    await this.ensureCoil(trx, {
      coilNo: row.coil_no,
      gradeCode: row.grade_code,
      widthMm: row.width_mm,
      coilThkMm: row.input_thk_mm ?? row.ppc_thk_mm,
      weightMt: row.ppc_weight_mt,
    });

    // Snapshot quality spec for planning (fail-soft)
    try {
      await QualitySpecService.attachFromPpc({
        sapOrderNo: row.sap_order_no,
        coilNo: row.coil_no,
        gradeCode: row.grade_code,
        customerName: row.customer_name,
        widthMm: row.width_mm,
        finishThkMm: row.ppc_thk_mm,
        surfaceFinish: row.roll_finish ?? null,
        resolvedBy: 'SYSTEM',
        trx,
      });
    } catch (err) {
      console.error('[PPCImportService] plan_order_spec attach failed safely:', err);
    }

    if (row.process_route) {
      await ProcessRouteService.linkBatchToJourney(
        batchId,
        row.coil_no,
        row.process_route,
        row.machine_code,
        row.sub_process,
        trx,
      );
    }

    return {
      action: existing ? 'updated' : 'inserted',
      batchNumber: storedBatchNumber,
    };
  }

  static async importFromCsvText(fileName: string, csvText: string, userId: number) {
    const detectedShift = await ShiftDetectionService.getCurrentShift();
    const parsed = parsePpcCsv(csvText, detectedShift.shiftCode);
    if (parsed.headerError) {
      return { headerError: parsed.headerError, batchId: null, status: 'FAILED' as const, loaded: 0, updated: 0, skipped: 0, skippedDuplicates: 0, skippedAllocated: 0, skippedProduction: 0, skippedCompleted: 0, errors: [] };
    }

    // ── Phase 1: In-file duplicate handling — keep first occurrence, skip the rest ──
    const seenBatch = new Set<string>();
    const dedupedRows: { row: (typeof parsed.rows)[number]; rowNum: number }[] = [];
    const skippedDuplicateRows: number[] = [];
    for (let i = 0; i < parsed.rows.length; i++) {
      const bn = String(parsed.rows[i]?.batch_number ?? '').trim();
      const rowNum = ppcDataRowNumber(i);
      if (bn && seenBatch.has(bn)) {
        skippedDuplicateRows.push(rowNum);
        continue;
      }
      if (bn) seenBatch.add(bn);
      dedupedRows.push({ row: parsed.rows[i], rowNum });
    }
    const skippedDuplicates = skippedDuplicateRows.length;

    const batch = await db.insertInto('planning.import_batch')
      .values({ source: 'CSV', file_name: fileName, row_count: dedupedRows.length, status: 'PENDING', imported_by: userId })
      .returning('import_batch_id')
      .executeTakeFirstOrThrow();

    const errors: { row: number; message: string }[] = [...parsed.rowErrors];
    let loaded = 0;
    let updated = 0;
    let skippedAllocated = 0;
    let skippedProduction = 0;
    let skippedCompleted = 0;
    const queueCounters = new Map<string, number>();

    for (const { row, rowNum } of dedupedRows) {
      const validation = PPCImportRowSchema.safeParse(row);
      if (!validation.success) {
        errors.push({ row: rowNum, message: validation.error.errors.map((e) => e.message).join('; ') });
        continue;
      }

      try {
        const result = await db.transaction().execute(async (trx) => {
          await this.ensureShift(row.shift_code, trx);
          await this.ensureGrade(row.grade_code, trx);
          const queueSeq = await this.seedQueueSeq(
            trx,
            row.machine_code,
            row.sub_process,
            row.plan_date,
            row.shift_code,
            queueCounters,
          );
          return this.upsertPpcRow(trx, { ...validation.data, queue_seq: queueSeq }, Number(batch.import_batch_id));
        });
        if (result.action === 'inserted') {
          loaded++;
          const { SixHiConfigService } = await import('./sixHi');
          await SixHiConfigService.ensureOrder(result.batchNumber, userId);
        } else {
          updated++;
          const { SixHiConfigService } = await import('./sixHi');
          await SixHiConfigService.ensureOrder(result.batchNumber, userId);
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Insert failed';
        errors.push({ row: rowNum, message: msg });
        // Categorize the skip reason
        if (e instanceof ProductionSafetyError) {
          const reason = e.message.toLowerCase();
          if (reason.includes('in_progress')) skippedProduction++;
          else if (reason.includes('completed')) skippedCompleted++;
          else if (reason.includes('allocated')) skippedAllocated++;
        }
      }
    }

    const totalLoaded = loaded + updated;
    const skipped = skippedAllocated + skippedProduction + skippedCompleted;
    const status = totalLoaded === 0 ? 'FAILED' : errors.length > 0 ? 'PARTIAL' : 'LOADED';
    await db.updateTable('planning.import_batch')
      .set({ status, error_count: errors.length, row_count: dedupedRows.length })
      .where('import_batch_id', '=', batch.import_batch_id)
      .execute();

    // Index successful rows into Elasticsearch
    if (totalLoaded > 0) {
      try {
        const rowsToIndex = await db.selectFrom('planning.ppc_batch')
          .selectAll()
          .where('import_batch_id', '=', batch.import_batch_id)
          .execute();
        if (rowsToIndex.length > 0) {
          await indexBulk(rowsToIndex);
        }
      } catch (e) {
        console.error('[elastic] Failed to bulk index CSV import:', e);
      }
    }

    return {
      batchId: String(batch.import_batch_id),
      status,
      loaded,
      updated,
      merged: 0,
      skipped,
      skippedDuplicates,
      skippedAllocated,
      skippedProduction,
      skippedCompleted,
      errors,
      headerError: undefined,
    };
  }

  static async previewRollingXlsx(
    buffer: Buffer,
    fileName: string,
    userId: number,
    sheetType: PpcXlsxSheetType,
    lineScope?: ImportLineScope,
  ) {
    const detectedShift = await ShiftDetectionService.getCurrentShift();
    const effectiveSheet = lineScope
      ? (LINE_IMPORT_SCOPE[lineScope].defaultSheet)
      : sheetType;
    const shiftOpts = { shiftCode: detectedShift.shiftCode };
    // Scope picks the parser (first sheet + signature). CRM ROLLING/SKIN_PASS untouched.
    const parsed =
      lineScope === 'HRS' || effectiveSheet === 'HRS'
        ? parseHrsPlanXlsx(buffer, shiftOpts)
        : lineScope === 'PKL' || effectiveSheet === 'PKL' || effectiveSheet === 'PICKLING'
          ? parsePklPlanXlsx(buffer, shiftOpts)
          : lineScope === 'ANN' || effectiveSheet === 'ANNEALING'
            ? parseAnnPlanXlsx(buffer, shiftOpts)
            : effectiveSheet === 'REWINDING' || lineScope === 'RWD'
              ? parseRewindingPlanXlsx(buffer, shiftOpts)
              : effectiveSheet === 'CTL'
                ? parseCtlPlanXlsx(buffer, shiftOpts)
                : parseRollingPlanXlsx(buffer, { sheetType: effectiveSheet, shiftCode: detectedShift.shiftCode });
    if (parsed.headerError) {
      return {
        headerError: parsed.headerError,
        sessionId: '',
        rows: [],
        planDate: '',
        shiftCode: '',
        sheetType: effectiveSheet,
        sheetName: parsed.sheetName ?? '',
      };
    }

    const scopeMeta = lineScope ? LINE_IMPORT_SCOPE[lineScope] : null;
    let workingRows = parsed.rows;
    if (scopeMeta) {
      workingRows = parsed.rows
        .filter((r) => routeHasToken(r.processRouteCanonical ?? r.processRouteRaw, scopeMeta.routeCode))
        .map((r) => {
          // Preserve parser 2HI rewinding target; line scope otherwise forces RWD desk.
          const onTwoHi = r.machineCode === '2HI' || r.subProcess === 'REWINDING';
          return {
            ...r,
            machineCode: (onTwoHi ? '2HI' : scopeMeta.machineCode) as ParsedRollingPlanRow['machineCode'],
            subProcess: (onTwoHi ? 'REWINDING' : scopeMeta.processCode) as ParsedRollingPlanRow['subProcess'],
          };
        });
    }

    const sessionId = randomUUID();
    const planDate = workingRows.find((r) => r.planDate)?.planDate ?? currentPlantDate();
    const effectiveShift = workingRows[0]?.shiftCode ?? detectedShift.shiftCode.toUpperCase();
    const planDates = [...new Set(workingRows.map((r) => r.planDate).filter(Boolean))].sort();
    const shiftCodes = [...new Set(workingRows.map((r) => (r.shiftCode ?? '').trim().toUpperCase()).filter(Boolean))].sort();
    const planDateFrom = planDates[0] ?? planDate;
    const planDateTo = planDates[planDates.length - 1] ?? planDate;

    // ── Enrich rows with production status for preview display ───────────────
    const allBatchNumbers = workingRows.map((r) => r.batchNumber).filter(Boolean);

    // Keep-first: first occurrence of each batch_number stays importable; later copies are skipped.
    const firstOccurrenceBatch = new Set<string>();
    const duplicateSkippedRows = new Set<number>();
    for (const row of workingRows) {
      const key = dedupKeyForRow(row, lineScope);
      if (!key) continue;
      if (firstOccurrenceBatch.has(key)) {
        duplicateSkippedRows.add(row.rowNum);
      } else {
        firstOccurrenceBatch.add(key);
      }
    }
    const duplicatesInFileCount = duplicateSkippedRows.size;

    // Bulk fetch existing batches (allocation + CRM production — coil safety is unified below)
    const existingBatches = allBatchNumbers.length > 0
      ? await db.selectFrom('planning.ppc_batch as pb')
          .leftJoin('txn.crm_order as o', 'o.batch_id', 'pb.batch_id')
          .leftJoin('txn.crm_rolling as r', 'r.order_id', 'o.order_id')
          .leftJoin('txn.crm_skinpass as sp', 'sp.order_id', 'o.order_id')
          .select([
            'pb.batch_number',
            'pb.batch_id',
            'pb.coil_no',
            'pb.machine_code',
            'pb.sub_process',
            'pb.machine_allocated',
            'o.status as order_status',
            'r.actual_weight_mt as rolling_weight',
            'sp.actual_weight_mt as skinpass_weight',
          ])
          .where('pb.batch_number', 'in', allBatchNumbers)
          .execute()
      : [];

    const existingMap = new Map(existingBatches.map((b) => [b.batch_number, b]));

    const enrichedRows = await Promise.all(workingRows.map(async (row) => {
      let previewStatus: PreviewRowStatus = 'new';
      let mergeTargetBatchNumber: string | undefined;
      let skipReason: string | undefined;

      if (duplicateSkippedRows.has(row.rowNum)) {
        previewStatus = 'duplicate-skipped';
      } else {
        const processCode = scopeMeta?.processCode
          ?? processCodeFromBatchMachine(row.machineCode, row.subProcess ?? '');

        // Same path as commit: journey + coil-level safety (works with or without ppc_batch).
        if (processCode && row.coilNo) {
          const journeyClass = await classifyJourneyForLine(db, row.coilNo, processCode, row.batchNumber);
          if (journeyClass.kind === 'already-advanced') {
            previewStatus = 'advanced-skipped';
            skipReason = journeyClass.reason;
          } else if (journeyClass.kind === 'already-in-line') {
            previewStatus = 'already-in-line';
            skipReason = journeyClass.reason;
          } else {
            const coilSafety = await this.checkCoilSafetyForLine(db, row.coilNo, processCode, row.batchNumber);
            if (coilSafety.isDangerous) {
              const st = coilSafety.orderStatus;
              if (st === 'COMPLETED' || coilSafety.skipReason?.toLowerCase().includes('production')) {
                previewStatus = 'completed';
              } else if (st === 'IN_PROGRESS' || st === 'STOPPAGE') {
                previewStatus = 'in-production';
              } else {
                previewStatus = 'in-production';
              }
              skipReason = coilSafety.skipReason ?? undefined;
            }
          }
        }

        if (previewStatus === 'new') {
          const ex = existingMap.get(row.batchNumber);
          if (ex) {
            const safety = await this.checkProductionSafety(db, ex.batch_id);
            if (safety.isDangerous) {
              if (safety.journeyAdvancedPast) {
                previewStatus = 'advanced-skipped';
              } else if (safety.orderStatus === 'COMPLETED' || safety.hasProduction) {
                previewStatus = 'completed';
              } else {
                previewStatus = 'in-production';
              }
              skipReason = safety.skipReason ?? undefined;
            } else if (safety.isAllocated) {
              previewStatus = 'allocation-protected';
              skipReason = safety.skipReason ?? undefined;
            } else {
              previewStatus = 'safe-update';
            }
          } else if (row.errors.length === 0 && row.batchNumber) {
            const pendingMatch = await this.findMatchingPendingBatch(db, rollingRowToSchemaInput(row), 0);
            if (pendingMatch) {
              const targetBatch = await db.selectFrom('planning.ppc_batch')
                .select('batch_number')
                .where('batch_id', '=', String(pendingMatch.batch_id))
                .executeTakeFirst();
              if (targetBatch && targetBatch.batch_number !== row.batchNumber) {
                previewStatus = 'will-merge';
                mergeTargetBatchNumber = targetBatch.batch_number;
              }
            }
          }
        }
      }

      return mapPreviewRow(row, previewStatus, mergeTargetBatchNumber, skipReason);
    }));

    previewSessionStore.set(sessionId, {
      sessionId,
      fileName,
      userId,
      rows: workingRows,
      planDate,
      shiftCode: effectiveShift,
      sheetType: parsed.sheetType ?? effectiveSheet,
      sheetName: parsed.sheetName,
      lineScope,
      expiresAt: Date.now() + PREVIEW_SESSION_TTL_MS,
    });

    const statusCounts = {
      new: 0,
      alreadyInLine: 0,
      advancedSkipped: 0,
      inProduction: 0,
      completed: 0,
      otherBlocked: 0,
    };
    for (const r of enrichedRows) {
      if (r.previewStatus === 'new' || r.previewStatus === 'safe-update' || r.previewStatus === 'will-merge') {
        statusCounts.new++;
      } else if (r.previewStatus === 'already-in-line') statusCounts.alreadyInLine++;
      else if (r.previewStatus === 'advanced-skipped') statusCounts.advancedSkipped++;
      else if (r.previewStatus === 'in-production') statusCounts.inProduction++;
      else if (r.previewStatus === 'completed') statusCounts.completed++;
      else statusCounts.otherBlocked++;
    }

    return {
      sessionId,
      rows: enrichedRows,
      planDate,
      shiftCode: effectiveShift,
      planDateFrom,
      planDateTo,
      shiftCodes,
      sheetType: parsed.sheetType ?? effectiveSheet,
      sheetName: parsed.sheetName ?? '',
      duplicatesInFile: duplicatesInFileCount,
      lineScope: lineScope ?? null,
      statusCounts,
    };
  }

  static async updatePreviewMachines(
    sessionId: string,
    assignments: { batchNumber: string; machineCode: '6HI' | '4HI' | '2HI' }[],
  ) {
    const session = getLiveSession(sessionId);

    for (const a of assignments) {
      const row = session.rows.find((r) => r.batchNumber === a.batchNumber);
      if (row) row.machineCode = a.machineCode;
    }

    // NB: call through an arrow so Array.map's index argument is not forwarded as
    // `previewStatus` (which would corrupt every row's status to its numeric index).
    return session.rows.map(r => mapPreviewRow(r));
  }

  static async commitRollingSession(
    sessionId: string,
    userId: number,
    batchNumbers?: string[],
  ) {
    const session = getLiveSession(sessionId);

    const rowsToCommit = batchNumbers?.length
      ? session.rows.filter((r) => batchNumbers.includes(r.batchNumber))
      : session.rows;

    if (rowsToCommit.length === 0) {
      throw new Error('No rows selected for import');
    }

    // ── Phase 1: In-file duplicate handling — keep first occurrence, skip the rest ──
    const seenBatch = new Set<string>();
    const dedupedRows: typeof rowsToCommit = [];
    const skippedDuplicateRows: number[] = [];
    const lineScope = session.lineScope;
    for (const row of rowsToCommit) {
      const key = dedupKeyForRow(row, lineScope);
      if (key && seenBatch.has(key)) {
        skippedDuplicateRows.push(row.rowNum);
        continue;
      }
      if (key) seenBatch.add(key);
      dedupedRows.push(row);
    }
    const skippedDuplicates = skippedDuplicateRows.length;

    const batch = await db.insertInto('planning.import_batch')
      .values({
        source: 'XLSX',
        file_name: session.fileName,
        row_count: dedupedRows.length,
        status: 'PENDING',
        imported_by: userId,
      })
      .returning('import_batch_id')
      .executeTakeFirstOrThrow();

    const errors: { row: number; message: string }[] = [];
    let loaded = 0;
    let updated = 0;
    let merged = 0;
    let skippedAllocated = 0;
    let skippedProduction = 0;
    let skippedCompleted = 0;
    let skippedAdvanced = 0;
    let skippedAlreadyInLine = 0;
    const isHrsScope = lineScope === 'HRS';
    const hrsSourceRowsByBatch = new Map<string, ParsedRollingPlanRow[]>();
    const rowsForUpsert: ParsedRollingPlanRow[] = isHrsScope
      ? this.groupHrsRowsForCommit(dedupedRows, hrsSourceRowsByBatch)
      : dedupedRows;

    for (const row of rowsForUpsert) {
      if (row.errors.length > 0) {
        errors.push({ row: row.rowNum, message: row.errors.join('; ') });
        continue;
      }

      const schemaInput = rollingRowToSchemaInput(row);
      const validation = PPCImportRowSchema.safeParse(schemaInput);
      if (!validation.success) {
        errors.push({
          row: row.rowNum,
          message: validation.error.errors.map((e) => e.message).join('; '),
        });
        continue;
      }

      try {
        const existedByBatchNumber = await db.selectFrom('planning.ppc_batch')
          .select('batch_id')
          .where('batch_number', '=', row.batchNumber)
          .executeTakeFirst();

        const result = await db.transaction().execute(async (trx) => {
          await this.ensureShift(row.shiftCode, trx);
          await this.ensureGrade(row.gradeCode, trx);
          const upserted = await this.upsertRollingPlanRow(trx, row, Number(batch.import_batch_id));
          if (isHrsScope) {
            const sourceRows = hrsSourceRowsByBatch.get(row.batchNumber) ?? [row];
            await this.upsertHrsPlanSlits(trx, upserted.batchId, row.coilNo, sourceRows);
          }
          return upserted;
        });
        const willCallCrmEnsure = session.sheetType !== 'REWINDING' && session.sheetType !== 'CTL'
          && row.machineCode !== 'RWD' && row.machineCode !== 'CTL'
          && row.machineCode !== 'HRS' && row.machineCode !== 'PKL' && row.machineCode !== 'ANN';
        const willCallRwdEnsure = session.sheetType === 'REWINDING'
          || row.machineCode === 'RWD'
          || (row.machineCode === '2HI' && row.fromWorkCenter === 'R')
          || lineScope === 'RWD';

        if (result.action === 'inserted') {
          // CRM mill orders only — RWD/CTL/HRS/PKL plan rows join their queues via journey link.
          if (willCallCrmEnsure) {
            const { SixHiConfigService } = await import('./sixHi');
            await SixHiConfigService.ensureOrder(row.batchNumber, userId);
          }
          if (lineScope === 'HRS' || row.machineCode === 'HRS') {
            const { HrsOrderService } = await import('./HrsOrderService');
            await HrsOrderService.ensureOrder(row.coilNo, userId);
          }
          if (lineScope === 'PKL' || row.machineCode === 'PKL') {
            const { PklOrderService } = await import('./PklOrderService');
            await PklOrderService.ensureOrderForBatch(row.batchNumber, userId);
          }
          loaded++;
        } else {
          if (!existedByBatchNumber) merged++;
          else updated++;
        }

        // RWD queue row — insert or safe update (re-import must still create rwd_order).
        if (willCallRwdEnsure) {
          const { RewindingOrderService } = await import('./RewindingOrderService');
          await RewindingOrderService.ensureOrder(row.batchNumber, userId);
        }
      } catch (e: unknown) {
        errors.push({ row: row.rowNum, message: e instanceof Error ? e.message : 'Insert failed' });
        if (e instanceof ProductionSafetyError) {
          const reason = e.message.toLowerCase();
          if (reason.includes('advanced past')) skippedAdvanced++;
          else if (reason.includes('already queued')) skippedAlreadyInLine++;
          else if (reason.includes('in_progress') || reason.includes('stoppage')) skippedProduction++;
          else if (reason.includes('completed')) skippedCompleted++;
          else if (reason.includes('allocated')) skippedAllocated++;
          else if (reason.includes('cannot re-import')) skippedProduction++;
        }
      }
    }

    const totalLoaded = loaded + updated + merged;
    const skipped = skippedAllocated + skippedProduction + skippedCompleted + skippedAdvanced + skippedAlreadyInLine;
    const status = totalLoaded === 0 && loaded === 0 ? 'FAILED' : errors.length > 0 ? 'PARTIAL' : 'LOADED';
    await db.updateTable('planning.import_batch')
      .set({ status, error_count: errors.length, row_count: dedupedRows.length })
      .where('import_batch_id', '=', batch.import_batch_id)
      .execute();

    if (status !== 'FAILED') {
      previewSessionStore.delete(sessionId);
    }

    // Only newly inserted rows trigger shift log provisioning and Elasticsearch indexing
    const syncedRows = rowsForUpsert.filter((r) =>
      r.errors.length === 0 && !errors.some((e) => e.row === r.rowNum),
    );
    const syncedBatchNumbers = syncedRows.map((r) => r.batchNumber);

    const firstSynced = syncedRows[0];

    // Index into Elasticsearch
    if (totalLoaded > 0) {
      try {
        const rowsToIndex = await db.selectFrom('planning.ppc_batch')
          .selectAll()
          .where('import_batch_id', '=', batch.import_batch_id)
          .execute();
        if (rowsToIndex.length > 0) {
          await indexBulk(rowsToIndex);
        }
      } catch (e) {
        console.error('[elastic] Failed to bulk index rolling import:', e);
      }
    }

    return {
      loaded,
      updated,
      merged,
      skipped,
      skippedDuplicates,
      skippedAllocated,
      skippedProduction,
      skippedCompleted,
      skippedAdvanced,
      skippedAlreadyInLine,
      errors,
      status,
      synced: loaded > 0
        ? {
            planDate: firstSynced?.planDate ?? session.planDate,
            shiftCode: firstSynced?.shiftCode ?? session.shiftCode,
            machines: [...new Set(syncedRows.map((r) => r.machineCode))],
            batchNumbers: syncedBatchNumbers.slice(0, loaded),
          }
        : undefined,
    };
  }

  private static groupHrsRowsForCommit(
    rows: ParsedRollingPlanRow[],
    groupedSource: Map<string, ParsedRollingPlanRow[]>,
  ): ParsedRollingPlanRow[] {
    const grouped = new Map<string, ParsedRollingPlanRow[]>();
    for (const row of rows) {
      const key = row.batchNumber || row.coilNo;
      const list = grouped.get(key) ?? [];
      list.push(row);
      grouped.set(key, list);
    }

    const mergedRows: ParsedRollingPlanRow[] = [];
    for (const [batchNumber, sourceRows] of grouped.entries()) {
      groupedSource.set(batchNumber, sourceRows);
      const first = sourceRows[0];
      const sumWeight = sourceRows.reduce((acc, r) => acc + (Number.isFinite(r.ppcWeightMt) ? r.ppcWeightMt : 0), 0);
      const rmWidth = numberFromUnknown((first.rawExtras as Record<string, unknown> | undefined)?.rmWidth);
      const motherWeight = numberFromUnknown((first.rawExtras as Record<string, unknown> | undefined)?.mCoilWeight);
      mergedRows.push({
        ...first,
        slitId: undefined,
        ppcWeightMt: motherWeight ?? (sumWeight > 0 ? sumWeight : first.ppcWeightMt),
        widthMm: rmWidth ?? first.widthMm,
        rawExtras: {
          ...(first.rawExtras ?? {}),
          hrsSlitCount: sourceRows.length,
        },
      });
    }
    return mergedRows;
  }

  private static async upsertHrsPlanSlits(
    trx: DbConn,
    batchId: number,
    motherCoilNo: string,
    slitRows: ParsedRollingPlanRow[],
  ): Promise<void> {
    for (const row of slitRows) {
      const extras = (row.rawExtras ?? {}) as Record<string, unknown>;
      const slitNo = numberFromUnknown(extras.hrsSlitNo) ?? numberFromUnknown(row.slitId) ?? 0;
      if (!Number.isFinite(slitNo) || slitNo <= 0) continue;
      const slitNoInt = Math.trunc(slitNo);
      const slitLabel = String(extras.hrsSlitLabel ?? row.slitId ?? slitNoInt).trim().toUpperCase();
      const route = String(row.processRouteRaw ?? '').trim().toUpperCase() || null;
      const child = derivedChildCoilNo(motherCoilNo, slitLabel);
      await sql`
        INSERT INTO planning.ppc_hrs_slit (
          batch_id, slit_no, slit_label, width_mm, weight_mt, finish_thk_mm,
          process_route_raw, sap_order_no, item_no, customer_name, child_coil_no
        ) VALUES (
          ${batchId}, ${slitNoInt}, ${slitLabel}, ${row.widthMm}, ${row.ppcWeightMt}, ${row.finishThkMm},
          ${route}, ${row.sapOrderNo ?? null}, ${row.itemNo ?? null}, ${row.customerName}, ${child}
        )
        ON CONFLICT (batch_id, slit_no) DO UPDATE
        SET
          slit_label = EXCLUDED.slit_label,
          width_mm = EXCLUDED.width_mm,
          weight_mt = EXCLUDED.weight_mt,
          finish_thk_mm = EXCLUDED.finish_thk_mm,
          process_route_raw = EXCLUDED.process_route_raw,
          sap_order_no = EXCLUDED.sap_order_no,
          item_no = EXCLUDED.item_no,
          customer_name = EXCLUDED.customer_name,
          child_coil_no = EXCLUDED.child_coil_no
      `.execute(trx);
    }
  }

  private static async upsertRollingPlanRow(
    trx: DbConn,
    row: ParsedRollingPlanRow,
    importBatchId: number,
  ): Promise<{ action: 'inserted' | 'updated'; batchId: number }> {
    const processCode = processCodeFromBatchMachine(row.machineCode, row.subProcess ?? '');
    if (processCode) {
      const journeyClass = await classifyJourneyForLine(trx, row.coilNo, processCode, row.batchNumber);
      if (journeyClass.kind === 'already-advanced' || journeyClass.kind === 'already-in-line') {
        throw new ProductionSafetyError(journeyClass.reason);
      }
      const coilSafety = await this.checkCoilSafetyForLine(trx, row.coilNo, processCode, row.batchNumber);
      if (coilSafety.isDangerous) {
        throw new ProductionSafetyError(coilSafety.skipReason!);
      }
    }

    const targetThk = row.passTargetThkMm ?? row.finishThkMm;

    let existing = await trx.selectFrom('planning.ppc_batch')
      .select('batch_id')
      .where('batch_number', '=', row.batchNumber)
      .executeTakeFirst();

    if (!existing) {
      const pendingMatch = await this.findMatchingPendingBatch(
        trx,
        rollingRowToSchemaInput(row),
        importBatchId,
      );
      if (pendingMatch) existing = { batch_id: pendingMatch.batch_id };
    }

    const batchValues = {
      plan_date: postgresDateOnly(row.planDate),
      shift_code: row.shiftCode,
      machine_code: row.machineCode,
      sub_process: row.subProcess,
      coil_no: row.coilNo,
      slit_id: row.slitId ?? null,
      customer_name: row.customerName,
      grade_code: row.gradeCode,
      width_mm: row.widthMm,
      input_thk_mm: row.inputThkMm,
      ppc_thk_mm: targetThk,
      finish_thk_mm: row.finishThkMm,
      active_rolling_pass_no: row.subProcess === 'ROLLING' ? (row.rollingPassNo ?? 1) : 1,
      ppc_weight_mt: row.ppcWeightMt,
      destination: row.destination ?? null,
      roll_finish: row.rollFinish ?? null,
      ppc_reroll_flag: row.ppcRerollFlag,
      coil_count: row.coilCount,
      queue_seq: null,
      sap_order_no: row.sapOrderNo ?? null,
      item_no: row.itemNo ?? null,
      from_work_center: row.fromWorkCenter ?? null,
      to_work_center: row.toWorkCenter ?? null,
      ppc_remarks: row.ppcRemarks ?? null,
      import_remark: row.importRemark ?? null,
      min_thk_tol_mm: row.minThkTolMm ?? null,
      max_thk_tol_mm: row.maxThkTolMm ?? null,
      sp_ra_max_um: row.spRaMaxUm ?? null,
      sp_ra_min_um: row.spRaMinUm ?? null,
      process_route_raw: row.processRouteRaw,
      process_route_canonical: row.processRouteCanonical,
      import_batch_id: importBatchId,
      raw_row_json: JSON.stringify(row),
      machine_allocated: false,
    };

    let batchId: number;
    if (existing) {
      batchId = Number(existing.batch_id);
      const safety = await this.checkProductionSafety(trx, batchId);

      if (safety.isDangerous) {
        throw new ProductionSafetyError(safety.skipReason!);
      }

      if (safety.isAllocated) {
        // Batch is operationally locked — reject per policy
        throw new ProductionSafetyError(safety.skipReason!);
      }

      // Safe to update — batch exists but is unallocated with no active/completed order
      await trx.updateTable('planning.ppc_batch')
        .set(batchValues)
        .where('batch_id', '=', String(batchId))
        .execute();

      // Only rebuild pass plans when the batch is completely clean (no order at all)
      if (!safety.hasOrder) {
        await trx.deleteFrom('planning.ppc_rolling_pass_plan')
          .where('batch_id', '=', String(batchId))
          .execute();
        for (const plan of row.rollingPassPlans) {
          await trx.insertInto('planning.ppc_rolling_pass_plan')
            .values({
              batch_id: batchId,
              pass_no: plan.passNo,
              target_thk_mm: plan.targetThkMm ?? null,
              roll_finish: plan.rollFinish ?? null,
              is_required: plan.isRequired,
            })
            .execute();
        }
      }
      // If a PENDING order exists, preserve pass plans to avoid disrupting operators
    } else {
      const inserted = await trx.insertInto('planning.ppc_batch')
        .values({ batch_number: row.batchNumber, ...batchValues })
        .returning('batch_id')
        .executeTakeFirstOrThrow();
      batchId = Number(inserted.batch_id);

      for (const plan of row.rollingPassPlans) {
        await trx.insertInto('planning.ppc_rolling_pass_plan')
          .values({
            batch_id: batchId,
            pass_no: plan.passNo,
            target_thk_mm: plan.targetThkMm ?? null,
            roll_finish: plan.rollFinish ?? null,
            is_required: plan.isRequired,
          })
          .execute();
      }
    }

    await this.ensureCoil(trx, {
      coilNo: row.coilNo,
      gradeCode: row.gradeCode,
      widthMm: row.widthMm,
      coilThkMm: row.inputThkMm,
      weightMt: row.ppcWeightMt,
    });

    if (row.processRouteCanonical) {
      await ProcessRouteService.linkBatchToJourney(
        batchId,
        row.coilNo,
        row.processRouteCanonical,
        row.machineCode,
        row.subProcess,
        trx,
      );
    }

    return { action: existing ? 'updated' : 'inserted', batchId };
  }

  /** @deprecated Use SixHiConfigService.transferMachines */
  static async transferMachine(
    batchNumbers: string[],
    targetMachine: '6HI' | '4HI' | '2HI',
    userId: number,
    roles: string[],
  ) {
    const { SixHiConfigService } = await import('./sixHi');
    return SixHiConfigService.transferMachines(batchNumbers, targetMachine, userId, roles);
  }
}
