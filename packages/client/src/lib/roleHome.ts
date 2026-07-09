import type { Role } from './authStore';
import { resolvePrimaryMachinePath } from './machineRouting';
import { usesUserScopeHome, userScopePath } from './userScope';

export interface RoleHomeContext {
  lineAccess?: string[];
  machineAccess?: string[];
  username?: string | null;
}

/** Role-native landing route after login or root redirect. */
export function getRoleHomePath(
  role: Role | null,
  lineAccess?: string[],
  machineAccess?: string[],
  username?: string | null,
): string {
  const lines = lineAccess ?? [];
  const machines = machineAccess ?? [];

  switch (role) {
    case 'MACHINE_HEAD':
      return '/machine-head-dashboard';
    case 'SUPERVISOR': {
      if (username && usesUserScopeHome(role)) {
        return userScopePath(username, role);
      }
      return '/plant';
    }
    case 'OPERATOR': {
      if (username && usesUserScopeHome(role)) {
        return userScopePath(username, role);
      }
      const primary = resolvePrimaryMachinePath(role, machines, lines);
      return primary ?? '/coming-soon';
    }
    case 'PLANT_HEAD':
      return '/plant';
    case 'ADMIN':
      return '/admin/master-data';
    default:
      return '/login';
  }
}
