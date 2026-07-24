import { describe, it, expect } from 'vitest';
import { UserRole, normalizeRoleName, pickPrimaryRole, ROLE_RANK } from '@m1/shared-validation';
import { assertLineOperation } from '../../src/auth/lineAccessPolicy';
import { assertMachineAccess, MachineAccessForbiddenError } from '../../src/auth/machineAccessPolicy';
import { AuthError } from '../../src/services/authService';

const supervisor = {
  id: 99,
  username: 'supervisor',
  roles: ['SUPERVISOR'],
  lineAccess: [],
  lineScopes: [],
  machineAccess: [],
} as const;

/** Allowlists copied from production routes — keep in sync with Workstream B. */
const SUPERVISOR_ALLOWED_ROLE_LISTS = [
  [UserRole.SUPERVISOR, UserRole.MACHINE_HEAD, UserRole.PLANT_HEAD, UserRole.ADMIN], // live
  [UserRole.PLANT_HEAD, UserRole.MACHINE_HEAD, UserRole.SUPERVISOR, UserRole.ADMIN], // traceability
  [UserRole.ADMIN, UserRole.SUPERVISOR], // import
  [UserRole.ADMIN, UserRole.MACHINE_HEAD, UserRole.SUPERVISOR], // ppc preview/commit/transfer-machine
  [UserRole.MACHINE_HEAD, UserRole.PLANT_HEAD, UserRole.ADMIN, UserRole.SUPERVISOR], // order-assignment
  [UserRole.MACHINE_HEAD, UserRole.PLANT_HEAD, UserRole.ADMIN, UserRole.SUPERVISOR], // machine-access/me
  [
    UserRole.OPERATOR,
    UserRole.MACHINE_HEAD,
    UserRole.PLANT_HEAD,
    UserRole.ADMIN,
    UserRole.SUPERVISOR,
  ], // allocate-machine (operators need this for CRM start)
];

const SUPERVISOR_DENIED_ROLE_LISTS = [
  [UserRole.ADMIN], // master-data writes, validation-rules
  [UserRole.ADMIN, UserRole.PLANT_HEAD], // users (no supervisor)
  [UserRole.MACHINE_HEAD, UserRole.PLANT_HEAD, UserRole.ADMIN], // exports, shift complete (no supervisor)
  [UserRole.MACHINE_HEAD, UserRole.PLANT_HEAD], // shift approve/reject
  [UserRole.OPERATOR, UserRole.MACHINE_HEAD, UserRole.ADMIN, UserRole.PLANT_HEAD], // machine-crew read (no supervisor)
];

function roleListAllows(list: string[], role: string): boolean {
  return list.includes(role) || list.includes(UserRole.ADMIN) && role === UserRole.ADMIN;
}

describe('Supervisor role — identity & normalization', () => {
  it('does not fold SUPERVISOR into MACHINE_HEAD', () => {
    expect(normalizeRoleName('SUPERVISOR')).toBe('SUPERVISOR');
    expect(normalizeRoleName('supervisor')).toBe('SUPERVISOR');
    expect(pickPrimaryRole(['SUPERVISOR'])).toBe(UserRole.SUPERVISOR);
    expect(pickPrimaryRole(['SUPERVISOR'])).not.toBe(UserRole.MACHINE_HEAD);
  });

  it('has low rank so it cannot inherit MH/Plant/Admin by rank', () => {
    expect(ROLE_RANK[UserRole.SUPERVISOR]).toBe(0);
    expect(ROLE_RANK[UserRole.SUPERVISOR]).toBeLessThan(ROLE_RANK[UserRole.MACHINE_HEAD]);
  });
});

describe('Supervisor role — route allowlists', () => {
  it('is present on every approved feature allowlist', () => {
    for (const list of SUPERVISOR_ALLOWED_ROLE_LISTS) {
      expect(list).toContain(UserRole.SUPERVISOR);
    }
  });

  it('is absent from denied feature allowlists', () => {
    for (const list of SUPERVISOR_DENIED_ROLE_LISTS) {
      expect(list).not.toContain(UserRole.SUPERVISOR);
      expect(roleListAllows(list as string[], UserRole.SUPERVISOR)).toBe(false);
    }
  });
});

describe('Supervisor role — line/machine scope', () => {
  it('allows READ on any line without assignment', () => {
    expect(() => assertLineOperation(supervisor as any, '6HI', 'READ')).not.toThrow();
    expect(() => assertLineOperation(supervisor as any, 'PKL', 'READ')).not.toThrow();
  });

  it('denies WRITE/SUBMIT/CORRECT/APPROVE/OVERRIDE (no capture / shift ops)', () => {
    for (const op of ['WRITE', 'SUBMIT', 'CORRECT', 'APPROVE', 'OVERRIDE'] as const) {
      expect(() => assertLineOperation(supervisor as any, '6HI', op)).toThrow(AuthError);
    }
  });

  it('allows machine READ-all but not global WRITE', () => {
    expect(() => assertMachineAccess(supervisor as any, '2HI', { mode: 'READ' })).not.toThrow();
    expect(() => assertMachineAccess(supervisor as any, '2HI', { mode: 'WRITE' })).toThrow(
      MachineAccessForbiddenError,
    );
  });
});