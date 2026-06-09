/** Normalized planning import row (canonical snake_case keys). */
import { tokenizeCsvText } from './csvTokenizer';

export interface ParsedImportRow {
  coil_no: string;
  sap_order_no?: string;
  customer_code: string;
  grade_code: string;
  surface_finish?: string;
  target_width_mm?: number;
  target_thk_mm?: number;
  planned_qty_mt?: number;
  due_date?: string;
  planned_process?: string;
  seq_no?: number;
  planned_date?: string;
  nominal_width_mm?: number;
  coil_thk_mm?: number;
  weight_mt?: number;
  weight_kg?: number;
  heat_no?: string;
}

export interface CsvRowParseError {
  rowIndex: number;
  error: string;
  partial?: Partial<ParsedImportRow>;
}

const HEADER_ALIASES: Record<string, keyof ParsedImportRow> = {
  coil_no: 'coil_no',
  coilno: 'coil_no',
  coil_number: 'coil_no',
  coilnumber: 'coil_no',
  sap_order_no: 'sap_order_no',
  saporderno: 'sap_order_no',
  order_no: 'sap_order_no',
  customer_code: 'customer_code',
  customercode: 'customer_code',
  customer: 'customer_code',
  grade_code: 'grade_code',
  gradecode: 'grade_code',
  grade: 'grade_code',
  surface_finish: 'surface_finish',
  surfacefinish: 'surface_finish',
  target_width_mm: 'target_width_mm',
  targetwidthmm: 'target_width_mm',
  width_mm: 'target_width_mm',
  width: 'target_width_mm',
  target_thk_mm: 'target_thk_mm',
  targetthkmm: 'target_thk_mm',
  thickness_mm: 'target_thk_mm',
  thickness: 'target_thk_mm',
  planned_qty_mt: 'planned_qty_mt',
  plannedqtymt: 'planned_qty_mt',
  qty_mt: 'planned_qty_mt',
  due_date: 'due_date',
  duedate: 'due_date',
  planned_process: 'planned_process',
  plannedprocess: 'planned_process',
  process: 'planned_process',
  process_code: 'planned_process',
  seq_no: 'seq_no',
  seqno: 'seq_no',
  sequence: 'seq_no',
  planned_date: 'planned_date',
  planneddate: 'planned_date',
  nominal_width_mm: 'nominal_width_mm',
  nominalwidthmm: 'nominal_width_mm',
  coil_thk_mm: 'coil_thk_mm',
  coilthkmm: 'coil_thk_mm',
  weight_mt: 'weight_mt',
  weightmt: 'weight_mt',
  weight_kg: 'weight_kg',
  weightkg: 'weight_kg',
  heat_no: 'heat_no',
  heatno: 'heat_no',
};

function normalizeHeader(header: string): keyof ParsedImportRow | null {
  const key = header.trim().toLowerCase().replace(/\s+/g, '_');
  return HEADER_ALIASES[key] ?? null;
}

function toNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
}

type MapRowResult = ParsedImportRow | { error: string; partial: Partial<ParsedImportRow> };

function mapRow(cells: string[], columnMap: Array<keyof ParsedImportRow | null>): MapRowResult | null {
  const raw: Partial<ParsedImportRow> = {};
  for (let i = 0; i < columnMap.length; i++) {
    const field = columnMap[i];
    if (!field) continue;
    const cell = cells[i] ?? '';
    if (!cell.trim()) continue;

    if (
      field === 'target_width_mm' ||
      field === 'target_thk_mm' ||
      field === 'planned_qty_mt' ||
      field === 'nominal_width_mm' ||
      field === 'coil_thk_mm' ||
      field === 'weight_mt' ||
      field === 'weight_kg' ||
      field === 'seq_no'
    ) {
      const n = toNumber(cell);
      if (n !== undefined) (raw as Record<string, unknown>)[field] = n;
    } else {
      (raw as Record<string, unknown>)[field] = cell.trim();
    }
  }

  if (!raw.coil_no || !raw.customer_code || !raw.grade_code) {
    const missing: string[] = [];
    if (!raw.coil_no) missing.push('coil_no');
    if (!raw.customer_code) missing.push('customer_code');
    if (!raw.grade_code) missing.push('grade_code');
    return { error: `Missing required field(s): ${missing.join(', ')}`, partial: raw };
  }

  if (raw.weight_kg !== undefined && raw.weight_mt === undefined) {
    raw.weight_mt = Math.round((raw.weight_kg / 1000) * 1000) / 1000;
  }

  if (raw.planned_process) {
    raw.planned_process = raw.planned_process.toUpperCase();
  }

  return raw as ParsedImportRow;
}

export function parseCsvText(csvText: string): {
  rows: ParsedImportRow[];
  rowErrors: CsvRowParseError[];
  headerError?: string;
} {
  const table = tokenizeCsvText(csvText.trim());
  if (table.length === 0) {
    return { rows: [], rowErrors: [], headerError: 'CSV file is empty' };
  }

  const headerCells = table[0];
  const columnMap = headerCells.map((h) => normalizeHeader(h));

  const required = ['coil_no', 'customer_code', 'grade_code'] as const;
  const present = new Set(columnMap.filter(Boolean));
  const missing = required.filter((r) => !present.has(r));
  if (missing.length > 0) {
    return {
      rows: [],
      rowErrors: [],
      headerError: `Missing required columns: ${missing.join(', ')}`,
    };
  }

  const rows: ParsedImportRow[] = [];
  const rowErrors: CsvRowParseError[] = [];

  for (let i = 1; i < table.length; i++) {
    const cells = table[i];
    if (cells.every((c) => c === '')) continue;

    const rowIndex = i + 1;
    const mapped = mapRow(cells, columnMap);
    if (!mapped) continue;
    if ('error' in mapped) {
      rowErrors.push({ rowIndex, error: mapped.error, partial: mapped.partial });
      continue;
    }
    rows.push(mapped);
  }

  return { rows, rowErrors };
}

/** Convert JSON upload rows (camelCase legacy) into canonical import rows. */
export function normalizeJsonRows(rows: unknown[]): ParsedImportRow[] {
  return rows.map((row) => {
    const r = row as Record<string, unknown>;
    return {
      coil_no: String(r.coil_no ?? r.coilNo ?? r.coilNumber ?? '').trim(),
      sap_order_no: (r.sap_order_no ?? r.sapOrderNo) as string | undefined,
      customer_code: String(r.customer_code ?? r.customerCode ?? r.customer ?? '').trim(),
      grade_code: String(r.grade_code ?? r.gradeCode ?? r.grade ?? '').trim(),
      surface_finish: (r.surface_finish ?? r.surfaceFinish) as string | undefined,
      target_width_mm: (r.target_width_mm ?? r.targetWidthMm ?? r.width) as number | undefined,
      target_thk_mm: (r.target_thk_mm ?? r.targetThkMm ?? r.targetThickness) as number | undefined,
      planned_qty_mt: (r.planned_qty_mt ?? r.plannedQtyMt) as number | undefined,
      due_date: (r.due_date ?? r.dueDate) as string | undefined,
      planned_process: (r.planned_process ?? r.plannedProcess ?? r.processCode) as string | undefined,
      seq_no: (r.seq_no ?? r.seqNo) as number | undefined,
      planned_date: (r.planned_date ?? r.plannedDate) as string | undefined,
      nominal_width_mm: (r.nominal_width_mm ?? r.nominalWidthMm) as number | undefined,
      coil_thk_mm: (r.coil_thk_mm ?? r.coilThkMm) as number | undefined,
      weight_mt: (r.weight_mt ?? r.weightMt) as number | undefined,
      weight_kg: (r.weight_kg ?? r.weightKg) as number | undefined,
      heat_no: (r.heat_no ?? r.heatNo) as string | undefined,
    };
  });
}

export function rowsToErrorCsv(errors: Array<{ rowIndex: number; rowData: ParsedImportRow; error: string }>): string {
  const headers = [
    'row_index',
    'error',
    'coil_no',
    'customer_code',
    'grade_code',
    'sap_order_no',
    'planned_process',
  ];
  const lines = [headers.join(',')];
  for (const e of errors) {
    lines.push(
      [
        e.rowIndex,
        `"${e.error.replace(/"/g, '""')}"`,
        e.rowData.coil_no,
        e.rowData.customer_code,
        e.rowData.grade_code,
        e.rowData.sap_order_no ?? '',
        e.rowData.planned_process ?? '',
      ].join(','),
    );
  }
  return lines.join('\n');
}
