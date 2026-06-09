import { describe, it, expect } from 'vitest';
import {
  pathForMachine,
  resolvePrimaryMachinePath,
  getEffectiveMachineAccess,
  canAccessMachine,
  getMachineNavItems,
} from '../src/lib/machineRouting';
import { MACHINE_OPTIONS } from '../src/lib/accessOptions';

describe('machineRouting', () => {
  it('routes CRM mills to user scope when username provided', () => {
    expect(pathForMachine('6HI', { username: 'operator', role: 'OPERATOR' })).toBe('/operator.operator');
    expect(pathForMachine('4HI', { username: 'operator', role: 'OPERATOR' })).toBe('/operator.operator');
  });

  it('routes CRM mills to legacy paths without username', () => {
    expect(pathForMachine('6HI')).toBe('/6hi');
    expect(pathForMachine('4HI')).toBe('/4hi');
  });

  it('routes built shift lines to shift-log capture', () => {
    expect(pathForMachine('HRS')).toBe('/shift-log/HRS');
    expect(pathForMachine('PKL')).toBe('/shift-log/PKL');
  });

  it('routes unbuilt machines to coming soon', () => {
    expect(pathForMachine('UNKNOWN')).toBe('/coming-soon/UNKNOWN');
  });

  it('uses first assigned machine — not 6HI by default', () => {
    expect(resolvePrimaryMachinePath('OPERATOR', ['4HI'], ['6HI'])).toBe('/4hi');
    expect(resolvePrimaryMachinePath('OPERATOR', ['2HI', '6HI'], ['6HI'])).toBe('/2hi');
    expect(resolvePrimaryMachinePath('OPERATOR', ['HRS'], ['HRS'])).toBe('/shift-log/HRS');
  });

  it('grants plant head and admin all machines', () => {
    expect(getEffectiveMachineAccess('PLANT_HEAD', [])).toEqual([...MACHINE_OPTIONS]);
    expect(getEffectiveMachineAccess('ADMIN', [])).toEqual([...MACHINE_OPTIONS]);
    expect(canAccessMachine('PLANT_HEAD', [], '4HI')).toBe(true);
    expect(canAccessMachine('OPERATOR', ['4HI'], '6HI')).toBe(false);
  });

  it('builds nav items pointing to user scope for CRM', () => {
    const items = getMachineNavItems('OPERATOR', ['4HI', '6HI'], ['6HI'], 'operator');
    expect(items.map((i) => i.path)).toEqual(['/operator.operator', '/operator.operator']);
  });
});
