import { describe, it, expect } from 'vitest';
import {
  calcAvailability,
  calcOee,
  calcPerformance,
  calcQuality,
  lineOeeFromTotals,
  pctChange,
} from '../src/utils/kpiCalculator';

describe('kpiCalculator', () => {
  it('calculates performance capped at 100%', () => {
    expect(calcPerformance(90, 100)).toBe(90);
    expect(calcPerformance(120, 100)).toBe(100);
    expect(calcPerformance(50, 0)).toBe(100);
  });

  it('calculates availability from downtime', () => {
    expect(calcAvailability(48, 480)).toBe(90);
    expect(calcAvailability(0, 480)).toBe(100);
  });

  it('calculates quality from good vs total output', () => {
    expect(calcQuality(95, 100)).toBe(95);
    expect(calcQuality(0, 0)).toBe(100);
  });

  it('calculates OEE as A x P x Q', () => {
    expect(calcOee(90, 95, 98)).toBe(83.8);
  });

  it('calculates period-over-period change', () => {
    expect(pctChange(110, 100)).toBe(10);
    expect(pctChange(90, 100)).toBe(-10);
    expect(pctChange(10, 0)).toBe(100);
  });

  it('derives line OEE from shift totals', () => {
    const result = lineOeeFromTotals(100, 90, 48, 5);
    expect(result.performance).toBe(90);
    expect(result.availability).toBe(90);
    expect(result.quality).toBe(94.4);
    expect(result.oee).toBe(76.5);
  });
});
