import { describe, expect, it } from 'vitest';
import { formatPlantClock } from '../src/lib/dateFormat';

describe('formatPlantClock', () => {
  it('formats instants as HH:MM in IST', () => {
    expect(formatPlantClock('2026-07-09T08:30:00.000Z')).toBe('14:00');
  });

  it('returns fallback for missing values', () => {
    expect(formatPlantClock(null)).toBe('—');
    expect(formatPlantClock(undefined, 'n/a')).toBe('n/a');
  });
});
