import { describe, it, expect } from 'vitest';
import { pklSchema } from '../src/rules/m1Forms';

describe('PKL coil contract', () => {
  it('accepts W/P + endFilling + repeats', () => {
    const r = pklSchema.safeParse({
      machineCode: 'PKL',
      shiftLogId: '1',
      coilNo: '1100038447-A',
      widthMm: 500,
      thkMm: 2.5,
      weightMt: 8.5,
      ppcWeightMt: 8.5,
      lineSpeedMpm: 40,
      wp: 'W',
      endFilling: true,
      repeats: 0,
      ht: 'X',
    });
    expect(r.success).toBe(true);
  });

  it('rejects invalid wp', () => {
    const r = pklSchema.safeParse({
      machineCode: 'PKL',
      shiftLogId: '1',
      coilNo: 'C1',
      wp: 'X',
    });
    expect(r.success).toBe(false);
  });
});
