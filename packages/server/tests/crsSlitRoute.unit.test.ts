import { describe, it, expect } from 'vitest';
import { resolveCrsSlitPreferredRoute } from '../src/utils/crsSlitRoute';

describe('resolveCrsSlitPreferredRoute', () => {
  it('skips HOLD lines', () => {
    expect(resolveCrsSlitPreferredRoute({ holdFlag: true, forCtlFlag: true, routeCode: 'LE' })).toBeNull();
  });

  it('routes for-CTL / LE to LE and CZ/PKG to PKG', () => {
    expect(resolveCrsSlitPreferredRoute({ forCtlFlag: true })).toBe('LE');
    expect(resolveCrsSlitPreferredRoute({ routeCode: 'LE' })).toBe('LE');
    expect(resolveCrsSlitPreferredRoute({ routeCode: 'PKG' })).toBe('PKG');
    expect(resolveCrsSlitPreferredRoute({ routeCode: 'Z' })).toBe('PKG');
  });

  it('returns null when no line preference (use pass default)', () => {
    expect(resolveCrsSlitPreferredRoute({})).toBeNull();
  });
});
