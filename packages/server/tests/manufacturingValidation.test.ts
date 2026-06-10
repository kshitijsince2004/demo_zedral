import { describe, it, expect } from 'vitest';
import {
  assertEndAfterStart,
  assertNoOverlappingIntervals,
  assertQuantityWithinProduction,
  assertRuntimeAccounting,
  clockRangeMinutes,
  ManufacturingValidationError,
  resolveShiftWindowBounds,
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

  it('resolves overnight shift window bounds', () => {
    const bounds = resolveShiftWindowBounds('2026-06-10', '22:00', '06:00');
    expect(bounds.durationMinutes).toBe(480);
    expect(bounds.end.getTime()).toBeGreaterThan(bounds.start.getTime());
  });

  it('calculates overnight clock range minutes', () => {
    expect(clockRangeMinutes('22:00', '06:00')).toBe(480);
    expect(clockRangeMinutes('06:00', '14:00')).toBe(480);
  });
});
