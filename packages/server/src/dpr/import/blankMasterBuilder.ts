import { Workbook } from 'exceljs';
import { classifyCell, CellClass } from './cellClassifier';

export async function buildBlankMaster(workbook: Workbook): Promise<Buffer> {
  const sheet = workbook.worksheets[0]; // main sheet

  sheet.eachRow((row, rowNumber) => {
    row.eachCell((cell, colNumber) => {
      const classification = classifyCell(cell);
      if (classification === CellClass.Daily_Input_Cell) {
        if (typeof cell.value === 'number' || cell.value === null) {
          cell.value = 0;
        }
      }
    });
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return buffer as Buffer;
}
