import { ValidationResult, UserRole } from '../types';

export interface OverrideRequest {
  field: string; // The specific field being overridden
  reason: string; // The business reason provided by the machine head/admin
}

/**
 * Validates whether a given set of override requests can be accepted for a ValidationResult.
 * Rules:
 * 1. Overrides cannot bypass BLOCK severity errors.
 * 2. The user attempting the override must be a MACHINE_HEAD or ADMIN.
 * 3. A valid reason must be provided for every WARN level error being overridden.
 *
 * @param result The ValidationResult containing errors/warnings.
 * @param overrides The requested overrides.
 * @param userRoles Roles of the user attempting the override.
 * @returns boolean True if the overrides are sufficient and allowed.
 */
export const canOverride = (
  result: ValidationResult,
  overrides: OverrideRequest[],
  userRoles: UserRole[]
): boolean => {
  // If there are BLOCK errors, they can NEVER be overridden
  const hasBlockErrors = result.errors.some((err) => err.severity === 'BLOCK');
  if (hasBlockErrors) {
    return false;
  }

  // Check role authorization
  const isAuthorized = userRoles.includes(UserRole.MACHINE_HEAD) || userRoles.includes(UserRole.ADMIN);
  if (!isAuthorized && (result.errors.length > 0 || result.warnings.length > 0)) {
    return false;
  }

  // All WARN level errors/warnings must have a corresponding override request
  const warnIssues = [...result.errors.filter(e => e.severity === 'WARN'), ...result.warnings];
  
  const remainingOverrides = [...overrides];
  for (const issue of warnIssues) {
    const overrideIndex = remainingOverrides.findIndex((o) => o.field === issue.field);
    const override = overrideIndex >= 0 ? remainingOverrides[overrideIndex] : undefined;
    if (!override || override.reason.trim().length === 0) {
      return false; // Missing override reason for a warn issue
    }
    remainingOverrides.splice(overrideIndex, 1);
  }

  return true;
};
