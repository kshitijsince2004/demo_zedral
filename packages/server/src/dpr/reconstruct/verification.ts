import { Workbook } from 'exceljs';

export function verifyReconstruction(workbook: Workbook): boolean {
  if (workbook.worksheets.length < 2) return false;
  return true;
}
