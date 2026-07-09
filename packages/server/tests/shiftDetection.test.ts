import { describe, it, expect } from 'vitest';
import { plantClockDate } from '@m1/shared-validation';
import { resolveShiftFromClock } from '../src/services/ShiftDetectionService';

const WINDOWS = [
  { shift_code: 'A', name: 'Shift A', start_time: '06:00', end_time: '14:00' },
  { shift_code: 'B', name: 'Shift B', start_time: '14:00', end_time: '22:00' },
  { shift_code: 'C', name: 'Shift C', start_time: '22:00', end_time: '06:00' },
];

describe('resolveShiftFromClock', () => {
  it('detects Shift A during morning window', () => {
    const at = plantClockDate('2026-06-08', '08:30');
    const r = resolveShiftFromClock(WINDOWS, at);
    expect(r.shiftCode).toBe('A');
    expect(r.prodDate).toBe('2026-06-08');
  });

  it('detects Shift B at 14:00 boundary', () => {
    const at = plantClockDate('2026-06-08', '14:00');
    const r = resolveShiftFromClock(WINDOWS, at);
    expect(r.shiftCode).toBe('B');
  });

  it('detects Shift C after 22:00', () => {
    const at = plantClockDate('2026-06-08', '23:00');
    const r = resolveShiftFromClock(WINDOWS, at);
    expect(r.shiftCode).toBe('C');
    expect(r.prodDate).toBe('2026-06-08');
  });

  it('detects Shift C before 06:00 on previous prod date', () => {
    const at = plantClockDate('2026-06-09', '03:00');
    const r = resolveShiftFromClock(WINDOWS, at);
    expect(r.shiftCode).toBe('C');
    expect(r.prodDate).toBe('2026-06-08');
  });
});
