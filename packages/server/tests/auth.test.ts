import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { hashPin, verifyPin } from '../src/services/pinService';
import { isAuthStrict } from '../src/config/authConfig';
import { assertLineWriteAccess, AuthUser } from '../src/services/authService';
import { assertLineOperation } from '../src/auth/lineAccessPolicy';

describe('pinService', () => {
  it('hashes and verifies a PIN', () => {
    const stored = hashPin('1234');
    expect(verifyPin('1234', stored)).toBe(true);
    expect(verifyPin('0000', stored)).toBe(false);
  });

  it('rejects malformed stored hashes', () => {
    expect(verifyPin('1234', 'not-a-hash')).toBe(false);
  });
});

describe('authConfig', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('evaluates AUTH_STRICT correctly', () => {
    process.env.AUTH_STRICT = 'false';
    expect(isAuthStrict()).toBe(false);
    
    process.env.AUTH_STRICT = 'true';
    expect(isAuthStrict()).toBe(true);
  });
});

describe('assertLineWriteAccess', () => {
  const operator: AuthUser = {
    id: 1,
    username: 'op',
    roles: ['OPERATOR'],
    lineAccess: ['HRS', 'CRM'],
    lineScopes: [
      { code: 'HRS', accessLevel: 'WRITE' },
      { code: 'CRM', accessLevel: 'WRITE' },
    ],
  };

  it('allows write when operator has line access', () => {
    expect(() => assertLineWriteAccess(operator, 'hrs')).not.toThrow();
  });

  it('denies write when operator lacks line access', () => {
    expect(() => assertLineWriteAccess(operator, 'PKL')).toThrow(/Forbidden/);
  });

  it('allows admin bypass', () => {
    const admin: AuthUser = { ...operator, roles: ['ADMIN'], lineAccess: [], lineScopes: [] };
    expect(() => assertLineWriteAccess(admin, 'PKL')).not.toThrow();
  });

  it('denies plant head writes via assertLineOperation', () => {
    const ph: AuthUser = {
      id: 3,
      username: 'ph',
      roles: ['PLANT_HEAD'],
      lineAccess: [],
      lineScopes: [],
    };
    expect(() => assertLineOperation(ph, 'HRS', 'WRITE')).toThrow(/read-only/);
  });
});
