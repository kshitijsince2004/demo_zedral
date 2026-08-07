/** Shift-cycle helpers extracted from SixHiService for reuse and testing. */

/** Shift codes earlier in the same production day (A→B→C cycle). */
export function earlierShiftCodesOnSameDay(shiftCode: string): string[] {
  const order = ['A', 'B', 'C'];
  const idx = order.indexOf(shiftCode.toUpperCase());
  if (idx <= 0) return [];
  return order.slice(0, idx);
}
