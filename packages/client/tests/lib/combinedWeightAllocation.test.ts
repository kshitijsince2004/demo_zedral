import { describe, expect, it } from 'vitest';
import {
  allocateCombinedWeight,
  combinedTargetMt,
  resolveCombinedActualMt,
} from '../../src/lib/combinedWeightAllocation';

describe('combinedWeightAllocation', () => {
  it('sums combined target weights', () => {
    expect(combinedTargetMt([{ targetMt: 5 }, { targetMt: 3 }])).toBe(8);
  });

  it('treats equal per-order actuals as legacy combined total', () => {
    expect(resolveCombinedActualMt([7.5, 7.5])).toBe(7.5);
  });

  it('sums distinct per-order actuals', () => {
    expect(resolveCombinedActualMt([5, 2.5])).toBe(7.5);
  });

  it('fills smallest targets first when allocating combined weight', () => {
    const allocation = allocateCombinedWeight(
      [
        { batchNumber: 'A', targetMt: 5 },
        { batchNumber: 'B', targetMt: 3 },
      ],
      7.5,
    );
    expect(allocation.get('B')).toBe(3);
    expect(allocation.get('A')).toBe(4.5);
  });

  it('allocates across three orders without exceeding targets', () => {
    const allocation = allocateCombinedWeight(
      [
        { batchNumber: 'A', targetMt: 2 },
        { batchNumber: 'B', targetMt: 3 },
        { batchNumber: 'C', targetMt: 5 },
      ],
      8,
    );
    expect(allocation.get('A')).toBe(2);
    expect(allocation.get('B')).toBe(3);
    expect(allocation.get('C')).toBe(3);
    expect([...allocation.values()].reduce((s, v) => s + v, 0)).toBe(8);
  });

  it('returns zeros when combined actual is missing', () => {
    const allocation = allocateCombinedWeight(
      [{ batchNumber: 'A', targetMt: 5 }],
      0,
    );
    expect(allocation.get('A')).toBe(0);
  });
});
