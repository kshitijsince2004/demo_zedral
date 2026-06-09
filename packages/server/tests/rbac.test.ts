import { describe, it, expect } from 'vitest';
import {
  assertLineOperation,
  getScopedLineCodes,
  meetsAccessLevel,
} from '../src/auth/lineAccessPolicy';
import { AuthUser } from '../src/services/authService';

const operatorHrs: AuthUser = {
  id: 1,
  username: 'op',
  roles: ['OPERATOR'],
  lineAccess: ['HRS'],
  lineScopes: [{ code: 'HRS', accessLevel: 'WRITE' }],
};

const supervisorCrm: AuthUser = {
  id: 2,
  username: 'sup',
  roles: ['SUPERVISOR'],
  lineAccess: ['CRM'],
  lineScopes: [{ code: 'CRM', accessLevel: 'APPROVE' }],
};

const plantHead: AuthUser = {
  id: 3,
  username: 'ph',
  roles: ['PLANT_HEAD'],
  lineAccess: [],
  lineScopes: [],
};

const readOnlyHrs: AuthUser = {
  id: 4,
  username: 'viewer',
  roles: ['OPERATOR'],
  lineAccess: ['HRS'],
  lineScopes: [{ code: 'HRS', accessLevel: 'READ' }],
};

const machineHeadSixHi: AuthUser = {
  id: 5,
  username: 'mh',
  roles: ['MACHINE_HEAD'],
  lineAccess: ['6HI'],
  lineScopes: [{ code: '6HI', accessLevel: 'WRITE' }],
};

describe('lineAccessPolicy', () => {
  it('ranks access levels correctly', () => {
    expect(meetsAccessLevel('APPROVE', 'WRITE')).toBe(true);
    expect(meetsAccessLevel('WRITE', 'READ')).toBe(true);
    expect(meetsAccessLevel('READ', 'WRITE')).toBe(false);
  });

  it('allows operator WRITE on assigned line', () => {
    expect(() => assertLineOperation(operatorHrs, 'HRS', 'WRITE')).not.toThrow();
  });

  it('denies operator WRITE on unassigned line', () => {
    expect(() => assertLineOperation(operatorHrs, 'CRM', 'WRITE')).toThrow(/Forbidden/);
  });

  it('denies READ-only operator from writing', () => {
    expect(() => assertLineOperation(readOnlyHrs, 'HRS', 'WRITE')).toThrow(/write access/);
  });

  it('allows supervisor APPROVE with APPROVE scope', () => {
    expect(() => assertLineOperation(supervisorCrm, 'CRM', 'APPROVE')).not.toThrow();
  });

  it('denies plant head from transactional writes', () => {
    expect(() => assertLineOperation(plantHead, 'HRS', 'WRITE')).toThrow(/read-only/);
  });

  it('allows plant head READ on any line', () => {
    expect(() => assertLineOperation(plantHead, 'HRS', 'READ')).not.toThrow();
  });

  it('scopes operator list to assigned readable lines', () => {
    expect(getScopedLineCodes(operatorHrs, 'READ')).toEqual(['HRS']);
    expect(getScopedLineCodes(plantHead, 'READ')).toBeNull();
  });

  it('allows machine head WRITE on assigned line', () => {
    expect(() => assertLineOperation(machineHeadSixHi, '6HI', 'WRITE')).not.toThrow();
  });

  it('denies machine head WRITE on unassigned line', () => {
    expect(() => assertLineOperation(machineHeadSixHi, 'HRS', 'WRITE')).toThrow(/Forbidden/);
  });
});
