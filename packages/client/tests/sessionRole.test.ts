import { describe, expect, it } from 'vitest';
import { roleFromAccessTokenPayload, isPlantWideDeskRole } from '../src/lib/sessionRoleUtils';

describe('sessionRole', () => {
  it('prefers JWT primary role from access-token payload', () => {
    expect(
      roleFromAccessTokenPayload({ roles: ['OPERATOR', 'MACHINE_HEAD'] }),
    ).toBe('MACHINE_HEAD');
    expect(roleFromAccessTokenPayload({ roles: ['SUPERVISOR'] })).toBe('SUPERVISOR');
  });

  it('returns null when payload has no roles', () => {
    expect(roleFromAccessTokenPayload({})).toBeNull();
    expect(roleFromAccessTokenPayload(null)).toBeNull();
  });

  it('treats supervisor as plant-wide desk role', () => {
    expect(isPlantWideDeskRole('SUPERVISOR')).toBe(true);
    expect(isPlantWideDeskRole('PLANT_HEAD')).toBe(true);
    expect(isPlantWideDeskRole('MACHINE_HEAD')).toBe(false);
    expect(isPlantWideDeskRole('OPERATOR')).toBe(false);
  });
});