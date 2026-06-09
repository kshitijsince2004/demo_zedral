import type { ShiftCode, ShiftTriple, ShiftTripleDerived, UtilisationPct, ProdRateBlock } from '../types/rdm';

export const SHIFTS: ShiftCode[] = ['A', 'B', 'C'];

export function emptyShiftTriple(): ShiftTriple {
  return { A: 0, B: 0, C: 0, total: 0 };
}

export function sumShiftTriple(t: Pick<ShiftTriple, 'A' | 'B' | 'C'>): number {
  return round2(t.A + t.B + t.C);
}

export function finalizeShiftTriple(t: Pick<ShiftTriple, 'A' | 'B' | 'C'>): ShiftTriple {
  return { ...t, total: sumShiftTriple(t) };
}

export function addToShift(t: ShiftTriple, shift: string, value: number): void {
  if (shift === 'A' || shift === 'B' || shift === 'C') {
    t[shift] = round2(t[shift] + value);
  }
}

/** TOTAL = A + B + C */
export function computeTotal(prod: Pick<ShiftTriple, 'A' | 'B' | 'C'>): ShiftTriple {
  return finalizeShiftTriple(prod);
}

/** CUM(day n) = TOTAL(day n) + CUM(day n-1) */
export function chainCumMt(
  dailyTotals: number[],
  priorCum = 0,
): number[] {
  let cum = priorCum;
  return dailyTotals.map((total) => {
    cum = round2(cum + total);
    return cum;
  });
}

/** AVG = CUM / day_index */
export function computeAvgMt(cumMt: number, dayIndex: number): number {
  return safeDiv(cumMt, dayIndex);
}

/**
 * equip_avail_min_X = base_min − Σ(stoppages against availability in shift X).
 * All stoppage categories count against availability.
 */
export function computeEquipAvailMin(
  baseMin: number,
  stoppageByShift: Record<ShiftCode, number>,
): ShiftTripleDerived {
  const A = round2(Math.max(baseMin - stoppageByShift.A, 0));
  const B = round2(Math.max(baseMin - stoppageByShift.B, 0));
  const C = round2(Math.max(baseMin - stoppageByShift.C, 0));
  const cum = round2(A + B + C);
  return { A, B, C, total: cum, cum };
}

/**
 * utilisation_pct today = Σ equip_avail shifts / operating_minutes_base × 100.
 * utilisation_pct cum = Σ daily equip_avail cum / (base × day_index) × 100.
 */
export function computeUtilisationPct(
  equipAvailToday: number,
  equipAvailCum: number,
  baseMin: number,
  dayIndex: number,
): UtilisationPct {
  return {
    today: round2(safeDiv(equipAvailToday, baseMin) * 100),
    cum: round2(safeDiv(equipAvailCum, baseMin * dayIndex) * 100),
  };
}

/**
 * prod_rate_X = prod_X / running_minutes_X × 60 (MT/hr).
 * running_minutes falls back to equip_avail when no run-time captured.
 */
export function computeProdRate(
  prod: ShiftTriple,
  runningMinutes: Record<ShiftCode, number>,
  targetRate: number,
  priorCumProd = 0,
  priorCumRunning = 0,
): ProdRateBlock {
  const rateA = round2(safeDiv(prod.A, runningMinutes.A) * 60);
  const rateB = round2(safeDiv(prod.B, runningMinutes.B) * 60);
  const rateC = round2(safeDiv(prod.C, runningMinutes.C) * 60);
  const todayRunning = runningMinutes.A + runningMinutes.B + runningMinutes.C;
  const today = round2(safeDiv(prod.total, todayRunning) * 60);
  const cumRunning = priorCumRunning + todayRunning;
  const cumProd = priorCumProd + prod.total;
  const cum = round2(safeDiv(cumProd, cumRunning) * 60);
  return { A: rateA, B: rateB, C: rateC, today, cum, target: targetRate };
}

export function computeDispositionPct(amount: number, totalProd: number): number {
  return round2(safeDiv(amount, totalProd) * 100);
}

/** Division guard — returns 0 when denominator is 0 (never #DIV/0!). */
export function safeDiv(numerator: number, denominator: number): number {
  if (!denominator || !Number.isFinite(denominator)) return 0;
  const result = numerator / denominator;
  return Number.isFinite(result) ? result : 0;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Parse HH:MM[:SS] duration to minutes. */
export function timeRangeMinutes(from: string | null, to: string | null): number {
  if (!from || !to) return 0;
  const parse = (t: string) => {
    const parts = t.split(':').map(Number);
    return (parts[0] ?? 0) * 60 + (parts[1] ?? 0) + (parts[2] ?? 0) / 60;
  };
  let diff = parse(to) - parse(from);
  if (diff < 0) diff += 24 * 60;
  return round2(diff);
}

/** Plant yield: downstream output / upstream input × 100. */
export function computeYieldPct(outputMt: number, inputMt: number): number {
  return round2(safeDiv(outputMt, inputMt) * 100);
}
