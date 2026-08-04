import { describe, it, expect } from 'vitest';
import { hrsSchema } from '../src/rules/m1Forms';
import { crsMassBalanceWarn } from '../src/utils/calculationEngine';

describe('HRS fan-out contract', () => {
  it('accepts >4 dynamic slots', () => {
    const slots = ['A', 'B', 'C', 'D', 'E', 'F'].map((slot) => ({
      slot,
      targetWidthMm: 100,
      plannedWeightMt: 1,
      routeRaw: 'SP4RFXCLE',
      thicknessReadings: [{ time: '10:00', thkMm: 2.5 }],
      taperReadings: [{ time: '10:05', taper: 'OK' }],
      thkLatestMm: 2.5,
      taperLatest: 'OK',
    }));
    const parsed = hrsSchema.safeParse({
      machineCode: 'HRS',
      shiftLogId: '1',
      coilNo: '1100038447',
      motherCoilWeightMt: 6,
      weightMt: 6,
      scrapMt: 0,
      motherWidthReadings: [{ time: '09:55', widthMm: 1250 }],
      actualWidthMm: 1250,
      slitSlots: slots,
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects zero mother width readings (operator empty-input bug)', () => {
    const parsed = hrsSchema.safeParse({
      machineCode: 'HRS',
      shiftLogId: '1',
      coilNo: 'HRS-COIL-001',
      actualWidthMm: 0,
      motherWidthReadings: [{ time: '20:26', widthMm: 0 }],
      slitSlots: [{ slot: 'A', targetWidthMm: 100, routeRaw: 'HOLD' }],
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const paths = parsed.error.issues.map((i) => i.path.join('.'));
      expect(paths.some((p) => p.includes('actualWidthMm') || p.includes('widthMm'))).toBe(true);
    }
  });

  it('mass-balances Σ line + scrap ≈ mother', () => {
    expect(crsMassBalanceWarn(23.22, [8.86, 6.67, 7.69], 0)).toBe(false);
    expect(crsMassBalanceWarn(23.22, [5, 5, 5], 0)).toBe(true);
  });
});
