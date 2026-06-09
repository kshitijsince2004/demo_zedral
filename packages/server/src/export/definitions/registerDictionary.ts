/** Canonical register column definitions (E4 data dictionary). */

export interface RegisterFieldDef {
  key: string;
  registerName: string;
  dataType: 'string' | 'number' | 'date' | 'boolean';
  unit: string | null;
  mandatory: boolean;
  description: string;
}

export const REGISTER_FIELDS: RegisterFieldDef[] = [
  { key: 'process_code', registerName: 'PROCESS_CODE', dataType: 'string', unit: null, mandatory: true, description: 'Process line code' },
  { key: 'area_code', registerName: 'AREA_CODE', dataType: 'string', unit: null, mandatory: true, description: 'DPR line area' },
  { key: 'coil_no', registerName: 'COIL_NO', dataType: 'string', unit: null, mandatory: true, description: 'Traceability spine' },
  { key: 'prod_date', registerName: 'PROD_DATE', dataType: 'date', unit: null, mandatory: true, description: 'Production date' },
  { key: 'shift_code', registerName: 'SHIFT_CODE', dataType: 'string', unit: null, mandatory: true, description: 'Shift A/B/C' },
  { key: 'operator_code', registerName: 'OPERATOR_CODE', dataType: 'string', unit: null, mandatory: false, description: 'Operator emp code' },
  { key: 'output_weight_mt', registerName: 'OUTPUT_WEIGHT_MT', dataType: 'number', unit: 'MT', mandatory: false, description: 'Output weight' },
  { key: 'output_thk_mm', registerName: 'OUTPUT_THK_MM', dataType: 'number', unit: 'mm', mandatory: false, description: 'Output thickness' },
  { key: 'status', registerName: 'STATUS', dataType: 'string', unit: null, mandatory: false, description: 'OK/HOLD/REJECT/FOR_CTL' },
  { key: 'time_from', registerName: 'TIME_FROM', dataType: 'string', unit: null, mandatory: false, description: 'Run start time' },
  { key: 'time_to', registerName: 'TIME_TO', dataType: 'string', unit: null, mandatory: false, description: 'Run end time' },
  { key: 'customer_code', registerName: 'CUSTOMER_CODE', dataType: 'string', unit: null, mandatory: false, description: 'Customer master code' },
  { key: 'grade_code', registerName: 'GRADE_CODE', dataType: 'string', unit: null, mandatory: false, description: 'Steel grade' },
  { key: 'source_table', registerName: 'SOURCE_TABLE', dataType: 'string', unit: null, mandatory: true, description: 'Origin txn table' },
  { key: 'source_entry_id', registerName: 'SOURCE_ENTRY_ID', dataType: 'string', unit: null, mandatory: true, description: 'Origin row PK' },
];

export const DEFAULT_REGISTER_COLUMNS = REGISTER_FIELDS.map((f) => f.key);

export function dictionaryRows(): Record<string, unknown>[] {
  return REGISTER_FIELDS.map((f) => ({
    field_key: f.key,
    register_name: f.registerName,
    data_type: f.dataType,
    unit: f.unit ?? '',
    mandatory: f.mandatory ? 'Y' : 'N',
    description: f.description,
  }));
}

export function resolveColumns(requested?: string[]): string[] {
  if (!requested?.length) return DEFAULT_REGISTER_COLUMNS;
  const allowed = new Set(DEFAULT_REGISTER_COLUMNS);
  const cols = requested.filter((c) => allowed.has(c));
  return cols.length > 0 ? cols : DEFAULT_REGISTER_COLUMNS;
}

export function projectRow(
  row: Record<string, unknown>,
  columns: string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const col of columns) {
    out[col] = row[col] ?? null;
  }
  return out;
}
