import { describe, it, expect } from 'vitest';
import { canCompleteOutgoingHandover } from '../src/validation/manufacturingValidation';
import { DEFAULT_PLANT_SHIFT_WINDOWS, plantClockDate } from '@m1/shared-validation';

/** Mirrors SixHiService.earlierShiftCodesOnSameDay for unit testing. */
function earlierShiftCodesOnSameDay(shiftCode: string): string[] {
  const order = ['A', 'B', 'C'];
  const idx = order.indexOf(shiftCode.toUpperCase());
  if (idx <= 0) return [];
  return order.slice(0, idx);
}

/** Mirrors MachineHandoverService.normalizeHandoverPriority. */
function normalizeHandoverPriority(priority?: string): 'LOW' | 'MEDIUM' | 'HIGH' {
  if (priority === 'LOW') return 'LOW';
  if (priority === 'HIGH' || priority === 'CRITICAL') return 'HIGH';
  return 'MEDIUM';
}

describe('shift handover helpers', () => {
  describe('earlierShiftCodesOnSameDay', () => {
    it('returns no earlier shifts for shift A', () => {
      expect(earlierShiftCodesOnSameDay('A')).toEqual([]);
    });

    it('returns A for shift B', () => {
      expect(earlierShiftCodesOnSameDay('B')).toEqual(['A']);
    });

    it('returns A and B for shift C', () => {
      expect(earlierShiftCodesOnSameDay('C')).toEqual(['A', 'B']);
    });
  });

  describe('normalizeHandoverPriority', () => {
    it('maps NORMAL to MEDIUM', () => {
      expect(normalizeHandoverPriority('NORMAL')).toBe('MEDIUM');
    });

    it('maps CRITICAL to HIGH', () => {
      expect(normalizeHandoverPriority('CRITICAL')).toBe('HIGH');
    });

    it('preserves LOW and HIGH', () => {
      expect(normalizeHandoverPriority('LOW')).toBe('LOW');
      expect(normalizeHandoverPriority('HIGH')).toBe('HIGH');
    });
  });

  describe('canCompleteOutgoingHandover', () => {
    const shiftB = {
      shiftCode: 'B',
      prodDate: '2026-07-09',
      windowStart: '14:00',
      windowEnd: '22:00',
    };

    it('blocks before scheduled shift end while clock is still on the same shift', () => {
      const at = plantClockDate('2026-07-09', '18:00');
      expect(canCompleteOutgoingHandover(shiftB, DEFAULT_PLANT_SHIFT_WINDOWS, at)).toBe(false);
    });

    it('allows after scheduled shift end', () => {
      const at = plantClockDate('2026-07-09', '22:05');
      expect(canCompleteOutgoingHandover(shiftB, DEFAULT_PLANT_SHIFT_WINDOWS, at)).toBe(true);
    });

    it('allows when wall clock has moved to the next shift', () => {
      const at = plantClockDate('2026-07-09', '22:30');
      expect(canCompleteOutgoingHandover(shiftB, DEFAULT_PLANT_SHIFT_WINDOWS, at)).toBe(true);
    });
  });
});
