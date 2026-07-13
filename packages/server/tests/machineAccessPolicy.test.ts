import { describe, it, expect } from 'vitest';
import {
  assertMachineAccess,
  isMachineAccessForbidden,
  MachineAccessForbiddenError,
} from '../src/auth/machineAccessPolicy';
import type { AuthUser } from '../src/services/authService';

const operator6Hi: AuthUser = {
  id: 1,
  username: 'op',
  roles: ['OPERATOR'],
  lineAccess: ['6HI'],
  lineScopes: [{ code: '6HI', accessLevel: 'WRITE' }],
  machineAccess: ['6HI'],
};

const operatorMulti: AuthUser = {
  id: 2,
  username: 'op2',
  roles: ['OPERATOR'],
  lineAccess: ['6HI', '4HI'],
  lineScopes: [
    { code: '6HI', accessLevel: 'WRITE' },
    { code: '4HI', accessLevel: 'WRITE' },
  ],
  machineAccess: ['6HI', '4HI'],
};

const plantHead: AuthUser = {
  id: 3,
  username: 'ph',
  roles: ['PLANT_HEAD'],
  lineAccess: [],
  lineScopes: [],
  machineAccess: [],
};

describe('machineAccessPolicy', () => {
  it('allows operator on assigned machine', () => {
    expect(() => assertMachineAccess(operator6Hi, '6HI')).not.toThrow();
  });

  it('allows operator on assigned machine regardless of case', () => {
    expect(() => assertMachineAccess(operator6Hi, '6hi')).not.toThrow();
  });

  it('denies operator on unassigned machine', () => {
    expect(() => assertMachineAccess(operator6Hi, '4HI')).toThrow(MachineAccessForbiddenError);
  });

  it('denies operator with empty machine scope', () => {
    const unscoped: AuthUser = { ...operator6Hi, machineAccess: [] };
    expect(() => assertMachineAccess(unscoped, '6HI')).toThrow(/Forbidden/);
  });

  it('allows plant head on any machine', () => {
    expect(() => assertMachineAccess(plantHead, '4HI')).not.toThrow();
  });

  it('identifies machine access forbidden errors', () => {
    try {
      assertMachineAccess(operator6Hi, '2HI');
    } catch (error) {
      expect(isMachineAccessForbidden(error)).toBe(true);
    }
  });

  it('scopes multi-machine operators per machine code', () => {
    expect(() => assertMachineAccess(operatorMulti, '6HI')).not.toThrow();
    expect(() => assertMachineAccess(operatorMulti, '4HI')).not.toThrow();
    expect(() => assertMachineAccess(operatorMulti, '2HI')).toThrow(/Forbidden/);
  });

  // machine-wise CRM access (requireCrmMill delegates here)
  it('4HI machine-head: allows 4HI, denies 6HI', () => {
    const mh: AuthUser = {
      id: 10,
      username: 'mh4',
      roles: ['MACHINE_HEAD'],
      lineAccess: ['ROLLING'],
      lineScopes: [{ code: 'ROLLING', accessLevel: 'WRITE' }],
      machineAccess: ['4HI'],
    };
    expect(() => assertMachineAccess(mh, '4HI')).not.toThrow();
    expect(() => assertMachineAccess(mh, '6HI')).toThrow(MachineAccessForbiddenError);
  });

  it('6HI operator keeps access', () => {
    expect(() => assertMachineAccess(operator6Hi, '6HI')).not.toThrow();
  });

  it('PLANT_HEAD bypasses machine scope', () => {
    expect(() => assertMachineAccess(plantHead, '2HI')).not.toThrow();
  });
});
