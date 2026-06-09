/**
 * Property 2: Preservation — Non-6 Route Processing and CRM Queue Creation Unchanged
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { translatePpcRoute, parseRouteForJourney } from '../src/utils/PpcRouteTranslator';
import { parseRouteString } from '../src/services/ProcessRouteService';

const NON_SIX_ALPHABET = ['S', 'P', '4', 'R', 'F', 'X', 'Y', 'Z', 'C', 'LE'] as const;

/** Observed baseline for SP4FXCLE on fixed code (no token 6). */
const OBSERVED_SP4FXCLE = 'S-P-4-F-X-C-LE-PKG';

describe('Property 2: Preservation', () => {
  it('observed — translatePpcRoute(SP4FXCLE) canonical output', () => {
    expect(translatePpcRoute('SP4FXCLE').canonical).toBe(OBSERVED_SP4FXCLE);
  });

  it('observed — parseRouteForJourney(S-P-4-F-X-C-LE) token order', () => {
    expect(parseRouteForJourney('S-P-4-F-X-C-LE')).toBe('S-P-4-F-X-C-LE');
  });

  it('Property 4 — routes without 6 produce stable canonical output', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...NON_SIX_ALPHABET), { minLength: 2, maxLength: 8 }),
        (parts) => {
          const raw = parts.join('');
          const result = translatePpcRoute(raw);
          expect(result.codes).not.toContain('6');
          expect(result.canonical).not.toContain('-6-');
          expect(result.canonical.endsWith('-PKG') || result.canonical.includes('PKG')).toBe(true);
        },
      ),
      { numRuns: 50 },
    );
  });

  it('Property 5 — CRM steps retain machineCode and subProcess', () => {
    const steps = parseRouteString('S-P-4-Z-C-LE');
    const fourHi = steps.find((s) => s.routeCode === '4');
    const skinPass = steps.find((s) => s.routeCode === 'Z');
    expect(fourHi?.machineCode).toBeNull();
    expect(fourHi?.subProcess).toBe('ROLLING');
    expect(skinPass?.machineCode).toBe('6HI');
    expect(skinPass?.subProcess).toBe('SKIN_PASS');
  });

  it('Packaging step — both null in ROUTE_META', () => {
    const steps = parseRouteString('S-P-4-C-LE');
    const pkg = steps.find((s) => s.routeCode === 'PKG');
    expect(pkg?.processCode).toBeNull();
    expect(pkg?.machineCode).toBeNull();
    expect(pkg?.subProcess).toBeNull();
  });

  it('standalone S/P/F codes unchanged', () => {
    const steps = parseRouteString('S-P-F-C-LE');
    expect(steps.find((s) => s.routeCode === 'S')?.processCode).toBe('HRS');
    expect(steps.find((s) => s.routeCode === 'P')?.processCode).toBe('PKL');
    expect(steps.find((s) => s.routeCode === 'F')?.processCode).toBe('ANN');
  });
});
