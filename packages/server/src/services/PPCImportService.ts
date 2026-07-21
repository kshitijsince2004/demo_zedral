import { randomUUID } from 'crypto';
import { SixHiManualOrderSchema, PPCImportRowSchema, UserRole } from '@m1/shared-validation';
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
import { ProcessRouteService } from './ProcessRouteService';
import {
  getLiveSession,
  previewSessionStore,
  PREVIEW_SESSION_TTL_MS,
} from './previewSessionStore';
import { indexBulk, indexBatch } from '../elastic/traceabilityIndexer';
import { currentPlantDate, postgresDateOnly } from '../utils/dateOnly';
import { ShiftDetectionService } from './ShiftDetectionService';

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
}

/** Preview status label returned to the client for each row. */
export type PreviewRowStatus =
  | 'new'
  | 'safe-update'
  | 'allocation-protected'
  | 'in-production'
  | 'completed'
  | 'duplicate-in-file'
  | 'will-merge';

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

function mapPreviewRow(
  row: ParsedRollingPlanRow,
  previewStatus: PreviewRowStatus = 'new',
  mergeTargetBatchNumber?: string,
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
   * Inspect an existing ppc_batch row to determine whether it is safe to update.
   * Returns a SafetyCheck describing the threat level and reason for any block.
   */
  private static async checkProductionSafety(
    trx: DbConn,
    batchId: string | number,
  ): Promise<SafetyCheck> {
    const row = await trx.selectFrom('planning.ppc_batch as pb')
      .leftJoin('txn.crm_order as o', 'o.batch_id', 'pb.batch_id')
      .leftJoin('txn.crm_rolling as r', 'r.order_id', 'o.order_id')
      .leftJoin('txn.crm_skinpass as sp', 'sp.order_id', 'o.order_id')
      .select([
        'pb.machine_allocated',
        'o.status as order_status',
        'r.actual_weight_mt as rolling_weight',
        'sp.actual_weight_mt as skinpass_weight',
      ])
      .where('pb.batch_id', '=', String(batchId))
      .executeTakeFirst();

    if (!row) {
      // Should not happen — caller verified existing
      return { isNew: true, isAllocated: false, hasOrder: false, orderStatus: null, hasProduction: false, isDangerous: false, skipReason: null };
    }

    const isAllocated = Boolean(row.machine_allocated);
    const hasOrder = row.order_status != null;
    const orderStatus = row.order_status ?? null;
    const hasProduction =
      (row.rolling_weight != null && Number(row.rolling_weight) > 0) ||
      (row.skinpass_weight != null && Number(row.skinpass_weight) > 0);

    const isDangerous =
      orderStatus === 'IN_PROGRESS' ||
      orderStatus === 'COMPLETED' ||
      hasProduction;

    let skipReason: string | null = null;
    if (orderStatus === 'IN_PROGRESS') skipReason = 'Order is currently IN_PROGRESS — cannot overwrite planning data';
    else if (orderStatus === 'COMPLETED') skipReason = 'Order is COMPLETED — production data is immutable';
    else if (hasProduction) skipReason = 'Production weight already captured — cannot overwrite planning data';
    else if (isAllocated) skipReason = 'Batch is already machine-allocated — operationally locked for import';

    return { isNew: false, isAllocated, hasOrder, orderStatus, hasProduction, isDangerous, skipReason };
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
  ): Promise<{ action: 'inserted' | 'updated' | 'skipped'; reason?: string }> {
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

      // Safe unallocated update — no order or PENDING
      await trx.updateTable('planning.ppc_batch')
        .set(batchValues)
        .where('batch_id', '=', String(batchId))
        .execute();
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

    return { action: existing ? 'updated' : 'inserted' };
  }

  static async importFromCsvText(fileName: string, csvText: string, userId: number) {
    const detectedShift = await ShiftDetectionService.getCurrentShift();
    const parsed = parsePpcCsv(csvText, detectedShift.shiftCode);
    if (parsed.headerError) {
      return { headerError: parsed.headerError, batchId: null, status: 'FAILED' as const, loaded: 0, updated: 0, skipped: 0, skippedDuplicates: 0, skippedAllocated: 0, skippedProduction: 0, skippedCompleted: 0, errors: [] };
    }

    // ── Phase 1: In-file duplicate detection (hard fail per policy) ──────────
    const seenInFile = new Map<string, number[]>(); // batchNumber → rowNums
    for (let i = 0; i < parsed.rows.length; i++) {
      const bn = String(parsed.rows[i]?.batch_number ?? '').trim();
      if (!bn) continue;
      const rowNum = ppcDataRowNumber(i);
      const existing = seenInFile.get(bn);
      if (existing) existing.push(rowNum);
      else seenInFile.set(bn, [rowNum]);
    }
    const duplicateEntries = [...seenInFile.entries()].filter(([, rows]) => rows.length > 1);
    if (duplicateEntries.length > 0) {
      const report = duplicateEntries
        .map(([bn, rows]) => `${bn} (rows ${rows.join(', ')})`)
        .join('; ');
      return {
        headerError: `Import rejected — duplicate batch_numbers detected in file: ${report}. Please correct the source file and re-import.`,
        batchId: null,
        status: 'FAILED' as const,
        loaded: 0, updated: 0, skipped: 0, merged: 0, skippedDuplicates: duplicateEntries.length, skippedAllocated: 0, skippedProduction: 0, skippedCompleted: 0,
        errors: [],
      };
    }

    const batch = await db.insertInto('planning.import_batch')
      .values({ source: 'CSV', file_name: fileName, row_count: parsed.rows.length, status: 'PENDING', imported_by: userId })
      .returning('import_batch_id')
      .executeTakeFirstOrThrow();

    const errors: { row: number; message: string }[] = [...parsed.rowErrors];
    let loaded = 0;
    let updated = 0;
    let skippedAllocated = 0;
    let skippedProduction = 0;
    let skippedCompleted = 0;
    const queueCounters = new Map<string, number>();

    for (let i = 0; i < parsed.rows.length; i++) {
      const row = parsed.rows[i];
      const rowNum = ppcDataRowNumber(i);
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
          await SixHiConfigService.ensureOrder(row.batch_number, userId);
        } else {
          updated++;
          const { SixHiConfigService } = await import('./sixHi');
          await SixHiConfigService.ensureOrder(row.batch_number, userId);
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
      .set({ status, error_count: errors.length, row_count: parsed.rows.length })
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
      skippedDuplicates: 0,
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
  ) {
    const detectedShift = await ShiftDetectionService.getCurrentShift();
    const parsed = parseRollingPlanXlsx(buffer, { sheetType, shiftCode: detectedShift.shiftCode });
    if (parsed.headerError) {
      return {
        headerError: parsed.headerError,
        sessionId: '',
        rows: [],
        planDate: '',
        shiftCode: '',
        sheetType,
        sheetName: parsed.sheetName ?? '',
      };
    }

    const sessionId = randomUUID();
    const planDate = parsed.rows.find((r) => r.planDate)?.planDate ?? currentPlantDate();
    const effectiveShift = parsed.rows[0]?.shiftCode ?? detectedShift.shiftCode.toUpperCase();

    // ── Enrich rows with production status for preview display ───────────────
    const allBatchNumbers = parsed.rows.map((r) => r.batchNumber).filter(Boolean);

    // Detect duplicates within the file
    const batchNumberCounts = new Map<string, number>();
    for (const bn of allBatchNumbers) batchNumberCounts.set(bn, (batchNumberCounts.get(bn) ?? 0) + 1);
    const duplicatesInFile = new Set([...batchNumberCounts.entries()].filter(([, n]) => n > 1).map(([bn]) => bn));

    // Same coil/spec with different batch_numbers is allowed — commit inserts
    // each as its own batch (findMatchingPendingBatch excludes current import).

    // Bulk fetch existing batches with their order status
    const existingBatches = allBatchNumbers.length > 0
      ? await db.selectFrom('planning.ppc_batch as pb')
          .leftJoin('txn.crm_order as o', 'o.batch_id', 'pb.batch_id')
          .leftJoin('txn.crm_rolling as r', 'r.order_id', 'o.order_id')
          .leftJoin('txn.crm_skinpass as sp', 'sp.order_id', 'o.order_id')
          .select([
            'pb.batch_number',
            'pb.machine_allocated',
            'o.status as order_status',
            'r.actual_weight_mt as rolling_weight',
            'sp.actual_weight_mt as skinpass_weight',
          ])
          .where('pb.batch_number', 'in', allBatchNumbers)
          .execute()
      : [];

    const existingMap = new Map(existingBatches.map((b) => [b.batch_number, b]));

    const enrichedRows = await Promise.all(parsed.rows.map(async (row) => {
      let previewStatus: PreviewRowStatus = 'new';
      let mergeTargetBatchNumber: string | undefined;

      if (duplicatesInFile.has(row.batchNumber)) {
        previewStatus = 'duplicate-in-file';
      } else {
        const ex = existingMap.get(row.batchNumber);
        if (ex) {
          const hasProduction =
            (ex.rolling_weight != null && Number(ex.rolling_weight) > 0) ||
            (ex.skinpass_weight != null && Number(ex.skinpass_weight) > 0);

          if (ex.order_status === 'COMPLETED' || hasProduction) {
            previewStatus = 'completed';
          } else if (ex.order_status === 'IN_PROGRESS') {
            previewStatus = 'in-production';
          } else if (ex.machine_allocated) {
            previewStatus = 'allocation-protected';
          } else {
            previewStatus = 'safe-update';
          }
        } else if (row.errors.length === 0 && row.batchNumber) {
          // Preview has no import_batch yet; 0 never matches a real id, so all DB candidates remain.
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

      return mapPreviewRow(row, previewStatus, mergeTargetBatchNumber);
    }));

    previewSessionStore.set(sessionId, {
      sessionId,
      fileName,
      userId,
      rows: parsed.rows,
      planDate,
      shiftCode: effectiveShift,
      sheetType: parsed.sheetType ?? sheetType,
      sheetName: parsed.sheetName,
      expiresAt: Date.now() + PREVIEW_SESSION_TTL_MS,
    });

    return {
      sessionId,
      rows: enrichedRows,
      planDate,
      shiftCode: effectiveShift,
      sheetType: parsed.sheetType ?? sheetType,
      sheetName: parsed.sheetName ?? '',
      duplicatesInFile: duplicatesInFile.size,
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

    // ── Phase 1: In-file duplicate detection (hard fail per policy) ──────────
    const seenInFile = new Map<string, number[]>(); // batchNumber → rowNums
    for (const row of rowsToCommit) {
      const existing = seenInFile.get(row.batchNumber);
      if (existing) existing.push(row.rowNum);
      else seenInFile.set(row.batchNumber, [row.rowNum]);
    }
    const duplicateEntries = [...seenInFile.entries()].filter(([, rows]) => rows.length > 1);
    if (duplicateEntries.length > 0) {
      const report = duplicateEntries
        .map(([bn, rows]) => `${bn} (rows ${rows.join(', ')})`)
        .join('; ');
      throw new Error(
        `Import rejected — duplicate batch_numbers detected in selected rows: ${report}. Please correct the source file and re-import.`,
      );
    }

    const batch = await db.insertInto('planning.import_batch')
      .values({
        source: 'XLSX',
        file_name: session.fileName,
        row_count: rowsToCommit.length,
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

    for (const row of rowsToCommit) {
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
          return this.upsertRollingPlanRow(trx, row, Number(batch.import_batch_id));
        });
        if (result.action === 'inserted') {
          const { SixHiConfigService } = await import('./sixHi');
          await SixHiConfigService.ensureOrder(row.batchNumber, userId);
          loaded++;
        } else {
          if (!existedByBatchNumber) merged++;
          else updated++;
        }
      } catch (e: unknown) {
        errors.push({ row: row.rowNum, message: e instanceof Error ? e.message : 'Insert failed' });
        if (e instanceof ProductionSafetyError) {
          const reason = e.message.toLowerCase();
          if (reason.includes('in_progress')) skippedProduction++;
          else if (reason.includes('completed')) skippedCompleted++;
          else if (reason.includes('allocated')) skippedAllocated++;
        }
      }
    }

    const totalLoaded = loaded + updated + merged;
    const skipped = skippedAllocated + skippedProduction + skippedCompleted;
    const status = totalLoaded === 0 && loaded === 0 ? 'FAILED' : errors.length > 0 ? 'PARTIAL' : 'LOADED';
    await db.updateTable('planning.import_batch')
      .set({ status, error_count: errors.length, row_count: rowsToCommit.length })
      .where('import_batch_id', '=', batch.import_batch_id)
      .execute();

    if (status !== 'FAILED') {
      previewSessionStore.delete(sessionId);
    }

    // Only newly inserted rows trigger shift log provisioning and Elasticsearch indexing
    const syncedRows = rowsToCommit.filter((r) =>
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
      skippedDuplicates: 0,
      skippedAllocated,
      skippedProduction,
      skippedCompleted,
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

  private static async upsertRollingPlanRow(
    trx: DbConn,
    row: ParsedRollingPlanRow,
    importBatchId: number,
  ): Promise<{ action: 'inserted' | 'updated' }> {
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

    return { action: existing ? 'updated' : 'inserted' };
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
