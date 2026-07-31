import { describe, it, expect } from 'vitest';
import { crsMassBalanceWarn } from '../src/utils/calculationEngine';

describe('crsMassBalanceWarn', () => {
  it('passes when sum ≈ input within 2%', () => {
    expect(crsMassBalanceWarn(10, [4, 5.8], 0.2, 0)).toBe(false);
  });

  it('warns when imbalance exceeds tolerance', () => {
    expect(crsMassBalanceWarn(10, [3, 3], 0, 0)).toBe(true);
  });
});
