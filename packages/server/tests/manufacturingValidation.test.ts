import { describe, it, expect } from 'vitest';
import {
  assertEndAfterStart,
  assertNoOverlappingIntervals,
  assertQuantityWithinProduction,
  assertRuntimeAccounting,
  clockRangeMinutes,
  ManufacturingValidationError,
  resolveShiftWindowBounds,
  resolveShiftSinceTime,
} from '../src/validation/manufacturingValidation';

describe('manufacturingValidation', () => {
  it('rejects end before start', () => {
    const start = new Date('2026-06-10T10:00:00');
    const end = new Date('2026-06-10T09:00:00');
    expect(() => assertEndAfterStart(start, end)).toThrow(ManufacturingValidationError);
  });

  it('rejects overlapping stoppage intervals', () => {
    expect(() =>
      assertNoOverlappingIntervals([
        {
          start: new Date('2026-06-10T10:00:00'),
          end: new Date('2026-06-10T11:00:00'),
        },
        {
          start: new Date('2026-06-10T10:30:00'),
          end: new Date('2026-06-10T12:00:00'),
        },
      ]),
    ).toThrow(/Overlapping stoppages/);
  });

  it('rejects runtime plus downtime beyond shift duration', () => {
    expect(() => assertRuntimeAccounting(400, 100, 480)).toThrow(ManufacturingValidationError);
    expect(() => assertRuntimeAccounting(300, 180, 480)).not.toThrow();
  });

  it('rejects defect quantity above production', () => {
    expect(() => assertQuantityWithinProduction(12, 10, 'Defect quantity')).toThrow(
      ManufacturingValidationError,
    );
    expect(() => assertQuantityWithinProduction(8, 10, 'Defect quantity')).not.toThrow();
  });

  it('resolves overnight shift window bounds in IST', () => {
    const bounds = resolveShiftWindowBounds('2026-06-10', '22:00', '06:00');
    expect(bounds.durationMinutes).toBe(480);
    expect(bounds.start.toISOString()).toBe('2026-06-10T16:30:00.000Z');
    expect(bounds.end.toISOString()).toBe('2026-06-11T00:30:00.000Z');
  });

  it('calculates overnight clock range minutes', () => {
    expect(clockRangeMinutes('22:00', '06:00')).toBe(480);
    expect(clockRangeMinutes('06:00', '14:00')).toBe(480);
  });

  it('prefers actual session start for utilization since time', () => {
    const actual = '2026-07-08T08:15:00.000Z';
    const since = resolveShiftSinceTime('2026-07-08', '06:00', actual);
    expect(since.toISOString()).toBe(actual);
  });

  it('falls back to scheduled window start when session start is absent', () => {
    const since = resolveShiftSinceTime('2026-07-08', '06:00', null);
    expect(since.toISOString()).toBe('2026-07-08T00:30:00.000Z');
  });
});
