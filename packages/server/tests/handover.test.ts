import { describe, it, expect } from 'vitest';
import { ShiftLogService } from '../src/services/shiftLogService';
import { formatPlantDate, parsePlantDateOnly } from '@m1/shared-validation';

describe('ShiftLogService handover helpers', () => {
  describe('getNextShift', () => {
    it('advances A → B on same date', () => {
      const date = parsePlantDateOnly('2025-06-01');
      const next = ShiftLogService.getNextShift('A', date);
      expect(next.nextShiftCode).toBe('B');
      expect(formatPlantDate(next.nextProdDate)).toBe('2025-06-01');
    });

    it('advances B → C on same date', () => {
      const date = parsePlantDateOnly('2025-06-01');
      const next = ShiftLogService.getNextShift('B', date);
      expect(next.nextShiftCode).toBe('C');
    });

    it('advances C → A and rolls date forward', () => {
      const date = parsePlantDateOnly('2025-06-01');
      const next = ShiftLogService.getNextShift('C', date);
      expect(next.nextShiftCode).toBe('A');
      expect(formatPlantDate(next.nextProdDate)).toBe('2025-06-02');
    });

    it('keeps G shift code unchanged', () => {
      const date = parsePlantDateOnly('2025-06-01');
      const next = ShiftLogService.getNextShift('G', date);
      expect(next.nextShiftCode).toBe('G');
    });
  });

  describe('getProcessTable', () => {
    it('maps all documented process IDs', () => {
      expect(ShiftLogService.getProcessTable(1)).toBe('txn.prod_hrs');
      expect(ShiftLogService.getProcessTable(4)).toBe('txn.ann_charge');
      expect(ShiftLogService.getProcessTable(9)).toBe('txn.prod_glv');
      expect(ShiftLogService.getProcessTable(99)).toBeNull();
    });
  });
});
