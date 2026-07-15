import { db } from '../db';
import { isAuthStrict } from '../config/authConfig';
import { verifyPin } from './pinService';

const JWT_EXPIRES_IN = '15m';
const REFRESH_EXPIRES_IN = '7d';

export type LineAccessLevel =
  | 'READ'
  | 'WRITE'
  | 'APPROVE'
  | 'SUBMIT'
  | 'CORRECT'
  | 'OVERRIDE';

export interface LineScope {
  code: string;
  accessLevel: LineAccessLevel;
}

export interface AuthUser {
  id: number;
  username: string;
  roles: string[];
  /** Process line codes — kept for JWT backward compatibility. */
  lineAccess: string[];
  /** Per-line access levels from security.line_access. */
  lineScopes: LineScope[];
  /** Machine codes assigned to MACHINE_HEAD users. */
  machineAccess: string[];
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

export class ServiceUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ServiceUnavailableError';
  }
}

export function isDbConnectionError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException)?.code;
  const message = error instanceof Error ? error.message : String(error);
  return (
    code === 'ECONNREFUSED' ||
    code === 'ECONNRESET' ||
    code === 'ENOTFOUND' ||
    /connect ECONNREFUSED|Connection terminated|connection error/i.test(message)
  );
}

export const exchangeOidcCode = async (_code: string): Promise<AuthUser> => {
  // Legacy OIDC/auth_subject path removed (P8 / E8). Use SuperTokens session auth.
  throw new AuthError('OIDC code exchange is no longer supported');
};



async function recordPinSuccess(userId: number): Promise<void> {
  await db.updateTable('security.app_user')
    .set({
      pin_failed_attempts: 0,
      pin_locked_until: null,
      status: 'ACTIVE',
    })
    .where('user_id', '=', userId)
    .execute();
}

async function verifyUserPin(
  pin: string,
  user: {
    user_id: number;
    pin_hash: string | null;
    status: string;
  },
): Promise<boolean> {
  if (!/^\d{4}$/.test(pin)) {
    return false;
  }

  if (user.pin_hash) {
    return verifyPin(pin, user.pin_hash);
  }

  // Legacy dev fallback only when auth is not strict and no hash is configured.
  if (!isAuthStrict() && pin === '0000') {
    return true;
  }

  return false;
}

/** Verify PIN for the currently authenticated user (screen unlock). */
export async function verifyAuthenticatedUserPin(userId: number, pin: string): Promise<void> {
  const user = await db
    .selectFrom('security.app_user')
    .select(['user_id', 'status', 'pin_hash'])
    .where('user_id', '=', userId)
    .executeTakeFirst();

  if (!user || user.status === 'DISABLED') {
    throw new AuthError('Invalid PIN');
  }

  const pinValid = await verifyUserPin(pin, user);
  if (!pinValid) {
    throw new AuthError('Invalid PIN');
  }

  await recordPinSuccess(user.user_id);
}

const OVERRIDE_ROLES = ['ADMIN', 'PLANT_HEAD', 'MACHINE_HEAD'];

/** Verify PIN belongs to an active user with supervisor override privileges. */
export async function verifySupervisorOverridePin(
  pin: string,
): Promise<{ userId: number; username: string }> {
  if (!/^\d{4}$/.test(pin)) {
    throw new AuthError('Invalid supervisor PIN');
  }

  const candidates = await db
    .selectFrom('security.app_user')
    .innerJoin('security.user_role', 'security.user_role.user_id', 'security.app_user.user_id')
    .innerJoin('security.role', 'security.role.role_id', 'security.user_role.role_id')
    .select([
      'security.app_user.user_id',
      'security.app_user.username',
      'security.app_user.status',
      'security.app_user.pin_hash',
      'security.role.role_name',
    ])
    .where('security.app_user.status', 'in', ['ACTIVE', 'LOCKED'])
    .where('security.role.role_name', 'in', OVERRIDE_ROLES)
    .execute();

  for (const user of candidates) {
    if (await verifyUserPin(pin, user)) {
      await recordPinSuccess(user.user_id);
      return { userId: user.user_id, username: user.username };
    }
  }

  throw new AuthError('Invalid supervisor PIN');
}

export const validateBadgePin = async (badgeId: string, pin: string): Promise<AuthUser> => {
  if (!badgeId?.trim() || !pin?.trim()) {
    throw new AuthError('Missing badge ID or PIN');
  }

  if (!/^\d{4}$/.test(pin)) {
    throw new AuthError('Invalid badge or PIN');
  }

  let user;
  try {
    user = await db.selectFrom('security.app_user')
      .select(['user_id', 'username', 'status', 'pin_hash'])
      .where('emp_code', '=', badgeId.trim())
      .executeTakeFirst();
  } catch (err) {
    if (isDbConnectionError(err)) {
      throw new ServiceUnavailableError(
        'Database unavailable. Start Docker: docker compose up -d db-primary',
      );
    }
    throw err;
  }

  if (!user || user.status === 'DISABLED') {
    throw new AuthError('Invalid badge or PIN');
  }

  const pinValid = await verifyUserPin(pin, user);
  if (!pinValid) {
    throw new AuthError('Invalid badge or PIN');
  }

  await recordPinSuccess(user.user_id);
  return await getUserWithRolesAndAccess(user.user_id, user.username);
};



export async function getUserWithRolesAndAccess(userId: number, username: string): Promise<AuthUser> {
  const rolesRows = await db.selectFrom('security.user_role')
    .innerJoin('security.role', 'security.user_role.role_id', 'security.role.role_id')
    .select('security.role.role_name')
    .where('security.user_role.user_id', '=', userId)
    .execute();
  const roles = rolesRows.map(r => r.role_name);

  const accessRows = await db.selectFrom('security.line_access')
    .innerJoin('master.process', 'security.line_access.process_id', 'master.process.process_id')
    .select(['master.process.code', 'security.line_access.access_level'])
    .where('security.line_access.user_id', '=', userId)
    .execute();

  const lineScopes: LineScope[] = accessRows.map((a) => ({
    code: a.code,
    accessLevel: a.access_level as LineAccessLevel,
  }));
  const lineAccess = lineScopes.map((s) => s.code);

  let machineAccess: string[];
  if (roles.includes('PLANT_HEAD') || roles.includes('ADMIN')) {
    const allMachines = await db.selectFrom('master.machine')
      .select('machine_code')
      .orderBy('machine_code', 'asc')
      .execute();
    machineAccess = allMachines.map((m) => m.machine_code);
  } else {
    const machineRows = await db.selectFrom('security.machine_access')
      .select('machine_code')
      .where('user_id', '=', userId as any)
      .execute();
    machineAccess = machineRows.map((m) => m.machine_code);
  }

  return {
    id: userId,
    username,
    roles,
    lineAccess,
    lineScopes,
    machineAccess,
  };
}

export { assertLineWriteAccess, assertLineOperation } from '../auth/lineAccessPolicy';

export async function getAuthUserBySuperTokensId(stUserId: string): Promise<AuthUser | null> {
  const user = await db.selectFrom('security.app_user')
    .select(['user_id', 'username'])
    .where('supertokens_user_id', '=', stUserId)
    .executeTakeFirst();
    
  if (!user) return null;
  return await getUserWithRolesAndAccess(user.user_id, user.username);
}
