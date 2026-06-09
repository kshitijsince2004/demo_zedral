/** Canonical role source — import from here, do not redefine locally. */

export enum UserRole {
  OPERATOR = 'OPERATOR',
  MACHINE_HEAD = 'MACHINE_HEAD',
  SUPERVISOR = 'SUPERVISOR',
  PLANT_HEAD = 'PLANT_HEAD',
  ADMIN = 'ADMIN',
}

export const ROLE_RANK: Record<UserRole, number> = {
  [UserRole.OPERATOR]: 0,
  [UserRole.MACHINE_HEAD]: 1,
  [UserRole.SUPERVISOR]: 2,
  [UserRole.PLANT_HEAD]: 3,
  [UserRole.ADMIN]: 4,
};

export const ROLE_LABELS: Record<UserRole, string> = {
  [UserRole.OPERATOR]: 'Operator',
  [UserRole.MACHINE_HEAD]: 'Machine head',
  [UserRole.SUPERVISOR]: 'Supervisor',
  [UserRole.PLANT_HEAD]: 'Plant head',
  [UserRole.ADMIN]: 'Admin',
};
