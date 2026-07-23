import { describe, it, expect } from 'vitest';
import { ROLE_RANK, UserRole } from '@m1/shared-validation';
import type { Role } from '../src/lib/authStore';

/** Mirrors RoleRoute rank + allow escape. */
function canAccess(userRole: Role | null, minRole: Role, allow?: UserRole[]): boolean {
  if (!userRole) return false;
  const userRank = ROLE_RANK[userRole as UserRole];
  const requiredRank = ROLE_RANK[minRole as UserRole];
  const passesRank = userRank != null && requiredRank != null && userRank >= requiredRank;
  const passesAllow = allow?.includes(userRole as UserRole) ?? false;
  return passesRank || passesAllow;
}

const SUPERVISOR_PAGES: { path: string; minRole: Role; allow?: UserRole[] }[] = [
  { path: '/live', minRole: UserRole.MACHINE_HEAD, allow: [UserRole.SUPERVISOR] },
  { path: '/machine-head-dashboard', minRole: UserRole.MACHINE_HEAD, allow: [UserRole.SUPERVISOR] },
  { path: '/import/rolling', minRole: UserRole.MACHINE_HEAD, allow: [UserRole.SUPERVISOR] },
  { path: '/order-assignment', minRole: UserRole.MACHINE_HEAD, allow: [UserRole.SUPERVISOR] },
  { path: '/machine-head/traceability', minRole: UserRole.MACHINE_HEAD, allow: [UserRole.SUPERVISOR] },
];

const HIDDEN_FROM_SUPERVISOR: { path: string; minRole: Role; allow?: UserRole[] }[] = [
  { path: '/machine-head/crew', minRole: UserRole.MACHINE_HEAD },
  { path: '/machine-head/shift-review', minRole: UserRole.MACHINE_HEAD },
  { path: '/machine-head/dpr-export', minRole: UserRole.MACHINE_HEAD },
  { path: '/plant', minRole: UserRole.MACHINE_HEAD }, // PlantRoute
  { path: '/admin/users', minRole: UserRole.ADMIN },
  { path: '/admin/master-data', minRole: UserRole.ADMIN },
  { path: '/admin/validation-rules', minRole: UserRole.ADMIN },
];

describe('Supervisor RoleRoute allow escape', () => {
  it('grants the four approved pages via allow without MH rank', () => {
    for (const page of SUPERVISOR_PAGES) {
      expect(canAccess(UserRole.SUPERVISOR, page.minRole, page.allow)).toBe(true);
    }
  });

  it('denies MH/Plant/Admin pages without allow (no rank inheritance)', () => {
    for (const page of HIDDEN_FROM_SUPERVISOR) {
      expect(canAccess(UserRole.SUPERVISOR, page.minRole, page.allow)).toBe(false);
    }
  });

  it('does not grant MH pages when allow is omitted', () => {
    expect(canAccess(UserRole.SUPERVISOR, UserRole.MACHINE_HEAD)).toBe(false);
  });
});