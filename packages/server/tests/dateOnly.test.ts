import { describe, expect, it } from 'vitest';
import {
  currentPlantDate,
  endOfDateFilter,
  formatDateOnly,
  parseDateOnly,
  postgresDateOnly,
  startOfDateFilter,
} from '../src/utils/dateOnly';

describe('dateOnly helpers', () => {
  it('parses YYYY-MM-DD at IST midnight', () => {
    const date = parseDateOnly('2026-07-07');

    expect(date.toISOString()).toBe('2026-07-06T18:30:00.000Z');
    expect(formatDateOnly(date)).toBe('2026-07-07');
  });

  it('normalizes start and end of date filters in IST', () => {
    const start = startOfDateFilter('2026-07-07');
    const end = endOfDateFilter('2026-07-07');

    expect(start.toISOString()).toBe('2026-07-06T18:30:00.000Z');
    expect(end.toISOString()).toBe('2026-07-07T18:29:59.999Z');
  });

  it('returns a YYYY-MM-DD plant date string', () => {
    expect(currentPlantDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('postgresDateOnly keeps calendar day for Postgres DATE on UTC hosts', () => {
    expect(postgresDateOnly('2026-06-15')).toBe('2026-06-15');
    expect(postgresDateOnly(parseDateOnly('2026-06-15'))).toBe('2026-06-15');
  });
});
