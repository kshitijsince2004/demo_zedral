import { Request, Response, NextFunction } from 'express';
import { UserRole } from '@m1/shared-validation';
import { verifyToken, AuthUser, LineAccessLevel } from '../services/authService';
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

export const requireAuth = (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or malformed Authorization header' });
    }

    const token = authHeader.split(' ')[1];
    const user = ensureLineScopes(verifyToken(token) as AuthUser);

    req.user = user;
    const store = requestContext.getStore();
    if (store) {
      store.user = user;
    }
    
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

export const requireRole = (allowedRoles: UserRole[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthenticated' });
    }

    const hasRole = req.user.roles.some((role) => allowedRoles.includes(role as UserRole));
    
    if (req.user.roles.includes(UserRole.ADMIN as string) || hasRole) {
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
