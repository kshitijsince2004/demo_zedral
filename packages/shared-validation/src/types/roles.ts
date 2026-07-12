/** Canonical role source — import from here, do not redefine locally. */

export enum UserRole {
  OPERATOR = 'OPERATOR',
  MACHINE_HEAD = 'MACHINE_HEAD',
  PLANT_HEAD = 'PLANT_HEAD',
  ADMIN = 'ADMIN',
}

export const ROLE_RANK: Record<UserRole, number> = {
  [UserRole.OPERATOR]: 0,
  [UserRole.MACHINE_HEAD]: 1,
  [UserRole.PLANT_HEAD]: 2,
  [UserRole.ADMIN]: 3,
};

export const ROLE_LABELS: Record<UserRole, string> = {
  [UserRole.OPERATOR]: 'Operator',
  [UserRole.MACHINE_HEAD]: 'Machine head',
  [UserRole.PLANT_HEAD]: 'Plant head',
  [UserRole.ADMIN]: 'Admin',
};
