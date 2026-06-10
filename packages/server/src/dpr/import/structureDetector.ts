import { Worksheet } from 'exceljs';

export interface StructureData {
  blockStride: number;
  machineLabels: string[];
  dateColIndex: number;
  lineMarkerRow: number;
}

export function detectStructure(sheet: Worksheet): StructureData {
  let dateRows: number[] = [];
  sheet.getColumn(11).eachCell((cell, rowNumber) => {
    if (cell.value && cell.value.toString().includes('DATE')) {
      dateRows.push(rowNumber);
    }
  });

  const blockStride = dateRows.length >= 2 ? dateRows[1] - dateRows[0] : 46;

  let lineMarkerRow = -1;
  sheet.getColumn(1).eachCell((cell, rowNumber) => {
    if (cell.value === 'LINE') {
      lineMarkerRow = rowNumber;
    }
  });

  const machineLabels: string[] = [];
  if (lineMarkerRow > 0) {
    for (let i = 1; i <= 26; i++) {
      const cell = sheet.getCell(lineMarkerRow + i, 1);
      if (cell.value) machineLabels.push(cell.value.toString());
    }
  }

  return { blockStride, machineLabels, dateColIndex: 11, lineMarkerRow };
}
