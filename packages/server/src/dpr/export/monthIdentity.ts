import { Worksheet } from 'exceljs';
import { monthSheetName, dateString, dprFilename } from '../geometry/monthCalendar';

export function applyMonthIdentity(sheet: Worksheet, delaySheet: Worksheet, year: number, month: number) {
  sheet.name = monthSheetName(year, month);
  
  // Stub: Update date columns
  for (let day = 1; day <= 31; day++) {
    const ds = dateString(year, month, day);
  }

  return dprFilename(year, month);
}
