/** Default planned shift length (minutes) when no line-specific standard is configured. */
export const DEFAULT_SHIFT_MINUTES = 480;

/** Rough rejection cost estimate (currency units per MT) for management KPIs. */
export const REJECTION_COST_PER_MT = 3500;

/** Plant-wide OEE target (%) shown on the Plant Head dashboard for delta context. */
export const PLANT_OEE_TARGET = 80;

export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function pctChange(current: number, previous: number): number {
  if (previous === 0) {
    return current === 0 ? 0 : 100;
  }
  return round1(((current - previous) / previous) * 100);
}

export function calcPerformance(actualMt: number, targetMt: number): number {
  if (targetMt <= 0) return 100;
  return round1(Math.min((actualMt / targetMt) * 100, 100));
}

export function calcAvailability(
  downtimeMin: number,
  shiftMinutes: number = DEFAULT_SHIFT_MINUTES,
): number {
  if (shiftMinutes <= 0) return 100;
  const runMin = Math.max(shiftMinutes - downtimeMin, 0);
  return round1(Math.min((runMin / shiftMinutes) * 100, 100));
}

export function calcQuality(goodMt: number, totalMt: number): number {
  if (totalMt <= 0) return 100;
  return round1(Math.min((goodMt / totalMt) * 100, 100));
}

export function calcOee(availability: number, performance: number, quality: number): number {
  return round1((availability * performance * quality) / 10000);
}

export function lineOeeFromTotals(
  targetMt: number,
  prodMt: number,
  downtimeMin: number,
  lossMt: number,
): { oee: number; availability: number; performance: number; quality: number } {
  const performance = calcPerformance(prodMt, targetMt);
  const availability = calcAvailability(downtimeMin);
  const goodMt = Math.max(prodMt - lossMt, 0);
  const quality = calcQuality(goodMt, prodMt);
  const oee = calcOee(availability, performance, quality);
  return { oee, availability, performance, quality };
}
