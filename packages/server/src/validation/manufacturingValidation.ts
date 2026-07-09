import { calcShiftDurationMinutes } from '../utils/kpiCalculator';
import {
  addPlantDays,
  DEFAULT_PLANT_SHIFT_WINDOWS,
  formatPlantDate,
  plantClockDate,
  resolveShiftFromClock,
  type PlantShiftWindow,
} from '@m1/shared-validation';

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

/** True when the outgoing operator may submit handover (shift ended or clock moved on). */
export function canCompleteOutgoingHandover(
  shift: { shiftCode: string; prodDate: string; windowStart: string; windowEnd: string },
  windows: PlantShiftWindow[] = DEFAULT_PLANT_SHIFT_WINDOWS,
  at: Date = new Date(),
): boolean {
  const bounds = resolveShiftWindowBounds(shift.prodDate, shift.windowStart, shift.windowEnd);
  if (at.getTime() >= bounds.end.getTime()) return true;

  const clock = resolveShiftFromClock(windows, at);
  return clock.shiftCode !== shift.shiftCode.toUpperCase();
}

export function resolveShiftWindowBounds(
  prodDate: string | Date,
  shiftStartTime: string,
  shiftEndTime: string,
): { start: Date; end: Date; durationMinutes: number } {
  const date = formatPlantDate(prodDate);
  const start = plantClockDate(date, shiftStartTime);
  let end = plantClockDate(date, shiftEndTime);
  if (end.getTime() <= start.getTime()) {
    end = plantClockDate(addPlantDays(date, 1), shiftEndTime);
  }

  return {
    start,
    end,
    durationMinutes: calcShiftDurationMinutes(shiftStartTime, shiftEndTime),
  };
}

export interface ShiftWindowSpec {
  shift_code: string;
  start_time: string;
  end_time: string;
}

/** Resolve which shift window contains an instant, using IST wall clock. */
export function resolveShiftFromInstant(
  windows: ShiftWindowSpec[],
  at: Date,
): { prodDate: string; startTime: string; endTime: string } | null {
  if (windows.length === 0) return null;
  const mapped: PlantShiftWindow[] = windows.map((w) => ({
    shift_code: w.shift_code,
    name: w.shift_code,
    start_time: w.start_time,
    end_time: w.end_time,
  }));
  const hit = resolveShiftFromClock(mapped, at);
  return {
    prodDate: hit.prodDate,
    startTime: hit.window.start_time,
    endTime: hit.window.end_time,
  };
}

/** Resolve the effective shift/session start for utilization and metrics. */
export function resolveShiftSinceTime(
  prodDate: string,
  scheduledWindowStart: string,
  actualSessionStartAt?: string | null,
): Date {
  if (actualSessionStartAt) {
    const actual = new Date(actualSessionStartAt);
    if (!Number.isNaN(actual.getTime())) return actual;
  }
  const bounds = resolveShiftWindowBounds(prodDate, scheduledWindowStart, scheduledWindowStart);
  return bounds.start;
}

export function formatDurationMinutes(minutes: number): string {
  if (minutes < 0) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
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
export function stoppageStartWithinShift(
  intervalStart: Date,
  shiftStart: Date,
  shiftEnd: Date,
): boolean {
  const toleranceMs = 60_000;
  return (
    intervalStart.getTime() >= shiftStart.getTime() - toleranceMs &&
    intervalStart.getTime() <= shiftEnd.getTime() + toleranceMs
  );
}

export function assertStoppageStartWithinShift(
  intervalStart: Date,
  shiftStart: Date,
  shiftEnd: Date,
): void {
  if (!stoppageStartWithinShift(intervalStart, shiftStart, shiftEnd)) {
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
