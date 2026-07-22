import type { UserAccess } from '../services/adminService';

/**
 * Fallback assignable mills when the machine registry has not loaded yet.
 * Prefer `fetchMachineRegistry()` for live chips in admin UIs.
 */
export const MACHINE_OPTIONS = ['6HI', '4HI', '2HI', 'PKL', 'ANN', 'RWD', 'CRS', 'CTL', 'HRS'] as const;

export function hasImplicitAllMachines(role: UserAccess['role']): boolean {
  return role === 'PLANT_HEAD' || role === 'ADMIN';
}

/** Prefer machine_access; fall back to legacy line_access for edit form. */
export function resolveMachineAccess(user: UserAccess): string[] {
  if (hasImplicitAllMachines(user.role)) {
    // Admin/PH get implicit all — keep any server-provided list for display sync.
    if (user.machine_access?.length) return [...user.machine_access];
    return [...MACHINE_OPTIONS];
  }
  if (user.machine_access?.length) return [...user.machine_access];
  return (user.line_access ?? []).map((la) => la.line_id);
}
