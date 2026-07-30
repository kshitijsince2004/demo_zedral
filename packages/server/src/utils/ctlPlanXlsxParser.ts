import * as XLSX from 'xlsx';
import { translatePpcRoute } from './PpcRouteTranslator';
import { currentPlantDate, formatDateOnly } from './dateOnly';
import type { ParsedRollingPlanRow } from './rollingPlanXlsxParser';
import { resolveWorkbookSheetName } from './rollingPlanXlsxParser';
import { parsePlanCount } from './ctlFieldMappers';

const HEADER_MAP: Record<string, string> = {
  'batch number': 'batchNumber',
  'plan date': 'planDate',
  'mother coil': 'coilNo',
  'mother coil no': 'coilNo',
  'slit id': 'slitId',
  'customer name': 'customerName',
  grade: 'gradeCode',
  'grade code': 'gradeCode',
  width: 'widthMm',
  'pre stage thickness': 'inputThkMm',
  'pre-stage thickness': 'inputThkMm',
  'coil weight': 'ppcWeightMt',
  length: 'lengthMm',
  pcs: 'plannedPcs',
  'pcs.': 'plannedPcs',
  'bundle wt.': 'bundleWtMt',
  'bundle wt': 'bundleWtMt',
  'no of rows': 'noOfRows',
  'prod. version': 'prodVersion',
  'prod version': 'prodVersion',
  'packing type': 'packingType',
  'length tol neg.': 'lengthTolNeg',
  'length tol neg': 'lengthTolNeg',
  'length tol pos.': 'lengthTolPos',
  'length tol pos': 'lengthTolPos',
  surface: 'rollFinish',
  'from work center': 'fromWorkCenter',
  'to work center': 'toWorkCenter',
  'process route': 'processRouteRaw',
  'sale order': 'sapOrderNo',
  'sales order': 'sapOrderNo',
  'item no': 'itemNo',
  remark: 'importRemark',
};

function normalizeHeader(value: unknown): string {
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

/**
 * CTL plan xlsx → ParsedRollingPlanRow with machine_code/sub_process = CTL.
 * Length/Pcs/Prod.Version ride along on the row (raw_row_json) for prefill.
 */
export function parseCtlPlanXlsx(
  buffer: Buffer,
  options: { shiftCode?: string } = {},
): { rows: ParsedRollingPlanRow[]; headerError?: string; sheetName?: string; sheetType: 'CTL' } {
  const shiftCode = (options.shiftCode ?? 'B').toUpperCase();
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  const sheetName = resolveWorkbookSheetName(wb.SheetNames, 'CTL');
  const sheet = sheetName ? wb.Sheets[sheetName] : undefined;
  if (!sheet) return { rows: [], headerError: 'Workbook has no sheets', sheetType: 'CTL' };

  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' }) as unknown[][];
  if (matrix.length < 2) {
    return { rows: [], headerError: 'Sheet must have header and data rows', sheetName, sheetType: 'CTL' };
  }

  const headerRowIndex = findHeaderRowIndex(matrix);
  const headers = (matrix[headerRowIndex] as unknown[]).map(normalizeHeader);
  const colKeys: (string | null)[] = headers.map((h) => HEADER_MAP[h] ?? null);

  const required = ['coilNo', 'customerName', 'gradeCode', 'inputThkMm', 'processRouteRaw'];
  const mapped = new Set(colKeys.filter(Boolean));
  const missing = required.filter((k) => !mapped.has(k));
  if (missing.length) {
    return { rows: [], headerError: `Missing columns: ${missing.join(', ')}`, sheetName, sheetType: 'CTL' };
  }

  const rows: ParsedRollingPlanRow[] = [];
  for (let i = headerRowIndex + 1; i < matrix.length; i++) {
    const line = matrix[i] as unknown[];
    if (line.every((c) => c == null || String(c).trim() === '')) continue;

    const raw: Record<string, unknown> = {};
    colKeys.forEach((key, idx) => {
      if (key) raw[key] = line[idx];
    });

    const errors: string[] = [];
    const coilNo = String(raw.coilNo ?? '').trim();
    const customerName = String(raw.customerName ?? '').trim();
    const gradeCode = String(raw.gradeCode ?? '').trim();
    const inputThkMm = num(raw.inputThkMm);
    const widthMm = num(raw.widthMm);
    const planDateIso = excelDateToIso(raw.planDate);
    const batchNumber = String(raw.batchNumber ?? '').trim()
      || (coilNo ? `CTL-${coilNo}-${raw.slitId ? String(raw.slitId).trim() + '-' : ''}${planDateIso ?? i}` : '');

    if (!batchNumber) errors.push('Empty batch number');
    if (!coilNo) errors.push('mother coil required');
    if (!customerName) errors.push('customer name required');
    if (!gradeCode) errors.push('grade required');
    if (inputThkMm == null) errors.push('pre-stage thickness required');
    if (widthMm == null || widthMm <= 0) errors.push('Width required / must be > 0');
    if (!raw.processRouteRaw) errors.push('process route required');

    const routeRaw = String(raw.processRouteRaw ?? '').trim().toUpperCase();
    const translated = routeRaw
      ? translatePpcRoute(routeRaw)
      : { raw: '', canonical: '', codes: [], rollingPassCount: 1 };
    if (routeRaw && !translated.canonical) errors.push(`invalid process route: ${routeRaw}`);

    const fromWc = String(raw.fromWorkCenter ?? 'L').trim() || 'L';
    const toWc = raw.toWorkCenter ? String(raw.toWorkCenter).trim() : undefined;
    const lengthMm = num(raw.lengthMm);
    const plannedPcs = parsePlanCount(raw.plannedPcs) ?? undefined;
    const noOfRows = parsePlanCount(raw.noOfRows) ?? undefined;
    const prodVersion = raw.prodVersion ? String(raw.prodVersion).trim() : undefined;

    rows.push({
      rowNum: i + 1,
      batchNumber,
      planDate: planDateIso ?? currentPlantDate(),
      shiftCode,
      machineCode: 'CTL',
      subProcess: 'CTL',
      coilNo,
      slitId: raw.slitId ? String(raw.slitId).trim() : undefined,
      customerName,
      gradeCode,
      widthMm: widthMm ?? 0,
      finishThkMm: inputThkMm ?? 0,
      inputThkMm: inputThkMm ?? 0,
      passTargetThkMm: inputThkMm,
      rollingPassNo: 1,
      ppcWeightMt: num(raw.ppcWeightMt) ?? 0,
      ppcRerollFlag: false,
      coilCount: 1,
      destination: 'CTL',
      processRouteRaw: routeRaw,
      processRouteCanonical: translated.canonical,
      fromWorkCenter: fromWc,
      toWorkCenter: toWc,
      itemNo: raw.itemNo ? String(raw.itemNo).trim() : undefined,
      sapOrderNo: raw.sapOrderNo ? String(raw.sapOrderNo).trim() : undefined,
      importRemark: [
        raw.importRemark ? String(raw.importRemark).trim() : '',
        prodVersion ? `PV=${prodVersion}` : '',
      ].filter(Boolean).join(' | ') || undefined,
      lengthMm,
      plannedPcs,
      noOfRows,
      bundleWtMt: num(raw.bundleWtMt),
      prodVersion,
      packingType: raw.packingType ? String(raw.packingType).trim() : undefined,
      lengthTolNegMm: num(raw.lengthTolNeg),
      lengthTolPosMm: num(raw.lengthTolPos),
      rollingPassPlans: [],
      errors,
    });
  }

  return { rows, sheetName, sheetType: 'CTL' };
}
