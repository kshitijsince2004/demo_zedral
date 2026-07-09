import { db } from '../../db';
import type { AuthUser } from '../../services/authService';
import { getScopedLineCodes } from '../../auth/lineAccessPolicy';
import type { ProcessRunRow } from './types';
import { ExportReadRepository } from './ExportReadRepository';
import { addPlantDays, currentPlantDate } from '@m1/shared-validation';

export const RAW_BATCH_SIZE = 500;

export interface RawRegisterScope {
  dateFrom?: string;
  dateTo?: string;
  processCodes?: string[];
  areaCodes?: string[];
  coilNos?: string[];
  shiftCodes?: string[];
  customerCodes?: string[];
  statuses?: string[];
  columns?: string[];
  /** Legacy single-value aliases */
  processId?: string;
  shiftCode?: string;
  coilNo?: string;
}

function parseArray(value: unknown): string[] | undefined {
  if (value == null) return undefined;
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  const s = String(value);
  if (!s) return undefined;
  return s.split(',').map((x) => x.trim()).filter(Boolean);
}

export function parseRawScope(scope: Record<string, unknown>): RawRegisterScope {
  const dateFrom = scope.dateFrom ?? scope.date_from;
  const dateTo = scope.dateTo ?? scope.date_to;

  let processCodes = parseArray(scope.processCodes ?? scope.process_codes ?? scope.process_code);
  if (!processCodes && scope.processId) {
    const pid = String(scope.processId).toUpperCase();
    processCodes = pid !== 'ALL' ? [pid] : undefined;
  }

  let coilNos = parseArray(scope.coilNos ?? scope.coil_nos ?? scope.coil_no);
  if (!coilNos && scope.coilNo) coilNos = [String(scope.coilNo)];

  let shiftCodes = parseArray(scope.shiftCodes ?? scope.shift_codes ?? scope.shift_code);
  if (!shiftCodes && scope.shiftCode) shiftCodes = [String(scope.shiftCode)];

  return {
    dateFrom: dateFrom ? String(dateFrom) : undefined,
    dateTo: dateTo ? String(dateTo) : undefined,
    processCodes,
    areaCodes: parseArray(scope.areaCodes ?? scope.area_codes ?? scope.area_code),
    coilNos,
    shiftCodes,
    customerCodes: parseArray(scope.customerCodes ?? scope.customer_codes ?? scope.customer_code),
    statuses: parseArray(scope.statuses ?? scope.status)?.map((s) => s.toUpperCase()),
    columns: parseArray(scope.columns),
    processId: scope.processId ? String(scope.processId) : undefined,
    shiftCode: scope.shiftCode ? String(scope.shiftCode) : undefined,
    coilNo: scope.coilNo ? String(scope.coilNo) : undefined,
  };
}

function defaultDateRange(): { dateFrom: string; dateTo: string } {
  return {
    dateFrom: addPlantDays(currentPlantDate(), -30),
    dateTo: currentPlantDate(),
  };
}

function resolveReadScope(parsed: RawRegisterScope) {
  const defaults = defaultDateRange();
  return {
    dateFrom: parsed.dateFrom ?? defaults.dateFrom,
    dateTo: parsed.dateTo ?? defaults.dateTo,
    processCode: parsed.processCodes?.length === 1 ? parsed.processCodes[0] : undefined,
    shiftCode: parsed.shiftCodes?.length === 1 ? parsed.shiftCodes[0] : undefined,
    coilNo: parsed.coilNos?.length === 1 ? parsed.coilNos[0] : undefined,
  };
}

function passesFilters(
  row: ProcessRunRow,
  parsed: RawRegisterScope,
  customerByCoil: Map<string, string | null>,
  gradeByCoil: Map<string, string | null>,
): boolean {
  if (parsed.processCodes?.length && !parsed.processCodes.includes(row.processCode)) return false;
  if (parsed.areaCodes?.length && !parsed.areaCodes.includes(row.areaCode)) return false;
  if (parsed.coilNos?.length && !parsed.coilNos.includes(row.coilNo)) return false;
  if (parsed.shiftCodes?.length && !parsed.shiftCodes.includes(row.shiftCode)) return false;
  if (parsed.statuses?.length && !parsed.statuses.includes(row.status)) return false;
  if (parsed.customerCodes?.length) {
    const cc = customerByCoil.get(row.coilNo);
    if (!cc || !parsed.customerCodes.includes(cc)) return false;
  }
  return true;
}

async function loadCoilMasters(coilNos: string[]) {
  const customerByCoil = new Map<string, string | null>();
  const gradeByCoil = new Map<string, string | null>();
  if (coilNos.length === 0) return { customerByCoil, gradeByCoil };

  const coils = await db
    .selectFrom('coil.coil as c')
    .leftJoin('master.customer as cu', 'c.customer_id', 'cu.customer_id')
    .select(['c.coil_no', 'cu.customer_code', 'c.grade_code'])
    .where('c.coil_no', 'in', coilNos)
    .execute();

  for (const c of coils) {
    customerByCoil.set(c.coil_no, c.customer_code);
    gradeByCoil.set(c.coil_no, c.grade_code);
  }
  return { customerByCoil, gradeByCoil };
}

function runToRegisterRow(
  row: ProcessRunRow,
  customerByCoil: Map<string, string | null>,
  gradeByCoil: Map<string, string | null>,
): Record<string, unknown> {
  const flat: Record<string, unknown> = {
    process_code: row.processCode,
    area_code: row.areaCode,
    coil_no: row.coilNo,
    prod_date: row.prodDate,
    shift_code: row.shiftCode,
    operator_code: row.operatorCode,
    output_weight_mt: row.outputWeightMt,
    output_thk_mm: row.outputThkMm,
    status: row.status,
    time_from: row.timeFrom,
    time_to: row.timeTo,
    customer_code: customerByCoil.get(row.coilNo) ?? null,
    grade_code: gradeByCoil.get(row.coilNo) ?? null,
    source_table: row.sourceTable,
    source_entry_id: row.sourceEntryId,
  };

  if (row.attrs) {
    for (const [k, v] of Object.entries(row.attrs)) {
      flat[`attr_${k}`] = v;
    }
  }
  return flat;
}

export function resolveEffectiveProcessCodes(
  user: AuthUser,
  processCodes?: string[],
): string[] {
  const scoped = getScopedLineCodes(user, 'READ');
  const ALL = ['HRS', 'PKL', '6HI', 'CRM', 'ANN', 'SKP', 'RWD', 'CRS', 'CTL', 'GLV'];
  let lines = processCodes?.length ? processCodes.map((c) => c.toUpperCase()) : ALL;
  if (scoped !== null) {
    lines = lines.filter((l) => scoped.includes(l));
  }
  return lines;
}

export async function fetchRawRegisterRows(
  scope: Record<string, unknown>,
  user: AuthUser,
): Promise<{ rows: Record<string, unknown>[]; parsed: RawRegisterScope; lines: string[] }> {
  const parsed = parseRawScope(scope);
  const lines = resolveEffectiveProcessCodes(user, parsed.processCodes);
  if (lines.length === 0) throw new Error('No process lines in scope for export');

  const readScope = resolveReadScope(parsed);
  const runs = await ExportReadRepository.fetchRuns(readScope);

  const coilNos = [...new Set(runs.map((r) => r.coilNo))];
  const { customerByCoil, gradeByCoil } = await loadCoilMasters(coilNos);

  const filtered = runs
    .filter((r) => lines.includes(r.processCode))
    .filter((r) => passesFilters(r, parsed, customerByCoil, gradeByCoil));

  const rows = filtered.map((r) => runToRegisterRow(r, customerByCoil, gradeByCoil));
  return { rows, parsed, lines };
}

/** Batched iteration for streaming CSV (cursor-style pagination in memory). */
export async function* iterateRawRegisterBatches(
  scope: Record<string, unknown>,
  user: AuthUser,
  batchSize = RAW_BATCH_SIZE,
): AsyncGenerator<Record<string, unknown>[]> {
  const { rows } = await fetchRawRegisterRows(scope, user);
  for (let i = 0; i < rows.length; i += batchSize) {
    yield rows.slice(i, i + batchSize);
  }
}

export async function countRawRegisterRows(
  scope: Record<string, unknown>,
  user: AuthUser,
): Promise<number> {
  const { rows } = await fetchRawRegisterRows(scope, user);
  return rows.length;
}
