import { Workbook } from 'exceljs';
import { NamedStyles } from './namedStyles';

export function buildDelaySheet(workbook: Workbook) {
  const sheet = workbook.addWorksheet('DELAY');
  for (let i = 0; i < 93; i++) {
    const row = 1 + i * 20;
    const cell = sheet.getCell(`A${row}`);
    cell.value = 'DELAY LOG';
    cell.style = NamedStyles.hdr as any;
  }
}
