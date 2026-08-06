import * as XLSX from 'xlsx';
import { translatePpcRoute } from './PpcRouteTranslator';
import { currentPlantDate, formatDateOnly } from './dateOnly';
import type { ParsedRollingPlanRow, PpcXlsxSheetType } from './rollingPlanXlsxParser';

/** First-class ParsedRollingPlanRow keys — everything else → rawExtras. */
const FIRST_CLASS = new Set([
  'batchNumber', 'planDate', 'shiftCode', 'coilNo', 'slitId', 'customerName', 'gradeCode',
  'widthMm', 'finishThkMm', 'inputThkMm', 'ppcWeightMt', 'coilCount', 'processRouteRaw',
  'fromWorkCenter', 'toWorkCenter', 'rollFinish', 'sapOrderNo', 'itemNo', 'importRemark',
  'ppcRemarks', 'minThkTolMm', 'maxThkTolMm',
]);

export type LinePlanParserConfig = {
  sheetType: PpcXlsxSheetType;
  machineCode: 'HRS' | 'PKL' | 'ANN';
  subProcess: 'HRS' | 'PKL' | 'ANN';
  lineLabel: string;
  headerMap: Record<string, string>;
  required: string[];
  /** Normalized header names that identify this line's file. */
  signatures: string[];
  /** HRS needs every signature; PKL/ANN need any. */
  signatureMode: 'all' | 'any';
  /** No gauge change — finish/ppc thk := input thk. */
  noFinishThk: boolean;
  defaultFromWc: string;
  /** Optional PKL fallback: PV-Desc cell contains this token. */
  pvDescSignatureToken?: string;
  /** ANN quirk: when width is missing/zero on a data row, carry forward last positive width. */
  carryForwardWidthMm?: boolean;
};

export function normalizeHeader(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function findHeaderRowIndex(matrix: unknown[][]): number {
  for (let r = 0; r < Math.min(10, matrix.length); r++) {
    const headers = (matrix[r] as unknown[]).map(normalizeHeader);
    if (headers.includes('batch number') || headers.includes('mother coil')) return r;
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
  if (v === 'MIRROR' || v === 'B' || v.includes('BRIGHT')) return 'BRIGHT';
  if (v.includes('LO')) return 'LOW_MATT';
  if (v === 'M' || v.includes('MATT')) return 'MATT';
  return v || undefined;
}

function rowHasAnyData(line: unknown[]): boolean {
  return line.some((c) => c != null && String(c).trim() !== '');
}

function isSpacerLikeRow(raw: Record<string, unknown>): boolean {
  const requiredAnchors = [
    raw.batchNumber,
    raw.coilNo,
    raw.customerName,
    raw.gradeCode,
    raw.processRouteRaw,
  ];
  return requiredAnchors.every((v) => String(v ?? '').trim() === '');
}

function signatureOk(
  headers: string[],
  matrix: unknown[][],
  headerRowIndex: number,
  colKeys: (string | null)[],
  config: LinePlanParserConfig,
): boolean {
  const set = new Set(headers);
  const hits = config.signatures.filter((s) => set.has(s));
  if (config.signatureMode === 'all') return hits.length === config.signatures.length;
  if (hits.length > 0) return true;

  const token = config.pvDescSignatureToken;
  if (!token) return false;
  const pvIdx = colKeys.indexOf('pvDesc');
  if (pvIdx < 0) return false;
  const upper = token.toUpperCase();
  for (let i = headerRowIndex + 1; i < matrix.length; i++) {
    const cell = String((matrix[i] as unknown[])[pvIdx] ?? '').toUpperCase();
    if (cell.includes(upper)) return true;
  }
  return false;
}

/**
 * Scope-driven line plan parser: first sheet only, signature reject, extras → rawExtras.
 */
export function parseLinePlanXlsx(
  buffer: Buffer,
  options: { shiftCode?: string },
  config: LinePlanParserConfig,
): { rows: ParsedRollingPlanRow[]; headerError?: string; sheetName?: string; sheetType: PpcXlsxSheetType } {
  const fallbackShift = (options.shiftCode ?? 'B').toUpperCase();
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  const sheetName = wb.SheetNames[0];
  const sheet = sheetName ? wb.Sheets[sheetName] : undefined;
  if (!sheet) {
    return { rows: [], headerError: 'Workbook has no sheets', sheetType: config.sheetType };
  }

  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' }) as unknown[][];
  if (matrix.length < 2) {
    return {
      rows: [],
      headerError: 'Sheet must have header and data rows',
      sheetName,
      sheetType: config.sheetType,
    };
  }

  const headerRowIndex = findHeaderRowIndex(matrix);
  const headers = (matrix[headerRowIndex] as unknown[]).map(normalizeHeader);
  const colKeys: (string | null)[] = headers.map((h) => config.headerMap[h] ?? null);

  if (!signatureOk(headers, matrix, headerRowIndex, colKeys, config)) {
    const missing = config.signatures.join(' / ');
    return {
      rows: [],
      headerError: `This doesn't look like a ${config.lineLabel} plan (missing ${missing})`,
      sheetName,
      sheetType: config.sheetType,
    };
  }

  const mapped = new Set(colKeys.filter(Boolean));
  const missing = config.required.filter((k) => !mapped.has(k));
  if (missing.length) {
    return {
      rows: [],
      headerError: `Missing columns: ${missing.join(', ')}`,
      sheetName,
      sheetType: config.sheetType,
    };
  }

  const rows: ParsedRollingPlanRow[] = [];
  let lastPositiveWidthMm: number | undefined;
  for (let i = headerRowIndex + 1; i < matrix.length; i++) {
    const line = matrix[i] as unknown[];
    if (!rowHasAnyData(line)) continue;

    const raw: Record<string, unknown> = {};
    const rawExtras: Record<string, unknown> = {};
    headers.forEach((header, idx) => {
      const key = colKeys[idx];
      const val = line[idx];
      if (key) {
        if (FIRST_CLASS.has(key)) raw[key] = val;
        else if (val != null && String(val).trim() !== '') rawExtras[key] = val;
      } else if (header && val != null && String(val).trim() !== '') {
        rawExtras[header] = val;
      }
    });

    // Planner sheets often include visual spacers with only recipe fragments.
    if (isSpacerLikeRow(raw)) continue;

    const errors: string[] = [];
    const coilNo = String(raw.coilNo ?? '').trim();
    const customerName = String(raw.customerName ?? '').trim();
    const gradeCode = String(raw.gradeCode ?? '').trim();
    const inputThkMm = num(raw.inputThkMm);
    const parsedWidthMm = num(raw.widthMm);
    const widthMm = (() => {
      if (parsedWidthMm != null && parsedWidthMm > 0) return parsedWidthMm;
      if (config.carryForwardWidthMm && lastPositiveWidthMm != null) return lastPositiveWidthMm;
      return parsedWidthMm;
    })();
    const finishFromSheet = config.noFinishThk ? undefined : num(raw.finishThkMm);
    const finishThkMm = config.noFinishThk ? inputThkMm : finishFromSheet;
    const planDateIso = excelDateToIso(raw.planDate);
    const sheetShift = raw.shiftCode ? String(raw.shiftCode).trim().toUpperCase() : '';
    const shiftCode = sheetShift || fallbackShift;
    const batchNumber = String(raw.batchNumber ?? '').trim();
    const coilCount = Math.max(1, Math.round(num(raw.coilCount) ?? 1));

    if (!batchNumber) errors.push('Empty batch number');
    if (!coilNo) errors.push('mother coil required');
    if (!customerName) errors.push('customer name required');
    if (!gradeCode) errors.push('grade required');
    if (inputThkMm == null) errors.push('pre-stage thickness required');
    if (!config.noFinishThk && finishFromSheet == null) errors.push('finish thickness required');
    if (widthMm == null || widthMm <= 0) errors.push('Width required / must be > 0');
    if (!raw.processRouteRaw) errors.push('process route required');
    if (!planDateIso) errors.push('plan date required or invalid');

    const routeRaw = String(raw.processRouteRaw ?? '').trim().toUpperCase();
    const translated = routeRaw
      ? translatePpcRoute(routeRaw)
      : { raw: '', canonical: '', codes: [], rollingPassCount: 1 };
    if (routeRaw && !translated.canonical) errors.push(`invalid process route: ${routeRaw}`);

    const fromWc = String(raw.fromWorkCenter ?? config.defaultFromWc).trim() || config.defaultFromWc;
    const toWc = raw.toWorkCenter ? String(raw.toWorkCenter).trim() : undefined;
    const surfaceRaw = raw.rollFinish != null ? String(raw.rollFinish).trim() : '';
    if (widthMm != null && widthMm > 0) {
      lastPositiveWidthMm = widthMm;
    }

    rows.push({
      rowNum: i + 1,
      batchNumber: batchNumber || `(row ${i + 1})`,
      planDate: planDateIso ?? currentPlantDate(),
      shiftCode,
      machineCode: config.machineCode,
      subProcess: config.subProcess,
      coilNo,
      slitId: raw.slitId ? String(raw.slitId).trim() : undefined,
      customerName,
      gradeCode,
      widthMm: widthMm ?? 0,
      finishThkMm: finishThkMm ?? 0,
      inputThkMm: inputThkMm ?? 0,
      passTargetThkMm: finishThkMm ?? inputThkMm,
      rollingPassNo: 1,
      ppcWeightMt: num(raw.ppcWeightMt) ?? 0,
      ppcRerollFlag: coilCount > 1,
      coilCount,
      rollFinish: normalizeFinish(surfaceRaw),
      processRouteRaw: routeRaw,
      processRouteCanonical: translated.canonical,
      fromWorkCenter: fromWc,
      toWorkCenter: toWc,
      itemNo: raw.itemNo ? String(raw.itemNo).trim() : undefined,
      sapOrderNo: raw.sapOrderNo ? String(raw.sapOrderNo).trim() : undefined,
      ppcRemarks: raw.ppcRemarks ? String(raw.ppcRemarks).trim() : undefined,
      importRemark: raw.importRemark ? String(raw.importRemark).trim() : undefined,
      minThkTolMm: num(raw.minThkTolMm),
      maxThkTolMm: num(raw.maxThkTolMm),
      rawExtras: Object.keys(rawExtras).length ? rawExtras : undefined,
      rollingPassPlans: [],
      errors,
    });
  }

  return { rows, sheetName, sheetType: config.sheetType };
}
