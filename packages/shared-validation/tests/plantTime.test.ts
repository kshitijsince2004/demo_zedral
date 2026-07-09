import { describe, expect, it } from 'vitest';
import {
  addPlantDays,
  formatPlantDate,
  parsePlantDateOnly,
  plantClockDate,
  plantWallClock,
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
});
