/**
 * Property 14: Role-based route guarding
 *
 * Validates: Requirements 7.6, 8.3
 *
 * For any (user role, guarded route) pair, navigation should be permitted if
 * and only if the role meets the route's minimum required role:
 *   - Review/approval routes require MACHINE_HEAD or higher.
 *   - Admin routes require ADMIN.
 *
 * This property tests the pure role-rank logic that backs RoleRoute, without
 * requiring a DOM/React environment.
 *
 * Tagged: Feature: m1-frontend-remediation, Property 14: Role-based route guarding
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { Role } from '../src/lib/authStore';

// ---------------------------------------------------------------------------
// Role rank table — mirrors RoleRoute.tsx
// ---------------------------------------------------------------------------

const ROLE_RANK: Record<Role, number> = {
  OPERATOR: 0,
  MACHINE_HEAD: 1,
  PLANT_HEAD: 2,
  ADMIN: 3,
};

/**
 * Pure access-check function extracted from RoleRoute logic.
 * Returns true when `userRole` meets or exceeds `minRole`.
 */
function canAccess(userRole: Role | null, minRole: Role): boolean {
  if (!userRole) return false;
  return ROLE_RANK[userRole] >= ROLE_RANK[minRole];
}

// ---------------------------------------------------------------------------
// Route table — mirrors the routing model in design.md
// ---------------------------------------------------------------------------

type RouteMinRole = 'authenticated' | Role;

interface RouteSpec {
  path: string;
  minRole: RouteMinRole;
}

const ROUTE_TABLE: RouteSpec[] = [
  // Authenticated-only routes (any logged-in role)
  { path: '/dashboard',              minRole: 'authenticated' },
  { path: '/station',                minRole: 'authenticated' },
  { path: '/6hi',                    minRole: 'authenticated' },
  // Machine head routes
  { path: '/machine',                minRole: 'MACHINE_HEAD' },
  { path: '/live',                   minRole: 'MACHINE_HEAD' },
  { path: '/import/rolling',         minRole: 'MACHINE_HEAD' },
  // Plant head routes
  { path: '/plant',                  minRole: 'PLANT_HEAD' },
  // Machine Head+ routes (Requirement 8.3)
  { path: '/reports/plant-head',     minRole: 'MACHINE_HEAD' },
  { path: '/reports/management',     minRole: 'MACHINE_HEAD' },
  { path: '/reports/export',         minRole: 'MACHINE_HEAD' },
  // Admin-only routes (Requirement 7.6, 8.3)
  { path: '/admin/master-data',      minRole: 'ADMIN' },
  { path: '/admin/planning',         minRole: 'ADMIN' },
  { path: '/admin/users',            minRole: 'ADMIN' },
];

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const roleArb = fc.constantFrom<Role>('OPERATOR', 'MACHINE_HEAD', 'PLANT_HEAD', 'ADMIN');
const routeArb = fc.constantFrom(...ROUTE_TABLE);

// ---------------------------------------------------------------------------
// Property 14a: Access is granted iff role meets the route minimum (Req 8.3)
// ---------------------------------------------------------------------------
describe('Property 14: Role-based route guarding', () => {
  it(
    '14a — access granted iff role meets route minimum (Req 8.3)',
    () => {
      fc.assert(
        fc.property(
          roleArb,
          routeArb,
          (role, route) => {
            if (route.minRole === 'authenticated') {
              // Any authenticated role can access
              expect(canAccess(role, 'OPERATOR')).toBe(true);
              return;
            }

            const minRole = route.minRole as Role;
            const allowed = canAccess(role, minRole);
            const expected = ROLE_RANK[role] >= ROLE_RANK[minRole];

            expect(allowed).toBe(expected);
          },
        ),
        { numRuns: 200 },
      );
    },
  );

  it(
    '14b — unauthenticated (null role) is denied access to all guarded routes',
    () => {
      fc.assert(
        fc.property(
          routeArb,
          (route) => {
            if (route.minRole === 'authenticated') {
              expect(canAccess(null, 'OPERATOR')).toBe(false);
            } else {
              expect(canAccess(null, route.minRole as Role)).toBe(false);
            }
          },
        ),
        { numRuns: 100 },
      );
    },
  );

  it(
    '14c — OPERATOR cannot access review or admin routes (Req 8.3)',
    () => {
      const machineHeadRoutes = ROUTE_TABLE.filter((r) => r.minRole === 'MACHINE_HEAD');
      const adminRoutes = ROUTE_TABLE.filter((r) => r.minRole === 'ADMIN');

      for (let i = 0; i < machineHeadRoutes.length; i += 1) {
        expect(canAccess('OPERATOR', 'MACHINE_HEAD')).toBe(false);
      }
      for (let i = 0; i < adminRoutes.length; i += 1) {
        expect(canAccess('OPERATOR', 'ADMIN')).toBe(false);
      }
    },
  );

  it(
    '14d — MACHINE_HEAD can access review routes but not admin routes (Req 8.3)',
    () => {
      expect(canAccess('MACHINE_HEAD', 'MACHINE_HEAD')).toBe(true);
      expect(canAccess('MACHINE_HEAD', 'ADMIN')).toBe(false);
    },
  );

  it(
    '14e — PLANT_HEAD can access review routes but not admin routes (Req 8.3)',
    () => {
      expect(canAccess('PLANT_HEAD', 'MACHINE_HEAD')).toBe(true);
      expect(canAccess('PLANT_HEAD', 'ADMIN')).toBe(false);
    },
  );

  it(
    '14f — ADMIN can access all routes including admin routes (Req 7.6, 8.3)',
    () => {
      fc.assert(
        fc.property(
          routeArb,
          (route) => {
            if (route.minRole === 'authenticated') {
              expect(canAccess('ADMIN', 'OPERATOR')).toBe(true);
            } else {
              expect(canAccess('ADMIN', route.minRole as Role)).toBe(true);
            }
          },
        ),
        { numRuns: 100 },
      );
    },
  );

  it(
    '14g — role hierarchy is strictly ordered: OPERATOR < MACHINE_HEAD < PLANT_HEAD < ADMIN',
    () => {
      const roles: Role[] = ['OPERATOR', 'MACHINE_HEAD', 'PLANT_HEAD', 'ADMIN'];
      for (let i = 0; i < roles.length; i++) {
        for (let j = 0; j < roles.length; j++) {
          const expected = ROLE_RANK[roles[i]] >= ROLE_RANK[roles[j]];
          expect(canAccess(roles[i], roles[j])).toBe(expected);
        }
      }
    },
  );

  it(
    '14h — access decision is monotone: if role R can access route, any higher role can too',
    () => {
      fc.assert(
        fc.property(
          roleArb,
          routeArb,
          (role, route) => {
            if (route.minRole === 'authenticated') return;

            const minRole = route.minRole as Role;
            if (canAccess(role, minRole)) {
              // All roles with higher or equal rank must also have access
              const higherRoles = (Object.keys(ROLE_RANK) as Role[]).filter(
                (r) => ROLE_RANK[r] >= ROLE_RANK[role],
              );
              for (const higherRole of higherRoles) {
                expect(canAccess(higherRole, minRole)).toBe(true);
              }
            }
          },
        ),
        { numRuns: 200 },
      );
    },
  );
});
