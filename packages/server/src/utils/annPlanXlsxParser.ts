import { parseLinePlanXlsx, type LinePlanParserConfig } from './linePlanXlsxCore';
import type { ParsedRollingPlanRow } from './rollingPlanXlsxParser';

/**
 * ANN plan columns — Height is coil width; Width is slit-combo string (rawExtras).
 * No finish thickness (ppc thk := input thk).
 */
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
  'rm grade': 'rmGrade',
  height: 'widthMm', // ANN quirk: width lives in Height
  width: 'slitCombination', // slit combo string — NOT widthMm
  'pre stage thickness': 'inputThkMm',
  'pre-stage thickness': 'inputThkMm',
  'coil weight': 'ppcWeightMt',
  count: 'coilCount',
  'process route': 'processRouteRaw',
  'from work center': 'fromWorkCenter',
  'to work center': 'toWorkCenter',
  'sale order': 'sapOrderNo',
  'sales order': 'sapOrderNo',
  'item no': 'itemNo',
  'charge no': 'chargeNo',
  remark: 'importRemark',
  'ppc remarks': 'ppcRemarks',
  // extras → rawExtras (annealing recipe)
  'ann cycle': 'annCycle',
  'ann cycle no.1': 'annCycleNo1',
  'ann cycle no.2': 'annCycleNo2',
  'ann cycle no.3': 'annCycleNo3',
  'ann cycle no.4': 'annCycleNo4',
  'first annealing temp': 'firstAnnealingTemp',
  'second annealing temp': 'secondAnnealingTemp',
  'third annealing temp': 'thirdAnnealingTemp',
  'fourth annealing temp': 'fourthAnnealingTemp',
  'first soak time': 'firstSoakTime',
  'second soak time': 'secondSoakTime',
  'third soak time': 'thirdSoakTime',
  'fourth soak time': 'fourthSoakTime',
  'rapid cool': 'rapidCool',
  'water cool': 'waterCool',
  'charge unload': 'chargeUnload',
  'heat rate 1': 'heatRate1',
  'heat rate 2': 'heatRate2',
  'heat rate 3': 'heatRate3',
  'heat rate 4': 'heatRate4',
  'first ann no.': 'firstAnnNo',
  'first ann no': 'firstAnnNo',
  'annealing batch': 'annealingBatch',
  'pv-desc': 'pvDesc',
  'pv desc': 'pvDesc',
  'material code': 'materialCode',
  'material type': 'materialType',
  'material code/type': 'materialCodeType',
  'prod. version': 'prodVersion',
  'prod version': 'prodVersion',
};

const CONFIG: LinePlanParserConfig = {
  sheetType: 'ANNEALING',
  machineCode: 'ANN',
  subProcess: 'ANN',
  lineLabel: 'ANN',
  headerMap: HEADER_MAP,
  required: [
    'batchNumber', 'planDate', 'coilNo', 'customerName', 'gradeCode',
    'widthMm', 'inputThkMm', 'ppcWeightMt', 'processRouteRaw',
  ],
  signatures: ['ann cycle', 'charge no', 'first annealing temp'],
  signatureMode: 'any',
  noFinishThk: true,
  defaultFromWc: 'F',
  carryForwardWidthMm: true,
};

/** ANN plan xlsx → ParsedRollingPlanRow (first sheet; Height→widthMm; reject non-ANN). */
export function parseAnnPlanXlsx(
  buffer: Buffer,
  options: { shiftCode?: string } = {},
): { rows: ParsedRollingPlanRow[]; headerError?: string; sheetName?: string; sheetType: 'ANNEALING' } {
  return parseLinePlanXlsx(buffer, options, CONFIG) as ReturnType<typeof parseAnnPlanXlsx>;
}
