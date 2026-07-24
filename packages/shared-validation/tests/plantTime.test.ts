import { describe, expect, it } from 'vitest';
import {
  addPlantDays,
  DEFAULT_PLANT_SHIFT_WINDOWS,
  endOfPlantDay,
  formatPlantChartDay,
  formatPlantDate,
  formatPlantTime,
  nextPlantShift,
  parsePlantDateOnly,
  plantClockDate,
  plantDaysBetween,
  plantWallClock,
  resolveShiftFromClock,
  startOfPlantDay,
} from '../src/utils/plantTime';

describe('plantTime', () => {
  it('formats UTC instants on the IST calendar', () => {
    // 2026-07-08 22:30 UTC = 2026-07-09 04:00 IST
    const instant = new Date('2026-07-08T22:30:00.000Z');
    expect(formatPlantDate(instant)).toBe('2026-07-09');
  });

  it('parses date-only values at IST midnight', () => {
    const d = parsePlantDateOnly('2026-07-09');
    expect(d.toISOString()).toBe('2026-07-08T18:30:00.000Z');
  });

  it('adds calendar days in IST', () => {
    expect(addPlantDays('2026-07-09', 1)).toBe('2026-07-10');
    expect(addPlantDays('2026-07-09', -1)).toBe('2026-07-08');
  });

  it('builds clock times on a plant date', () => {
    const at = plantClockDate('2026-07-09', '14:00');
    expect(at.toISOString()).toBe('2026-07-09T08:30:00.000Z');
  });

  it('exposes IST wall clock through plantWallClock', () => {
    const instant = new Date('2026-07-09T08:30:00.000Z'); // 14:00 IST
    const wall = plantWallClock(instant);
    expect(wall.getFullYear()).toBe(2026);
    expect(wall.getMonth()).toBe(6);
    expect(wall.getDate()).toBe(9);
    expect(wall.getHours()).toBe(14);
    expect(wall.getMinutes()).toBe(0);
  });

  it('resolves overnight shift C before 06:00 on prior prod date', () => {
    const at = plantClockDate('2026-06-09', '03:00');
    const hit = resolveShiftFromClock(DEFAULT_PLANT_SHIFT_WINDOWS, at);
    expect(hit.shiftCode).toBe('C');
    expect(hit.prodDate).toBe('2026-06-08');
  });

  it('computes plant calendar day differences', () => {
    expect(plantDaysBetween('2026-07-08', '2026-07-09')).toBe(1);
    expect(plantDaysBetween('2026-07-09', '2026-07-09')).toBe(0);
  });

  it('advances shift codes on the plant calendar', () => {
    expect(nextPlantShift('A', '2026-07-09')).toEqual({ shiftCode: 'B', prodDate: '2026-07-09' });
    expect(nextPlantShift('C', '2026-07-09')).toEqual({ shiftCode: 'A', prodDate: '2026-07-10' });
  });

  it('formats HH:MM on the plant clock (not UTC)', () => {
    // 14:00 IST = 08:30 UTC
    expect(formatPlantTime(new Date('2026-07-09T08:30:00.000Z'))).toBe('14:00');
  });

  it('uses IST day bounds (not UTC midnight)', () => {
    expect(startOfPlantDay('2026-07-07').toISOString()).toBe('2026-07-06T18:30:00.000Z');
    expect(endOfPlantDay('2026-07-07').toISOString()).toBe('2026-07-07T18:29:59.999Z');
  });

  it('formats chart day labels on the IST calendar (not UTC weekday-only)', () => {
    // YYYY-MM-DD must not be parsed as UTC midnight then shown as previous weekday.
    const label = formatPlantChartDay('2026-07-08');
    expect(label).toMatch(/8/);
    expect(label).toMatch(/Jul/i);
    expect(label.toLowerCase()).toMatch(/wed/);
  });
});
