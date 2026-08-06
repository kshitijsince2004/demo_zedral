import { parseLinePlanXlsx, type LinePlanParserConfig } from './linePlanXlsxCore';
import type { ParsedRollingPlanRow } from './rollingPlanXlsxParser';

/** PKL plan columns — no finish thickness; signature First ANL TMP (or PV-Desc PICKL). */
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
  'pre stage thickness': 'inputThkMm',
  'pre-stage thickness': 'inputThkMm',
  'coil weight': 'ppcWeightMt',
  count: 'coilCount',
  'process route': 'processRouteRaw',
  'from work center': 'fromWorkCenter',
  'to work center': 'toWorkCenter',
  surface: 'rollFinish',
  'sale order': 'sapOrderNo',
  'sales order': 'sapOrderNo',
  'item no': 'itemNo',
  remark: 'importRemark',
  'ppc remarks': 'ppcRemarks',
  // extras → rawExtras
  'first anl tmp': 'firstAnlTmp',
  'first soak time': 'firstSoakTime',
  'delivery date': 'deliveryDate',
  'stage ageing': 'stageAgeing',
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
  sheetType: 'PKL',
  machineCode: 'PKL',
  subProcess: 'PKL',
  lineLabel: 'PKL',
  headerMap: HEADER_MAP,
  required: [
    'batchNumber', 'planDate', 'coilNo', 'customerName', 'gradeCode',
    'widthMm', 'inputThkMm', 'ppcWeightMt', 'processRouteRaw',
  ],
  signatures: ['first anl tmp'],
  signatureMode: 'any',
  noFinishThk: true,
  defaultFromWc: 'P',
  pvDescSignatureToken: 'PICKL',
};

/** PKL plan xlsx → ParsedRollingPlanRow (first sheet; reject non-PKL by signature). */
export function parsePklPlanXlsx(
  buffer: Buffer,
  options: { shiftCode?: string } = {},
): { rows: ParsedRollingPlanRow[]; headerError?: string; sheetName?: string; sheetType: 'PKL' } {
  return parseLinePlanXlsx(buffer, options, CONFIG) as ReturnType<typeof parsePklPlanXlsx>;
}
