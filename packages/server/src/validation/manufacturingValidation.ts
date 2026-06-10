import { calcShiftDurationMinutes } from '../utils/kpiCalculator';

export class ManufacturingValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ManufacturingValidationError';
  }
}

export function assertEndAfterStart(start: Date, end: Date, label = 'Interval'): void {
  if (end.getTime() < start.getTime()) {
    throw new ManufacturingValidationError(`${label} end time cannot be before start time`);
  }
}

export function intervalsOverlap(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date,
): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}

export function assertNoOverlappingIntervals(
  intervals: Array<{ start: Date; end: Date; label?: string }>,
): void {
  const sorted = [...intervals].sort((a, b) => a.start.getTime() - b.start.getTime());
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    if (intervalsOverlap(prev.start, prev.end, curr.start, curr.end)) {
      throw new ManufacturingValidationError(
        `Overlapping stoppages detected${curr.label ? ` (${curr.label})` : ''}`,
      );
    }
  }
}

export function resolveShiftWindowBounds(
  prodDate: string | Date,
  shiftStartTime: string,
  shiftEndTime: string,
): { start: Date; end: Date; durationMinutes: number } {
  const date = prodDate instanceof Date ? prodDate : new Date(prodDate);
  const y = date.getFullYear();
  const m = date.getMonth();
  const d = date.getDate();

  const parse = (t: string) => {
    const [h, min] = t.trim().slice(0, 5).split(':').map(Number);
    return { h: h ?? 0, min: min ?? 0 };
  };

  const startParts = parse(shiftStartTime);
  const endParts = parse(shiftEndTime);
  const start = new Date(y, m, d, startParts.h, startParts.min, 0, 0);
  let end = new Date(y, m, d, endParts.h, endParts.min, 0, 0);
  if (end.getTime() <= start.getTime()) {
    end = new Date(end.getTime() + 24 * 60 * 60 * 1000);
  }

  return {
    start,
    end,
    durationMinutes: calcShiftDurationMinutes(shiftStartTime, shiftEndTime),
  };
}

export function assertWithinShiftWindow(
  intervalStart: Date,
  intervalEnd: Date,
  shiftStart: Date,
  shiftEnd: Date,
): void {
  if (intervalStart.getTime() < shiftStart.getTime() || intervalEnd.getTime() > shiftEnd.getTime()) {
    throw new ManufacturingValidationError('Stoppage duration exceeds shift boundary');
  }
}

/** Validate stoppage start is inside shift; allow end after shift closes so operators can always end active stops. */
export function assertStoppageStartWithinShift(
  intervalStart: Date,
  shiftStart: Date,
  shiftEnd: Date,
): void {
  const toleranceMs = 60_000;
  if (intervalStart.getTime() < shiftStart.getTime() - toleranceMs) {
    throw new ManufacturingValidationError('Stoppage start is outside the shift window');
  }
  if (intervalStart.getTime() > shiftEnd.getTime() + toleranceMs) {
    throw new ManufacturingValidationError('Stoppage start is outside the shift window');
  }
}

export function clockRangeMinutes(from: string, to: string): number {
  const parse = (t: string) => {
    const parts = t.trim().slice(0, 8).split(':').map(Number);
    return (parts[0] ?? 0) * 60 + (parts[1] ?? 0) + (parts[2] ?? 0) / 60;
  };
  let diff = parse(to) - parse(from);
  if (diff < 0) diff += 24 * 60;
  return Math.round(diff);
}

export function assertRuntimeAccounting(
  runtimeMinutes: number,
  downtimeMinutes: number,
  shiftDurationMinutes: number,
): void {
  if (runtimeMinutes < 0 || downtimeMinutes < 0) {
    throw new ManufacturingValidationError('Runtime and downtime minutes must be non-negative');
  }
  if (runtimeMinutes + downtimeMinutes > shiftDurationMinutes + 1) {
    throw new ManufacturingValidationError(
      `Runtime (${runtimeMinutes} min) plus downtime (${downtimeMinutes} min) exceeds shift duration (${shiftDurationMinutes} min)`,
    );
  }
}

export function assertQuantityWithinProduction(
  quantity: number,
  productionMt: number,
  fieldLabel: string,
): void {
  if (quantity < 0) {
    throw new ManufacturingValidationError(`${fieldLabel} cannot be negative`);
  }
  if (productionMt <= 0 && quantity > 0) {
    throw new ManufacturingValidationError(`${fieldLabel} cannot be recorded without production quantity`);
  }
  if (quantity > productionMt + 1e-6) {
    throw new ManufacturingValidationError(`${fieldLabel} (${quantity}) exceeds production quantity (${productionMt})`);
  }
}
