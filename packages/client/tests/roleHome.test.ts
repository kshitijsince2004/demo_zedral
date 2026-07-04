import { describe, it, expect } from 'vitest';
import { getRoleHomePath } from '../src/lib/roleHome';
import { UserRole } from '@m1/shared-validation';

describe('getRoleHomePath', () => {
  it('maps PLANT_HEAD to /plant', () => {
    expect(getRoleHomePath(UserRole.PLANT_HEAD)).toBe('/plant');
  });

  it('maps OPERATOR to /username.role workspace', () => {
    expect(getRoleHomePath(UserRole.OPERATOR, ['6HI'], ['4HI'], 'operator')).toBe('/operator.operator');
    expect(getRoleHomePath(UserRole.OPERATOR, ['6HI'], ['2HI'], 'operator')).toBe('/operator.operator');
  });

  it('maps SUPERVISOR to /username.role workspace', () => {
    expect(getRoleHomePath(UserRole.SUPERVISOR, [], ['4HI'], 'supervisor')).toBe('/supervisor.supervisor');
  });

  it('falls back to assigned machine path without username', () => {
    expect(getRoleHomePath(UserRole.OPERATOR, ['6HI'], ['4HI'])).toBe('/4hi');
    expect(getRoleHomePath(UserRole.OPERATOR, ['HRS'], ['HRS'])).toBe('/capture/HRS');
  });

  it('maps every role to a non-login path', () => {
    const paths = [
      getRoleHomePath(UserRole.OPERATOR, ['HRS'], ['HRS'], 'operator'),
      getRoleHomePath(UserRole.MACHINE_HEAD, [], ['4HI'], 'machinehead'),
      getRoleHomePath(UserRole.SUPERVISOR, [], [], 'supervisor'),
      getRoleHomePath(UserRole.PLANT_HEAD),
      getRoleHomePath(UserRole.ADMIN),
    ];
    for (const p of paths) {
      expect(p).not.toBe('/login');
    }
  });
});
