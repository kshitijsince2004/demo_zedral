import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  validateEnvironmentAtStartup,
  getConfiguredTenantId,
  isValidTenantUuid,
} from '../src/config/envValidation';

describe('envValidation', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('blocks production startup when AUTH_STRICT is not true', () => {
    process.env.NODE_ENV = 'production';
    process.env.AUTH_STRICT = 'false';
    process.env.JWT_SECRET = 'a'.repeat(32);
    process.env.DATABASE_URL = 'postgres://u:p@localhost/db';
    process.env.TENANT_ID = '00000000-0000-0000-0000-000000000001';
    expect(() => validateEnvironmentAtStartup()).toThrow(/AUTH_STRICT/);
  });

  it('blocks production startup when JWT_SECRET is too short', () => {
    process.env.NODE_ENV = 'production';
    process.env.AUTH_STRICT = 'true';
    process.env.JWT_SECRET = 'short';
    process.env.DATABASE_URL = 'postgres://u:p@localhost/db';
    process.env.TENANT_ID = '00000000-0000-0000-0000-000000000001';
    expect(() => validateEnvironmentAtStartup()).toThrow(/JWT_SECRET/);
  });

  it('blocks production startup when TENANT_ID is missing', () => {
    process.env.NODE_ENV = 'production';
    process.env.AUTH_STRICT = 'true';
    process.env.JWT_SECRET = 'a'.repeat(32);
    process.env.DATABASE_URL = 'postgres://u:p@localhost/db';
    delete process.env.TENANT_ID;
    expect(() => validateEnvironmentAtStartup()).toThrow(/TENANT_ID/);
  });

  it('allows dev startup with relaxed config', () => {
    process.env.NODE_ENV = 'development';
    process.env.AUTH_STRICT = 'false';
    delete process.env.JWT_SECRET;
    expect(() => validateEnvironmentAtStartup()).not.toThrow();
  });

  it('validates tenant UUID format', () => {
    expect(isValidTenantUuid('00000000-0000-0000-0000-000000000001')).toBe(true);
    expect(isValidTenantUuid('not-a-uuid')).toBe(false);
    process.env.TENANT_ID = '00000000-0000-0000-0000-000000000001';
    expect(getConfiguredTenantId()).toBe('00000000-0000-0000-0000-000000000001');
  });
});
