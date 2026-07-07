import type { PPCImportRow } from '@m1/shared-validation';
import { tokenizeCsvText } from './csvTokenizer';

const PPC_MACHINES = new Set(['6HI', '4HI', '2HI']);

const HEADER_ALIASES: Record<string, keyof PPCImportRow> = {
  batch_number: 'batch_number',
  batch_no: 'batch_number',
  batchnumber: 'batch_number',
  batch: 'batch_number',
  plan_date: 'plan_date',
  plandate: 'plan_date',
  date: 'plan_date',
  shift_code: 'shift_code',
  shiftcode: 'shift_code',
  shift: 'shift_code',
  machine_code: 'machine_code',
  machinecode: 'machine_code',
  machine: 'machine_code',
  sub_process: 'sub_process',
  subprocess: 'sub_process',
  process: 'sub_process',
  coil_no: 'coil_no',
  coilno: 'coil_no',
  coil_number: 'coil_no',
  mother_coil: 'coil_no',
  slit_id: 'slit_id',
  slitid: 'slit_id',
  slit: 'slit_id',
  customer_name: 'customer_name',
  customername: 'customer_name',
  customer: 'customer_name',
  grade_code: 'grade_code',
  gradecode: 'grade_code',
  grade: 'grade_code',
  width_mm: 'width_mm',
  widthmm: 'width_mm',
  width: 'width_mm',
  input_thk_mm: 'input_thk_mm',
  input_thk: 'input_thk_mm',
  input_thickness: 'input_thk_mm',
  input_thickness_mm: 'input_thk_mm',
  ppc_thk_mm: 'ppc_thk_mm',
  ppc_thk: 'ppc_thk_mm',
  target_thk_mm: 'ppc_thk_mm',
  target_thickness: 'ppc_thk_mm',
  target_thickness_mm: 'ppc_thk_mm',
  thickness: 'ppc_thk_mm',
  thickness_mm: 'ppc_thk_mm',
  ppc_weight_mt: 'ppc_weight_mt',
  ppc_weight: 'ppc_weight_mt',
  weight_mt: 'ppc_weight_mt',
  weight: 'ppc_weight_mt',
  destination: 'destination',
  roll_finish: 'roll_finish',
  rollfinish: 'roll_finish',
  finish: 'roll_finish',
  ppc_reroll_flag: 'ppc_reroll_flag',
  reroll: 'ppc_reroll_flag',
  rr: 'ppc_reroll_flag',
  queue_seq: 'queue_seq',
  seq_no: 'queue_seq',
  sequence: 'queue_seq',
  sap_order_no: 'sap_order_no',
  saporderno: 'sap_order_no',
  process_route: 'process_route',
  processroute: 'process_route',
  route: 'process_route',
  ppc_route: 'process_route',
};

function normalizeHeader(header: string): keyof PPCImportRow | null {
  const key = header.trim().toLowerCase().replace(/\s+/g, '_');
  return HEADER_ALIASES[key] ?? null;
}

function parseBool(val: string | undefined): boolean | undefined {
  if (!val) return undefined;
  const v = val.trim().toLowerCase();
  if (['yes', 'y', 'true', '1', 'rr'].includes(v)) return true;
  if (['no', 'n', 'false', '0'].includes(v)) return false;
  return undefined;
}

function parseNum(val: string | undefined): number | undefined {
  if (!val || val.trim() === '') return undefined;
  const n = parseFloat(val.replace(/,/g, ''));
  return isNaN(n) ? undefined : n;
}

function normalizeSubProcess(raw: string): string {
  const v = raw.trim().toUpperCase().replace(/\s+/g, '_');
  if (v === 'ROLLING' || v === 'ROLL') return 'ROLLING';
  if (v === 'SKIN_PASS' || v === 'SKINPASS' || v === 'SKIN PASS') return 'SKIN_PASS';
  return v;
}

function normalizeDestination(raw?: string): string | undefined {
  if (!raw) return undefined;
  const v = raw.trim().toUpperCase();
  if (v.includes('REWIND') || v === 'R/W' || v === 'RW') return 'REWINDING';
  if (v.includes('ANN')) return 'ANNEALING';
  return v;
}

function normalizeRollFinish(raw?: string): string | undefined {
  if (!raw) return undefined;
  const v = raw.trim().toUpperCase();
  if (v === 'M' || v === 'MATT' || v === 'MATTE') return 'MATT';
  if (v === 'B' || v === 'BRIGHT') return 'BRIGHT';
  if (v.includes('LOW')) return 'LOW_MATT';
  return v;
}

/** Physical data row number: header = row 1, first data row = row 2. */
export function ppcDataRowNumber(dataIndex: number): number {
  return dataIndex + 2;
}

export interface PPCParseResult {
  rows: PPCImportRow[];
  headerError?: string;
  rowErrors: { row: number; message: string }[];
}

export function parsePpcCsv(csvText: string, defaultShiftCode = 'B'): PPCParseResult {
  const table = tokenizeCsvText(csvText.trim());
  if (table.length < 2) {
    return { rows: [], headerError: 'CSV must have a header row and at least one data row', rowErrors: [] };
  }

  const headers = table[0];
  const colMap: (keyof PPCImportRow | null)[] = headers.map(normalizeHeader);

  const required: (keyof PPCImportRow)[] = [
    'batch_number', 'plan_date', 'machine_code', 'sub_process',
    'coil_no', 'customer_name', 'grade_code', 'width_mm', 'ppc_thk_mm', 'ppc_weight_mt',
  ];

  const mappedKeys = new Set(colMap.filter(Boolean));
  const missing = required.filter((k) => !mappedKeys.has(k));
  if (missing.length > 0) {
    return { rows: [], headerError: `Missing required columns: ${missing.join(', ')}`, rowErrors: [] };
  }

  const rows: PPCImportRow[] = [];
  const rowErrors: { row: number; message: string }[] = [];

  for (let i = 1; i < table.length; i++) {
    const cells = table[i];
    if (cells.every((c) => c === '')) continue;

    const rowNum = ppcDataRowNumber(i - 1);
    const raw: Partial<PPCImportRow> = {};
    colMap.forEach((key, idx) => {
      if (!key) return;
      const cell = cells[idx] ?? '';
      if (['width_mm', 'ppc_thk_mm', 'ppc_weight_mt', 'queue_seq'].includes(key)) {
        (raw as Record<string, unknown>)[key] = parseNum(cell);
      } else if (key === 'ppc_reroll_flag') {
        (raw as Record<string, unknown>)[key] = parseBool(cell);
      } else {
        (raw as Record<string, unknown>)[key] = cell.trim();
      }
    });

    if (raw.sub_process) {
      raw.sub_process = normalizeSubProcess(String(raw.sub_process));
    }
    if (raw.destination) {
      raw.destination = normalizeDestination(String(raw.destination));
    }
    if (raw.roll_finish) {
      raw.roll_finish = normalizeRollFinish(String(raw.roll_finish));
    }
    if (raw.machine_code) {
      raw.machine_code = String(raw.machine_code).trim().toUpperCase();
    }
    if (raw.shift_code) {
      raw.shift_code = String(raw.shift_code).trim().toUpperCase();
    } else {
      raw.shift_code = defaultShiftCode.trim().toUpperCase();
    }

    if (!raw.batch_number) {
      rowErrors.push({ row: rowNum, message: 'batch_number is required' });
      continue;
    }
    if (!raw.plan_date || !raw.machine_code || !raw.sub_process) {
      rowErrors.push({ row: rowNum, message: 'date, machine, and process are required' });
      continue;
    }
    if (!['ROLLING', 'SKIN_PASS'].includes(raw.sub_process)) {
      rowErrors.push({ row: rowNum, message: `Invalid process: ${raw.sub_process}` });
      continue;
    }
    if (!PPC_MACHINES.has(raw.machine_code)) {
      rowErrors.push({
        row: rowNum,
        message: `Unsupported machine (got ${raw.machine_code}); expected 6HI, 4HI, or 2HI`,
      });
      continue;
    }

    rows.push(raw as PPCImportRow);
  }

  return { rows, rowErrors };
}
