import { db } from '../db';
import { ParsedImportRow } from '../utils/csvParser';

export interface ImportRowError {
  rowIndex: number;
  rowData: ParsedImportRow;
  error: string;
}

const PROCESS_CODES = new Set(['HRS', 'PKL', 'CRM', 'ANN', 'SKP', 'RWD', 'CRS', 'CTL', 'GLV']);

export async function validateImportRow(
  row: ParsedImportRow,
  rowIndex: number,
  seenCoils: Set<string>,
): Promise<ImportRowError | null> {
  if (!row.coil_no) {
    return { rowIndex, rowData: row, error: 'coil_no is required' };
  }
  if (!row.customer_code) {
    return { rowIndex, rowData: row, error: 'customer_code is required' };
  }
  if (!row.grade_code) {
    return { rowIndex, rowData: row, error: 'grade_code is required' };
  }

  const coilKey = row.coil_no.toUpperCase();
  if (seenCoils.has(coilKey)) {
    return { rowIndex, rowData: row, error: `Duplicate coil_no in file: ${row.coil_no}` };
  }
  seenCoils.add(coilKey);

  const customer = await db
    .selectFrom('master.customer')
    .select('customer_id')
    .where('customer_code', '=', row.customer_code)
    .executeTakeFirst();
  if (!customer) {
    return { rowIndex, rowData: row, error: `Unknown customer_code: ${row.customer_code}` };
  }

  const grade = await db
    .selectFrom('master.grade')
    .select('grade_code')
    .where('grade_code', '=', row.grade_code)
    .executeTakeFirst();
  if (!grade) {
    return { rowIndex, rowData: row, error: `Unknown grade_code: ${row.grade_code}` };
  }

  if (row.planned_process && !PROCESS_CODES.has(row.planned_process.toUpperCase())) {
    return { rowIndex, rowData: row, error: `Unknown planned_process: ${row.planned_process}` };
  }

  const numericChecks: Array<[keyof ParsedImportRow, string]> = [
    ['target_width_mm', 'target_width_mm'],
    ['target_thk_mm', 'target_thk_mm'],
    ['planned_qty_mt', 'planned_qty_mt'],
    ['nominal_width_mm', 'nominal_width_mm'],
    ['coil_thk_mm', 'coil_thk_mm'],
    ['weight_mt', 'weight_mt'],
  ];

  for (const [field, label] of numericChecks) {
    const val = row[field] as number | undefined;
    if (val !== undefined && (val <= 0 || !Number.isFinite(val))) {
      return { rowIndex, rowData: row, error: `${label} must be a positive number` };
    }
  }

  if (row.due_date) {
    const d = new Date(row.due_date);
    if (Number.isNaN(d.getTime())) {
      return { rowIndex, rowData: row, error: `Invalid due_date: ${row.due_date}` };
    }
  }

  return null;
}
