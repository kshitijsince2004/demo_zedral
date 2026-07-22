import { Request, Response, NextFunction } from 'express';
import Session from 'supertokens-node/recipe/session';
import { UserRole, normalizeRoles } from '@m1/shared-validation';
import { AuthUser, LineAccessLevel, resolveSessionAuthUser } from '../services/authService';
import { assertLineOperation, ensureLineScopes } from '../auth/lineAccessPolicy';
import { requestContext } from '../context';

// Extend Express Request to include user
declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = await Session.getSession(req, res, { sessionRequired: false });
    if (!session) {
      return res.status(401).json({ error: 'Unauthenticated' });
    }

    const payload = session.getAccessTokenPayload() as Record<string, unknown>;
    const payloadRoles = normalizeRoles(
      Array.isArray(payload.roles) ? (payload.roles as string[]) : [],
    );
    const payloadLineAccess = Array.isArray(payload.lineAccess)
      ? (payload.lineAccess as string[])
      : [];
    const payloadLineScopes = Array.isArray(payload.lineScopes)
      ? (payload.lineScopes as AuthUser['lineScopes'])
      : [];
    const payloadMachineAccess = Array.isArray(payload.machineAccess)
      ? (payload.machineAccess as string[])
      : [];

    const payloadIdRaw = payload.id;
    const payloadId =
      typeof payloadIdRaw === 'number'
        ? payloadIdRaw
        : Number.parseInt(String(payloadIdRaw ?? ''), 10);

    let user = ensureLineScopes({
      id: Number.isFinite(payloadId) ? payloadId : Number.parseInt(session.getUserId(), 10),
      username: typeof payload.username === 'string' ? payload.username : 'unknown',
      roles: payloadRoles,
      lineAccess: payloadLineAccess,
      lineScopes: payloadLineScopes,
      machineAccess: payloadMachineAccess,
    });

    const stUserId = session.getUserId();
    const liveUser = await resolveSessionAuthUser(stUserId, payload);
    if (liveUser) {
      // Prefer live DB grants for access lists (including empty = revoked).
      // Keep JWT roles/line scopes only if the DB unexpectedly returns none
      // (avoids wiping MACHINE_HEAD mid-session and 403'ing /live/*).
      user = ensureLineScopes({
        ...user,
        id: liveUser.id,
        username: liveUser.username || user.username,
        roles: liveUser.roles.length > 0 ? liveUser.roles : user.roles,
        lineAccess: liveUser.lineAccess.length > 0 ? liveUser.lineAccess : user.lineAccess,
        lineScopes: liveUser.lineScopes.length > 0 ? liveUser.lineScopes : user.lineScopes,
        machineAccess: liveUser.machineAccess,
      });
    }

    req.user = user;
    const store = requestContext.getStore();
    if (store) {
      store.user = user;
    }
    
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
};

export const requireRole = (allowedRoles: UserRole | UserRole[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthenticated' });
    }

    const allowedList = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];
    const roles = normalizeRoles(req.user.roles);
    const allowed = new Set(allowedList.map((r) => String(r)));
    const hasRole = roles.some((role) => allowed.has(role));
    
    if (roles.includes(UserRole.ADMIN) || hasRole) {
      return next();
    }

    return res.status(403).json({ error: 'Forbidden: Insufficient role permissions' });
  };
};

export const requireLineAccess = (operation: LineAccessLevel) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthenticated' });
    }

    const rawProcessId =
      req.params.processId ||
      req.params.processCode ||
      req.body?.processId ||
      req.body?.processLine ||
      req.query.processId;

    if (!rawProcessId || typeof rawProcessId !== 'string') {
      return next();
    }

    try {
      assertLineOperation(req.user, rawProcessId, operation);
      next();
    } catch (error: any) {
      return res.status(403).json({ error: error.message || 'Forbidden' });
    }
  };
};
