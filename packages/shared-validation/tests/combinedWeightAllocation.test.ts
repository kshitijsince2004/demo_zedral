import { describe, expect, it } from 'vitest';
import {
  allocateCombinedRemainderToBlanks,
  allocateCombinedWeight,
  resolveCombinedActualMt,
} from '../src/utils/combinedWeightAllocation';

describe('resolveCombinedActualMt', () => {
  it('sums all entered per-order weights (5 + 5 regression case)', () => {
    expect(resolveCombinedActualMt([5, 5])).toBe(10);
  });

  it('sums distinct per-order actuals', () => {
    expect(resolveCombinedActualMt([5, 2.5])).toBe(7.5);
  });

  it('returns undefined when no weights entered', () => {
    expect(resolveCombinedActualMt([null, undefined])).toBeUndefined();
  });
});

describe('allocateCombinedRemainderToBlanks', () => {
  const targets = [
    { batchNumber: 'A', targetMt: 6 },
    { batchNumber: 'B', targetMt: 4 },
  ];

  it('returns null when all siblings already have weights (no overwrite)', () => {
    const allocation = allocateCombinedRemainderToBlanks(
      [
        { batchNumber: 'A', actualWeightMt: 5 },
        { batchNumber: 'B', actualWeightMt: 5 },
      ],
      targets,
      10,
    );
    expect(allocation).toBeNull();
  });

  it('fills blank sibling from combined total (6 + null, total 10)', () => {
    const allocation = allocateCombinedRemainderToBlanks(
      [
        { batchNumber: 'A', actualWeightMt: 6 },
        { batchNumber: 'B', actualWeightMt: null },
      ],
      targets,
      10,
    );
    expect(allocation?.get('B')).toBe(4);
    expect(allocation?.has('A')).toBe(false);
  });

  it('allocates across all blanks by target (null + null, total 10)', () => {
    const allocation = allocateCombinedRemainderToBlanks(
      [
        { batchNumber: 'A', actualWeightMt: null },
        { batchNumber: 'B', actualWeightMt: null },
      ],
      targets,
      10,
    );
    expect(allocation?.get('B')).toBe(4);
    expect(allocation?.get('A')).toBe(6);
  });

  it('throws when combined total is less than entered sum', () => {
    expect(() => allocateCombinedRemainderToBlanks(
      [
        { batchNumber: 'A', actualWeightMt: 5 },
        { batchNumber: 'B', actualWeightMt: null },
      ],
      targets,
      4,
    )).toThrow(/not greater than already-entered/);
  });

  it('returns null when combined total is omitted and blanks exist', () => {
    const allocation = allocateCombinedRemainderToBlanks(
      [
        { batchNumber: 'A', actualWeightMt: null },
        { batchNumber: 'B', actualWeightMt: null },
      ],
      targets,
      undefined,
    );
    expect(allocation).toBeNull();
  });
});

describe('allocateCombinedWeight', () => {
  it('fills smallest targets first', () => {
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
});
