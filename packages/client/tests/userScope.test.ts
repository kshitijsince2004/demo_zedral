import { describe, it, expect } from 'vitest';
import {
  userScopePath,
  parseUserScope,
  matchesUserScope,
  isUserScopePath,
  roleFromSlug,
} from '../src/lib/userScope';

describe('userScope', () => {
  it('builds /username.role paths', () => {
    expect(userScopePath('operator', 'OPERATOR')).toBe('/operator.operator');
    expect(userScopePath('machinehead', 'MACHINE_HEAD')).toBe('/machinehead.machine_head');
  });

  it('parses user scope segments', () => {
    expect(parseUserScope('operator.operator')).toEqual({
      username: 'operator',
      roleSlug: 'operator',
    });
  });

  it('matches logged-in user to scope', () => {
    expect(matchesUserScope('operator.operator', 'operator', 'OPERATOR')).toBe(true);
    expect(matchesUserScope('operator.supervisor', 'operator', 'OPERATOR')).toBe(false);
  });

  it('detects user scope paths', () => {
    expect(isUserScopePath('/operator.operator')).toBe(true);
    expect(isUserScopePath('/operator.operator/capture')).toBe(true);
    expect(isUserScopePath('/plant')).toBe(false);
    expect(isUserScopePath('/6hi')).toBe(false);
  });

  it('maps role slugs back to roles', () => {
    expect(roleFromSlug('operator')).toBe('OPERATOR');
    expect(roleFromSlug('machine_head')).toBe('MACHINE_HEAD');
  });
});
