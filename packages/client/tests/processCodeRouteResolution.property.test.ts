/**
 * Property 1: Process-code route resolution
 *
 * Validates: Requirements 1.4
 *
 * For any string used as the `:processId` route parameter, the process-section
 * registry should resolve a capture section if and only if the string is one of
 * the canonical process codes (HRS, PKL, CRM, ANN, SKP, RWD, CRS, CTL).
 *
 * For every other string — including near-misses such as the removed SPM and REW
 * codes, lowercase variants, empty strings, and arbitrary strings — the registry
 * should return null, causing the unified capture route to render a not-found
 * state with no capture form.
 *
 * Tagged: Feature: m1-frontend-remediation, Property 1: Process-code route resolution
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  resolveProcessSection,
  isValidProcessCode,
  CANONICAL_PROCESS_CODES,
  type ProcessCode,
} from '../src/lib/processSectionRegistry';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CANONICAL_CODES = [...CANONICAL_PROCESS_CODES] as const;

/** Removed / non-canonical codes that must never resolve. */
const REMOVED_CODES = ['SPM', 'REW', 'spm', 'rew'];

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Arbitrary that produces one of the eight canonical process codes. */
const canonicalCodeArb = fc.constantFrom<ProcessCode>(...CANONICAL_CODES);

/**
 * Arbitrary that produces strings that are NOT canonical process codes.
 * Includes: arbitrary strings, lowercase canonical codes, removed codes,
 * empty string, whitespace, numeric strings, and near-misses.
 */
const nonCanonicalStringArb = fc
  .oneof(
    // Completely arbitrary strings
    fc.string({ minLength: 0, maxLength: 20 }),
    // Lowercase versions of canonical codes (case-sensitive check)
    fc.constantFrom(...CANONICAL_CODES.map((c) => c.toLowerCase())),
    // Removed codes
    fc.constantFrom(...REMOVED_CODES),
    // Near-misses: canonical code with extra character
    canonicalCodeArb.map((c) => c + 'X'),
    canonicalCodeArb.map((c) => 'X' + c),
    // Numeric strings
    fc.integer({ min: 0, max: 9999 }).map(String),
    // Empty string
    fc.constant(''),
    // Whitespace
    fc.constant(' '),
    fc.constant('\t'),
  )
  .filter((s) => !(CANONICAL_CODES as readonly string[]).includes(s));

// ---------------------------------------------------------------------------
// Property 1a: Every canonical code resolves to a non-null descriptor
//              (Requirement 1.4 — valid codes render a capture section)
// ---------------------------------------------------------------------------
describe('Property 1: Process-code route resolution', () => {
  it(
    '1a — every canonical code resolves to a non-null descriptor (Req 1.4)',
    () => {
      fc.assert(
        fc.property(canonicalCodeArb, (code) => {
          const descriptor = resolveProcessSection(code);

          expect(descriptor).not.toBeNull();
          expect(descriptor).toBeDefined();
        }),
        { numRuns: 100 },
      );
    },
  );

  // ---------------------------------------------------------------------------
  // Property 1b: Resolved descriptor carries the correct code, title, Section,
  //              and endpoint
  // ---------------------------------------------------------------------------
  it(
    '1b — resolved descriptor has correct code, title, Section component, and endpoint (Req 1.4)',
    () => {
      fc.assert(
        fc.property(canonicalCodeArb, (code) => {
          const descriptor = resolveProcessSection(code);

          // Descriptor must be non-null (covered by 1a, but guard here too)
          if (!descriptor) throw new Error(`Expected descriptor for ${code}`);

          // code field must match the input
          expect(descriptor.code).toBe(code);

          // title must be a non-empty string
          expect(typeof descriptor.title).toBe('string');
          expect(descriptor.title.length).toBeGreaterThan(0);

          // Section must be a function (React component) or a React.lazy object.
          // The registry uses React.lazy() for code-splitting, which returns an
          // object with $$typeof === Symbol.for('react.lazy'), not a plain function.
          expect(
            typeof descriptor.Section === 'function' ||
            (typeof descriptor.Section === 'object' && descriptor.Section !== null),
          ).toBe(true);

          // 6HI uses the dedicated workspace route; other lines use /entries/*
          if (code === '6HI') {
            expect(descriptor.endpoint).toBe('/6hi');
          } else {
            expect(descriptor.endpoint).toBe(`/entries/${code.toLowerCase()}`);
          }
        }),
        { numRuns: 100 },
      );
    },
  );

  // ---------------------------------------------------------------------------
  // Property 1c: Every non-canonical string resolves to null
  //              (Requirement 1.4 — invalid codes render not-found, no form)
  // ---------------------------------------------------------------------------
  it(
    '1c — every non-canonical string resolves to null (Req 1.4)',
    () => {
      fc.assert(
        fc.property(nonCanonicalStringArb, (nonCode) => {
          const descriptor = resolveProcessSection(nonCode);

          expect(descriptor).toBeNull();
        }),
        { numRuns: 200 },
      );
    },
  );

  // ---------------------------------------------------------------------------
  // Property 1d: Removed codes SPM and REW always resolve to null
  //              (explicit regression guard for removed Path B codes)
  // ---------------------------------------------------------------------------
  it(
    '1d — removed codes SPM and REW always resolve to null (Req 1.4)',
    () => {
      for (const code of ['SPM', 'REW', 'spm', 'rew']) {
        expect(resolveProcessSection(code)).toBeNull();
        expect(isValidProcessCode(code)).toBe(false);
      }
    },
  );

  // ---------------------------------------------------------------------------
  // Property 1e: isValidProcessCode is consistent with resolveProcessSection
  //              (the two functions must agree on every input)
  // ---------------------------------------------------------------------------
  it(
    '1e — isValidProcessCode and resolveProcessSection agree on canonical codes (Req 1.4)',
    () => {
      fc.assert(
        fc.property(canonicalCodeArb, (code) => {
          expect(isValidProcessCode(code)).toBe(true);
          expect(resolveProcessSection(code)).not.toBeNull();
        }),
        { numRuns: 100 },
      );
    },
  );

  it(
    '1f — isValidProcessCode and resolveProcessSection agree on non-canonical strings (Req 1.4)',
    () => {
      fc.assert(
        fc.property(nonCanonicalStringArb, (nonCode) => {
          expect(isValidProcessCode(nonCode)).toBe(false);
          expect(resolveProcessSection(nonCode)).toBeNull();
        }),
        { numRuns: 200 },
      );
    },
  );

  // ---------------------------------------------------------------------------
  // Property 1g: Exactly 9 canonical codes are registered
  //              (no more, no fewer — guards against accidental additions)
  // ---------------------------------------------------------------------------
  it(
    '1g — exactly 9 canonical codes are registered (Req 1.4)',
    () => {
      expect(CANONICAL_CODES).toHaveLength(9);

      const expectedCodes = new Set(['HRS', 'PKL', '6HI', 'ANN', 'SKP', 'RWD', 'CRS', 'CTL', 'GLV']);
      for (const code of CANONICAL_CODES) {
        expect(expectedCodes.has(code)).toBe(true);
      }
    },
  );

  // ---------------------------------------------------------------------------
  // Property 1h: Resolution is idempotent — calling resolveProcessSection twice
  //              with the same code returns equivalent descriptors
  // ---------------------------------------------------------------------------
  it(
    '1h — resolution is idempotent for canonical codes (Req 1.4)',
    () => {
      fc.assert(
        fc.property(canonicalCodeArb, (code) => {
          const d1 = resolveProcessSection(code);
          const d2 = resolveProcessSection(code);

          // Both must be non-null and reference the same descriptor object
          expect(d1).not.toBeNull();
          expect(d2).not.toBeNull();
          expect(d1).toBe(d2); // same object reference (registry is a static map)
        }),
        { numRuns: 100 },
      );
    },
  );

  // ---------------------------------------------------------------------------
  // Property 1i: Lowercase canonical codes do NOT resolve
  //              (route parameter matching is case-sensitive; sidebar uses uppercase)
  // ---------------------------------------------------------------------------
  it(
    '1i — lowercase canonical codes do not resolve (case-sensitive matching) (Req 1.4)',
    () => {
      fc.assert(
        fc.property(canonicalCodeArb, (code) => {
          const lower = code.toLowerCase();
          expect(resolveProcessSection(lower)).toBeNull();
          expect(isValidProcessCode(lower)).toBe(false);
        }),
        { numRuns: 100 },
      );
    },
  );
});
