export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

const SHEET_MONTH_NAMES = [
  'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUNE',
  'JULY', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'
];

export function monthSheetName(year: number, month: number): string {
  const monthName = SHEET_MONTH_NAMES[month - 1];
  const yearStr = String(year).slice(-2);
  return `${monthName}${yearStr}`;
}

const FULL_MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

export function dprFilename(year: number, month: number): string {
  const monthName = FULL_MONTH_NAMES[month - 1];
  return `DPR ${monthName} ${year}.xlsx`;
}

export function dateString(year: number, month: number, day: number): string {
  const dd = String(day).padStart(2, '0');
  const mm = String(month).padStart(2, '0');
  return `${dd}.${mm}.${year}`;
}
