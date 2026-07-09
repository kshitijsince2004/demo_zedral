import { describe, it, expect } from 'vitest';
import { assertLineOperation } from '../../src/auth/lineAccessPolicy';
import { AuthError } from '../../src/services/authService';

const plantHead = {
  id: 10,
  username: 'ph',
  roles: ['PLANT_HEAD'],
  lineAccess: [],
  lineScopes: [],
  machineAccess: [],
} as const;

const supervisor = {
  id: 11,
  username: 'sup',
  roles: ['SUPERVISOR'],
  lineAccess: ['HRS'],
  lineScopes: [{ code: 'HRS', accessLevel: 'APPROVE' as const }],
  machineAccess: [],
} as const;

describe('lineAccessPolicy — Plant Head read-only', () => {
  it('allows READ on any line without per-line scope', () => {
    expect(() => assertLineOperation(plantHead as any, 'PKL', 'READ')).not.toThrow();
    expect(() => assertLineOperation(plantHead as any, '6HI', 'READ')).not.toThrow();
  });

  it.each(['WRITE', 'SUBMIT', 'CORRECT'] as const)(
    'denies %s for Plant Head',
    (op) => {
      expect(() => assertLineOperation(plantHead as any, 'HRS', op)).toThrow(AuthError);
      try {
        assertLineOperation(plantHead as any, 'HRS', op);
      } catch (e) {
        expect((e as AuthError).message).toContain("Operation '" + op + "'");
        expect((e as AuthError).message).toContain('read-only');
      }
    },
  );

  it.each(['APPROVE', 'OVERRIDE'] as const)(
    'allows %s for Plant Head (shift governance)',
    (op) => {
      expect(() => assertLineOperation(plantHead as any, 'HRS', op)).not.toThrow();
    },
  );

  it('allows supervisor APPROVE on scoped line', () => {
    expect(() => assertLineOperation(supervisor as any, 'HRS', 'APPROVE')).not.toThrow();
  });
});
