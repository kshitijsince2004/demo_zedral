import { describe, it, expect } from 'vitest';
import { evaluateLimit } from '../src/services/SpecResolverService';

describe('evaluateLimit', () => {
  it('MIN_MAX within / below / above', () => {
    expect(evaluateLimit('MIN_MAX', { min: 10, max: 20 }, 15)).toBe('PASS');
    expect(evaluateLimit('MIN_MAX', { min: 10, max: 20 }, 9)).toBe('FAIL');
    expect(evaluateLimit('MIN_MAX', { min: 10, max: 20 }, 21)).toBe('FAIL');
  });

  it('MAX_ONLY and MIN_ONLY', () => {
    expect(evaluateLimit('MAX_ONLY', { max: 5 }, 4)).toBe('PASS');
    expect(evaluateLimit('MAX_ONLY', { max: 5 }, 6)).toBe('FAIL');
    expect(evaluateLimit('MIN_ONLY', { min: 5 }, 6)).toBe('PASS');
    expect(evaluateLimit('MIN_ONLY', { min: 5 }, 4)).toBe('FAIL');
  });

  it('TARGET_TOL and EXACT', () => {
    expect(evaluateLimit('TARGET_TOL', { target: 100, tolerance: 2 }, 101)).toBe('PASS');
    expect(evaluateLimit('TARGET_TOL', { target: 100, tolerance: 2 }, 104)).toBe('FAIL');
    expect(evaluateLimit('EXACT', { target: 1 }, 1)).toBe('PASS');
    expect(evaluateLimit('EXACT', { textValue: 'OK' }, 'ok')).toBe('PASS');
    expect(evaluateLimit('EXACT', { textValue: 'OK' }, 'NOK')).toBe('FAIL');
  });

  it('missing measured or limits → NOT_EVALUATED', () => {
    expect(evaluateLimit('MIN_MAX', { min: 1, max: 2 }, null)).toBe('NOT_EVALUATED');
    expect(evaluateLimit('MIN_MAX', {}, 1)).toBe('NOT_EVALUATED');
    expect(evaluateLimit('TARGET_TOL', { tolerance: 1 }, 5)).toBe('NOT_EVALUATED');
  });
});
