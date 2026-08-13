import { describe, expect, it } from 'vitest';
import {
  asDisplayText,
  combinedRunKey,
  displayMotherCoilId,
  finishGroupOf,
  isCompatibleCombinedRunOrder,
} from '../../src/lib/sixHiOrderIdentity';

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

  it('unwraps prefill { value } and snake_case instead of rendering [object Object]', () => {
    expect(asDisplayText({ value: '1100038319' })).toBe('1100038319');
    expect(asDisplayText({ coil_no: '1100038319' })).toBe('1100038319');
    expect(asDisplayText({ nested: true })).toBe('');
    expect(displayMotherCoilId({
      motherCoil: { value: '1100038319' },
      slitId: { value: 'A' },
      batchNumber: { value: 'B-1' },
    })).toBe('1100038319 A');
    expect(displayMotherCoilId({
      coil_no: '1100038348',
      slit_id: 'B',
    })).toBe('1100038348 B');
  });

  it('renders coil alone when no slit', () => {
    expect(displayMotherCoilId({ motherCoil: '1100038348', batchNumber: 'B-1' })).toBe('1100038348');
  });

  it('accepts motherCoilNo (process module)', () => {
    expect(displayMotherCoilId({ motherCoilNo: '1100038348', batchNumber: 'B-1', slitId: 'A' })).toBe(
      '1100038348 A',
    );
  });

  it('accepts displayCoilNo (process/rewinding)', () => {
    expect(displayMotherCoilId({ displayCoilNo: '1100038348', batchNumber: 'B-1', slitId: 'A' })).toBe(
      '1100038348 A',
    );
  });

  it('does not double-append when displayCoilNo already embeds the slit', () => {
    expect(
      displayMotherCoilId({ displayCoilNo: '1100038348 A', batchNumber: 'B-1', slitId: 'A' }),
    ).toBe('1100038348 A');
    expect(
      displayMotherCoilId({ displayCoilNo: '1100038348 a', batchNumber: 'B-1', slitId: 'A' }),
    ).toBe('1100038348 a');
  });

  it('treats dash/empty/em-dash slit as no slit', () => {
    expect(displayMotherCoilId({ motherCoil: '1100038348', batchNumber: 'B-1', slitId: '-' })).toBe(
      '1100038348',
    );
    expect(displayMotherCoilId({ motherCoil: '1100038348', batchNumber: 'B-1', slitId: '—' })).toBe(
      '1100038348',
    );
    expect(displayMotherCoilId({ motherCoil: '1100038348', batchNumber: 'B-1', slitId: '  ' })).toBe(
      '1100038348',
    );
    expect(displayMotherCoilId({ motherCoil: '1100038348', batchNumber: 'B-1', slitId: null })).toBe(
      '1100038348',
    );
  });

  it('uppercases slit token', () => {
    expect(displayMotherCoilId({ motherCoil: '1100038348', batchNumber: 'B-1', slitId: 'a' })).toBe(
      '1100038348 A',
    );
  });
});

describe('combinedRunKey — Coil+Slit+Finish family (no thickness)', () => {
  it('folds LOW_MATT and MATT into the same finish family', () => {
    expect(finishGroupOf('LOW_MATT')).toBe('MATT');
    expect(finishGroupOf('MATT')).toBe('MATT');
    expect(finishGroupOf('MIRROR')).toBe('BRIGHT');
    expect(finishGroupOf('BRIGHT')).toBe('BRIGHT');
  });

  it('matches orders that differ only by thickness', () => {
    const a = {
      batchNumber: 'B1',
      motherCoil: 'COIL1',
      slitId: 'A',
      rollFinish: 'MATT' as const,
      targetThkMm: 0.5,
      finishThkMm: 0.5,
    };
    const b = {
      batchNumber: 'B2',
      motherCoil: 'COIL1',
      slitId: 'A',
      rollFinish: 'LOW_MATT' as const,
      targetThkMm: 0.8,
      finishThkMm: 0.8,
    };
    expect(combinedRunKey(a)).toBe(combinedRunKey(b));
    expect(isCompatibleCombinedRunOrder(a, b)).toBe(true);
  });

  it('rejects different slit or coil', () => {
    const base = {
      batchNumber: 'B1',
      motherCoil: 'COIL1',
      slitId: 'A',
      rollFinish: 'BRIGHT' as const,
      targetThkMm: 0.5,
      finishThkMm: 0.5,
    };
    expect(
      isCompatibleCombinedRunOrder(base, { ...base, slitId: 'B', batchNumber: 'B2' }),
    ).toBe(false);
    expect(
      isCompatibleCombinedRunOrder(base, { ...base, motherCoil: 'COIL2', batchNumber: 'B3' }),
    ).toBe(false);
  });
});
