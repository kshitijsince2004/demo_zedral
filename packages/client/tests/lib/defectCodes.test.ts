import { describe, expect, it } from 'vitest';
import {
  defectCodeSortKey,
  resolveDefectCodes,
  sortDefectCodes,
  withOtherDefectOption,
  DEFECT_OTHER_CODE,
} from '../../src/lib/defectCodes';
import type { MasterDefectCode } from '@m1/shared-validation';

describe('defectCodes', () => {
  it('sorts numeric defect codes in natural order', () => {
    const input: MasterDefectCode[] = [
      { defectCode: '10', defectName: 'Roll Mark', category: null, isActive: true },
      { defectCode: '2', defectName: 'Edge Cut', category: null, isActive: true },
      { defectCode: '1', defectName: 'Gauge Variation', category: null, isActive: true },
    ];
    expect(sortDefectCodes(input).map((d) => d.defectCode)).toEqual(['1', '2', '10']);
  });

  it('uses numeric keys for plain-number codes', () => {
    expect(defectCodeSortKey('45')).toBe(45);
    expect(defectCodeSortKey('9')).toBe(9);
  });

  it('appends Other after sorted master codes', () => {
    const codes = withOtherDefectOption([
      { defectCode: '3', defectName: 'Slivers', category: null, isActive: true },
      { defectCode: '1', defectName: 'Gauge Variation', category: null, isActive: true },
    ]);
    expect(codes.map((c) => c.defectCode)).toEqual(['1', '3', 'OTHER']);
  });

  it('normalizes snake_case API rows', () => {
    const resolved = resolveDefectCodes([
      { defect_code: '2', description: 'Edge Cut', is_active: true },
    ]);
    expect(resolved.some((d) => d.defectCode === '2' && d.defectName === 'Edge Cut')).toBe(true);
    expect(resolved.some((d) => d.defectCode === DEFECT_OTHER_CODE)).toBe(true);
  });

  it('returns only Other when API payload is empty', () => {
    const resolved = resolveDefectCodes([]);
    expect(resolved).toEqual([
      {
        defectCode: DEFECT_OTHER_CODE,
        defectName: 'Other',
        category: null,
        isActive: true,
      },
    ]);
  });
});
