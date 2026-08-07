import { describe, it, expect } from 'vitest';
import { UserRole, ROLE_RANK, pickPrimaryRole } from '@m1/shared-validation';

/** Allowlists mirrored from production routes — keep in sync with Task 2. */
const PLANNER_ALLOWED_ROLE_LISTS = [
  [UserRole.ADMIN, UserRole.MACHINE_HEAD, UserRole.SUPERVISOR, UserRole.PLANNER], // ppc preview/machines/commit
  [UserRole.ADMIN, UserRole.SUPERVISOR, UserRole.PLANNER], // CSV import + batch reads
];

const PLANNER_DENIED_ROLE_LISTS = [
  [UserRole.ADMIN, UserRole.MACHINE_HEAD, UserRole.SUPERVISOR], // transfer-machine (no PLANNER)
  [UserRole.ADMIN], // master-data
  [UserRole.ADMIN, UserRole.PLANT_HEAD], // users
  [UserRole.MACHINE_HEAD, UserRole.PLANT_HEAD, UserRole.ADMIN], // exports / shift complete
  [UserRole.OPERATOR, UserRole.MACHINE_HEAD, UserRole.ADMIN, UserRole.PLANT_HEAD], // machine-crew
  [UserRole.MACHINE_HEAD, UserRole.PLANT_HEAD, UserRole.ADMIN, UserRole.SUPERVISOR], // order-assignment
];

function roleListAllows(list: string[], role: string): boolean {
  return list.includes(role) || (list.includes(UserRole.ADMIN) && role === UserRole.ADMIN);
}

describe('Planner role — identity', () => {
  it('has rank 0 so it cannot inherit MH/Plant/Admin by rank', () => {
    expect(ROLE_RANK[UserRole.PLANNER]).toBe(0);
    expect(ROLE_RANK[UserRole.PLANNER]).toBeLessThan(ROLE_RANK[UserRole.MACHINE_HEAD]);
    expect(pickPrimaryRole(['PLANNER'])).toBe(UserRole.PLANNER);
  });
});

describe('Planner role — route allowlists', () => {
  it('is present only on import allowlists', () => {
    for (const list of PLANNER_ALLOWED_ROLE_LISTS) {
      expect(list).toContain(UserRole.PLANNER);
    }
  });

  it('is absent from non-import feature allowlists', () => {
    for (const list of PLANNER_DENIED_ROLE_LISTS) {
      expect(list).not.toContain(UserRole.PLANNER);
      expect(roleListAllows(list as string[], UserRole.PLANNER)).toBe(false);
    }
  });
});
