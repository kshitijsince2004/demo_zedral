import { UserRole } from '@m1/shared-validation';
import { logAuthorizationDenied } from './authorizationAudit';
import { AuthError, AuthUser, LineAccessLevel, LineScope } from '../services/authService';

const LEVEL_RANK: Record<LineAccessLevel, number> = {
  READ: 1,
  WRITE: 2,
  APPROVE: 3,
  SUBMIT: 2,
  CORRECT: 2,
  OVERRIDE: 3,
};

export function meetsAccessLevel(
  actual: LineAccessLevel,
  required: LineAccessLevel,
): boolean {
  return LEVEL_RANK[actual] >= LEVEL_RANK[required];
}

export function findLineScope(user: AuthUser, processCode: string): LineScope | undefined {
  const normalized = processCode.toUpperCase();
  return user.lineScopes.find((s) => s.code.toUpperCase() === normalized);
}

/** null = unrestricted (all lines) for the given operation. */
export function getScopedLineCodes(
  user: AuthUser,
  minLevel: LineAccessLevel,
): string[] | null {
  if (user.roles.includes(UserRole.ADMIN as string)) {
    return null;
  }

  if (minLevel === 'READ' && user.roles.includes(UserRole.PLANT_HEAD as string)) {
    return null;
  }

  return user.lineScopes
    .filter((s) => meetsAccessLevel(s.accessLevel, minLevel))
    .map((s) => s.code.toUpperCase());
}

function denyPlantHeadMutation(
  user: AuthUser,
  operation: LineAccessLevel,
  processCode: string,
): never {
  const primaryRole = user.roles.includes(UserRole.PLANT_HEAD as string)
    ? UserRole.PLANT_HEAD
    : user.roles[0] ?? 'UNKNOWN';
  void logAuthorizationDenied(
    user.id,
    primaryRole,
    operation,
    `line:${processCode}`,
  );
  throw new AuthError(
    `Plant Head has read-only access. Operation '${operation}' is not permitted.`,
  );
}

export function assertLineOperation(
  user: AuthUser,
  processCode: string,
  operation: LineAccessLevel,
): void {
  const code = processCode.toUpperCase();

  if (user.roles.includes(UserRole.ADMIN as string)) {
    return;
  }

  if (operation === 'READ') {
    if (user.roles.includes(UserRole.PLANT_HEAD as string)) {
      return;
    }
    const scope = findLineScope(user, code);
    if (!scope || !meetsAccessLevel(scope.accessLevel, 'READ')) {
      throw new AuthError(`Forbidden: No read access to line ${code}`);
    }
    return;
  }

  if (user.roles.includes(UserRole.PLANT_HEAD as string)) {
    if (operation === 'READ') return;
    if (operation === 'APPROVE' || operation === 'OVERRIDE') return;
    denyPlantHeadMutation(user, operation, code);
  }

  if (operation === 'WRITE' || operation === 'SUBMIT' || operation === 'CORRECT') {
    const canWriteRole =
      user.roles.includes(UserRole.OPERATOR as string) ||
      user.roles.includes(UserRole.SUPERVISOR as string) ||
      user.roles.includes(UserRole.MACHINE_HEAD as string);
    if (!canWriteRole) {
      throw new AuthError(`Forbidden: Cannot write on line ${code}`);
    }
    const scope = findLineScope(user, code);
    if (!scope || !meetsAccessLevel(scope.accessLevel, 'WRITE')) {
      throw new AuthError(`Forbidden: No write access to line ${code}`);
    }
    return;
  }

  if (operation === 'APPROVE' || operation === 'OVERRIDE') {
    if (user.roles.includes(UserRole.PLANT_HEAD as string)) {
      return;
    }
    if (!user.roles.includes(UserRole.SUPERVISOR as string)) {
      throw new AuthError('Forbidden: Only supervisors may approve on a line');
    }
    const scope = findLineScope(user, code);
    if (!scope || !meetsAccessLevel(scope.accessLevel, 'APPROVE')) {
      throw new AuthError(`Forbidden: No approve access to line ${code}`);
    }
  }
}

/** Back-compat alias used by sync batch replay. */
export function assertLineWriteAccess(user: AuthUser, processCode: string): void {
  assertLineOperation(user, processCode, 'WRITE');
}

export function ensureLineScopes(user: AuthUser): AuthUser {
  if (user.lineScopes?.length) {
    return user;
  }

  const lineAccess = user.lineAccess ?? [];
  if (lineAccess.length === 0) {
    return { ...user, lineScopes: [] };
  }

  let defaultLevel: LineAccessLevel = 'READ';
  if (user.roles.includes(UserRole.SUPERVISOR as string)) {
    defaultLevel = 'APPROVE';
  } else if (
    (user.roles.includes(UserRole.OPERATOR as string) ||
      user.roles.includes(UserRole.MACHINE_HEAD as string)) &&
    !user.roles.includes(UserRole.PLANT_HEAD as string)
  ) {
    defaultLevel = 'WRITE';
  }

  return {
    ...user,
    lineScopes: lineAccess.map((code) => ({
      code: code.toUpperCase(),
      accessLevel: defaultLevel,
    })),
  };
}
