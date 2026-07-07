/** Fallback planned shift length (minutes) when master.shift has no window for a code. */
export const DEFAULT_SHIFT_MINUTES = 480;

/** Rough rejection cost estimate (currency units per MT) for management KPIs. */
export const REJECTION_COST_PER_MT = 3500;

/** Plant-wide OEE target (%) shown on the Plant Head dashboard for delta context. */
export const PLANT_OEE_TARGET = 80;

export interface ShiftWindowTimes {
  shiftCode: string;
  startTime: string;
  endTime: string;
}

function parseClockTimeToMinutes(time: string): number {
  const normalized = time.trim().slice(0, 5);
  const [h, m] = normalized.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/**
 * Duration of a shift window from master.shift start/end (HH:MM).
 * Supports overnight shifts where end <= start (e.g. 22:00–06:00).
 */
export function calcShiftDurationMinutes(startTime: string, endTime: string): number {
  const start = parseClockTimeToMinutes(startTime);
  const end = parseClockTimeToMinutes(endTime);
  if (start === end) return 24 * 60;
  let duration = end - start;
  if (duration <= 0) duration += 24 * 60;
  return duration;
}

export function buildShiftDurationMap(windows: ShiftWindowTimes[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (const window of windows) {
    map[window.shiftCode.toUpperCase()] = calcShiftDurationMinutes(
      window.startTime,
      window.endTime,
    );
  }
  return map;
}

export function resolveShiftMinutes(
  shiftCode: string,
  durationMap: Record<string, number>,
): number {
  return durationMap[shiftCode.toUpperCase()] ?? DEFAULT_SHIFT_MINUTES;
}

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
  if (targetMt <= 0) return actualMt > 0 ? 100 : 0;
  return round1(Math.min((actualMt / targetMt) * 100, 100));
}

export function calcAvailability(downtimeMin: number, shiftMinutes: number): number {
  if (shiftMinutes <= 0) return 0;
  const runMin = Math.max(shiftMinutes - downtimeMin, 0);
  return round1(Math.min((runMin / shiftMinutes) * 100, 100));
}

export function calcQuality(goodMt: number, totalMt: number): number {
  if (totalMt <= 0) return 0;
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
  shiftMinutes: number,
): { oee: number; availability: number; performance: number; quality: number } {
  const performance = calcPerformance(prodMt, targetMt);
  const availability = calcAvailability(downtimeMin, shiftMinutes);
  const goodMt = Math.max(prodMt - lossMt, 0);
  const quality = calcQuality(goodMt, prodMt);
  const oee = calcOee(availability, performance, quality);
  return { oee, availability, performance, quality };
}
