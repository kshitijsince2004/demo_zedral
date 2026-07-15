import { describe, expect, it } from 'vitest';
import { displayMotherCoilId } from '../../src/lib/sixHiOrderIdentity';

describe('displayMotherCoilId — Operator / MH / PH parity', () => {
  it('renders Mother Coil + Slit the same across profile DTO shapes', () => {
    const operator = { batchNumber: 'B-100', motherCoil: '1100038319', slitId: 'A' };
    const mhLive = {
      batchNumber: 'B-100',
      coilNo: '1100038319',
      motherCoil: '1100038319',
      slitId: 'A',
    };
    const phTrace = {
      batchNumber: 'B-100',
      coilNo: '1100038319',
      motherCoil: '1100038319',
      slitId: 'A',
    };

    expect(displayMotherCoilId(operator)).toBe('1100038319 A');
    expect(displayMotherCoilId(mhLive)).toBe(displayMotherCoilId(operator));
    expect(displayMotherCoilId(phTrace)).toBe(displayMotherCoilId(operator));
  });

  it('falls back to coilNo then batchNumber when motherCoil is absent', () => {
    expect(displayMotherCoilId({ batchNumber: 'B-1', coilNo: '1100038319', slitId: 'B' })).toBe(
      '1100038319 B',
    );
    expect(displayMotherCoilId({ batchNumber: 'B-1' })).toBe('B-1');
  });
});
