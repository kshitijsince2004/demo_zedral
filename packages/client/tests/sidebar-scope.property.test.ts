/**
 * Property 13: Line-scoped sidebar derivation
 *
 * Validates: Requirements 8.1, 8.2
 *
 * For any authenticated user, the set of process lines shown in the sidebar
 * should equal the scope of the user's role and line access:
 *   - For an Operator, the canonical lines intersected with the user's
 *     line-access set (empty lineAccess = dev default = all lines).
 *   - For Supervisor, canonical lines intersected with lineAccess (all if empty).
 *   - For Plant Head and Admin, all canonical process lines.
 *
 * Tagged: Feature: m1-frontend-remediation, Property 13: Line-scoped sidebar derivation
 */

import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';

// Mock authStore to avoid sessionStorage access in a Node test environment.
// getSidebarProcessLines is a pure function that takes role/lineAccess as
// parameters and does not call the store at runtime.
vi.mock('../src/lib/authStore', () => ({
  useAuthStore: vi.fn(),
}));

import { getSidebarProcessLines } from '../src/components/layout/Sidebar';
import type { Role } from '../src/lib/authStore';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CANONICAL_CODES = ['HRS', 'PKL', '6HI', 'ANN', 'SKP', 'RWD', 'CRS', 'CTL', 'GLV'] as const;
type ProcessCode = typeof CANONICAL_CODES[number];

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const roleArb = fc.constantFrom<Role>('OPERATOR', 'SUPERVISOR', 'PLANT_HEAD', 'ADMIN');

const canonicalCodeArb = fc.constantFrom<ProcessCode>(...CANONICAL_CODES);

/** A lineAccess array that is a subset of canonical codes (possibly empty). */
const lineAccessSubsetArb = fc
  .uniqueArray(canonicalCodeArb, { minLength: 0, maxLength: CANONICAL_CODES.length })
  .map((arr) => arr as string[]);

/** A lineAccess array that may include non-canonical codes too. */
const lineAccessMixedArb = fc
  .uniqueArray(
    fc.oneof(
      canonicalCodeArb,
      fc.stringMatching(/^[A-Z]{2,4}$/).filter((s) => !(CANONICAL_CODES as readonly string[]).includes(s)),
    ),
    { minLength: 0, maxLength: 12 },
  )
  .map((arr) => arr as string[]);

// ---------------------------------------------------------------------------
// Property 13a: Operator sees only their assigned canonical lines
//               (Requirement 8.2)
// ---------------------------------------------------------------------------
describe('Property 13: Line-scoped sidebar derivation', () => {
  it(
    '13a — Operator sees only canonical lines in their lineAccess (Req 8.2)',
    () => {
      fc.assert(
        fc.property(
          // Use a non-empty lineAccess subset so the dev-default (empty = all) case
          // is excluded here; it is covered separately in 13b.
          fc.uniqueArray(canonicalCodeArb, { minLength: 1, maxLength: CANONICAL_CODES.length })
            .map((arr) => arr as string[]),
          (lineAccess) => {
            const items = getSidebarProcessLines('OPERATOR', lineAccess);
            const codes = items.map((i) => i.code);

            // Every visible code must be in the user's lineAccess
            for (const code of codes) {
              expect(lineAccess).toContain(code);
            }

            // Every canonical code in lineAccess must be visible
            for (const code of lineAccess) {
              if ((CANONICAL_CODES as readonly string[]).includes(code)) {
                expect(codes).toContain(code);
              }
            }

            // No non-canonical codes appear
            for (const code of codes) {
              expect(CANONICAL_CODES as readonly string[]).toContain(code);
            }
          },
        ),
        { numRuns: 200 },
      );
    },
  );

  it(
    '13b — Operator with empty lineAccess sees no process lines (Req 8.2)',
    () => {
      const items = getSidebarProcessLines('OPERATOR', []);
      expect(items).toHaveLength(0);
    },
  );

  it(
    '13c — Operator with non-canonical codes in lineAccess only sees canonical intersection (Req 8.1)',
    () => {
      fc.assert(
        fc.property(
          lineAccessMixedArb,
          (lineAccess) => {
            const items = getSidebarProcessLines('OPERATOR', lineAccess);
            const codes = items.map((i) => i.code);

            // All visible codes must be canonical
            for (const code of codes) {
              expect(CANONICAL_CODES as readonly string[]).toContain(code);
            }

            // Non-canonical codes in lineAccess must NOT appear
            const nonCanonical = lineAccess.filter(
              (c) => !(CANONICAL_CODES as readonly string[]).includes(c),
            );
            for (const code of nonCanonical) {
              expect(codes).not.toContain(code);
            }
          },
        ),
        { numRuns: 200 },
      );
    },
  );

  it(
    '13d — Supervisor sees canonical lines in their lineAccess scope (Req 8.1)',
    () => {
      fc.assert(
        fc.property(
          lineAccessMixedArb,
          (lineAccess) => {
            const items = getSidebarProcessLines('SUPERVISOR', lineAccess);
            const codes = items.map((i) => i.code);
            const expected =
              lineAccess.length === 0
                ? [...CANONICAL_CODES]
                : lineAccess.filter((c) =>
                    (CANONICAL_CODES as readonly string[]).includes(c),
                  );

            expect(codes.sort()).toEqual([...expected].sort());
          },
        ),
        { numRuns: 100 },
      );
    },
  );

  it(
    '13e — Plant Head sees all canonical process lines regardless of lineAccess (Req 8.1)',
    () => {
      fc.assert(
        fc.property(
          lineAccessMixedArb,
          (lineAccess) => {
            const items = getSidebarProcessLines('PLANT_HEAD', lineAccess);
            const codes = items.map((i) => i.code);

            expect(codes.sort()).toEqual([...CANONICAL_CODES].sort());
          },
        ),
        { numRuns: 100 },
      );
    },
  );

  it(
    '13f — Admin sees all canonical process lines regardless of lineAccess (Req 8.1)',
    () => {
      fc.assert(
        fc.property(
          lineAccessMixedArb,
          (lineAccess) => {
            const items = getSidebarProcessLines('ADMIN', lineAccess);
            const codes = items.map((i) => i.code);

            expect(codes.sort()).toEqual([...CANONICAL_CODES].sort());
          },
        ),
        { numRuns: 100 },
      );
    },
  );

  it(
    '13g — null role returns empty list (unauthenticated)',
    () => {
      const items = getSidebarProcessLines(null, []);
      expect(items).toHaveLength(0);
    },
  );

  it(
    '13h — SPM and REW never appear in the sidebar (non-canonical codes excluded) (Req 8.1)',
    () => {
      fc.assert(
        fc.property(
          roleArb,
          lineAccessMixedArb,
          (role, lineAccess) => {
            const items = getSidebarProcessLines(role, lineAccess);
            const codes = items.map((i) => i.code);

            expect(codes).not.toContain('SPM');
            expect(codes).not.toContain('REW');
          },
        ),
        { numRuns: 200 },
      );
    },
  );

  it(
    '13i — visible codes are always a subset of canonical codes for any role/lineAccess (Req 8.1)',
    () => {
      fc.assert(
        fc.property(
          roleArb,
          lineAccessMixedArb,
          (role, lineAccess) => {
            const items = getSidebarProcessLines(role, lineAccess);
            for (const item of items) {
              expect(CANONICAL_CODES as readonly string[]).toContain(item.code);
            }
          },
        ),
        { numRuns: 300 },
      );
    },
  );
});
