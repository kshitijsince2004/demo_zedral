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

  it('routes non-CRM lines to coming soon (6HI-only operator scope)', () => {
    expect(pathForMachine('HRS')).toBe('/coming-soon/HRS');
    expect(pathForMachine('PKL')).toBe('/coming-soon/PKL');
  });

  it('prefers 6HI among CRM assignments', () => {
    expect(preferCrmMachine(['4HI', '6HI', '2HI'])).toBe('6HI');
    expect(preferCrmMachine(['PKL', 'HRS'])).toBe(null);
  });

  it('resolves primary path to CRM mill only', () => {
    expect(resolvePrimaryMachinePath('OPERATOR', ['4HI'], ['HRS'])).toBe('/4hi');
    expect(resolvePrimaryMachinePath('OPERATOR', ['HRS'], ['HRS'])).toBe('/coming-soon/6HI');
    expect(resolvePrimaryMachinePath('OPERATOR', ['6HI', '4HI'], [])).toBe('/6hi');
  });

  it('grants plant head and admin all machines', () => {
    expect(getEffectiveMachineAccess('PLANT_HEAD', [])).toEqual([...MACHINE_OPTIONS]);
    expect(getEffectiveMachineAccess('ADMIN', [])).toEqual([...MACHINE_OPTIONS]);
    expect(canAccessMachine('PLANT_HEAD', [], '4HI')).toBe(true);
    expect(canAccessMachine('OPERATOR', ['4HI'], '6HI')).toBe(false);
  });

  it('builds CRM-only nav items for operators', () => {
    const items = getMachineNavItems('OPERATOR', ['4HI', '6HI', 'HRS'], ['HRS'], 'operator');
    expect(items.map((i) => i.code)).toEqual(['6HI', '4HI']);
    expect(items.every((i) => i.path === '/operator.operator')).toBe(true);
  });

  it('filters CRM machines from assignments', () => {
    expect(filterCrmMachines(['6HI', 'HRS', 'PKL'])).toEqual(['6HI']);
  });
});
