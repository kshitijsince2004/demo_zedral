import { parseLinePlanXlsx, type LinePlanParserConfig } from './linePlanXlsxCore';
import type { ParsedRollingPlanRow } from './rollingPlanXlsxParser';

/** HRS plan columns — Act. Process Route + Pre Stage Thinkness (typo) aliases. */
const HEADER_MAP: Record<string, string> = {
  'batch number': 'batchNumber',
  'plan date': 'planDate',
  shift: 'shiftCode',
  'mother coil': 'coilNo',
  'mother coil no': 'coilNo',
  'slit id': 'slitId',
  'customer name': 'customerName',
  grade: 'gradeCode',
  'grade code': 'gradeCode',
  width: 'widthMm',
  'finish thickness': 'finishThkMm',
  'finish thick': 'finishThkMm',
  'pre stage thinkness': 'inputThkMm', // real-file typo
  'pre stage thickness': 'inputThkMm',
  'pre-stage thickness': 'inputThkMm',
  'coil weight': 'ppcWeightMt',
  count: 'coilCount',
  'act. process route': 'processRouteRaw',
  'from work center': 'fromWorkCenter',
  'to work center': 'toWorkCenter',
  'fin. surface': 'rollFinish',
  'fin surface': 'rollFinish',
  'max thick tol(mm)': 'maxThkTolMm',
  'min thick tol(mm)': 'minThkTolMm',
  remark: 'importRemark',
  'ppc remarks': 'ppcRemarks',
  // extras → rawExtras
  'rm width': 'rmWidth',
  'rm thickness': 'rmThickness',
  'm. coil weight': 'mCoilWeight',
  'hrs combination': 'hrsCombination',
  'crs combination': 'crsCombination',
  'max width tol(mm)': 'maxWidthTolMm',
  'min width tol(mm)': 'minWidthTolMm',
  ageing: 'ageing',
  'pv-desc': 'pvDesc',
  'pv desc': 'pvDesc',
  'material code': 'materialCode',
  'material type': 'materialType',
  'material code/type': 'materialCodeType',
  'prod. version': 'prodVersion',
  'prod version': 'prodVersion',
  priority: 'priority',
  'coil size(w/t)': 'coilSizeWT',
};

const CONFIG: LinePlanParserConfig = {
  sheetType: 'HRS',
  machineCode: 'HRS',
  subProcess: 'HRS',
  lineLabel: 'HRS',
  headerMap: HEADER_MAP,
  required: [
    'batchNumber', 'planDate', 'coilNo', 'customerName', 'gradeCode',
    'widthMm', 'finishThkMm', 'inputThkMm', 'ppcWeightMt', 'processRouteRaw',
  ],
  signatures: ['finish thickness', 'hrs combination'],
  signatureMode: 'all',
  noFinishThk: false,
  defaultFromWc: 'S',
};

/** HRS plan xlsx → ParsedRollingPlanRow (first sheet; reject non-HRS by signature). */
export function parseHrsPlanXlsx(
  buffer: Buffer,
  options: { shiftCode?: string } = {},
): { rows: ParsedRollingPlanRow[]; headerError?: string; sheetName?: string; sheetType: 'HRS' } {
  const parsed = parseLinePlanXlsx(buffer, options, CONFIG) as ReturnType<typeof parseHrsPlanXlsx>;
  if (parsed.headerError || parsed.rows.length === 0) return parsed;

  const coilSlotUsage = new Map<string, Set<number>>();
  for (const row of parsed.rows) {
    const extras = (row.rawExtras ?? {}) as Record<string, unknown>;
    const comboRaw = String(extras.hrsCombination ?? '').trim();
    const comboWidths = parseHrsCombination(comboRaw);

    if (comboWidths.length === 0) {
      row.errors.push('HRS Combination missing or invalid');
      continue;
    }

    const slot = resolveHrsSlot(row, comboWidths, coilSlotUsage);
    if (!slot) {
      row.errors.push(`Width ${row.widthMm} not found in HRS Combination`);
      continue;
    }

    row.rawExtras = {
      ...extras,
      hrsSlitNo: slot.no,
      hrsSlitLabel: slot.label,
      hrsCombination: comboRaw,
    };
  }

  return parsed;
}

function parseHrsCombination(raw: string): number[] {
  if (!raw) return [];
  return raw
    .split('+')
    .map((part) => Number.parseFloat(part.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
}

function slitNoFromLabel(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const s = raw.trim().toUpperCase();
  if (!s) return undefined;
  const numeric = Number.parseInt(s, 10);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const ch = s.charCodeAt(0);
  if (ch >= 65 && ch <= 90) return ch - 64;
  return undefined;
}

function slotLabel(no: number): string {
  if (no >= 1 && no <= 26) return String.fromCharCode(64 + no);
  return String(no);
}

function resolveHrsSlot(
  row: ParsedRollingPlanRow,
  comboWidths: number[],
  usage: Map<string, Set<number>>,
): { no: number; label: string } | null {
  const explicitNo = slitNoFromLabel(row.slitId);
  if (explicitNo && explicitNo <= comboWidths.length) {
    return { no: explicitNo, label: slotLabel(explicitNo) };
  }

  const key = `${row.coilNo}|${comboWidths.join('+')}`;
  const used = usage.get(key) ?? new Set<number>();
  usage.set(key, used);
  for (let i = 0; i < comboWidths.length; i++) {
    const slotNo = i + 1;
    if (used.has(slotNo)) continue;
    if (Math.abs(comboWidths[i] - row.widthMm) < 0.001) {
      used.add(slotNo);
      return { no: slotNo, label: slotLabel(slotNo) };
    }
  }
  return null;
}
