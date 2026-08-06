import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  resolveSlitThkMm,
  resolveSlitWeightMt,
  widthProportionalShare,
} from '../src/utils/slitAllocation';

describe('resolveSlitWeightMt', () => {
  it('prefers actual over planned and width share', () => {
    const slits = [
      { actual_weight_mt: 4.2, planned_weight_mt: 5, width_mm: 300 },
      { planned_weight_mt: 5, width_mm: 300 },
    ];
    expect(resolveSlitWeightMt(slits[0], 10, slits)).toBe(4.2);
  });

  it('uses planned when actual is missing', () => {
    const slits = [
      { planned_weight_mt: 5, width_mm: 250 },
      { planned_weight_mt: 5, width_mm: 250 },
    ];
    expect(resolveSlitWeightMt(slits[0], 20, slits)).toBe(5);
  });

  it('uses CRS output_wt_mt before planned', () => {
    const slits = [{ output_wt_mt: 3.1, planned_weight_mt: 5, width_mm: 200 }];
    expect(resolveSlitWeightMt(slits[0], 10, slits)).toBe(3.1);
  });

  it('falls back to width share, never full mother weight', () => {
    const slits = [
      { width_mm: 300 },
      { width_mm: 100 },
    ];
    expect(resolveSlitWeightMt(slits[0], 20, slits)).toBe(15);
    expect(resolveSlitWeightMt(slits[1], 20, slits)).toBe(5);
  });

  it('equal-splits when widths are missing (not N×mother)', () => {
    const slits = [{}, {}, {}, {}];
    const weights = slits.map((s) => resolveSlitWeightMt(s, 20, slits));
    expect(weights).toEqual([5, 5, 5, 5]);
    expect(weights.reduce((a, b) => a + (b ?? 0), 0)).toBe(20);
  });
});

describe('resolveSlitThkMm', () => {
  it('uses latest → planned → CRS front → mother', () => {
    expect(resolveSlitThkMm({ thk_latest_mm: 1.8, planned_thk_mm: 2, actual_thk_front_mm: 1.9 }, 2.2)).toBe(1.8);
    expect(resolveSlitThkMm({ planned_thk_mm: 2, actual_thk_front_mm: 1.9 }, 2.2)).toBe(2);
    expect(resolveSlitThkMm({ actual_thk_front_mm: 1.9 }, 2.2)).toBe(1.9);
    expect(resolveSlitThkMm({}, 2.2)).toBe(2.2);
  });
});

describe('widthProportionalShare mass balance', () => {
  it('Σ child weight ≈ mother (± rounding), never N × mother', () => {
    fc.assert(
      fc.property(
        fc.float({ min: Math.fround(0.1), max: Math.fround(80), noNaN: true }),
        fc.array(fc.float({ min: Math.fround(10), max: Math.fround(1500), noNaN: true }), {
          minLength: 1,
          maxLength: 8,
        }),
        (mother, widths) => {
          const slits = widths.map((width_mm) => ({ width_mm }));
          const children = slits.map((s) => widthProportionalShare(s, slits, mother) ?? 0);
          const sum = children.reduce((a, b) => a + b, 0);
          expect(sum).toBeLessThanOrEqual(mother * 1.05 + 0.01);
          expect(sum).toBeGreaterThanOrEqual(mother * 0.95 - 0.01);
          for (const w of children) {
            expect(w).toBeLessThanOrEqual(mother + 0.001);
          }
          if (slits.length > 1) {
            expect(Math.abs(sum - mother * slits.length)).toBeGreaterThan(mother * 0.5);
          }
        },
      ),
      { numRuns: 50 },
    );
  });
});
