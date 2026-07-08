import { describe, it, expect } from 'vitest';

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
});
