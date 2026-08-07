import { UserRole, normalizeRoles } from '@m1/shared-validation';
import {
  findLineScope,
  meetsAccessLevel,
} from './lineAccessPolicy';
import { AuthError, type AuthUser } from '../services/authService';

/**
 * Narrow authorizer for PPC/CSV plan import (Option A).
 * Does not widen assertLineOperation WRITE semantics used by production paths.
 *
 * Allows: ADMIN; SUPERVISOR with no line scopes (plant-wide) or matching WRITE scope;
 * MACHINE_HEAD / PLANNER with matching WRITE line scope.
 */
export function assertPlanImportAccess(user: AuthUser, line: string): void {
  const code = line.toUpperCase();
  const roles = normalizeRoles(user.roles);

  if (roles.includes(UserRole.ADMIN)) return;

  if (roles.includes(UserRole.PLANT_HEAD)) {
    throw new AuthError(`Forbidden: Plant Head cannot import plans for line ${code}`);
  }

  const isMh = roles.includes(UserRole.MACHINE_HEAD);
  const isSup = roles.includes(UserRole.SUPERVISOR);
  const isPlanner = roles.includes(UserRole.PLANNER);

  if (!isMh && !isSup && !isPlanner) {
    throw new AuthError(`Forbidden: Cannot import plans for line ${code}`);
  }

  // Supervisor with empty lineAccess = plant-wide oversight (seed default).
  if (isSup && user.lineScopes.length === 0) return;

  const scope = findLineScope(user, code);
  if (!scope || !meetsAccessLevel(scope.accessLevel, 'WRITE')) {
    throw new AuthError(`Forbidden: No plan-import write access to line ${code}`);
  }
}
