import ExcelJS from 'exceljs';
import { titleRow } from '../../dpr/geometry/blockGeometry';
import { AREA_TITLE_OFFSET } from './areaGeometry';

/** All daily INPUT columns on machine rows (1-indexed). Never write formula columns. */
export const MACHINE_INPUT_COLS = [
  2,  // B target
  3, 4, 5, // C D E production
  26, 27, 28, // Z AA AB electrical
  30, 31, 32, // AD AE AF mechanical
  34, 35, 36, // AH AI AJ operational
  38, 39, 40, // AL AM AN availability
  42, // AP prev maint
  44, 45, 46, // AR AS AT power
  54, 55, 56, // BB BC BD rm shortage
  61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, // BI–BT scrap/rej region
] as const;

/** Summary-band input cells (offset from title row → columns). */
const SUMMARY_INPUTS: Array<{ offset: number; cols: number[] }> = [
  { offset: AREA_TITLE_OFFSET.WIP, cols: [6] },
  { offset: AREA_TITLE_OFFSET.OT, cols: [2, 3, 4, 5] },
  { offset: 32, cols: [11, 12, 13, 14, 15, 16] },
  { offset: 33, cols: [11, 12, 13, 14, 15, 16] },
  { offset: 34, cols: [11, 12, 13, 14, 15, 16] },
  { offset: 37, cols: [11, 12, 13, 14, 15, 16] },
  { offset: 38, cols: [11, 12, 13, 14, 15, 16] },
  { offset: 39, cols: [11, 12, 13, 14, 15, 16] },
  { offset: 40, cols: [11, 12, 13, 14, 15, 16] },
];

function setZero(ws: ExcelJS.Worksheet, row: number, col: number) {
  ws.getCell(row, col).value = 0;
}

/** Zero every daily-input cell on the main sheet for all 31 day-blocks. */
export function zeroMainSheetInputs(ws: ExcelJS.Worksheet, maxDays = 31) {
  for (let day = 1; day <= maxDays; day++) {
    const base = titleRow(day);
    for (const offset of Object.values(AREA_TITLE_OFFSET)) {
      const row = base + offset;
      for (const col of MACHINE_INPUT_COLS) setZero(ws, row, col);
    }
    for (const { offset, cols } of SUMMARY_INPUTS) {
      const row = base + offset;
      for (const col of cols) setZero(ws, row, col);
    }
  }
}

/** Zero DELAY sheet time/agency/reason columns on all machine data rows. */
export function zeroDelaySheetInputs(ws: ExcelJS.Worksheet) {
  ws.eachRow((row) => {
    const label = String(row.getCell(1).value ?? '').trim();
    if (!label || label === 'LINE') return;
    row.getCell(4).value = 0;
    row.getCell(5).value = '';
    row.getCell(6).value = '';
  });
}

/**
 * Strip all prefilled/sample values from a loaded workbook.
 * Preserves labels, formulas, styles, and structure.
 */
export function zeroAllTemplateInputs(workbook: ExcelJS.Workbook) {
  const main = workbook.worksheets[0];
  if (main) zeroMainSheetInputs(main);
  const delay = workbook.getWorksheet('DELAY');
  if (delay) zeroDelaySheetInputs(delay);
}

/** Build a blank master buffer from any filled DPR template workbook. */
export async function buildBlankMasterBuffer(workbook: ExcelJS.Workbook): Promise<Buffer> {
  zeroAllTemplateInputs(workbook);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
