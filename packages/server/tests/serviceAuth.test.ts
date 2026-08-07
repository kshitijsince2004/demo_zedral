import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  resolveServiceTokenTenant,
  validateServiceToken,
  loadServiceTokenByTenant,
} from '../../platform/src/security/serviceAuth';

describe('serviceAuth', () => {
  const env = { ...process.env };

  beforeEach(() => {
    process.env = { ...env };
    delete process.env.SERVICE_TOKEN_MAP;
  });

  afterEach(() => {
    process.env = env;
  });

  it('accepts a valid bearer token bound to TENANT_ID', () => {
    process.env.SERVICE_TOKEN = 'secret-token-value';
    process.env.TENANT_ID = '00000000-0000-0000-0000-000000000001';
    expect(validateServiceToken('Bearer secret-token-value')).toBe(true);
    expect(
      resolveServiceTokenTenant(
        'Bearer secret-token-value',
        '00000000-0000-0000-0000-000000000001',
      ),
    ).toBe('00000000-0000-0000-0000-000000000001');
  });

  it('rejects token when x-tenant-id does not match binding', () => {
    process.env.SERVICE_TOKEN = 'secret-token-value';
    process.env.TENANT_ID = '00000000-0000-0000-0000-000000000001';
    expect(
      resolveServiceTokenTenant(
        'Bearer secret-token-value',
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      ),
    ).toBeNull();
  });

  it('supports SERVICE_TOKEN_MAP for per-tenant tokens', () => {
    process.env.SERVICE_TOKEN_MAP = JSON.stringify({
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa': 'token-a',
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb': 'token-b',
    });
    const map = loadServiceTokenByTenant();
    expect(map.size).toBe(2);
    expect(resolveServiceTokenTenant('Bearer token-b', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')).toBe(
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    );
  });

  it('rejects invalid tokens', () => {
    process.env.SERVICE_TOKEN = 'expected';
    expect(validateServiceToken('Bearer wrong')).toBe(false);
    expect(validateServiceToken(undefined)).toBe(false);
  });
});
