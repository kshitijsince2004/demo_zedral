import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  calculateScrapPct,
  calculateStoppageDuration,
  calculateChargeWeight,
  calculateTotalProduction,
  convertKgToMt,
  kgToMt
} from '../../src/utils/calculationEngine';

describe('Property Tests: Calculation Engine', () => {
  // Property 5: Scrap percentage calculation correctness
  it('Property 5: should calculate scrap percentage correctly (S / W * 100)', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1000, noNaN: true }), // scrap
        fc.double({ min: 0.001, max: 5000, noNaN: true }), // total (must be > 0)
        (scrap, total) => {
          const result = calculateScrapPct(scrap, total);
          const expected = Math.round((scrap / total) * 100 * 100) / 100;
          expect(result).toBeCloseTo(expected, 2);
        }
      )
    );
  });

  // Property 6: Stoppage duration calculation correctness
  it('Property 6: should calculate stoppage duration as absolute difference in minutes', () => {
    fc.assert(
      fc.property(
        // Use a bounded date range to avoid overflow when adding durationMs
        fc.date({ min: new Date(0), max: new Date(2_000_000_000_000) }),
        fc.integer({ min: 1, max: 1_000_000 }), // duration in ms
        (start, durationMs) => {
          const end = new Date(start.getTime() + durationMs);
          const result = calculateStoppageDuration(start, end);
          const expected = Math.round(durationMs / (1000 * 60));
          expect(result).toBe(expected);
        }
      )
    );
  });

  // Property 7: Total production recalculation invariant
  it('Property 7: should always equal sum of current entry weights', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ weightMt: fc.double({ min: 0, max: 100, noNaN: true }) })),
        (entries) => {
          const total = calculateTotalProduction(entries);
          const expectedSum = entries.reduce((acc, curr) => acc + curr.weightMt, 0);
          expect(total).toBeCloseTo(expectedSum, 4);
        }
      )
    );
  });

  // Property 8: Charge weight equals sum of coil weights
  it('Property 8: should calculate charge weight as sum of individual coil weights', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0, max: 50, noNaN: true })),
        (weights) => {
          const total = calculateChargeWeight(weights);
          const expectedSum = weights.reduce((acc, curr) => acc + curr, 0);
          expect(total).toBeCloseTo(expectedSum, 4);
        }
      )
    );
  });
});

/**
 * Property 8: Kilogram-to-metric-ton conversion
 * Validates: Requirements 3.10
 *
 * For any non-negative kilogram weight entered on the CTL form, the stored
 * weight in MT should equal the kilogram value divided by 1000, within
 * floating-point tolerance.
 */
describe('Feature: m1-frontend-remediation, Property 8: Kilogram-to-metric-ton conversion', () => {
  it('Property 8: kgToMt(kg) === kg / 1000 for all non-negative kg values', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1_000_000, noNaN: true }),
        (kg) => {
          const result = kgToMt(kg);
          const expected = kg / 1000;
          expect(result).toBeCloseTo(expected, 10);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 8: kgToMt result is always non-negative for non-negative input', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1_000_000, noNaN: true }),
        (kg) => {
          const result = kgToMt(kg);
          expect(result).toBeGreaterThanOrEqual(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 8: kgToMt(0) === 0 (zero boundary)', () => {
    expect(kgToMt(0)).toBe(0);
  });

  it('Property 8: kgToMt throws for negative kg values', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1_000_000, max: -Number.EPSILON, noNaN: true }),
        (negativeKg) => {
          expect(() => kgToMt(negativeKg)).toThrow();
        }
      ),
      { numRuns: 100 }
    );
  });
});
