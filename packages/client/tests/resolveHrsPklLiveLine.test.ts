import { describe, expect, it } from 'vitest';
import {
  isPklMhDesk,
  isHrsMhDesk,
  resolveHrsPklLiveLine,
} from '../src/lib/pklMhDesk';

describe('HRS MH must not open PKL from stale focus', () => {
  it('resolveHrsPklLiveLine ignores PKL focus when only HRS assigned', () => {
    expect(resolveHrsPklLiveLine(['HRS'], 'PKL')).toBe('HRS');
  });

  it('isPklMhDesk is false for HRS-only even with focus PKL', () => {
    expect(isPklMhDesk(['HRS'], 'PKL')).toBe(false);
  });

  it('isHrsMhDesk is true for HRS-only with stale PKL focus', () => {
    expect(isHrsMhDesk(['HRS'], 'PKL')).toBe(true);
  });

  it('PKL-only with HRS focus resolves to PKL', () => {
    expect(resolveHrsPklLiveLine(['PKL'], 'HRS')).toBe('PKL');
    expect(isHrsMhDesk(['PKL'], 'HRS')).toBe(false);
  });
});
