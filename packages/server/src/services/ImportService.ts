import { db } from '../db';
import type { Kysely } from 'kysely';
import type { Database } from '../db';
import {
  ParsedImportRow,
  CsvRowParseError,
  normalizeJsonRows,
  parseCsvText,
  rowsToErrorCsv,
} from '../utils/csvParser';
import { ImportRowError, validateImportRow } from './importRowValidator';
import { parseDateOnly } from '../utils/dateOnly';

export type ImportSource = 'CSV' | 'SAP' | 'MANUAL' | 'XLSX';
export type ImportBatchStatus = 'PENDING' | 'VALIDATED' | 'LOADED' | 'FAILED' | 'PARTIAL';

type DbConn = Kysely<Database>;

export interface ImportBatchResult {
  batchId: string;
  successCount: number;
  errorCount: number;
  status: ImportBatchStatus;
  errors: ImportRowError[];
}

export interface ClientImportBatch {
  id: string;
  source: 'CSV' | 'SAP';
  status: ImportBatchStatus;
  total_rows: number;
  loaded_rows: number;
  error_count: number;
  created_at: string;
  updated_at: string;
  error_summary?: string;
}

function toClientSource(source: ImportSource): 'CSV' | 'SAP' {
  return source === 'SAP' ? 'SAP' : 'CSV';
}

function toClientBatch(
  record: {
    import_batch_id: string | number | bigint;
    source: string;
    status: string;
    row_count: number | null;
    error_count: number | null;
    imported_at: Date | string;
    errors_json?: unknown;
  },
  loadedRows: number,
): ClientImportBatch {
  const errors = Array.isArray(record.errors_json) ? (record.errors_json as ImportRowError[]) : [];
  return {
    id: String(record.import_batch_id),
    source: toClientSource(record.source as ImportSource),
    status: record.status as ImportBatchStatus,
    total_rows: record.row_count ?? 0,
    loaded_rows: loadedRows,
    error_count: record.error_count ?? 0,
    created_at: new Date(record.imported_at).toISOString(),
    updated_at: new Date(record.imported_at).toISOString(),
    error_summary:
      errors.length > 0
        ? errors
            .slice(0, 3)
            .map((e: ImportRowError) => e.error)
            .join('; ')
        : undefined,
  };
}

function parserErrorsToImportErrors(rowErrors: CsvRowParseError[]): ImportRowError[] {
  return rowErrors.map((e) => ({
    rowIndex: e.rowIndex,
    rowData: {
      coil_no: e.partial?.coil_no ?? '',
      customer_code: e.partial?.customer_code ?? '',
      grade_code: e.partial?.grade_code ?? '',
      sap_order_no: e.partial?.sap_order_no,
    },
    error: e.error,
  }));
}

export class ImportService {
  static parseCsv(csvText: string): {
    rows: ParsedImportRow[];
    rowErrors: CsvRowParseError[];
    headerError?: string;
  } {
    return parseCsvText(csvText);
  }

  /**
   * Idempotent import into planning.plan_order, planning.coil_plan, and coil.coil.
   */
  static async importPlans(
    source: ImportSource,
    fileName: string,
    rows: ParsedImportRow[],
    userId: number,
    parserRowErrors: CsvRowParseError[] = [],
  ): Promise<ImportBatchResult> {
    const totalDataRows = rows.length + parserRowErrors.length;
    const errors: ImportRowError[] = [...parserErrorsToImportErrors(parserRowErrors)];

    const batch = await db
      .insertInto('planning.import_batch')
      .values({
        source,
        file_name: fileName,
        row_count: totalDataRows,
        error_count: 0,
        status: 'PENDING',
        imported_by: userId,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    const batchId = String(batch.import_batch_id);
    let successCount = 0;
    const seenCoils = new Set<string>();

    for (const [index, row] of rows.entries()) {
      const validationError = await validateImportRow(row, index + 2, seenCoils);
      if (validationError) {
        errors.push(validationError);
        continue;
      }

      try {
        await db.transaction().execute(async (trx) => {
          await this.upsertPlanningRow(trx, row, batch.import_batch_id);
        });
        successCount++;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Load failed';
        errors.push({ rowIndex: index + 2, rowData: row, error: message });
      }
    }

    let finalStatus: ImportBatchStatus = 'LOADED';
    if (errors.length === totalDataRows && totalDataRows > 0) finalStatus = 'FAILED';
    else if (errors.length > 0) finalStatus = 'PARTIAL';
    else if (totalDataRows === 0) finalStatus = 'FAILED';

    await db
      .updateTable('planning.import_batch')
      .set({
        status: finalStatus,
        error_count: errors.length,
        errors_json: JSON.parse(JSON.stringify(errors)),
      })
      .where('import_batch_id', '=', batch.import_batch_id)
      .execute();

    return {
      batchId,
      successCount,
      errorCount: errors.length,
      status: finalStatus,
      errors,
    };
  }

  private static async upsertPlanningRow(
    trx: DbConn,
    row: ParsedImportRow,
    importBatchId: bigint | number | string,
  ) {
    const customer = await trx
      .selectFrom('master.customer')
      .select('customer_id')
      .where('customer_code', '=', row.customer_code)
      .executeTakeFirstOrThrow();

    const sapOrderNo = row.sap_order_no?.trim() || `IMP-${importBatchId}-${row.coil_no}`;

    const existingOrder = await trx
      .selectFrom('planning.plan_order')
      .select('plan_order_id')
      .where('sap_order_no', '=', sapOrderNo)
      .executeTakeFirst();

    let planOrderId: string;
    if (existingOrder) {
      planOrderId = String(existingOrder.plan_order_id);
      await trx
        .updateTable('planning.plan_order')
        .set({
          customer_id: customer.customer_id,
          grade_code: row.grade_code,
          surface_finish: row.surface_finish ?? null,
          target_width_mm: row.target_width_mm ?? null,
          target_thk_mm: row.target_thk_mm ?? null,
          planned_qty_mt: row.planned_qty_mt ?? null,
          due_date: row.due_date ? new Date(row.due_date) : null,
          import_batch_id: String(importBatchId),
        })
        .where('plan_order_id', '=', planOrderId)
        .execute();
    } else {
      const inserted = await trx
        .insertInto('planning.plan_order')
        .values({
          sap_order_no: sapOrderNo,
          customer_id: customer.customer_id,
          grade_code: row.grade_code,
          surface_finish: row.surface_finish ?? null,
          target_width_mm: row.target_width_mm ?? null,
          target_thk_mm: row.target_thk_mm ?? null,
          planned_qty_mt: row.planned_qty_mt ?? null,
          due_date: row.due_date ? new Date(row.due_date) : null,
          import_batch_id: String(importBatchId),
        })
        .returning('plan_order_id')
        .executeTakeFirstOrThrow();
      planOrderId = String(inserted.plan_order_id);
    }

    const existingCoil = await trx
      .selectFrom('coil.coil')
      .select('coil_no')
      .where('coil_no', '=', row.coil_no)
      .executeTakeFirst();

    const coilValues = {
      customer_id: customer.customer_id,
      grade_code: row.grade_code,
      surface_finish: row.surface_finish ?? null,
      heat_no: row.heat_no ?? null,
      nominal_width_mm: row.nominal_width_mm ?? row.target_width_mm ?? null,
      coil_width_mm: row.nominal_width_mm ?? row.target_width_mm ?? null,
      coil_thk_mm: row.coil_thk_mm ?? row.target_thk_mm ?? null,
      weight_mt: row.weight_mt ?? row.planned_qty_mt ?? null,
    };

    if (existingCoil) {
      await trx
        .updateTable('coil.coil')
        .set(coilValues)
        .where('coil_no', '=', row.coil_no)
        .execute();
    } else {
      await trx
        .insertInto('coil.coil')
        .values({ coil_no: row.coil_no, status: 'PLANNED', ...coilValues })
        .execute();
    }

    const processCode = row.planned_process?.toUpperCase();
    if (processCode) {
      const process = await trx
        .selectFrom('master.process')
        .select('process_id')
        .where('code', '=', processCode)
        .executeTakeFirstOrThrow();

      const existingPlan = await trx
        .selectFrom('planning.coil_plan')
        .select('coil_plan_id')
        .where('coil_no', '=', row.coil_no)
        .where('plan_order_id', '=', planOrderId)
        .where('planned_process_id', '=', process.process_id)
        .executeTakeFirst();

      const coilPlanValues = {
        plan_order_id: planOrderId,
        coil_no: row.coil_no,
        planned_process_id: process.process_id,
        seq_no: row.seq_no ?? null,
        planned_date: row.planned_date ? new Date(row.planned_date) : null,
      };

      if (existingPlan) {
        await trx
          .updateTable('planning.coil_plan')
          .set(coilPlanValues)
          .where('coil_plan_id', '=', existingPlan.coil_plan_id)
          .execute();
      } else {
        await trx.insertInto('planning.coil_plan').values(coilPlanValues).execute();
      }
    }
  }

  static async importFromJson(
    fileName: string,
    rows: unknown[],
    userId: number,
  ): Promise<ImportBatchResult> {
    return this.importPlans('MANUAL', fileName, normalizeJsonRows(rows), userId);
  }

  static async importFromCsvText(
    source: ImportSource,
    fileName: string,
    csvText: string,
    userId: number,
  ): Promise<ImportBatchResult & { headerError?: string }> {
    const parsed = parseCsvText(csvText);
    if (parsed.headerError) {
      return {
        batchId: '',
        successCount: 0,
        errorCount: 0,
        status: 'FAILED',
        errors: [],
        headerError: parsed.headerError,
      };
    }
    const result = await this.importPlans(source, fileName, parsed.rows, userId, parsed.rowErrors);
    return result;
  }

  static async getBatch(batchId: string): Promise<ClientImportBatch | null> {
    const batch = await db
      .selectFrom('planning.import_batch')
      .selectAll()
      .where('import_batch_id', '=', batchId)
      .executeTakeFirst();

    if (!batch) return null;

    const loaded = (batch.row_count ?? 0) - (batch.error_count ?? 0);
    return toClientBatch(batch, Math.max(loaded, 0));
  }

  static async getErrorRowsCsv(batchId: string): Promise<string | null> {
    const batch = await db
      .selectFrom('planning.import_batch')
      .select(['errors_json'])
      .where('import_batch_id', '=', batchId)
      .executeTakeFirst();

    if (!batch?.errors_json) return null;

    const errors = (
      typeof batch.errors_json === 'string' ? JSON.parse(batch.errors_json) : batch.errors_json
    ) as ImportRowError[];

    return rowsToErrorCsv(errors);
  }

  /** Plans for a process/date — uses documented planning tables. */
  static async getPlansByProcess(processCode: string, targetDate: string | Date) {
    const process = await db
      .selectFrom('master.process')
      .select('process_id')
      .where('code', '=', processCode.toUpperCase())
      .executeTakeFirst();

    if (!process) return [];

    const day = parseDateOnly(targetDate);

    return db
      .selectFrom('planning.coil_plan as cp')
      .innerJoin('coil.coil as c', 'cp.coil_no', 'c.coil_no')
      .leftJoin('planning.plan_order as po', 'cp.plan_order_id', 'po.plan_order_id')
      .select([
        'c.coil_no',
        'c.grade_code',
        'c.nominal_width_mm',
        'c.coil_thk_mm',
        'c.weight_mt',
        'c.status',
        'po.sap_order_no',
        'po.target_width_mm',
        'po.target_thk_mm',
        'cp.seq_no',
        'cp.planned_date',
      ])
      .where('cp.planned_process_id', '=', process.process_id)
      .where((eb) =>
        eb.or([
          eb('cp.planned_date', '=', day),
          eb('cp.planned_date', 'is', null),
        ]),
      )
      .orderBy('cp.seq_no', 'asc')
      .execute();
  }
}
