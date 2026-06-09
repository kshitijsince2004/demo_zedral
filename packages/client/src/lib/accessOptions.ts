import type { UserAccess } from '../services/adminService';

/** Assignable mills/lines (machine_access; line_access is synced on save). */
export const MACHINE_OPTIONS = ['6HI', '4HI', '2HI', 'PKL', 'ANN', 'RWD', 'CRS', 'CTL', 'HRS'] as const;

export function hasImplicitAllMachines(role: UserAccess['role']): boolean {
  return role === 'PLANT_HEAD' || role === 'ADMIN';
}

/** Prefer machine_access; fall back to legacy line_access for edit form. */
export function resolveMachineAccess(user: UserAccess): string[] {
  if (hasImplicitAllMachines(user.role)) return [...MACHINE_OPTIONS];
  if (user.machine_access?.length) return [...user.machine_access];
  return (user.line_access ?? []).map((la) => la.line_id);
}
