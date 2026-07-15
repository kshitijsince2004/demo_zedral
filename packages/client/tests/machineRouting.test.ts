import { describe, it, expect } from 'vitest';
import {
  pathForMachine,
  resolvePrimaryMachinePath,
  getEffectiveMachineAccess,
  canAccessMachine,
  getMachineNavItems,
  preferCrmMachine,
  filterCrmMachines,
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

  it('routes non-CRM lines to process capture', () => {
    expect(pathForMachine('HRS')).toBe('/capture/HRS');
    expect(pathForMachine('PKL')).toBe('/capture/PKL');
  });

  it('prefers 6HI among CRM assignments', () => {
    expect(preferCrmMachine(['4HI', '6HI', '2HI'])).toBe('6HI');
    expect(preferCrmMachine(['PKL', 'HRS'])).toBe(null);
  });

  it('lands 4HI-only and 2HI-only operators on their mill (does not force 6HI)', () => {
    expect(preferCrmMachine(['4HI'])).toBe('4HI');
    expect(preferCrmMachine(['2HI'])).toBe('2HI');
    expect(preferCrmMachine(['4HI', '2HI'])).toBe('4HI');
    expect(resolvePrimaryMachinePath('OPERATOR', ['4HI'], [])).toBe('/4hi');
    expect(resolvePrimaryMachinePath('OPERATOR', ['2HI'], [])).toBe('/2hi');
  });

  it('resolves primary path to CRM first, then process capture', () => {
    expect(resolvePrimaryMachinePath('OPERATOR', ['4HI'], ['HRS'])).toBe('/4hi');
    expect(resolvePrimaryMachinePath('OPERATOR', ['HRS'], ['HRS'])).toBe('/capture/HRS');
    expect(resolvePrimaryMachinePath('OPERATOR', ['6HI', '4HI'], [])).toBe('/6hi');
  });

  it('grants plant head and admin all machines', () => {
    expect(getEffectiveMachineAccess('PLANT_HEAD', [])).toEqual([...MACHINE_OPTIONS]);
    expect(getEffectiveMachineAccess('ADMIN', [])).toEqual([...MACHINE_OPTIONS]);
    expect(canAccessMachine('PLANT_HEAD', [], '4HI')).toBe(true);
    expect(canAccessMachine('OPERATOR', ['4HI'], '6HI')).toBe(false);
  });

  it('builds all-machine nav items with CRM first', () => {
    const items = getMachineNavItems('OPERATOR', ['4HI', '6HI', 'HRS'], ['HRS'], 'operator');
    expect(items.map((i) => i.code)).toEqual(['6HI', '4HI', 'HRS']);
    expect(items.map((i) => i.path)).toEqual(['/operator.operator', '/operator.operator', '/capture/HRS']);
  });

  it('filters CRM machines from assignments', () => {
    expect(filterCrmMachines(['6HI', 'HRS', 'PKL'])).toEqual(['6HI']);
  });
});
