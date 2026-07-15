/** Geometry helpers previously under src/dpr/geometry — kept for export DPR templates. */

export const BLOCK_STRIDE = 46;

export function titleRow(N: number): number {
  if (N === 1) return 2;
  return 49 + (N - 2) * BLOCK_STRIDE;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

const FULL_MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
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
