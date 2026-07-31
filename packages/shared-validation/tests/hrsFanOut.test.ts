import { describe, it, expect } from 'vitest';
import { hrsSchema } from '../src/rules/m1Forms';
import { crsMassBalanceWarn } from '../src/utils/calculationEngine';

describe('HRS fan-out contract', () => {
  it('accepts >4 dynamic slots', () => {
    const slots = ['A', 'B', 'C', 'D', 'E', 'F'].map((slot) => ({
      slot,
      targetWidthMm: 100,
      actualWidthMm: 100,
      routeRaw: 'SP4RFXCLE',
      actualWeightMt: 1,
    }));
    const parsed = hrsSchema.safeParse({
      machineCode: 'HRS',
      shiftLogId: '1',
      coilNo: '1100038447',
      motherCoilWeightMt: 6,
      weightMt: 6,
      scrapMt: 0,
      slitSlots: slots,
    });
    expect(parsed.success).toBe(true);
  });

  it('mass-balances Σ line + scrap ≈ mother', () => {
    expect(crsMassBalanceWarn(23.22, [8.86, 6.67, 7.69], 0)).toBe(false);
    expect(crsMassBalanceWarn(23.22, [5, 5, 5], 0)).toBe(true);
  });
});
