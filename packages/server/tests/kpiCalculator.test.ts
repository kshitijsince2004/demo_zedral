import { describe, it, expect } from 'vitest';
import {
  buildShiftDurationMap,
  calcAvailability,
  calcOee,
  calcPerformance,
  calcQuality,
  calcShiftDurationMinutes,
  lineOeeFromTotals,
  pctChange,
  resolveShiftMinutes,
} from '../src/utils/kpiCalculator';

describe('kpiCalculator', () => {
  it('calculates performance capped at 100%', () => {
    expect(calcPerformance(90, 100)).toBe(90);
    expect(calcPerformance(120, 100)).toBe(100);
    expect(calcPerformance(50, 0)).toBe(100);
    expect(calcPerformance(0, 0)).toBe(0);
  });

  it('calculates shift duration from master.shift windows', () => {
    expect(calcShiftDurationMinutes('06:00', '14:00')).toBe(480);
    expect(calcShiftDurationMinutes('14:00', '22:00')).toBe(480);
    expect(calcShiftDurationMinutes('22:00', '06:00')).toBe(480);
    expect(calcShiftDurationMinutes('06:00', '15:00')).toBe(540);
  });

  it('builds duration map and resolves shift codes', () => {
    const map = buildShiftDurationMap([
      { shiftCode: 'A', startTime: '06:00', endTime: '14:00' },
      { shiftCode: 'B', startTime: '14:00', endTime: '22:00' },
      { shiftCode: 'C', startTime: '22:00', endTime: '06:00' },
    ]);
    expect(resolveShiftMinutes('A', map)).toBe(480);
    expect(resolveShiftMinutes('c', map)).toBe(480);
    expect(resolveShiftMinutes('X', map)).toBe(480);
  });

  it('calculates availability from downtime and actual shift duration', () => {
    expect(calcAvailability(48, 480)).toBe(90);
    expect(calcAvailability(0, 480)).toBe(100);
    expect(calcAvailability(54, 540)).toBe(90);
  });

  it('calculates quality from good vs total output', () => {
    expect(calcQuality(95, 100)).toBe(95);
    expect(calcQuality(0, 0)).toBe(0);
  });

  it('calculates OEE as A x P x Q', () => {
    expect(calcOee(90, 95, 98)).toBe(83.8);
  });

  it('calculates period-over-period change', () => {
    expect(pctChange(110, 100)).toBe(10);
    expect(pctChange(90, 100)).toBe(-10);
    expect(pctChange(10, 0)).toBe(100);
  });

  it('derives line OEE from shift totals using actual shift minutes', () => {
    const result = lineOeeFromTotals(100, 90, 48, 5, 480);
    expect(result.performance).toBe(90);
    expect(result.availability).toBe(90);
    expect(result.quality).toBe(94.4);
    expect(result.oee).toBe(76.5);
  });
});
