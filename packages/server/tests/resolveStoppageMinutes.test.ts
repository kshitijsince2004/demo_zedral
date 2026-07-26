import { describe, expect, it } from 'vitest';
import {
  isBreakdownStoppageCategory,
  resolveStoppageMinutes,
} from '../src/validation/manufacturingValidation';

describe('resolveStoppageMinutes', () => {
  it('prefers stored duration when positive', () => {
    const start = new Date('2026-07-26T10:00:00Z');
    const end = new Date('2026-07-26T10:05:00Z');
    expect(resolveStoppageMinutes(start, end, 12)).toBe(12);
  });

  it('computes from timestamps when stored is 0/null', () => {
    const start = new Date('2026-07-26T10:00:00Z');
    const end = new Date('2026-07-26T10:05:00Z');
    expect(resolveStoppageMinutes(start, end, 0)).toBe(5);
    expect(resolveStoppageMinutes(start, end, null)).toBe(5);
  });

  it('rounds short stops to at least 1 minute', () => {
    const start = new Date('2026-07-26T10:00:00Z');
    const end = new Date('2026-07-26T10:00:20Z');
    expect(resolveStoppageMinutes(start, end, 0)).toBe(1);
  });
});

describe('isBreakdownStoppageCategory', () => {
  it('matches BREAKDOWN or requires_breakdown_code', () => {
    expect(isBreakdownStoppageCategory('BREAKDOWN')).toBe(true);
    expect(isBreakdownStoppageCategory('01', true)).toBe(true);
    expect(isBreakdownStoppageCategory('12', false)).toBe(false);
  });
});
