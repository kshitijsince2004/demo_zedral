import { describe, it, expect } from 'vitest';
import { UserRole } from '@m1/shared-validation';
import { assertPlanImportAccess } from '../../src/auth/planImportPolicy';
import { AuthError } from '../../src/services/authService';
import { parseImportLineScope } from '../../src/services/PPCImportService';

function user(partial: {
  roles: string[];
  lineScopes?: { code: string; accessLevel: string }[];
}) {
  return {
    id: 1,
    username: 'u',
    roles: partial.roles,
    lineAccess: (partial.lineScopes ?? []).map((s) => s.code),
    lineScopes: partial.lineScopes ?? [],
    machineAccess: [],
  };
}

describe('assertPlanImportAccess', () => {
  it('allows ADMIN on any line', () => {
    expect(() => assertPlanImportAccess(user({ roles: [UserRole.ADMIN] }) as any, 'CTL')).not.toThrow();
  });

  it('allows MACHINE_HEAD with matching WRITE scope', () => {
    const mh = user({
      roles: [UserRole.MACHINE_HEAD],
      lineScopes: [{ code: 'HRS', accessLevel: 'WRITE' }],
    });
    expect(() => assertPlanImportAccess(mh as any, 'HRS')).not.toThrow();
    expect(() => assertPlanImportAccess(mh as any, 'PKL')).toThrow(AuthError);
  });

  it('allows SUPERVISOR with empty scopes (plant-wide)', () => {
    expect(() =>
      assertPlanImportAccess(user({ roles: [UserRole.SUPERVISOR], lineScopes: [] }) as any, 'ANN'),
    ).not.toThrow();
  });

  it('allows PLANNER only on assigned WRITE lines', () => {
    const planner = user({
      roles: [UserRole.PLANNER],
      lineScopes: [
        { code: 'HRS', accessLevel: 'WRITE' },
        { code: 'CTL', accessLevel: 'WRITE' },
      ],
    });
    expect(() => assertPlanImportAccess(planner as any, 'HRS')).not.toThrow();
    expect(() => assertPlanImportAccess(planner as any, 'CTL')).not.toThrow();
    expect(() => assertPlanImportAccess(planner as any, 'PKL')).toThrow(/plan-import write access/);
  });

  it('denies PLANT_HEAD and OPERATOR', () => {
    expect(() =>
      assertPlanImportAccess(user({ roles: [UserRole.PLANT_HEAD] }) as any, 'HRS'),
    ).toThrow(AuthError);
    expect(() =>
      assertPlanImportAccess(
        user({
          roles: [UserRole.OPERATOR],
          lineScopes: [{ code: 'HRS', accessLevel: 'WRITE' }],
        }) as any,
        'HRS',
      ),
    ).toThrow(AuthError);
  });
});

describe('parseImportLineScope', () => {
  it('accepts CTL alongside HRS/PKL/RWD/ANN', () => {
    expect(parseImportLineScope('CTL')).toBe('CTL');
    expect(parseImportLineScope('hrs')).toBe('HRS');
    expect(parseImportLineScope('CRM')).toBeUndefined();
  });
});
