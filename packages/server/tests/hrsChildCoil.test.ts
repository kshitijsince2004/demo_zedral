import { describe, expect, it } from 'vitest';
import { derivedChildCoilNo } from '../src/utils/childCoil';

describe('derivedChildCoilNo', () => {
  it('mints mother-slot identity used by prod_hrs_slit FK', () => {
    expect(derivedChildCoilNo('1100038447', 'a')).toBe('1100038447-A');
    expect(derivedChildCoilNo('1100038447', ' 1 ')).toBe('1100038447-1');
  });
});
