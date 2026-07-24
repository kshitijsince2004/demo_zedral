import { formatPlantDate, formatPlantDateTime } from './dateFormat';

const SKIP_KEYS = new Set([
  'order_id',
  'coil_no',
  'shift_log_id',
  'batch_id',
  'created_at',
  'updated_at',
  'created_by',
  'updated_by',
]);

const DATE_KEYS = new Set([
  'plan_date',
  'prod_date',
  'production_day',
  'outgoing_prod_date',
  'incoming_prod_date',
]);

const DATETIME_KEYS = new Set([
  'created_at',
  'updated_at',
  'prod_start_at',
  'prod_end_at',
  'start_at',
  'end_at',
  'rejected_at',
  'occurred_at',
]);

const FIELD_LABELS: Record<string, string> = {
  sub_process: 'Sub-process',
  status: 'Status',
  ppc_weight_mt: 'Planned (MT)',
  actualWeightMt: 'Actual (MT)',
  rolling_actual_weight_mt: 'Rolling actual (MT)',
  skinpass_actual_weight_mt: 'Skin Pass actual (MT)',
  rerolling: 'Rerolling',
  grade_code: 'Grade',
  customer_name: 'Customer',
  mill_type: 'Mill',
  input_thk_mm: 'Input thickness (mm)',
  output_thk_mm: 'Output thickness (mm)',
  weight_mt: 'Weight (MT)',
  prod_date: 'Production date',
  shift_code: 'Shift',
  charge_no: 'Charge',
  slit_count: 'Slit count',
  remarks: 'Remarks',
  for_ctl: 'For CTL',
};

const PROCESS_FIELDS: Record<string, string[]> = {
  CRM6: ['sub_process', 'status', 'ppc_weight_mt', 'actualWeightMt', 'rerolling'],
  CRM: ['mill_type', 'input_thk_mm', 'output_thk_mm', 'weight_mt', 'grade_code'],
  HRS: ['grade_code', 'weight_mt', 'slit_count', 'prod_date', 'shift_code'],
  PKL: ['grade_code', 'weight_mt', 'input_thk_mm', 'output_thk_mm', 'prod_date'],
  ANN: ['charge_no', 'grade_code', 'weight_mt', 'prod_date'],
  SKP: ['input_thk_mm', 'output_thk_mm', 'weight_mt', 'grade_code'],
  RWD: ['weight_mt', 'grade_code', 'prod_date', 'shift_code'],
  CRS: ['grade_code', 'weight_mt', 'for_ctl', 'prod_date'],
  CTL: ['weight_mt', 'piece_count', 'bundle_count', 'remarks'],
};

function humanizeKey(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatValue(key: string, value: unknown): string | null {
  if (value == null || value === '') return null;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (DATE_KEYS.has(key) && (value instanceof Date || typeof value === 'string')) {
    return formatPlantDate(value);
  }
  if (DATETIME_KEYS.has(key) && (value instanceof Date || typeof value === 'string')) {
    return formatPlantDateTime(value);
  }
  if (typeof value === 'number' || typeof value === 'string') return String(value);
  if (Array.isArray(value)) return value.length > 0 ? `${value.length} item(s)` : null;
  return null;
}

export type TraceabilityDetailPair = { label: string; value: string };

export function formatTraceabilityRecordDetails(
  process: string,
  record: Record<string, unknown>,
  extras?: { stoppages?: unknown[]; siblings?: string[] },
): TraceabilityDetailPair[] {
  const pairs: TraceabilityDetailPair[] = [];
  const priorityKeys = PROCESS_FIELDS[process] ?? [];

  for (const key of priorityKeys) {
    const value = formatValue(key, record[key]);
    if (!value) continue;
    pairs.push({ label: FIELD_LABELS[key] ?? humanizeKey(key), value });
  }

  if (pairs.length < 4) {
    for (const [key, raw] of Object.entries(record)) {
      if (pairs.length >= 5) break;
      if (SKIP_KEYS.has(key) || priorityKeys.includes(key)) continue;
      const value = formatValue(key, raw);
      if (!value) continue;
      pairs.push({ label: FIELD_LABELS[key] ?? humanizeKey(key), value });
    }
  }

  if (extras?.stoppages && extras.stoppages.length > 0) {
    pairs.push({ label: 'Stoppages', value: String(extras.stoppages.length) });
  }
  if (extras?.siblings && extras.siblings.length > 0) {
    pairs.push({ label: 'Charge siblings', value: extras.siblings.join(', ') });
  }

  return pairs.slice(0, 6);
}
