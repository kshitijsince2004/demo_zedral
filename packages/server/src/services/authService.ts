import jwt from 'jsonwebtoken';
import { db } from '../db';
import { getJwtSecret, isAuthStrict } from '../config/authConfig';
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

export const exchangeOidcCode = async (code: string): Promise<AuthUser> => {
  if (code === 'mock-oidc-error') {
    throw new AuthError('Invalid OIDC code');
  }

  const user = await db.selectFrom('security.app_user')
    .selectAll()
    .where('auth_subject', '=', code)
    .where('status', '=', 'ACTIVE')
    .executeTakeFirst();

  if (!user) {
    throw new AuthError('User not found or inactive');
  }

  return await getUserWithRolesAndAccess(user.user_id, user.username);
};

export const generateTokens = (user: AuthUser) => {
  const secret = getJwtSecret();
  const payload = {
    id: user.id,
    username: user.username,
    roles: user.roles,
    lineAccess: user.lineAccess,
    lineScopes: user.lineScopes,
    machineAccess: user.machineAccess,
  };

  const accessToken = jwt.sign(payload, secret, { expiresIn: JWT_EXPIRES_IN });
  const refreshToken = jwt.sign({ id: user.id }, secret, { expiresIn: REFRESH_EXPIRES_IN });

  return {
    accessToken,
    refreshToken,
    expiresIn: 15 * 60,
  };
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
  }
): Promise<boolean> {
  if (user.pin_hash) {
    return verifyPin(pin, user.pin_hash);
  }

  // Legacy dev fallback only when auth is not strict and no hash is configured.
  if (!isAuthStrict() && pin === '0000') {
    return true;
  }

  return false;
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

export const verifyToken = (token: string): AuthUser => {
  return jwt.verify(token, getJwtSecret()) as AuthUser;
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
      .where('user_id', '=', userId)
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
