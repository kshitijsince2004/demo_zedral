import { describe, it, expect } from 'vitest';
import { lineAccessFromMachines } from '../src/services/MachineAccessService';
import { normalizeRoles } from '@m1/shared-validation';

describe('lineAccessFromMachines', () => {
  it('maps CRM mills to ROLLING process', () => {
    expect(lineAccessFromMachines(['6HI'])).toEqual([{ line_id: 'ROLLING', level: 'WRITE' }]);
    expect(lineAccessFromMachines(['4HI', '2HI'])).toEqual([{ line_id: 'ROLLING', level: 'WRITE' }]);
    expect(lineAccessFromMachines(['6HI', '4HI', '2HI'])).toEqual([
      { line_id: 'ROLLING', level: 'WRITE' },
    ]);
  });

  it('keeps non-CRM machines as their own line codes', () => {
    expect(lineAccessFromMachines(['HRS', 'PKL'])).toEqual([
      { line_id: 'HRS', level: 'WRITE' },
      { line_id: 'PKL', level: 'WRITE' },
    ]);
  });

  it('dedupes ROLLING when CRM and non-CRM mixed', () => {
    expect(lineAccessFromMachines(['4HI', 'HRS', '6hi'])).toEqual([
      { line_id: 'ROLLING', level: 'WRITE' },
      { line_id: 'HRS', level: 'WRITE' },
    ]);
  });
});

describe('plant-wide viewer roles for machine-access/me', () => {
  it('classifies SUPERVISOR with PH/Admin as plant-wide', () => {
    const plantWide = (roles: string[]) => {
      const n = normalizeRoles(roles);
      return (
        n.includes('PLANT_HEAD') || n.includes('ADMIN') || n.includes('SUPERVISOR')
      );
    };
    expect(plantWide(['SUPERVISOR'])).toBe(true);
    expect(plantWide(['MACHINE_HEAD'])).toBe(false);
    expect(plantWide(['OPERATOR'])).toBe(false);
  });
});
