import { describe, it, expect } from 'vitest';
import { ANN_BASE_REQUIRED_MSG, annCreateStatus, assertAnnBaseAssigned } from '../src/lib/annBaseAssignment';

describe('ANN base assignment rules', () => {
  it('creates PREPARING when base is missing and IN_PROCESS when present', () => {
    expect(annCreateStatus(undefined)).toBe('PREPARING');
    expect(annCreateStatus('')).toBe('PREPARING');
    expect(annCreateStatus('AB01')).toBe('IN_PROCESS');
  });

  it('blocks start without a base', () => {
    expect(() => assertAnnBaseAssigned(null)).toThrow(ANN_BASE_REQUIRED_MSG);
    expect(assertAnnBaseAssigned('ab01')).toBe('AB01');
  });
});
