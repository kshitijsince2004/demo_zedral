import { describe, expect, it } from 'vitest';
import {
  currentPlantDate,
  endOfDateFilter,
  formatDateOnly,
  parseDateOnly,
  startOfDateFilter,
} from '../src/utils/dateOnly';

describe('dateOnly helpers', () => {
  it('parses YYYY-MM-DD as a local calendar date', () => {
    const date = parseDateOnly('2026-07-07');

    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(6);
    expect(date.getDate()).toBe(7);
    expect(formatDateOnly(date)).toBe('2026-07-07');
  });

  it('normalizes start and end of date filters', () => {
    const start = startOfDateFilter('2026-07-07');
    const end = endOfDateFilter('2026-07-07');

    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);
    expect(end.getHours()).toBe(23);
    expect(end.getMinutes()).toBe(59);
    expect(end.getSeconds()).toBe(59);
    expect(end.getMilliseconds()).toBe(999);
  });

  it('returns a YYYY-MM-DD plant date string', () => {
    expect(currentPlantDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
