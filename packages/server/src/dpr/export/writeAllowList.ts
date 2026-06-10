import { Worksheet } from 'exceljs';
import { CellClass, classifyCell } from '../import/cellClassifier';

export function assertWritable(sheet: Worksheet, row: number, col: number) {
  const cell = sheet.getCell(row, col);
  const cls = classifyCell(cell);
  if (cls === CellClass.Formula_Cell) {
    throw new Error('Write allow-list violation: Attempted to write to a Formula cell');
  }
}
