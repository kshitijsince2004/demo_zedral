import { randomUUID } from 'crypto';
import { SixHiManualOrderSchema, PPCImportRowSchema, UserRole } from '@m1/shared-validation';
import type { z } from 'zod';
import type { Kysely } from 'kysely';
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

function mapPreviewRow(row: ParsedRollingPlanRow) {
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

function queueKey(machineCode: string, planDate: string, shiftCode: string): string {
  return `${machineCode}|${planDate}|${shiftCode}`;
}

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
    planDate: string,
    shiftCode: string,
    counters: Map<string, number>,
  ): Promise<number> {
    const key = queueKey(machineCode, planDate, shiftCode);
    if (!counters.has(key)) {
      const maxSeq = await conn.selectFrom('planning.ppc_batch')
        .select(conn.fn.max('queue_seq').as('max_seq'))
        .where('plan_date', '=', new Date(planDate))
        .where('shift_code', '=', shiftCode)
        .where('machine_code', '=', machineCode)
        .executeTakeFirst();
      counters.set(key, Number(maxSeq?.max_seq) || 0);
    }
    const next = counters.get(key)! + 1;
    counters.set(key, next);
    return next;
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

    return { batchNumber: data.batch_number };
  }

  private static async upsertPpcRow(trx: DbConn, row: PpcRow, importBatchId: number) {
    const existing = await trx.selectFrom('planning.ppc_batch')
      .select('batch_id')
      .where('batch_number', '=', row.batch_number)
      .executeTakeFirst();

    const batchValues = {
      plan_date: new Date(row.plan_date),
      shift_code: row.shift_code,
      machine_code: row.machine_code,
      sub_process: row.sub_process,
      coil_no: row.coil_no,
      slit_id: row.slit_id ?? null,
      customer_name: row.customer_name,
      grade_code: row.grade_code,
      width_mm: row.width_mm,
      input_thk_mm: row.input_thk_mm ?? row.ppc_thk_mm + (row.sub_process === 'SKIN_PASS' ? 0.15 : 0.9),
      ppc_thk_mm: row.ppc_thk_mm,
      ppc_weight_mt: row.ppc_weight_mt,
      destination: row.destination ?? null,
      roll_finish: row.roll_finish ?? null,
      ppc_reroll_flag: row.ppc_reroll_flag ?? false,
      queue_seq: null,
      sap_order_no: row.sap_order_no ?? null,
      process_route_raw: row.process_route ?? null,
      import_batch_id: importBatchId,
      raw_row_json: JSON.stringify(row),
      machine_allocated: false,
    };

    let batchId: number;
    if (existing) {
      batchId = Number(existing.batch_id);
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
  }

  static async importFromCsvText(fileName: string, csvText: string, userId: number) {
    const parsed = parsePpcCsv(csvText);
    if (parsed.headerError) {
      return { headerError: parsed.headerError, batchId: null, status: 'FAILED' as const, loaded: 0, errors: [] };
    }

    const batch = await db.insertInto('planning.import_batch')
      .values({ source: 'CSV', file_name: fileName, row_count: parsed.rows.length, status: 'PENDING', imported_by: userId })
      .returning('import_batch_id')
      .executeTakeFirstOrThrow();

    const errors: { row: number; message: string }[] = [...parsed.rowErrors];
    let loaded = 0;
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
        await db.transaction().execute(async (trx) => {
          await this.ensureShift(row.shift_code, trx);
          await this.ensureGrade(row.grade_code, trx);
          const queueSeq = await this.seedQueueSeq(
            trx,
            row.machine_code,
            row.plan_date,
            row.shift_code,
            queueCounters,
          );
          await this.upsertPpcRow(trx, { ...validation.data, queue_seq: queueSeq }, Number(batch.import_batch_id));
        });
        loaded++;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Insert failed';
        errors.push({ row: rowNum, message: msg });
      }
    }

    const status = loaded === 0 ? 'FAILED' : errors.length > 0 ? 'PARTIAL' : 'LOADED';
    await db.updateTable('planning.import_batch')
      .set({ status, error_count: errors.length, row_count: parsed.rows.length })
      .where('import_batch_id', '=', batch.import_batch_id)
      .execute();

    return {
      batchId: String(batch.import_batch_id),
      status,
      loaded,
      errors,
      headerError: undefined,
    };
  }

  static async previewRollingXlsx(
    buffer: Buffer,
    fileName: string,
    userId: number,
    sheetType: PpcXlsxSheetType,
    shiftCode: string,
  ) {
    const parsed = parseRollingPlanXlsx(buffer, { sheetType, shiftCode });
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
    const planDate = parsed.rows.find((r) => r.planDate)?.planDate ?? new Date().toISOString().slice(0, 10);
    const effectiveShift = parsed.rows[0]?.shiftCode ?? shiftCode.toUpperCase();

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
      rows: parsed.rows.map(mapPreviewRow),
      planDate,
      shiftCode: effectiveShift,
      sheetType: parsed.sheetType ?? sheetType,
      sheetName: parsed.sheetName ?? '',
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

    return session.rows.map(mapPreviewRow);
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
    const queueCounters = new Map<string, number>();

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
        await db.transaction().execute(async (trx) => {
          await this.ensureShift(row.shiftCode, trx);
          await this.ensureGrade(row.gradeCode, trx);
          const queueSeq = await this.seedQueueSeq(
            trx,
            row.machineCode,
            row.planDate,
            row.shiftCode,
            queueCounters,
          );
          await this.upsertRollingPlanRow(trx, row, Number(batch.import_batch_id), queueSeq);
        });
        const { SixHiService } = await import('./SixHiService');
        await SixHiService.ensureOrder(row.batchNumber, userId);
        loaded++;
      } catch (e: unknown) {
        errors.push({ row: row.rowNum, message: e instanceof Error ? e.message : 'Insert failed' });
      }
    }

    const status = loaded === 0 ? 'FAILED' : errors.length > 0 ? 'PARTIAL' : 'LOADED';
    await db.updateTable('planning.import_batch')
      .set({ status, error_count: errors.length, row_count: rowsToCommit.length })
      .where('import_batch_id', '=', batch.import_batch_id)
      .execute();

    if (status !== 'FAILED') {
      previewSessionStore.delete(sessionId);
    }

    const syncedRows = rowsToCommit.filter((r) => r.errors.length === 0);
    const syncedBatchNumbers = syncedRows
      .filter((r) => !errors.some((e) => e.row === r.rowNum))
      .map((r) => r.batchNumber);

    if (loaded > 0) {
      const { SixHiService } = await import('./SixHiService');
      const contexts = new Set<string>();
      for (const row of rowsToCommit) {
        if (row.errors.length > 0 || errors.some((e) => e.row === row.rowNum)) continue;
        contexts.add(`${row.planDate}|${row.shiftCode}`);
      }
      for (const ctx of contexts) {
        const [planDate, shift] = ctx.split('|');
        await SixHiService.ensureActiveShiftLog(
          userId,
          SixHiService.toPlanDate(planDate),
          shift,
        );
      }
    }

    const firstSynced = rowsToCommit.find(
      (r) => r.errors.length === 0 && !errors.some((e) => e.row === r.rowNum),
    );

    return {
      loaded,
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
    queueSeq: number,
  ) {
    const targetThk = row.passTargetThkMm ?? row.finishThkMm;

    const existing = await trx.selectFrom('planning.ppc_batch')
      .select('batch_id')
      .where('batch_number', '=', row.batchNumber)
      .executeTakeFirst();

    const batchValues = {
      plan_date: new Date(row.planDate),
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
      await trx.updateTable('planning.ppc_batch')
        .set(batchValues)
        .where('batch_id', '=', String(batchId))
        .execute();
      await trx.deleteFrom('planning.ppc_rolling_pass_plan')
        .where('batch_id', '=', String(batchId))
        .execute();
    } else {
      const inserted = await trx.insertInto('planning.ppc_batch')
        .values({ batch_number: row.batchNumber, ...batchValues })
        .returning('batch_id')
        .executeTakeFirstOrThrow();
      batchId = Number(inserted.batch_id);
    }

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
  }

  /** @deprecated Use SixHiService.transferMachines */
  static async transferMachine(
    batchNumbers: string[],
    targetMachine: '6HI' | '4HI' | '2HI',
    userId: number,
    roles: string[],
  ) {
    const { SixHiService } = await import('./SixHiService');
    return SixHiService.transferMachines(batchNumbers, targetMachine, userId, roles);
  }
}
