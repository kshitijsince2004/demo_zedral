import * as XLSX from 'xlsx';
import { translatePpcRoute } from './PpcRouteTranslator';
import { currentPlantDate, formatDateOnly } from './dateOnly';

export type PpcXlsxSheetType = 'ROLLING' | 'SKIN_PASS' | 'REWINDING' | 'ANNEALING';
export type PpcMillCode = '6HI' | '4HI' | '2HI';

export interface RollingPassPlanInput {
  passNo: number;
  targetThkMm?: number;
  rollFinish?: string;
  isRequired: boolean;
}

export interface ParsedRollingPlanRow {
  rowNum: number;
  batchNumber: string;
  planDate: string;
  shiftCode: string;
  machineCode: PpcMillCode;
  subProcess: 'ROLLING' | 'SKIN_PASS';
  coilNo: string;
  slitId?: string;
  customerName: string;
  gradeCode: string;
  widthMm: number;
  finishThkMm: number;
  inputThkMm: number;
  passTargetThkMm?: number;
  rollingPassNo: number;
  ppcWeightMt: number;
  ppcRerollFlag: boolean;
  coilCount: number;
  destination?: 'REWINDING' | 'ANNEALING';
  rollFinish?: string;
  processRouteRaw: string;
  processRouteCanonical: string;
  fromWorkCenter?: string;
  toWorkCenter?: string;
  itemNo?: string;
  sapOrderNo?: string;
  ppcRemarks?: string;
  importRemark?: string;
  minThkTolMm?: number;
  maxThkTolMm?: number;
  rollingPassPlans: RollingPassPlanInput[];
  errors: string[];
}

export interface ParsePpcXlsxOptions {
  sheetType?: PpcXlsxSheetType;
  shiftCode?: string;
}

const SHEET_NAME_PATTERNS: Record<PpcXlsxSheetType, RegExp[]> = {
  ROLLING: [/rolling/i, /^sheet\s*1$/i],
  SKIN_PASS: [/skin\s*pass/i, /skinpass/i],
  REWINDING: [/rewind/i, /r\/w/i],
  ANNEALING: [/anneal/i, /\bann\b/i],
};

const HEADER_MAP: Record<string, string> = {
  'pv-desc': 'pvDesc',
  'pv desc': 'pvDesc',
  'batch number': 'batchNumber',
  'plan date': 'planDate',
  'mother coil': 'coilNo',
  'mother coil no': 'coilNo',
  'slit id': 'slitId',
  'customer name': 'customerName',
  grade: 'gradeCode',
  'grade code': 'gradeCode',
  'coil weight': 'ppcWeightMt',
  count: 'coilCount',
  width: 'widthMm',
  'finish thickness': 'finishThkMm',
  'finish thick': 'finishThkMm',
  'pre stage thickness': 'inputThkMm',
  'pre-stage thickness': 'inputThkMm',
  '1st rolling thicknes': 'pass1Thk',
  '1st rolling thickness': 'pass1Thk',
  '1st rolling surf': 'pass1Surf',
  '1st rolling surface': 'pass1Surf',
  '2nd rolling thicknes': 'pass2Thk',
  '2nd rolling thickness': 'pass2Thk',
  '2nd rolling surf': 'pass2Surf',
  '2nd rolling surface': 'pass2Surf',
  '3rd rolling thicknes': 'pass3Thk',
  '3rd rolling thickness': 'pass3Thk',
  '3rd rolling surf': 'pass3Surf',
  '3rd rolling surface': 'pass3Surf',
  '4th rolling thicknes': 'pass4Thk',
  '4th rolling thickness': 'pass4Thk',
  '4th rolling surf': 'pass4Surf',
  '4th rolling surface': 'pass4Surf',
  'ppc remarks': 'ppcRemarks',
  'process route': 'processRouteRaw',
  'from work center': 'fromWorkCenter',
  'to work center': 'toWorkCenter',
  'sale order': 'sapOrderNo',
  'sales order': 'sapOrderNo',
  'item no': 'itemNo',
  remark: 'importRemark',
  'min thick tol(mm)': 'minThkTolMm',
  'max thick tol(mm)': 'maxThkTolMm',
  'sp thickness': 'spThkMm',
  'sp surface finish': 'spSurfaceFinish',
  'sp ramax': 'spRaMax',
  'sp ramin': 'spRaMin',
  'thick tolerance pos.': 'maxThkTolMm',
  'thick tolerance neg.': 'minThkTolMm',
};

function normalizeHeader(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function machineFromPvDesc(raw: string): PpcMillCode | null {
  const v = raw.trim().toUpperCase();
  if (!v) return null;
  if (v.startsWith('6HI') || v.includes('6HI')) return '6HI';
  if (v.startsWith('4HI') || v.includes('4HI')) return '4HI';
  if (v.startsWith('2HI') || v.includes('2HI')) return '2HI';
  return null;
}

/** Skin-pass plans may use route work-center codes (X/Y/Z); also accepts PV-Desc-style values. */
export function machineFromWorkCenter(raw: string): PpcMillCode | null {
  const v = raw.trim().toUpperCase();
  if (v === 'X') return '2HI';
  if (v === 'Y') return '4HI';
  if (v === 'Z') return '6HI';
  return machineFromPvDesc(v);
}

const DEFAULT_MACHINE_CODE: PpcMillCode = '6HI';

/** PV-Desc and From Work Center are optional; default machine when neither resolves. */
export function resolveMachineCode(pvDesc?: string, fromWorkCenter?: string): PpcMillCode {
  return machineFromPvDesc(pvDesc ?? '')
    ?? machineFromWorkCenter(fromWorkCenter ?? '')
    ?? DEFAULT_MACHINE_CODE;
}

export function subProcessForSheetType(sheetType: PpcXlsxSheetType): 'ROLLING' | 'SKIN_PASS' {
  return sheetType === 'SKIN_PASS' ? 'SKIN_PASS' : 'ROLLING';
}

export function resolveWorkbookSheetName(sheetNames: string[], sheetType: PpcXlsxSheetType): string {
  for (const pattern of SHEET_NAME_PATTERNS[sheetType]) {
    const hit = sheetNames.find((n) => pattern.test(n.trim()));
    if (hit) return hit;
  }
  return sheetNames[0] ?? '';
}

function findHeaderRowIndex(matrix: unknown[][]): number {
  for (let r = 0; r < Math.min(10, matrix.length); r++) {
    const headers = (matrix[r] as unknown[]).map(normalizeHeader);
    if (headers.includes('batch number')) return r;
  }
  return 0;
}

function excelDateToIso(val: unknown): string | null {
  if (val == null || val === '') return null;
  if (typeof val === 'number') {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    epoch.setUTCDate(epoch.getUTCDate() + val);
    return epoch.toISOString().slice(0, 10);
  }
  const s = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (!isNaN(d.getTime())) return formatDateOnly(d);
  return null;
}

function num(val: unknown): number | undefined {
  if (val == null || val === '') return undefined;
  const n = parseFloat(String(val).replace(/,/g, ''));
  return isNaN(n) ? undefined : n;
}

function normalizeFinish(raw?: string): string | undefined {
  if (!raw) return undefined;
  const v = raw.trim().toUpperCase();
  if ((v === 'M' || v.includes('MATT')) && !v.includes('LO')) return 'MATT';
  if (v.includes('LO')) return 'LOW_MATT';
  if (v === 'B' || v.includes('BRIGHT')) return 'BRIGHT';
  return undefined;
}

function normalizeDest(toWc?: string, sheetType?: PpcXlsxSheetType): 'REWINDING' | 'ANNEALING' | undefined {
  if (sheetType === 'REWINDING') return 'REWINDING';
  if (sheetType === 'ANNEALING') return 'ANNEALING';
  if (!toWc) return undefined;
  const v = toWc.trim().toUpperCase();
  if (v === 'R' || v.includes('REW')) return 'REWINDING';
  if (v === 'F' || v.includes('ANN')) return 'ANNEALING';
  return undefined;
}

function deriveActivePass(row: Record<string, unknown>): number {
  const filled: number[] = [];
  for (let p = 1; p <= 4; p++) {
    const thk = num(row[`pass${p}Thk`]);
    const surf = normalizeFinish(String(row[`pass${p}Surf`] ?? ''));
    if (thk != null || surf) filled.push(p);
  }
  if (filled.length === 0) return 1;
  if (filled.length === 1 && filled[0] === 2) return 2;
  if (!filled.includes(1) && filled.includes(2)) return 2;
  return filled[0];
}

function buildPassPlans(row: Record<string, unknown>): RollingPassPlanInput[] {
  const plans: RollingPassPlanInput[] = [];
  for (let p = 1; p <= 4; p++) {
    const thk = num(row[`pass${p}Thk`]);
    const surf = normalizeFinish(String(row[`pass${p}Surf`] ?? ''));
    if (thk != null || surf) {
      plans.push({ passNo: p, targetThkMm: thk, rollFinish: surf, isRequired: thk != null || !!surf });
    }
  }
  return plans;
}

export function parseRollingPlanXlsx(
  buffer: Buffer,
  optionsOrLegacyMachine: ParsePpcXlsxOptions | PpcMillCode = {},
  legacyShift?: string,
): {
  rows: ParsedRollingPlanRow[];
  headerError?: string;
  sheetName?: string;
  sheetType?: PpcXlsxSheetType;
} {
  const options: ParsePpcXlsxOptions =
    typeof optionsOrLegacyMachine === 'string'
      ? { shiftCode: legacyShift ?? 'B' }
      : optionsOrLegacyMachine;

  const sheetType = options.sheetType ?? 'ROLLING';
  const shiftCode = (options.shiftCode ?? 'B').toUpperCase();
  const subProcess = subProcessForSheetType(sheetType);

  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  const sheetName = resolveWorkbookSheetName(wb.SheetNames, sheetType);
  const sheet = sheetName ? wb.Sheets[sheetName] : undefined;
  if (!sheet) return { rows: [], headerError: 'Workbook has no sheets', sheetType };

  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' }) as unknown[][];
  if (matrix.length < 2) {
    return { rows: [], headerError: 'Sheet must have header and data rows', sheetName, sheetType };
  }

  const headerRowIndex = findHeaderRowIndex(matrix);
  const headers = (matrix[headerRowIndex] as unknown[]).map(normalizeHeader);
  const colKeys: (string | null)[] = headers.map((h) => HEADER_MAP[h] ?? null);

  const required = ['batchNumber', 'coilNo', 'customerName', 'gradeCode', 'finishThkMm', 'processRouteRaw'];
  const mapped = new Set(colKeys.filter(Boolean));
  const missing = required.filter((k) => !mapped.has(k));
  if (missing.length) {
    return { rows: [], headerError: `Missing columns: ${missing.join(', ')}`, sheetName, sheetType };
  }

  const pvDescCol = colKeys.indexOf('pvDesc');
  const rows: ParsedRollingPlanRow[] = [];

  for (let i = headerRowIndex + 1; i < matrix.length; i++) {
    const line = matrix[i] as unknown[];
    if (line.every((c) => c == null || String(c).trim() === '')) continue;

    const raw: Record<string, unknown> = {};
    colKeys.forEach((key, idx) => {
      if (key) raw[key] = line[idx];
    });

    const errors: string[] = [];
    const batchNumber = String(raw.batchNumber ?? '').trim();
    if (!batchNumber) continue;

    const pvDesc = pvDescCol >= 0 ? String(line[pvDescCol] ?? '').trim() : '';
    const fromWorkCenter = String(raw.fromWorkCenter ?? '').trim();
    const machineCode = resolveMachineCode(pvDesc, fromWorkCenter);

    const coilCount = Math.max(1, Math.round(num(raw.coilCount) ?? 1));
    const ppcRerollFlag = coilCount > 1;
    const finishThkMm = num(raw.finishThkMm);
    const spThkMm = num(raw.spThkMm);
    const spSurfaceFinish = normalizeFinish(String(raw.spSurfaceFinish ?? ''));

    let rollingPassPlans = buildPassPlans(raw);
    let rollingPassNo = deriveActivePass(raw);
    if (subProcess === 'SKIN_PASS') {
      rollingPassPlans = spThkMm != null || spSurfaceFinish
        ? [{ passNo: 1, targetThkMm: spThkMm, rollFinish: spSurfaceFinish, isRequired: true }]
        : [];
      rollingPassNo = 1;
    }
    const activePlan = rollingPassPlans.find((p) => p.passNo === rollingPassNo);
    const inputThkMm = num(raw.inputThkMm);
    if (subProcess === 'SKIN_PASS' && inputThkMm == null) errors.push('pre-stage thickness required');
    const resolvedInputThkMm = inputThkMm
      ?? (subProcess === 'SKIN_PASS' ? undefined : (finishThkMm != null ? finishThkMm + 0.9 : undefined));

    const coilNo = String(raw.coilNo ?? '').trim();
    const customerName = String(raw.customerName ?? '').trim();
    const gradeCode = String(raw.gradeCode ?? '').trim();
    const planDateIso = excelDateToIso(raw.planDate);

    if (!coilNo) errors.push('mother coil required');
    if (!customerName) errors.push('customer name required');
    if (!gradeCode) errors.push('grade required');
    if (finishThkMm == null) errors.push('finish thickness required');
    if (subProcess === 'SKIN_PASS' && spThkMm == null) errors.push('SP thickness required');
    if (!raw.processRouteRaw) errors.push('process route required');
    if (!planDateIso) errors.push('plan date required or invalid');

    const routeRaw = String(raw.processRouteRaw ?? '').trim().toUpperCase();
    const translated = routeRaw ? translatePpcRoute(routeRaw) : { raw: '', canonical: '', codes: [], rollingPassCount: 1 };
    if (routeRaw && !translated.canonical) errors.push(`invalid process route: ${routeRaw}`);

    rows.push({
      rowNum: i + 1,
      batchNumber,
      planDate: planDateIso ?? currentPlantDate(),
      shiftCode,
      machineCode,
      subProcess,
      coilNo,
      slitId: raw.slitId ? String(raw.slitId).trim() : undefined,
      customerName,
      gradeCode,
      widthMm: num(raw.widthMm) ?? 0,
      finishThkMm: finishThkMm ?? 0,
      inputThkMm: resolvedInputThkMm ?? 0,
      passTargetThkMm: subProcess === 'SKIN_PASS' ? (spThkMm ?? activePlan?.targetThkMm) : activePlan?.targetThkMm,
      rollingPassNo,
      ppcWeightMt: num(raw.ppcWeightMt) ?? 0,
      ppcRerollFlag,
      coilCount,
      destination: normalizeDest(String(raw.toWorkCenter ?? ''), sheetType),
      rollFinish: subProcess === 'SKIN_PASS'
        ? (spSurfaceFinish ?? activePlan?.rollFinish)
        : (activePlan?.rollFinish ?? normalizeFinish(String(raw.pass1Surf ?? ''))),
      processRouteRaw: routeRaw,
      processRouteCanonical: translated.canonical,
      fromWorkCenter: raw.fromWorkCenter ? String(raw.fromWorkCenter).trim() : undefined,
      toWorkCenter: raw.toWorkCenter ? String(raw.toWorkCenter).trim() : undefined,
      itemNo: raw.itemNo ? String(raw.itemNo).trim() : undefined,
      sapOrderNo: raw.sapOrderNo ? String(raw.sapOrderNo).trim() : undefined,
      ppcRemarks: raw.ppcRemarks ? String(raw.ppcRemarks).trim() : undefined,
      importRemark: raw.importRemark ? String(raw.importRemark).trim() : undefined,
      minThkTolMm: num(raw.minThkTolMm),
      maxThkTolMm: num(raw.maxThkTolMm),
      rollingPassPlans,
      errors,
    });
  }

  return { rows, sheetName, sheetType };
}
