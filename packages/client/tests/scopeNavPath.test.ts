import { describe, expect, it } from 'vitest';
import { normalizeDoubledUserScopePath, scopeNavPath } from '../src/lib/scopeNavPath';

describe('scopeNavPath', () => {
  it('keeps absolute base and joins segments', () => {
    expect(scopeNavPath('/alice.operator')).toBe('/alice.operator');
    expect(scopeNavPath('/alice.operator', 'capture')).toBe('/alice.operator/capture');
    expect(scopeNavPath('/alice.operator', 'capture', 'C1')).toBe('/alice.operator/capture/C1');
    expect(scopeNavPath('/alice.operator', 'chart')).toBe('/alice.operator/chart');
    expect(scopeNavPath('/alice.operator', 'history')).toBe('/alice.operator/history');
  });

  it('repairs a base missing a leading slash', () => {
    expect(scopeNavPath('alice.operator', 'history')).toBe('/alice.operator/history');
  });

  it('returns / when base is empty (callers must guard)', () => {
    expect(scopeNavPath('')).toBe('/');
    expect(scopeNavPath('/', 'capture')).toBe('/');
  });

  it('encodes multi-segment capture paths for PKL/HRS', () => {
    const coil = encodeURIComponent('M-1/A');
    expect(scopeNavPath('/pkl.operator', 'capture', coil)).toBe('/pkl.operator/capture/M-1%2FA');
  });
});

describe('normalizeDoubledUserScopePath', () => {
  it('collapses doubled user-scope segments', () => {
    expect(normalizeDoubledUserScopePath('/alice.operator/alice.operator/capture')).toBe(
      '/alice.operator/capture',
    );
    expect(normalizeDoubledUserScopePath('/alice.operator/alice.operator')).toBe('/alice.operator');
    expect(normalizeDoubledUserScopePath('/alice.operator/alice.operator/history')).toBe(
      '/alice.operator/history',
    );
  });

  it('returns null when path is already fine', () => {
    expect(normalizeDoubledUserScopePath('/alice.operator/capture')).toBeNull();
    expect(normalizeDoubledUserScopePath('/alice.operator')).toBeNull();
    expect(normalizeDoubledUserScopePath('/not-a-scope/not-a-scope/x')).toBeNull();
  });
});
